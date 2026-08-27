/**
 * Distributed Redis Queue Adapter
 * @module core/queue/adapters/redis
 */

'use strict';

const { Job } = require('../job');

class RedisQueueAdapter {
  /**
   * @param {Object} options
   * @param {any} options.client - ioredis or @redis/client instance
   * @param {string} [options.prefix='webspresso:queue:'] - Key prefix
   */
  constructor(options = {}) {
    if (!options.client) {
      throw new Error('RedisQueueAdapter requires a Redis client in options.client');
    }
    this.client = options.client;
    this.prefix = options.prefix || 'webspresso:queue:';
  }

  _key(name) {
    return this.prefix + name;
  }

  /**
   * Enqueue a job into Redis
   * @param {Job} job
   * @returns {Promise<Job>}
   */
  async enqueue(job) {
    const jobInstance = job instanceof Job ? job : new Job(job);
    const jobKey = this._key('job:' + jobInstance.id);
    const delayedKey = this._key('delayed');
    const waitingKey = this._key('waiting');

    const jobData = JSON.stringify(jobInstance.toJSON());

    // Save job payload
    if (typeof this.client.set === 'function') {
      await this.client.set(jobKey, jobData);
    }

    const now = Date.now();
    const runAt = jobInstance.runAt ? jobInstance.runAt.getTime() : now;

    if (runAt > now) {
      // Delayed job
      if (typeof this.client.zadd === 'function') {
        await this.client.zadd(delayedKey, runAt, String(jobInstance.id));
      } else if (typeof this.client.zAdd === 'function') {
        await this.client.zAdd(delayedKey, [{ score: runAt, value: String(jobInstance.id) }]);
      }
    } else {
      // Ready to process (score is negative priority to sort highest priority first)
      const score = (100 - (jobInstance.priority || 10)) * 1000000000000 + runAt;
      if (typeof this.client.zadd === 'function') {
        await this.client.zadd(waitingKey, score, String(jobInstance.id));
      } else if (typeof this.client.zAdd === 'function') {
        await this.client.zAdd(waitingKey, [{ score, value: String(jobInstance.id) }]);
      }
    }

    return jobInstance;
  }

  /**
   * Move due delayed jobs into waiting queue
   * @private
   */
  async _promoteDelayed() {
    const delayedKey = this._key('delayed');
    const waitingKey = this._key('waiting');
    const now = Date.now();

    try {
      let dueIds = [];
      if (typeof this.client.zrangebyscore === 'function') {
        dueIds = await this.client.zrangebyscore(delayedKey, 0, now);
      } else if (typeof this.client.zRangeByScore === 'function') {
        dueIds = await this.client.zRangeByScore(delayedKey, 0, now);
      }

      if (dueIds && dueIds.length > 0) {
        for (const id of dueIds) {
          const job = await this.getJob(id);
          if (job) {
            const score = (100 - (job.priority || 10)) * 1000000000000 + now;
            if (typeof this.client.zadd === 'function') {
              await this.client.zadd(waitingKey, score, String(id));
              await this.client.zrem(delayedKey, String(id));
            } else if (typeof this.client.zAdd === 'function') {
              await this.client.zAdd(waitingKey, [{ score, value: String(id) }]);
              await this.client.zRem(delayedKey, String(id));
            }
          }
        }
      }
    } catch {}
  }

  /**
   * Dequeue next pending job
   * @param {string[]} [jobNames]
   * @returns {Promise<Job|null>}
   */
  async dequeue(jobNames = []) {
    await this._promoteDelayed();

    const waitingKey = this._key('waiting');
    const activeKey = this._key('active');

    let ids = [];
    if (typeof this.client.zrange === 'function') {
      ids = await this.client.zrange(waitingKey, 0, 50);
    } else if (typeof this.client.zRange === 'function') {
      ids = await this.client.zRange(waitingKey, 0, 50);
    }

    if (!ids || ids.length === 0) return null;

    for (const id of ids) {
      const job = await this.getJob(id);
      if (!job) {
        if (typeof this.client.zrem === 'function') await this.client.zrem(waitingKey, String(id));
        else if (typeof this.client.zRem === 'function') await this.client.zRem(waitingKey, String(id));
        continue;
      }

      if (jobNames.length > 0 && !jobNames.includes(job.name)) {
        continue;
      }

      // Pop from waiting and add to active
      if (typeof this.client.zrem === 'function') {
        await this.client.zrem(waitingKey, String(id));
        await this.client.sadd(activeKey, String(id));
      } else if (typeof this.client.zRem === 'function') {
        await this.client.zRem(waitingKey, String(id));
        await this.client.sAdd(activeKey, String(id));
      }

      job.status = 'running';
      job.attempts += 1;
      job.updatedAt = new Date();

      const jobKey = this._key('job:' + job.id);
      if (typeof this.client.set === 'function') {
        await this.client.set(jobKey, JSON.stringify(job.toJSON()));
      }

      return job;
    }

    return null;
  }

