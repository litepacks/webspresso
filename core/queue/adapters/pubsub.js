/**
 * Google Cloud Pub/Sub Queue Adapter for Webspresso
 * Zero-dependency: Uses standard Node.js https/crypto with standard Google Cloud Pub/Sub REST API.
 * Supports official @google-cloud/pubsub client, duck-typed client, or direct REST calls.
 * Supports pull worker loop and Cloud Run Push Subscription HTTP webhook processing.
 *
 * @module core/queue/adapters/pubsub
 */

'use strict';

const https = require('https');
const { Job } = require('../job');

/**
 * Execute HTTPS request to Google Cloud Pub/Sub REST endpoint
 * @param {string} urlStr
 * @param {Object} options
 * @returns {Promise<{ statusCode: number, data: string, json: any }>}
 */
function makePubSubRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);

    const req = https.request(parsedUrl, {
      method: options.method || 'POST',
      headers: options.headers || {},
      timeout: options.timeout || 15000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode || 200,
          data: body,
          json,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`[PubSubQueueAdapter] Request to ${urlStr} timed out`));
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

class PubSubQueueAdapter {
  /**
   * @param {Object} options
   * @param {string} [options.projectId] - Google Cloud Project ID
   * @param {string} options.topic - Pub/Sub topic name or full path (projects/P/topics/T)
   * @param {string} [options.subscription] - Pub/Sub subscription name or full path
   * @param {string} [options.token] - Bearer token for Google API calls
   * @param {Object} [options.pubsubClient] - Optional @google-cloud/pubsub client
   */
  constructor(options = {}) {
    this.projectId = options.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'default';
    this.topic = this._normalizeTopicName(options.topic);
    this.subscription = options.subscription ? this._normalizeSubscriptionName(options.subscription) : null;
    this.token = options.token || process.env.GCP_ACCESS_TOKEN || null;
    this.client = options.pubsubClient || null;
    this.httpTransport = options.httpTransport || makePubSubRequest;

    /** @type {Map<string|number, string>} Map jobId -> ackId */
    this.ackIds = new Map();
  }

  _normalizeTopicName(name) {
    if (!name) return '';
    if (name.startsWith('projects/')) return name;
    return `projects/${this.projectId}/topics/${name}`;
  }

  _normalizeSubscriptionName(name) {
    if (!name) return null;
    if (name.startsWith('projects/')) return name;
    return `projects/${this.projectId}/subscriptions/${name}`;
  }

