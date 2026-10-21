/**
 * AWS SQS Queue Adapter for Webspresso
 * Zero-dependency: Uses standard Node.js https/crypto with standard AWS SigV4 request signing.
 * Supports official @aws-sdk/client-sqs client, duck-typed client, or direct zero-dependency REST calls.
 * Supports worker polling loop and AWS Lambda event.Records push batch processing.
 *
 * @module core/queue/adapters/sqs
 */

'use strict';

const https = require('https');
const { Job } = require('../job');
const { signAwsV4Request } = require('../../secrets/providers/aws');

/**
 * Execute HTTPS request to SQS endpoint
 * @param {string} urlStr
 * @param {Object} options
 * @returns {Promise<{ statusCode: number, data: string, json: any }>}
 */
function makeSqsRequest(urlStr, options = {}) {
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
      reject(new Error(`[SqsQueueAdapter] Request to ${urlStr} timed out`));
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

class SqsQueueAdapter {
  /**
   * @param {Object} options
   * @param {string} options.queueUrl - Full URL to AWS SQS queue
   * @param {string} [options.region] - AWS region (e.g. us-east-1)
   * @param {string} [options.accessKeyId]
   * @param {string} [options.secretAccessKey]
   * @param {string} [options.sessionToken]
   * @param {number} [options.waitTimeSeconds=5] - SQS Long polling wait time (0-20s)
   * @param {number} [options.visibilityTimeout=30] - Visibility timeout in seconds
   * @param {Object} [options.sqsClient] - Optional @aws-sdk/client-sqs client
   */
  constructor(options = {}) {
    if (!options.queueUrl && !options.sqsClient) {
      throw new Error('[SqsQueueAdapter] Requires queueUrl or an initialized sqsClient');
    }

    this.queueUrl = options.queueUrl || '';
    this.region = options.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || this._extractRegion(this.queueUrl) || 'us-east-1';
    this.accessKeyId = options.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '';
    this.secretAccessKey = options.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '';
    this.sessionToken = options.sessionToken || process.env.AWS_SESSION_TOKEN || '';
    this.waitTimeSeconds = Math.max(0, Math.min(20, options.waitTimeSeconds ?? 5));
    this.visibilityTimeout = Math.max(1, options.visibilityTimeout ?? 30);
    this.client = options.sqsClient || null;
    this.httpTransport = options.httpTransport || makeSqsRequest;

    /** @type {Map<string|number, string>} Map jobId -> receiptHandle */
    this.receiptHandles = new Map();
  }

  _extractRegion(urlStr) {
    if (!urlStr) return null;
    const match = urlStr.match(/sqs\.([a-z0-9-]+)\.amazonaws\.com/i);
    return match ? match[1] : null;
  }

  /**
   * Send SQS request using SDK client or native signed HTTP POST
   * @private
   */
  async _call(action, payload = {}) {
    if (this.client) {
      if (typeof this.client[action] === 'function') {
        return this.client[action]({ QueueUrl: this.queueUrl, ...payload });
      }
      if (typeof this.client.send === 'function') {
        return this.client.send({ name: action, input: { QueueUrl: this.queueUrl, ...payload } });
      }
    }

    // Zero-dependency native signed POST using AWS SQS JSON 1.0 protocol
    const parsedUrl = new URL(this.queueUrl);
    const body = JSON.stringify({
      QueueUrl: this.queueUrl,
      ...payload,
    });

    const targetHeader = `AmazonSQS.${action}`;
    const baseHeaders = {
      'content-type': 'application/x-amz-json-1.0',
      'x-amz-target': targetHeader,
    };

    const signedHeaders = signAwsV4Request({
      method: 'POST',
      host: parsedUrl.host,
      path: parsedUrl.pathname,
      headers: baseHeaders,
      body,
      service: 'sqs',
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
    });

    const response = await this.httpTransport(this.queueUrl, {
      method: 'POST',
      headers: signedHeaders,
      body,
    });

    if (response.statusCode >= 300) {
      const errMsg = response.json?.message || response.json?.Message || response.data || `HTTP ${response.statusCode}`;
      throw new Error(`[SqsQueueAdapter] SQS.${action} failed (${response.statusCode}): ${errMsg}`);
    }

    return response.json || {};
  }

  /**
   * Enqueue job to SQS
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

    let delaySeconds = 0;
    if (jobInstance.runAt) {
      const delayMs = jobInstance.runAt.getTime() - Date.now();
      if (delayMs > 0) {
        delaySeconds = Math.min(900, Math.floor(delayMs / 1000));
      }
    }

    const res = await this._call('SendMessage', {
      MessageBody: JSON.stringify(messagePayload),
      DelaySeconds: delaySeconds,
      MessageAttributes: {
        JobName: {
          DataType: 'String',
          StringValue: jobInstance.name,
        },
      },
    });

    if (res.MessageId) {
      jobInstance._sqsMessageId = res.MessageId;
    }

    return jobInstance;
  }

  /**
   * Dequeue single job from SQS
   * @param {string[]} [jobNames]
   * @returns {Promise<Job|null>}
   */
  async dequeue(jobNames = []) {
    const res = await this._call('ReceiveMessage', {
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: this.waitTimeSeconds,
      VisibilityTimeout: this.visibilityTimeout,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    });

    const messages = res.Messages || res.messages || [];
    if (!messages || messages.length === 0) {
      return null;
    }

    const msg = messages[0];
    const receiptHandle = msg.ReceiptHandle || msg.receiptHandle;

    let payload = {};
    try {
      payload = JSON.parse(msg.Body || msg.body || '{}');
    } catch (_) {
      payload = { name: 'raw', data: msg.Body };
    }

    const job = new Job({
      id: payload.id || msg.MessageId || msg.messageId,
      name: payload.name || 'default',
      data: payload.data || {},
      status: 'running',
      attempts: (payload.attempts || 0) + 1,
      maxAttempts: payload.maxAttempts ?? 3,
      priority: payload.priority ?? 10,
      runAt: payload.runAt ? new Date(payload.runAt) : new Date(),
    });

    job._receiptHandle = receiptHandle;
    this.receiptHandles.set(job.id, receiptHandle);

    // If job does not match expected handlers, return visibility immediately
    if (jobNames.length > 0 && !jobNames.includes(job.name)) {
      await this.retry(job.id, 0);
      return null;
    }

    return job;
  }

  /**
   * Mark job as completed and delete from SQS
   * @param {string|number} jobId
   * @param {any} [result]
   * @returns {Promise<Job|null>}
   */
  async complete(jobId, result = null) {
    const handle = this.receiptHandles.get(jobId);
    if (handle) {
      try {
        await this._call('DeleteMessage', { ReceiptHandle: handle });
      } finally {
        this.receiptHandles.delete(jobId);
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
   * Mark job as permanently failed
   * @param {string|number} jobId
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async fail(jobId, error = null) {
    const handle = this.receiptHandles.get(jobId);
    if (handle) {
      try {
        await this._call('DeleteMessage', { ReceiptHandle: handle });
      } finally {
        this.receiptHandles.delete(jobId);
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
   * Change visibility timeout to reschedule job for retry
   * @param {string|number} jobId
   * @param {number} delayMs
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async retry(jobId, delayMs, error = null) {
    const handle = this.receiptHandles.get(jobId);
    if (handle) {
      const visibilitySeconds = Math.min(43200, Math.max(0, Math.ceil(delayMs / 1000)));
      try {
        await this._call('ChangeMessageVisibility', {
          ReceiptHandle: handle,
          VisibilityTimeout: visibilitySeconds,
        });
      } finally {
        this.receiptHandles.delete(jobId);
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
   * Get queue statistics from SQS
   * @returns {Promise<{ pending: number, running: number, delayed: number, total: number }>}
   */
  async getStats() {
    try {
      const res = await this._call('GetQueueAttributes', {
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
        ],
      });

      const attrs = res.Attributes || res.attributes || {};
      const pending = parseInt(attrs.ApproximateNumberOfMessages || '0', 10);
      const running = parseInt(attrs.ApproximateNumberOfMessagesNotVisible || '0', 10);
      const delayed = parseInt(attrs.ApproximateNumberOfMessagesDelayed || '0', 10);

      return {
        pending,
        running,
        delayed,
        total: pending + running + delayed,
      };
    } catch (_) {
      return { pending: 0, running: 0, delayed: 0, total: 0 };
    }
  }

  /**
   * Process an AWS Lambda SQS event batch (`event.Records`)
   * @param {Array<Object>} records - SQS event records
   * @param {import('../manager').QueueManager} queueManager
   * @returns {Promise<{ processed: number, failed: number }>}
   */
  async processBatch(records, queueManager) {
    if (!Array.isArray(records)) {
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    for (const record of records) {
      let payload = {};
      try {
        payload = JSON.parse(record.body || '{}');
      } catch (_) {
        payload = { name: 'raw', data: record.body };
      }

      const jobName = payload.name;
      const handlerDef = queueManager?.handlers?.get(jobName);

      if (!handlerDef || typeof handlerDef.handler !== 'function') {
        continue;
      }

      const job = new Job({
        id: payload.id || record.messageId,
        name: jobName,
        data: payload.data || {},
        priority: payload.priority || 10,
        runAt: payload.runAt ? new Date(payload.runAt) : new Date(),
      });

      try {
        job.status = 'running';
        job.startedAt = new Date();
        queueManager.emit('job:start', job);

        const result = await handlerDef.handler(job, { queue: queueManager, record });
        job.status = 'completed';
        job.result = result;
        job.completedAt = new Date();
        queueManager.emit('job:completed', job, result);
        processed++;
      } catch (err) {
        job.status = 'failed';
        job.error = err;
        queueManager.emit('job:failed', job, err);
        failed++;
        throw err; // In Lambda SQS batches, throwing lets SQS retry or trigger DLQ
      }
    }

    return { processed, failed };
  }
}

module.exports = {
  SqsQueueAdapter,
  makeSqsRequest,
};
