/**
 * Cloudflare Queues Adapter
 * Integrates Webspresso Queue with Cloudflare Queues (env.MY_QUEUE)
 * Supports dispatching messages via `queue.send()` and processing them in worker `queue(batch)` events.
 * @module core/queue/adapters/cloudflare
 */

'use strict';

const { Job } = require('../job');

class CloudflareQueueAdapter {
  /**
   * @param {Object} options
   * @param {Object} options.queue - Cloudflare Queue binding (e.g. env.MY_QUEUE)
   */
  constructor(options = {}) {
    if (!options.queue || typeof options.queue.send !== 'function') {
      throw new Error('[CloudflareQueueAdapter] Requires a valid Cloudflare Queue binding with a .send() method.');
    }
    this.queue = options.queue;
  }

  /**
   * Enqueue a job into Cloudflare Queues
   * @param {Job} job
   * @returns {Promise<Job>}
   */
  async enqueue(job) {
    const jobInstance = job instanceof Job ? job : new Job(job);

    const message = {
      id: jobInstance.id,
      name: jobInstance.name,
      data: jobInstance.data,
      priority: jobInstance.priority,
      runAt: jobInstance.runAt ? jobInstance.runAt.toISOString() : null,
      createdAt: jobInstance.createdAt ? jobInstance.createdAt.toISOString() : new Date().toISOString(),
    };

    const sendOptions = {};
    if (jobInstance.delay && typeof jobInstance.delay === 'number') {
      sendOptions.delaySeconds = Math.max(0, Math.floor(jobInstance.delay / 1000));
    }

    await this.queue.send(message, sendOptions);
    return jobInstance;
  }

  /**
   * Cloudflare Queues is a push-based queue (not pull-based polling),
   * so dequeue returns null to indicate no polling loop is needed.
   * @returns {Promise<null>}
   */
  async dequeue() {
    return null;
  }

  /**
   * Process a batch received from Cloudflare Worker's `queue(batch, env, ctx)` handler
   * @param {Object} batch - Cloudflare Queues MessageBatch
   * @param {import('../manager').QueueManager} queueManager - Webspresso QueueManager instance
   * @returns {Promise<{ processed: number, failed: number }>}
   */
  async processBatch(batch, queueManager) {
    if (!batch || !Array.isArray(batch.messages)) {
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    for (const message of batch.messages) {
      const payload = message.body || {};
      const jobName = payload.name;
      const handlerDef = queueManager?.handlers?.get(jobName);

      if (!handlerDef || typeof handlerDef.handler !== 'function') {
        // No handler registered for this job
        if (typeof message.ack === 'function') message.ack();
        continue;
      }

      const job = new Job({
        id: payload.id || message.id,
        name: jobName,
        data: payload.data || {},
        priority: payload.priority || 0,
        runAt: payload.runAt ? new Date(payload.runAt) : new Date(),
      });

      try {
        job.status = 'running';
        job.startedAt = new Date();
        queueManager.emit('job:start', job);

        const result = await handlerDef.handler(job, { queue: queueManager, message });
        job.status = 'completed';
        job.result = result;
        job.completedAt = new Date();
        queueManager.emit('job:complete', job, result);

        if (typeof message.ack === 'function') {
          message.ack();
        }
        processed++;
      } catch (err) {
        job.status = 'failed';
        job.error = err.message;
        job.failedAt = new Date();
        queueManager.emit('job:failed', job, err);

        if (typeof message.retry === 'function') {
          message.retry();
        }
        failed++;
      }
    }

    return { processed, failed };
  }

  async get() { return null; }
  async update(job) { return job; }
  async delete() { return true; }
  async count() { return 0; }
  async clean() { return 0; }
  async clear() { return; }
}

module.exports = { CloudflareQueueAdapter };