  /**
   * Mark job as completed
   * @param {string|number} jobId
   * @param {any} [result]
   * @returns {Promise<Job|null>}
   */
  async complete(jobId, result = null) {
    const job = await this.getJob(jobId);
    if (!job) return null;

    const activeKey = this._key('active');
    const completedKey = this._key('completed');
    const jobKey = this._key('job:' + jobId);

    if (typeof this.client.srem === 'function') {
      await this.client.srem(activeKey, String(jobId));
      await this.client.sadd(completedKey, String(jobId));
    } else if (typeof this.client.sRem === 'function') {
      await this.client.sRem(activeKey, String(jobId));
      await this.client.sAdd(completedKey, String(jobId));
    }

    job.status = 'completed';
    job.result = result;
    job.progressValue = 100;
    job.updatedAt = new Date();

    if (typeof this.client.set === 'function') {
      await this.client.set(jobKey, JSON.stringify(job.toJSON()));
    }

    return job;
  }

  /**
   * Mark job as failed
   * @param {string|number} jobId
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async fail(jobId, error = null) {
    const job = await this.getJob(jobId);
    if (!job) return null;

    const activeKey = this._key('active');
    const failedKey = this._key('failed');
    const jobKey = this._key('job:' + jobId);

    if (typeof this.client.srem === 'function') {
      await this.client.srem(activeKey, String(jobId));
      await this.client.sadd(failedKey, String(jobId));
    } else if (typeof this.client.sRem === 'function') {
      await this.client.sRem(activeKey, String(jobId));
      await this.client.sAdd(failedKey, String(jobId));
    }

    job.status = 'failed';
    job.error = error;
    job.updatedAt = new Date();

    if (typeof this.client.set === 'function') {
      await this.client.set(jobKey, JSON.stringify(job.toJSON()));
    }

    return job;
  }

  /**
   * Re-enqueue job for retry
   * @param {string|number} jobId
   * @param {number} delayMs
   * @param {any} [error]
   * @returns {Promise<Job|null>}
   */
  async retry(jobId, delayMs, error = null) {
    const job = await this.getJob(jobId);
    if (!job) return null;

    const activeKey = this._key('active');
    if (typeof this.client.srem === 'function') {
      await this.client.srem(activeKey, String(jobId));
    } else if (typeof this.client.sRem === 'function') {
      await this.client.sRem(activeKey, String(jobId));
    }

    job.status = 'pending';
    job.runAt = new Date(Date.now() + Math.max(0, delayMs));
    job.error = error;
    job.updatedAt = new Date();

    await this.enqueue(job);
    return job;
  }

  /**
   * Get job by ID
   * @param {string|number} jobId
   * @returns {Promise<Job|null>}
   */
  async getJob(jobId) {
    const jobKey = this._key('job:' + jobId);
    let raw = null;
    if (typeof this.client.get === 'function') {
      raw = await this.client.get(jobKey);
    }
    if (!raw) return null;

    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return new Job(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Get stats
   * @returns {Promise<{ pending: number, running: number, completed: number, failed: number, total: number }>}
   */
  async getStats() {
    const waitingKey = this._key('waiting');
    const delayedKey = this._key('delayed');
    const activeKey = this._key('active');
    const completedKey = this._key('completed');
    const failedKey = this._key('failed');

    let pending = 0;
    let delayed = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    try {
      if (typeof this.client.zcard === 'function') {
        pending = (await this.client.zcard(waitingKey)) || 0;
        delayed = (await this.client.zcard(delayedKey)) || 0;
        running = (await this.client.scard(activeKey)) || 0;
        completed = (await this.client.scard(completedKey)) || 0;
        failed = (await this.client.scard(failedKey)) || 0;
      } else if (typeof this.client.zCard === 'function') {
        pending = (await this.client.zCard(waitingKey)) || 0;
        delayed = (await this.client.zCard(delayedKey)) || 0;
        running = (await this.client.sCard(activeKey)) || 0;
        completed = (await this.client.sCard(completedKey)) || 0;
        failed = (await this.client.sCard(failedKey)) || 0;
      }
    } catch {}

    const totalPending = pending + delayed;
    return {
      pending: totalPending,
      running,
      completed,
      failed,
      total: totalPending + running + completed + failed,
    };
  }

  /**
   * Clear all queue keys
   * @returns {Promise<void>}
   */
  async clear() {
    const keys = [
      this._key('waiting'),
      this._key('delayed'),
      this._key('active'),
      this._key('completed'),
      this._key('failed'),
    ];
    for (const k of keys) {
      if (typeof this.client.del === 'function') await this.client.del(k);
    }
  }
}

module.exports = { RedisQueueAdapter };
