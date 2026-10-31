/**
 * Queue Manager & Worker Dispatcher
 * @module core/queue/manager
 */

'use strict';

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { Job } = require('./job');
const { MemoryQueueAdapter } = require('./adapters/memory');
const { CronExpression, CRON_ALIASES } = require('./cron');
const { TaskScheduler } = require('./scheduler');
const { walkDirectoryDetailed } = require('../utils/fs');
const { parseDurationMs } = require('../utils/time');

class QueueManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {any} [options.adapter] - Queue adapter instance (defaults to MemoryQueueAdapter)
   * @param {number} [options.concurrency=2] - Maximum concurrent running jobs
   * @param {number} [options.pollInterval=500] - Polling interval in ms when idle
   * @param {string} [options.jobsDir] - Directory to auto-discover job handlers
   * @param {boolean} [options.autoStart=true] - Start worker loop immediately
   * @param {number|string|false} [options.staleJobGrace='1m'] - Requeue jobs left 'running' by a crashed
   *   worker once they are idle for their timeout plus this grace (false disables)
   * @param {number|string} [options.staleCheckInterval='30s'] - How often to look for abandoned jobs
   */
  constructor(options = {}) {
    super();

    this.adapter = options.adapter || new MemoryQueueAdapter();
    this.concurrency = Math.max(1, options.concurrency || 2);
    this.pollInterval = Math.max(50, options.pollInterval || 500);
    this.maxPollInterval = Math.max(this.pollInterval, options.maxPollInterval || (this.pollInterval * 5));
    this._currentPollInterval = this.pollInterval;
    this.jobsDir = options.jobsDir || null;
    this.timeouts = options.timeouts || null;
    this.defaultTimeout = options.timeout !== undefined
      ? parseDurationMs(options.timeout, 30000)
      : (options.timeouts?.queue ? parseDurationMs(options.timeouts.queue, 30000) : 30000);

    this.staleJobGrace = options.staleJobGrace === false
      ? false
      : parseDurationMs(options.staleJobGrace ?? '1m', 60000);
    this.staleCheckInterval = parseDurationMs(options.staleCheckInterval ?? '30s', 30000);
    this._lastStaleCheck = 0;

    /** @type {Map<string, { handler: Function, options: Object }>} */
    this.handlers = new Map();

    /** @type {Map<string|number, Job>} */
    this.activeJobs = new Map();

    this.runningCount = 0;
    this.isPaused = false;
    this.isDraining = false;
    this.isRunning = false;
    this._timer = null;
    /** @type {Set<Promise<any>>} */
    this._activeJobPromises = new Set();

    // Retention configuration
    const retentionOption = options.retention;
    const isRetentionDisabled =
      retentionOption === false ||
      (typeof retentionOption === 'object' && retentionOption.enabled === false) ||
      options.retentionDays === null;

    const autoCleanupEnabled =
      !isRetentionDisabled &&
      options.autoCleanup !== false &&
      (typeof retentionOption !== 'object' || retentionOption.autoCleanup !== false) &&
      (retentionOption !== undefined || options.retentionDays !== undefined || options.cleanupIntervalMs !== undefined);

    this.retentionConfig = {
      enabled: !isRetentionDisabled && autoCleanupEnabled,
      days: (typeof options.retentionDays === 'number' && options.retentionDays >= 0)
        ? options.retentionDays
        : (typeof retentionOption === 'object' && retentionOption?.days ? retentionOption.days : 7),
      statuses: (typeof retentionOption === 'object' && retentionOption?.statuses)
        ? retentionOption.statuses
        : (options.retentionStatuses || ['completed']),
      intervalMs: (typeof options.cleanupIntervalMs === 'number' && options.cleanupIntervalMs > 0)
        ? options.cleanupIntervalMs
        : (typeof retentionOption === 'object' && retentionOption?.intervalMs ? retentionOption.intervalMs : 24 * 60 * 60 * 1000),
      runOnStart: (typeof retentionOption === 'object' && retentionOption?.runOnStart !== undefined)
        ? !!retentionOption.runOnStart
        : (options.cleanupOnStart !== undefined ? !!options.cleanupOnStart : false),
    };

    this._cleanupInterval = null;
    this._cleanupStartTimeout = null;

    if (this.retentionConfig.enabled) {
      this.startCleanup();
    }

    // Initialize TaskScheduler for recurring cron tasks
    this.scheduler = new TaskScheduler(this, {
      autoStart: options.autoStart !== false,
      ...(options.scheduler || {}),
    });

    if (this.jobsDir && fs.existsSync(this.jobsDir)) {
      this.loadJobsFromDirectory(this.jobsDir);
    }

    if (options.autoStart !== false) {
      this.start();
    }
  }

  /**
   * Register a job processor handler
   * @param {string} name - Job name (e.g. 'email.send')
   * @param {Function} handler - Async worker function (job, ctx) => Promise<any>
   * @param {Object} [options]
   * @param {number} [options.attempts=3]
   * @param {number|Object} [options.backoff]
   * @param {number} [options.timeout=30000]
   * @param {number} [options.priority=10]
   */
  define(name, handler, options = {}) {
    if (typeof name !== 'string' || !name) {
      throw new Error('Job name must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new Error(`Job handler for '${name}' must be a function`);
    }

    this.handlers.set(name, {
      handler,
      options: {
        attempts: 3,
        timeout: options.timeout !== undefined ? parseDurationMs(options.timeout, this.defaultTimeout) : this.defaultTimeout,
        priority: 10,
        ...options,
      },
    });

    return this;
  }

  /**
   * Alias for define
   * @param {string} name
   * @param {Function} handler
   * @param {Object} [options]
   * @returns {JobQueueManager}
   */
  register(name, handler, options = {}) {
    return this.define(name, handler, options);
  }

  /**
   * Check if a job handler is defined
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.handlers.has(name);
  }

  /**
   * Dispatch a job into the queue
   * @param {string} name - Registered job name
   * @param {any} [data={}] - Job payload
   * @param {Object} [options] - Dispatch options (delay, priority, attempts, timeout, backoff)
   * @returns {Promise<Job>}
   */
  async dispatch(name, data = {}, options = {}) {
    const registered = this.handlers.get(name);
    const defaults = registered ? registered.options : {};

    let runAt = new Date();
    if (options.delay) {
      if (typeof options.delay === 'number') {
        runAt = new Date(Date.now() + options.delay);
      } else if (options.delay instanceof Date) {
        runAt = options.delay;
      } else if (typeof options.delay === 'string') {
        runAt = new Date(Date.now() + parseDurationMs(options.delay, 0));
      }
    }

    const job = new Job({
      name,
      data,
      runAt,
      priority: options.priority !== undefined ? options.priority : defaults.priority,
      maxAttempts: options.attempts !== undefined ? options.attempts : defaults.attempts,
      timeout: options.timeout !== undefined ? parseDurationMs(options.timeout, defaults.timeout) : defaults.timeout,
      backoff: options.backoff !== undefined ? options.backoff : defaults.backoff,
      onProgress: (j, percent, msg) => {
        this.emit('job:progress', j, percent, msg);
      },
    });

    const enqueued = await this.adapter.enqueue(job);
    this.emit('job:queued', enqueued);

    // Reset polling backoff and trigger immediate poll if capacity is available
    this._currentPollInterval = this.pollInterval;
    if (this.isRunning && !this.isPaused && this.runningCount < this.concurrency) {
      setImmediate(() => this._tick());
    }

    return enqueued;
  }

  /**
   * Start processing jobs
   */
  start() {
    if (this.isRunning) return this;
    this.isRunning = true;
    this.isPaused = false;
    this._currentPollInterval = this.pollInterval;
    this._scheduleNextTick(0);
    if (this.scheduler) {
      this.scheduler.start();
    }
    this.emit('start');
    return this;
  }

  /**
   * Pause processing (running jobs continue until finished)
   */
  pause() {
    this.isPaused = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this.scheduler) {
      this.scheduler.stop();
    }
    this.emit('pause');
    return this;
  }

  /**
   * Resume processing
   */
  resume() {
    if (!this.isRunning) return this.start();
    this.isPaused = false;
    this._currentPollInterval = this.pollInterval;
    this._scheduleNextTick(0);
    if (this.scheduler) {
      this.scheduler.start();
    }
    this.emit('resume');
    return this;
  }

  /**
   * Gracefully drain all active jobs before stopping
   * @param {number} [timeoutMs=10000]
   * @returns {Promise<void>}
   */
  async drain(timeoutMs = 10000) {
    this.isDraining = true;
    this.pause();
    if (this.scheduler) {
      this.scheduler.stop();
    }

    if (this.runningCount > 0 && this._activeJobPromises.size > 0) {
      let timer = null;
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        if (timer && typeof timer.unref === 'function') {
          timer.unref();
        }
      });
      const allJobsPromise = Promise.allSettled(Array.from(this._activeJobPromises));

      try {
        await Promise.race([allJobsPromise, timeoutPromise]);
      } finally {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
    }

    this.isDraining = false;
    this.isRunning = false;
    this.stopCleanup();
    this.emit('drain');
  }

  /**
   * Stop worker loop
   */
  async stop() {
    this.pause();
    this.isRunning = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this.scheduler) {
      this.scheduler.stop();
    }
    this.stopCleanup();
    this.emit('stop');
  }

  /**
   * Schedule a recurring cron job
   * @param {string|CronExpression} cronExpression - Cron pattern or alias (e.g. '0 0 * * *', '@daily')
   * @param {string} name - Registered job name
   * @param {any} [data={}] - Job data payload
   * @param {Object} [options={}] - Schedule options (overlap, maxRuns, utc, runImmediately)
   * @returns {Object} Registered schedule object
   */
  schedule(cronExpression, name, data = {}, options = {}) {
    return this.scheduler.schedule(cronExpression, name, data, options);
  }

  /**
   * Alias for schedule()
   */
  cron(cronExpression, name, data, options) {
    return this.schedule(cronExpression, name, data, options);
  }

  /**
   * Unschedule a recurring job by ID or job name
   * @param {string} idOrJobName
   * @returns {boolean}
   */
  unschedule(idOrJobName) {
    return this.scheduler.unschedule(idOrJobName);
  }

  /**
   * Get all registered schedules
   * @returns {Array<Object>}
   */
  getSchedules() {
    return this.scheduler.getSchedules();
  }

  /**
   * Get single schedule by ID or job name
   * @param {string} idOrJobName
   * @returns {Object|null}
   */
  getSchedule(idOrJobName) {
    return this.scheduler.getSchedule(idOrJobName);
  }

  /**
   * Manually trigger a scheduled job immediately
   * @param {string} idOrJobName
   * @returns {Promise<Job|null>}
   */
  triggerSchedule(idOrJobName) {
    return this.scheduler.trigger(idOrJobName);
  }

  /**
   * Alias for triggerSchedule()
   * @param {string} idOrJobName
   * @returns {Promise<Job|null>}
   */
  triggerCron(idOrJobName) {
    return this.scheduler.trigger(idOrJobName);
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
    if (this.adapter && typeof this.adapter.clean === 'function') {
      return this.adapter.clean(options);
    }
    return 0;
  }

  /**
   * Run one-time retention cleanup pass
   * @returns {Promise<number>}
   */
  async runCleanup() {
    try {
      return await this.clean({
        status: this.retentionConfig.statuses,
        days: this.retentionConfig.days,
      });
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[QueueManager] Failed to run retention cleanup:', err.message);
      }
      return 0;
    }
  }

  /**
   * Start auto-retention cleanup timer
   * @param {number} [customIntervalMs]
   */
  startCleanup(customIntervalMs) {
    this.stopCleanup();
    if (!this.retentionConfig.enabled) return;
    if (typeof customIntervalMs === 'number' && customIntervalMs > 0) {
      this.retentionConfig.intervalMs = customIntervalMs;
    }

    if (this.retentionConfig.runOnStart) {
      const delayMs = process.env.NODE_ENV === 'test' ? 50 : 5000;
      this._cleanupStartTimeout = setTimeout(() => {
        this.runCleanup();
      }, delayMs);
      if (this._cleanupStartTimeout && this._cleanupStartTimeout.unref) {
        this._cleanupStartTimeout.unref();
      }
    }

    this._cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, this.retentionConfig.intervalMs);
    if (this._cleanupInterval && this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  /**
   * Stop auto-retention cleanup timer
   */
  stopCleanup() {
    if (this._cleanupStartTimeout) {
      clearTimeout(this._cleanupStartTimeout);
      this._cleanupStartTimeout = null;
    }
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  /**
   * Get retention configuration
   */
  getRetentionConfig() {
    return { ...this.retentionConfig };
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    const stats = await this.adapter.getStats();
    return {
      ...stats,
      activeWorkers: this.runningCount,
      concurrency: this.concurrency,
      registeredJobs: Array.from(this.handlers.keys()),
      isPaused: this.isPaused,
      isRunning: this.isRunning,
    };
  }

  /**
   * Get job by ID
   * @param {string|number} jobId
   */
  async getJob(jobId) {
    return this.adapter.getJob(jobId);
  }

  /**
   * List jobs with optional filter, pagination and sorting
   * @param {Object} [filter={}]
   * @returns {Promise<{ jobs: Job[], total: number, page: number, limit: number, totalPages: number }>}
   */
  async listJobs(filter = {}) {
    if (this.adapter && typeof this.adapter.listJobs === 'function') {
      return this.adapter.listJobs(filter);
    }
    return { jobs: [], total: 0, page: 1, limit: 20, totalPages: 0 };
  }

  /**
   * Retry a specific job
   * @param {string|number} jobId
   * @param {Object} [options={}]
   * @returns {Promise<Job|null>}
   */
  async retryJob(jobId, options = {}) {
    if (this.adapter && typeof this.adapter.retryJob === 'function') {
      const job = await this.adapter.retryJob(jobId, options);
      if (job) {
        this.emit('job:retried', job);
        if (this.isRunning && !this.isPaused && this.runningCount < this.concurrency) {
          setImmediate(() => this._tick());
        }
      }
      return job;
    }
    return null;
  }

  /**
   * Bulk retry jobs by ID array
   * @param {Array<string|number>} ids
   * @param {Object} [options={}]
   * @returns {Promise<{ retried: number, jobs: Job[] }>}
   */
  async bulkRetry(ids = [], options = {}) {
    if (this.adapter && typeof this.adapter.bulkRetry === 'function') {
      const res = await this.adapter.bulkRetry(ids, options);
      if (res.retried > 0 && this.isRunning && !this.isPaused && this.runningCount < this.concurrency) {
        setImmediate(() => this._tick());
      }
      return res;
    }
    const results = [];
    for (const id of ids) {
      const retried = await this.retryJob(id, options);
      if (retried) results.push(retried);
    }
    return { retried: results.length, jobs: results };
  }

  /**
   * Cancel (remove) a job by ID
   * @param {string|number} jobId
   * @returns {Promise<{ success: boolean, id: string|number }>}
   */
  async cancelJob(jobId) {
    if (this.adapter && typeof this.adapter.cancelJob === 'function') {
      const res = await this.adapter.cancelJob(jobId);
      this.emit('job:cancelled', jobId);
      return res;
    }
    return { success: false, id: jobId };
  }

  /**
   * Purge jobs (completed/failed/all)
   * @param {Object} [options={}]
   * @param {string|string[]} [options.status=['completed', 'failed']]
   * @returns {Promise<number>}
   */
  async purgeJobs(options = {}) {
    const statuses = options.status || ['completed', 'failed'];
    return this.clean({
      status: statuses,
      days: 0,
    });
  }

  /**
   * Auto-discover and register job files from directory recursively
   * @param {string} dirPath
   */
  loadJobsFromDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) return;

    const files = walkDirectoryDetailed(dirPath, {
      extensions: ['.js', '.cjs'],
      ignorePrefixes: ['.', '_'],
      ignoreTests: true,
    });

    for (const item of files) {
      const relNormalized = item.relativePath.split(/[\/\\]/).join('.');
      const isCronFile = item.name.endsWith('.cron.js') || item.name.endsWith('.cron.cjs');
      const baseNameWithoutExt = isCronFile
        ? item.name.replace(/\.cron\.(c)?js$/, '')
        : item.name.replace(/\.(c)?js$/, '');
      const jobName = isCronFile
        ? relNormalized.replace(/\.cron\.(c)?js$/, '')
        : relNormalized.replace(/\.(c)?js$/, '');

      try {
        const mod = require(item.absolutePath);
        const handler = typeof mod === 'function' ? mod : (mod.handler || mod.default);
        const options = mod.options || {};

        if (typeof handler === 'function') {
          this.define(jobName, handler, options);

          const cronExpr = mod.cron || mod.schedule || (isCronFile ? (mod.expression || (CRON_ALIASES[`@${baseNameWithoutExt}`] ? `@${baseNameWithoutExt}` : null)) : null);
          if (cronExpr) {
            this.schedule(
              cronExpr,
              jobName,
              mod.data || {},
              { ...options, ...(mod.scheduleOptions || {}) }
            );
          }
        }
      } catch (err) {
        console.error(`[QueueManager] Failed to load job from ${item.absolutePath}:`, err.message);
      }
    }
  }

  /**
   * Schedule next tick
   * @private
   */
  _scheduleNextTick(delay = this._currentPollInterval) {
    if (!this.isRunning || this.isPaused || this.isDraining) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._tick(), delay);
  }

  /**
   * Process loop tick
   * @private
   */
  async _tick() {
    if (!this.isRunning || this.isPaused || this.isDraining) return;

    const availableSlots = this.concurrency - this.runningCount;
    if (availableSlots <= 0) return;

    const registeredNames = Array.from(this.handlers.keys());
    if (registeredNames.length === 0) {
      this._scheduleNextTick(this._currentPollInterval);
      return;
    }

    await this._recoverStaleJobs();

    let jobs = [];
    try {
      if (typeof this.adapter.dequeueMany === 'function' && availableSlots > 1) {
        jobs = await this.adapter.dequeueMany(registeredNames, availableSlots);
      } else {
        const single = await this.adapter.dequeue(registeredNames);
        if (single) jobs = [single];
      }
    } catch (err) {
      this.emit('error', err);
      // Back off polling interval on database or adapter error to avoid tight spin-loop
      this._currentPollInterval = Math.min(
        this.maxPollInterval,
        Math.round(this._currentPollInterval * 2)
      );
      this._scheduleNextTick(this._currentPollInterval);
      return;
    }

    if (!jobs || jobs.length === 0) {
      // No jobs ready -> back off polling interval
      this._currentPollInterval = Math.min(
        this.maxPollInterval,
        Math.round(this._currentPollInterval * 1.5)
      );
      this._scheduleNextTick(this._currentPollInterval);
      return;
    }

    // Found job(s) -> reset polling interval
    this._currentPollInterval = this.pollInterval;

    for (const job of jobs) {
      if (this.isPaused || this.isDraining) break;

      this.runningCount++;
      this.activeJobs.set(job.id, job);

      // Attach progress handler
      job._onProgress = (j, percent, msg) => {
        this.emit('job:progress', j, percent, msg);
      };

      const jobPromise = this._executeJob(job).finally(() => {
        this.runningCount--;
        this.activeJobs.delete(job.id);
        this._activeJobPromises.delete(jobPromise);
        if (this.runningCount === 0) {
          this.emit('idle');
        }
        if (this.isRunning && !this.isPaused && !this.isDraining) {
          this._scheduleNextTick(0);
        }
      });
      this._activeJobPromises.add(jobPromise);
    }

    if (this.runningCount < this.concurrency) {
      this._scheduleNextTick(0);
    } else {
      this._scheduleNextTick(this.pollInterval);
    }
  }

  /**
   * Requeue jobs abandoned in 'running' state by crashed workers (throttled).
   * @private
   */
  async _recoverStaleJobs() {
    if (this.staleJobGrace === false || typeof this.adapter.recoverStale !== 'function') return;
    const now = Date.now();
    if (now - this._lastStaleCheck < this.staleCheckInterval) return;
    this._lastStaleCheck = now;
    try {
      const recovered = await this.adapter.recoverStale({
        graceMs: this.staleJobGrace,
        excludeIds: Array.from(this.activeJobs.keys()),
      });
      if (recovered > 0) this.emit('jobs:recovered', recovered);
    } catch (err) {
      this.emit('error', err);
    }
  }

  /**
   * Execute single job with timeout & retry handling
   * @private
   */
  async _executeJob(job) {
    const registered = this.handlers.get(job.name);
    if (!registered) {
      const err = new Error(`No handler registered for job '${job.name}'`);
      await this.adapter.fail(job.id, err);
      this.emit('job:failed', job, err);
      return;
    }

    this.emit('job:started', job);

    const { handler } = registered;
    const timeoutMs = job.timeout || this.defaultTimeout || 30000;

    let timeoutTimer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new Error(`Job '${job.name}' (${job.id}) exceeded timeout of ${timeoutMs}ms`));
      }, timeoutMs);
      if (timeoutTimer && typeof timeoutTimer.unref === 'function') {
        timeoutTimer.unref();
      }
    });

    const handlerPromise = Promise.resolve().then(() => handler(job, { queue: this }));
    if (typeof handlerPromise.catch === 'function') {
      handlerPromise.catch(() => {});
    }

    try {
      const result = await Promise.race([
        handlerPromise,
        timeoutPromise,
      ]);

      try {
        const completedJob = await this.adapter.complete(job.id, result);
        this.emit('job:completed', completedJob || job, result);
      } catch (adapterErr) {
        this.emit('error', adapterErr);
      }
    } catch (err) {
      try {
        if (job.attempts < job.maxAttempts) {
          const delayMs = job.getNextRetryDelay();
          const retryingJob = await this.adapter.retry(job.id, delayMs, err);
          this.emit('job:retrying', retryingJob || job, err, delayMs);
        } else {
          const failedJob = await this.adapter.fail(job.id, err);
          this.emit('job:failed', failedJob || job, err);
        }
      } catch (adapterErr) {
        this.emit('error', adapterErr);
      }
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    }
  }
}

/**
 * Factory to create QueueManager
 * @param {Object} [options]
 * @returns {QueueManager}
 */
function createQueueManager(options = {}) {
  return new QueueManager(options);
}

module.exports = {
  QueueManager,
  createQueueManager,
};