  /**
   * Send Pub/Sub request
   * @private
   */
  async _call(urlPath, body = {}) {
    if (this.client) {
      return this.client.request({ method: 'POST', url: urlPath, data: body });
    }

    const url = `https://pubsub.googleapis.com/v1/${urlPath}`;
    const headers = {
      'content-type': 'application/json',
    };

    if (this.token) {
      headers['authorization'] = `Bearer ${this.token}`;
    }

    const res = await this.httpTransport(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (res.statusCode >= 300) {
      const errMsg = res.json?.error?.message || res.data || `HTTP ${res.statusCode}`;
      throw new Error(`[PubSubQueueAdapter] Request to ${urlPath} failed (${res.statusCode}): ${errMsg}`);
    }

    return res.json || {};
  }

  /**
   * Enqueue job by publishing message to Google Cloud Pub/Sub
   * @param {Job} job
   * @returns {Promise<Job>}
   */
  async enqueue(job) {
    const jobInstance = job instanceof Job ? job : new Job(job);

    const messagePayload = {
      id: jobInstance.id,
      name: jobInstance.name,
      data: jobInstance.data,
      attempts: jobInstance.attempts,
      maxAttempts: jobInstance.maxAttempts,
      priority: jobInstance.priority,
      runAt: jobInstance.runAt ? jobInstance.runAt.toISOString() : null,
      createdAt: jobInstance.createdAt ? jobInstance.createdAt.toISOString() : new Date().toISOString(),
    };

    const base64Data = Buffer.from(JSON.stringify(messagePayload)).toString('base64');

    if (this.client && typeof this.client.topic === 'function') {
      const topicObj = this.client.topic(this.topic.replace(/^projects\/[^/]+\/topics\//, ''));
      const messageId = await topicObj.publishMessage({
        data: Buffer.from(JSON.stringify(messagePayload)),
        attributes: {
          jobName: jobInstance.name,
          priority: String(jobInstance.priority),
        },
      });
      jobInstance._pubsubMessageId = messageId;
      return jobInstance;
    }

    const res = await this._call(`${this.topic}:publish`, {
      messages: [
        {
          data: base64Data,
          attributes: {
            jobName: jobInstance.name,
            priority: String(jobInstance.priority),
          },
        },
      ],
    });

    if (res.messageIds && res.messageIds.length > 0) {
      jobInstance._pubsubMessageId = res.messageIds[0];
    }

    return jobInstance;
  }

  /**
   * Dequeue single job from subscription via pull
   * @param {string[]} [jobNames]
   * @returns {Promise<Job|null>}
   */
  async dequeue(jobNames = []) {
    if (!this.subscription) {
      return null; // Push-only mode or no subscription configured
    }

    let receivedMessages = [];

    if (this.client && typeof this.client.subscription === 'function') {
      const subObj = this.client.subscription(this.subscription.replace(/^projects\/[^/]+\/subscriptions\//, ''));
      if (typeof subObj.pull === 'function') {
        const [pullRes] = await subObj.pull({ maxMessages: 1 });
        receivedMessages = pullRes.receivedMessages || [];
      }
    } else {
      const res = await this._call(`${this.subscription}:pull`, {
        maxMessages: 1,
        returnImmediately: false,
      });
      receivedMessages = res.receivedMessages || [];
    }

    if (receivedMessages.length === 0) {
      return null;
    }

    const received = receivedMessages[0];
    const ackId = received.ackId;
    const msg = received.message || {};

    let payload = {};
    try {
      const decoded = Buffer.from(msg.data || '', 'base64').toString('utf8');
      payload = JSON.parse(decoded);
    } catch (_) {
      payload = { name: msg.attributes?.jobName || 'raw', data: {} };
    }

    const job = new Job({
      id: payload.id || msg.messageId,
      name: payload.name || msg.attributes?.jobName || 'default',
      data: payload.data || {},
      status: 'running',
      attempts: (payload.attempts || 0) + 1,
      maxAttempts: payload.maxAttempts ?? 3,
      priority: payload.priority ? Number(payload.priority) : 10,
      runAt: payload.runAt ? new Date(payload.runAt) : new Date(),
    });

    job._ackId = ackId;
    this.ackIds.set(job.id, ackId);

    // If job does not match expected handlers, modify ack deadline to 0 so other workers can process
    if (jobNames.length > 0 && !jobNames.includes(job.name)) {
      await this.retry(job.id, 0);
      return null;
    }

    return job;
  }

  /**
   * Acknowledge completed message
   * @param {string|number} jobId
   * @param {any} [result]
   * @returns {Promise<Job|null>}
   */
  async complete(jobId, result = null) {
    const ackId = this.ackIds.get(jobId);
    if (ackId && this.subscription) {
      try {
        await this._call(`${this.subscription}:acknowledge`, {
          ackIds: [ackId],
        });
      } finally {
        this.ackIds.delete(jobId);
      }
    }

    return new Job({
      id: jobId,
      status: 'completed',
      result,
      updatedAt: new Date(),
    });
  }

  /**
   * Mark job failed (acknowledges to prevent indefinite loop or sends to dead-letter)
   * @param {string|number} jobId
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async fail(jobId, error = null) {
    const ackId = this.ackIds.get(jobId);
    if (ackId && this.subscription) {
      try {
        await this._call(`${this.subscription}:acknowledge`, {
          ackIds: [ackId],
        });
      } finally {
        this.ackIds.delete(jobId);
      }
    }

    return new Job({
      id: jobId,
      status: 'failed',
      error,
      updatedAt: new Date(),
    });
  }

  /**
   * Reschedule job by modifying ack deadline
   * @param {string|number} jobId
   * @param {number} delayMs
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async retry(jobId, delayMs, error = null) {
    const ackId = this.ackIds.get(jobId);
    if (ackId && this.subscription) {
      const ackDeadlineSeconds = Math.min(600, Math.max(0, Math.ceil(delayMs / 1000)));
      try {
        await this._call(`${this.subscription}:modifyAckDeadline`, {
          ackIds: [ackId],
          ackDeadlineSeconds,
        });
      } finally {
        this.ackIds.delete(jobId);
      }
    }

    return new Job({
      id: jobId,
      status: 'pending',
      error,
      updatedAt: new Date(),
    });
  }

  /**
   * Process a Google Cloud Pub/Sub Push Subscription HTTP request (Cloud Run / Webhook)
   * @param {Object} req - Incoming Express / Node HTTP request
   * @param {Object} res - Outgoing response
   * @param {import('../manager').QueueManager} queueManager
   * @returns {Promise<boolean>}
   */
  async processPushRequest(req, res, queueManager) {
    const body = req.body || {};
    const message = body.message;

    if (!message) {
      if (res && typeof res.status === 'function') {
        res.status(400).send('Bad Request: Missing Pub/Sub message payload');
      }
      return false;
    }

    let payload = {};
    try {
      const decoded = Buffer.from(message.data || '', 'base64').toString('utf8');
      payload = JSON.parse(decoded);
    } catch (_) {
      payload = { name: message.attributes?.jobName || 'raw', data: {} };
    }

    const jobName = payload.name || message.attributes?.jobName;
    const handlerDef = queueManager?.handlers?.get(jobName);

    if (!handlerDef || typeof handlerDef.handler !== 'function') {
      // Return 200/204 to acknowledge unhandled job type so it doesn't loop
      if (res && typeof res.status === 'function') {
        res.status(204).end();
      }
      return true;
    }

    const job = new Job({
      id: payload.id || message.messageId,
      name: jobName,
      data: payload.data || {},
      priority: payload.priority ? Number(payload.priority) : 10,
      runAt: payload.runAt ? new Date(payload.runAt) : new Date(),
    });

    try {
      job.status = 'running';
      job.startedAt = new Date();
      queueManager.emit('job:start', job);

      const result = await handlerDef.handler(job, { queue: queueManager, req });
      job.status = 'completed';
      job.result = result;
      job.completedAt = new Date();
      queueManager.emit('job:completed', job, result);

      if (res && typeof res.status === 'function') {
        res.status(200).send('OK');
      }
      return true;
    } catch (err) {
      job.status = 'failed';
      job.error = err;
      queueManager.emit('job:failed', job, err);

      // Return 500 so Pub/Sub push subscription automatically retries with backoff
      if (res && typeof res.status === 'function') {
        res.status(500).send(`Job failed: ${err.message}`);
      }
      throw err;
    }
  }
}

module.exports = {
  PubSubQueueAdapter,
  makePubSubRequest,
};
