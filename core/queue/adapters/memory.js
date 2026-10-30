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
   * @returns {Promise<{ pending: number, delayed: number, running: number, completed: number, failed: number, total: number }>}
   */
  async getStats() {
    let pending = 0;
    let delayed = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.status === 'pending') {
        if (job.runAt && job.runAt.getTime() > now) {
          delayed++;
        }
        pending++;
      } else if (job.status === 'running') {
        running++;
      } else if (job.status === 'completed') {
        completed++;
      } else if (job.status === 'failed') {
        failed++;
      }
    }

    return {
      pending,
      delayed,
      running,
      completed,
      failed,
      total: this.jobs.size,
    };
  }

  /**
   * List jobs with filtering, search, pagination, and sorting
   * @param {Object} [filter={}]
   * @param {string} [filter.status] - 'all', 'pending', 'delayed', 'running', 'completed', 'failed'
   * @param {string} [filter.name] - Job name
   * @param {string} [filter.search] - Substring search in id, name, error, data
   * @param {number} [filter.page=1]
   * @param {number} [filter.limit=20]
   * @param {string} [filter.sortBy='createdAt']
   * @param {'asc'|'desc'} [filter.sortOrder='desc']
   * @returns {Promise<{ jobs: Job[], total: number, page: number, limit: number, totalPages: number }>}
   */
  async listJobs(filter = {}) {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(filter.limit) || 20));
    const now = Date.now();
    const searchTerm = filter.search ? String(filter.search).trim().toLowerCase() : null;
    const filterStatus = filter.status && filter.status !== 'all' ? filter.status : null;
    const filterName = filter.name ? filter.name : null;

    let items = Array.from(this.jobs.values());

    // Status filter
    if (filterStatus) {
      if (filterStatus === 'delayed') {
        items = items.filter((j) => j.status === 'pending' && j.runAt && j.runAt.getTime() > now);
      } else if (filterStatus === 'pending') {
        items = items.filter((j) => j.status === 'pending' && (!j.runAt || j.runAt.getTime() <= now));
      } else {
        items = items.filter((j) => j.status === filterStatus);
      }
    }

    // Name filter
    if (filterName) {
      items = items.filter((j) => j.name === filterName);
    }

    // Search filter (id, name, error, data)
    if (searchTerm) {
      items = items.filter((j) => {
        if (String(j.id).toLowerCase().includes(searchTerm)) return true;
        if (String(j.name).toLowerCase().includes(searchTerm)) return true;
        if (j.error) {
          const errStr = typeof j.error === 'string' ? j.error : (j.error.message || j.error.stack || JSON.stringify(j.error));
          if (errStr.toLowerCase().includes(searchTerm)) return true;
        }
        if (j.data) {
          try {
            if (JSON.stringify(j.data).toLowerCase().includes(searchTerm)) return true;
          } catch {}
        }
        return false;
      });
    }

    const total = items.length;

    // Sorting
    const sortBy = filter.sortBy || 'createdAt';
    const sortOrder = filter.sortOrder === 'asc' ? 1 : -1;

    items.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (valA instanceof Date) valA = valA.getTime();
      if (valB instanceof Date) valB = valB.getTime();
      if (valA == null) valA = 0;
      if (valB == null) valB = 0;
      if (valA < valB) return -1 * sortOrder;
      if (valA > valB) return 1 * sortOrder;
      return 0;
    });

    // Pagination
    const startIndex = (page - 1) * limit;
    const paginated = items.slice(startIndex, startIndex + limit);

    return {
      jobs: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Reschedule or retry a job immediately or with delay
   * @param {string|number} jobId
   * @param {Object} [options={}]
   * @param {number} [options.delayMs=0]
   * @param {boolean} [options.resetAttempts=true]
   * @returns {Promise<Job|null>}
   */
  async retryJob(jobId, options = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const delayMs = options.delayMs || options.delay || 0;
    job.status = 'pending';
    job.runAt = new Date(Date.now() + Math.max(0, delayMs));
    job.error = null;
    if (options.resetAttempts !== false) {
      job.attempts = 0;
    }
    job.updatedAt = new Date();
    return job;
  }

  /**
   * Bulk retry jobs by ID
   * @param {Array<string|number>} jobIds
   * @param {Object} [options={}]
   * @returns {Promise<{ retried: number, jobs: Job[] }>}
   */
  async bulkRetry(jobIds = [], options = {}) {
    const results = [];
    for (const id of jobIds) {
      const retried = await this.retryJob(id, options);
      if (retried) results.push(retried);
    }
    return { retried: results.length, jobs: results };
  }

  /**
   * Cancel (delete) a job by ID
   * @param {string|number} jobId
   * @returns {Promise<{ success: boolean, id: string|number }>}
   */
  async cancelJob(jobId) {
    const existed = this.jobs.has(jobId);
    if (existed) {
      this.jobs.delete(jobId);
    }
    return { success: existed, id: jobId };
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
