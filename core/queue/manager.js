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

class QueueManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {any} [options.adapter] - Queue adapter instance (defaults to MemoryQueueAdapter)
   * @param {number} [options.concurrency=2] - Maximum concurrent running jobs
   * @param {number} [options.pollInterval=500] - Polling interval in ms when idle
   * @param {string} [options.jobsDir] - Directory to auto-discover job handlers
   * @param {boolean} [options.autoStart=true] - Start worker loop immediately
   */
  constructor(options = {}) {
    super();

    this.adapter = options.adapter || new MemoryQueueAdapter();
    this.concurrency = Math.max(1, options.concurrency || 2);
    this.pollInterval = Math.max(50, options.pollInterval || 500);
    this.maxPollInterval = Math.max(this.pollInterval, options.maxPollInterval || (this.pollInterval * 5));
    this._currentPollInterval = this.pollInterval;
    this.jobsDir = options.jobsDir || null;

    /** @type {Map<string, { handler: Function, options: Object }>} */
    this.handlers = new Map();

    /** @type {Map<string|number, Job>} */
    this.activeJobs = new Map();

    this.runningCount = 0;
    this.isPaused = false;
    this.isDraining = false;
    this.isRunning = false;
    this._timer = null;

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
        timeout: 30000,
        priority: 10,
        ...options,
      },
    });

    return this;
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
      }
    }

    const job = new Job({
      name,
      data,
      runAt,
      priority: options.priority !== undefined ? options.priority : defaults.priority,
      maxAttempts: options.attempts !== undefined ? options.attempts : defaults.attempts,
      timeout: options.timeout !== undefined ? options.timeout : defaults.timeout,
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

    if (this.runningCount === 0) {
      this.isDraining = false;
      this.isRunning = false;
      return;
    }

    const start = Date.now();
    while (this.runningCount > 0) {
      if (Date.now() - start > timeoutMs) {
        break;
      }
      await new Promise((res) => setTimeout(res, 50));
    }

    this.isDraining = false;
    this.isRunning = false;
    this.emit('drain');
  }

  /**
   * Stop worker loop
   */
  async stop() {
    this.pause();
    this.isRunning = false;
    this.emit('stop');
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
   * Auto-discover and register job files from directory recursively
   * @param {string} dirPath
   */
  loadJobsFromDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) return;

    const readRecursive = (curDir, basePrefix = '') => {
      const entries = fs.readdirSync(curDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(curDir, entry.name);
        if (entry.isDirectory()) {
          readRecursive(fullPath, basePrefix ? `${basePrefix}.${entry.name}` : entry.name);
        } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))) {
          const nameWithoutExt = entry.name.replace(/\.(c)?js$/, '');
          const jobName = basePrefix ? `${basePrefix}.${nameWithoutExt}` : nameWithoutExt;

          try {
            const mod = require(fullPath);
            const handler = typeof mod === 'function' ? mod : (mod.handler || mod.default);
            const options = mod.options || {};

            if (typeof handler === 'function') {
              this.define(jobName, handler, options);
            }
          } catch (err) {
            console.error(`[QueueManager] Failed to load job from ${fullPath}:`, err.message);
          }
        }
      }
    };

    readRecursive(dirPath);
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

      this._executeJob(job).finally(() => {
        this.runningCount--;
        this.activeJobs.delete(job.id);
        if (this.isRunning && !this.isPaused) {
          this._scheduleNextTick(0);
        }
      });
    }

    if (this.runningCount < this.concurrency) {
      this._scheduleNextTick(0);
    } else {
      this._scheduleNextTick(this.pollInterval);
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
    const timeoutMs = job.timeout || 30000;

    let timeoutTimer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new Error(`Job '${job.name}' (${job.id}) exceeded timeout of ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        handler(job, { queue: this }),
        timeoutPromise,
      ]);
      clearTimeout(timeoutTimer);

      const completedJob = await this.adapter.complete(job.id, result);
      this.emit('job:completed', completedJob || job, result);
    } catch (err) {
      clearTimeout(timeoutTimer);

      if (job.attempts < job.maxAttempts) {
        const delayMs = job.getNextRetryDelay();
        const retryingJob = await this.adapter.retry(job.id, delayMs, err);
        this.emit('job:retrying', retryingJob || job, err, delayMs);
      } else {
        const failedJob = await this.adapter.fail(job.id, err);
        this.emit('job:failed', failedJob || job, err);
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
