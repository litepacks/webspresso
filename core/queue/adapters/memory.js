/**
 * In-Memory Queue Adapter
 * @module core/queue/adapters/memory
 */

'use strict';

const { Job } = require('../job');

class MemoryQueueAdapter {
  constructor() {
    /** @type {Map<string|number, Job>} */
    this.jobs = new Map();
  }

  /**
   * Enqueue a job into memory
   * @param {Job} job
   * @returns {Promise<Job>}
   */
  async enqueue(job) {
    const jobInstance = job instanceof Job ? job : new Job(job);
    this.jobs.set(jobInstance.id, jobInstance);
    return jobInstance;
  }

  /**
   * Dequeue the highest priority pending job matching registered job names
   * @param {string[]} [jobNames]
   * @returns {Promise<Job|null>}
   */
  async dequeue(jobNames = []) {
    const now = Date.now();
    let candidate = null;

    for (const job of this.jobs.values()) {
      if (job.status !== 'pending') continue;
      if (job.runAt && job.runAt.getTime() > now) continue;
      if (jobNames.length > 0 && !jobNames.includes(job.name)) continue;

      if (!candidate) {
        candidate = job;
      } else {
        // Priority (higher first) then runAt (earlier first)
        if (job.priority > candidate.priority) {
          candidate = job;
        } else if (job.priority === candidate.priority && job.runAt.getTime() < candidate.runAt.getTime()) {
          candidate = job;
        }
      }
    }

    if (candidate) {
      candidate.status = 'running';
      candidate.attempts += 1;
      candidate.updatedAt = new Date();
      return candidate;
    }

    return null;
  }

  /**
   * Dequeue multiple pending jobs up to limit
   * @param {string[]} [jobNames]
   * @param {number} [limit=1]
   * @returns {Promise<Job[]>}
   */
  async dequeueMany(jobNames = [], limit = 1) {
    if (limit <= 1) {
      const single = await this.dequeue(jobNames);
      return single ? [single] : [];
    }

    const jobs = [];
    for (let i = 0; i < limit; i++) {
      const job = await this.dequeue(jobNames);
      if (!job) break;
      jobs.push(job);
    }
    return jobs;
  }

  /**
   * Mark job as completed
   * @param {string|number} jobId
   * @param {any} [result]
   * @returns {Promise<Job|null>}
   */
  async complete(jobId, result = null) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = 'completed';
    job.result = result;
    job.progressValue = 100;
    job.updatedAt = new Date();
    return job;
  }

  /**
   * Mark job as permanently failed
   * @param {string|number} jobId
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async fail(jobId, error = null) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = 'failed';
    job.error = error;
    job.updatedAt = new Date();
    return job;
  }

  /**
   * Re-schedule job for retry
   * @param {string|number} jobId
   * @param {number} delayMs
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async retry(jobId, delayMs, error = null) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = 'pending';
    job.runAt = new Date(Date.now() + Math.max(0, delayMs));
    job.error = error;
    job.updatedAt = new Date();
    return job;
  }

  /**
   * Get job by ID
   * @param {string|number} jobId
   * @returns {Promise<Job|null>}
   */
  async getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get queue statistics
   * @returns {Promise<{ pending: number, running: number, completed: number, failed: number, total: number }>}
   */
  async getStats() {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const job of this.jobs.values()) {
      if (job.status === 'pending') pending++;
      else if (job.status === 'running') running++;
      else if (job.status === 'completed') completed++;
      else if (job.status === 'failed') failed++;
    }

    return {
      pending,
      running,
      completed,
      failed,
      total: this.jobs.size,
    };
  }

  /**
   * Delete completed or failed jobs older than a cutoff date
   * @param {Object} [options={}]
   * @param {string|string[]} [options.status=['completed']]
   * @param {Date|string|number} [options.olderThan]
   * @param {number} [options.days=7]
   * @param {number} [options.retentionDays]
   * @param {number} [options.limit]
   * @returns {Promise<number>}
   */
  async clean(options = {}) {
    let olderThan;
    if (options.olderThan !== undefined) {
      olderThan = options.olderThan instanceof Date
        ? options.olderThan
        : new Date(options.olderThan);

      if (Number.isNaN(olderThan.getTime())) {
        throw new Error('clean: invalid olderThan date');
      }
    } else {
      const rawDays = options.days !== undefined
        ? options.days
        : (options.retentionDays !== undefined ? options.retentionDays : 7);
      const days = typeof rawDays === 'number' ? rawDays : Number(rawDays);
      if (Number.isNaN(days) || days < 0) {
        throw new Error('clean: days must be a non-negative number');
      }
      olderThan = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    let statuses = ['completed'];
    if (options.status) {
      if (Array.isArray(options.status)) {
        statuses = options.status;
      } else if (typeof options.status === 'string') {
        if (options.status === '*' || options.status === 'all') {
          statuses = ['completed', 'failed', 'pending'];
        } else {
          statuses = options.status.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
    }

    const cutoffTime = olderThan.getTime();
    let deletedCount = 0;
    const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : Infinity;

    for (const [id, job] of this.jobs.entries()) {
      if (deletedCount >= limit) break;
      if (!statuses.includes(job.status)) continue;

      const jobTime = (job.updatedAt instanceof Date ? job.updatedAt.getTime() : (job.createdAt instanceof Date ? job.createdAt.getTime() : 0));
      if (jobTime < cutoffTime) {
        this.jobs.delete(id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Clear all jobs
   * @returns {Promise<void>}
   */
  async clear() {
    this.jobs.clear();
  }
}

module.exports = { MemoryQueueAdapter };
