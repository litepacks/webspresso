/**
 * Background Job Entity
 * @module core/queue/job
 */

'use strict';

class Job {
  /**
   * @param {Object} options
   * @param {string|number} options.id
   * @param {string} options.name
   * @param {any} [options.data={}]
   * @param {'pending'|'running'|'completed'|'failed'} [options.status='pending']
   * @param {number} [options.attempts=0]
   * @param {number} [options.maxAttempts=3]
   * @param {number|Object} [options.backoff={ type: 'exponential', delay: 1000 }]
   * @param {number} [options.priority=10]
   * @param {number} [options.timeout=30000]
   * @param {number} [options.progress=0]
   * @param {any} [options.result=null]
   * @param {any} [options.error=null]
   * @param {Date|number|string} [options.runAt]
   * @param {Date|number|string} [options.createdAt]
   * @param {Date|number|string} [options.updatedAt]
   * @param {Function} [options.onProgress]
   */
  constructor(options = {}) {
    this.id = options.id || ('job_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36));
    this.name = options.name || 'default';
    this.data = options.data !== undefined ? options.data : {};
    this.status = options.status || 'pending';
    this.attempts = options.attempts || 0;
    this.maxAttempts = options.maxAttempts !== undefined ? options.maxAttempts : 3;
    this.backoff = options.backoff !== undefined ? options.backoff : { type: 'exponential', delay: 1000 };
    this.priority = options.priority !== undefined ? options.priority : 10;
    this.timeout = options.timeout !== undefined ? options.timeout : 30000;
    this.progressValue = options.progress || 0;
    this.result = options.result || null;
    this.error = options.error || null;
    this.createdAt = options.createdAt ? new Date(options.createdAt) : new Date();
    this.updatedAt = options.updatedAt ? new Date(options.updatedAt) : new Date();
    this.runAt = options.runAt ? new Date(options.runAt) : new Date();
    this._onProgress = options.onProgress || null;
  }

  /**
   * Update progress of a running job
   * @param {number} percent - 0 to 100
   * @param {string} [message]
   */
  progress(percent, message) {
    this.progressValue = Math.min(100, Math.max(0, percent));
    this.updatedAt = new Date();
    if (typeof this._onProgress === 'function') {
      this._onProgress(this, this.progressValue, message);
    }
  }

  /**
   * Compute next retry delay in milliseconds based on backoff config
   * @returns {number}
   */
  getNextRetryDelay() {
    if (typeof this.backoff === 'number') {
      return this.backoff;
    }
    const baseDelay = (this.backoff && this.backoff.delay) || 1000;
    const type = (this.backoff && this.backoff.type) || 'exponential';

    if (type === 'fixed') {
      return baseDelay;
    }
    // Exponential: baseDelay * 2^(attempts - 1)
    const factor = Math.max(1, Math.pow(2, Math.max(0, this.attempts - 1)));
    return Math.min(baseDelay * factor, 3600000); // Cap at 1 hour
  }

  /**
   * Plain object serialization
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      data: this.data,
      status: this.status,
      attempts: this.attempts,
      maxAttempts: this.maxAttempts,
      backoff: this.backoff,
      priority: this.priority,
      timeout: this.timeout,
      progress: this.progressValue,
      result: this.result,
      error: this.error ? (this.error.message || String(this.error)) : null,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      runAt: this.runAt.toISOString(),
    };
  }
}

module.exports = { Job };
