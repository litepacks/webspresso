/**
 * WaitUntil (Edge/Serverless) Queue Adapter
 * Designed for environments exposing an execution context (e.g. Cloudflare Workers ctx.waitUntil,
 * Vercel Edge waitUntil) where jobs run non-blocking in the background without persistent polling daemons.
 * @module core/queue/adapters/wait-until
 */

'use strict';

const { MemoryQueueAdapter } = require('./memory');
const { Job } = require('../job');

class WaitUntilQueueAdapter extends MemoryQueueAdapter {
  /**
   * @param {Object} [options]
   * @param {Function} [options.waitUntil] - Optional global waitUntil handler
   * @param {number} [options.maxRetainedJobs=1000] - In-memory retention limit to prevent memory leaks in isolates
   */
  constructor(options = {}) {
    super();
    this.waitUntilHandler = typeof options.waitUntil === 'function' ? options.waitUntil : null;
    this.maxRetainedJobs = options.maxRetainedJobs || 1000;
  }

  /**
   * Set or update the active waitUntil handler (e.g. from per-request execution context)
   * @param {Function} fn
   */
  setWaitUntil(fn) {
    if (typeof fn === 'function') {
      this.waitUntilHandler = fn;
    }
  }

  /**
   * Enqueue a job and schedule it for immediate execution via waitUntil if available
   * @param {Job} job
   * @returns {Promise<Job>}
   */
  async enqueue(job) {
    const jobInstance = await super.enqueue(job);

    // Evict oldest completed/failed jobs if limit reached to protect isolate memory
    if (this.jobs.size > this.maxRetainedJobs) {
      let evicted = 0;
      for (const [id, j] of this.jobs.entries()) {
        if (j.status === 'completed' || j.status === 'failed') {
          this.jobs.delete(id);
          evicted++;
          if (evicted >= 50) break;
        }
      }
    }

    return jobInstance;
  }

  /**
   * Schedule a promise to complete in the background via waitUntil if available,
   * or fall back to unhandled Promise execution.
   * @param {Promise<any>} promise
   */
  scheduleBackground(promise) {
    if (this.waitUntilHandler) {
      try {
        this.waitUntilHandler(promise);
        return;
      } catch (_) {
        // Fall back to unhandled background promise
      }
    }
    // Standard Node/V8 unhandled background promise fallback
    promise.catch(() => {});
  }
}

module.exports = { WaitUntilQueueAdapter };
