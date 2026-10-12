/**
 * Webspresso Task Scheduler Engine
 * Manages recurring cron jobs, overlap prevention, and worker dispatching
 * @module core/queue/scheduler
 */

'use strict';

const { CronExpression } = require('./cron');

let scheduleCounter = 0;

class TaskScheduler {
  /**
   * @param {import('./manager').QueueManager} queue - QueueManager instance
   * @param {Object} [options]
   * @param {boolean} [options.autoStart=true]
   * @param {number} [options.maxIntervalMs=60000] - Maximum sleep interval in ms
   */
  constructor(queue, options = {}) {
    if (!queue) {
      throw new Error('TaskScheduler requires a QueueManager instance');
    }

    this.queue = queue;
    this.maxIntervalMs = options.maxIntervalMs || 60000;
    this.isRunning = false;
    this._timer = null;

    /** @type {Map<string, Object>} */
    this.schedules = new Map();

    // Hook into queue events to track job lifecycle for overlap prevention
    this._onJobCompleted = (job, result) => {
      this._handleJobSettled(job, null, result);
    };

    this._onJobFailed = (job, err) => {
      this._handleJobSettled(job, err, null);
    };

    this.queue.on('job:completed', this._onJobCompleted);
    this.queue.on('job:failed', this._onJobFailed);

    if (options.autoStart !== false && queue.isRunning) {
      this.start();
    }
  }

  /**
   * Register a new recurring scheduled task
   * @param {string|CronExpression} cronExpression - Cron pattern or alias (e.g. '0 0 * * *', '@daily')
   * @param {string} jobName - Name of the registered job in QueueManager
   * @param {any} [data={}] - Payload passed to job on dispatch
   * @param {Object} [options]
   * @param {string} [options.id] - Optional custom schedule ID
   * @param {boolean} [options.overlap=false] - Allow concurrent executions of the same schedule
   * @param {number} [options.maxRuns] - Maximum number of runs before auto-unscheduling
   * @param {boolean} [options.utc=false] - Evaluate schedule in UTC
   * @param {boolean} [options.runImmediately=false] - Run immediately upon registration
   * @returns {Object} Registered schedule object
   */
  schedule(cronExpression, jobName, data = {}, options = {}) {
    if (typeof jobName !== 'string' || !jobName.trim()) {
      throw new Error('Job name must be a non-empty string');
    }

    const cron = cronExpression instanceof CronExpression
      ? cronExpression
      : new CronExpression(cronExpression, { utc: !!options.utc });

    const id = options.id || `schedule:${jobName}:${cron.resolvedExpression}`;

    const now = new Date();
    const nextRunAt = cron.getNextDate(now);

    const scheduleObj = {
      id,
      name: jobName,
      cronExpression: cron.rawExpression,
      cron,
      data,
      options: {
        overlap: options.overlap === true,
        maxRuns: typeof options.maxRuns === 'number' && options.maxRuns > 0 ? options.maxRuns : null,
        runImmediately: !!options.runImmediately,
        ...options,
      },
      runsCount: 0,
      lastRunAt: null,
      nextRunAt,
      isRunning: false,
      activeJobId: null,
      registeredAt: now,
    };

    this.schedules.set(id, scheduleObj);
    this.queue.emit('schedule:registered', scheduleObj);

    if (options.runImmediately) {
      setImmediate(() => this.trigger(id));
    }

    this._rescheduleTimer();
    return scheduleObj;
  }

  /**
   * Alias for schedule()
   */
  cron(cronExpression, jobName, data, options) {
    return this.schedule(cronExpression, jobName, data, options);
  }

  /**
   * Remove a scheduled task by ID or job name
   * @param {string} idOrJobName
   * @returns {boolean} True if removed, false if not found
   */
  unschedule(idOrJobName) {
    let targetId = null;

    if (this.schedules.has(idOrJobName)) {
      targetId = idOrJobName;
    } else {
      for (const [id, s] of this.schedules.entries()) {
        if (s.name === idOrJobName) {
          targetId = id;
          break;
        }
      }
    }

    if (!targetId) return false;

    const scheduleObj = this.schedules.get(targetId);
    this.schedules.delete(targetId);
    this.queue.emit('schedule:unregistered', scheduleObj);
    this._rescheduleTimer();
    return true;
  }

  /**
   * Get all registered schedules
   * @returns {Array<Object>}
   */
  getSchedules() {
    return Array.from(this.schedules.values()).map((s) => ({
      id: s.id,
      name: s.name,
      cronExpression: s.cronExpression,
      data: s.data,
      options: s.options,
      runsCount: s.runsCount,
      lastRunAt: s.lastRunAt,
      nextRunAt: s.nextRunAt,
      isRunning: s.isRunning,
      activeJobId: s.activeJobId,
      registeredAt: s.registeredAt,
    }));
  }

  /**
   * Get single schedule by ID or job name
   * @param {string} idOrJobName
   * @returns {Object|null}
   */
  getSchedule(idOrJobName) {
    if (this.schedules.has(idOrJobName)) {
      return this.schedules.get(idOrJobName);
    }
    for (const s of this.schedules.values()) {
      if (s.name === idOrJobName) return s;
    }
    return null;
  }

  /**
   * Manually trigger a schedule immediately
   * @param {string} idOrJobName
   * @returns {Promise<any>}
   */
  async trigger(idOrJobName) {
    const s = this.getSchedule(idOrJobName);
    if (!s) {
      throw new Error(`Schedule not found: '${idOrJobName}'`);
    }

    if (!s.options.overlap && s.isRunning) {
      this.queue.emit('schedule:skipped', s, 'overlap');
      return null;
    }

    s.isRunning = true;
    s.lastRunAt = new Date();
    s.runsCount++;

    try {
      const job = await this.queue.dispatch(s.name, s.data, s.options);
      s.activeJobId = job.id;
      this.queue.emit('schedule:triggered', s, job);

      if (s.options.maxRuns && s.runsCount >= s.options.maxRuns) {
        this.unschedule(s.id);
      }

      return job;
    } catch (err) {
      s.isRunning = false;
      s.activeJobId = null;
      throw err;
    }
  }

  /**
   * Start scheduler timer loop
   */
  start() {
    if (this.isRunning) return this;
    this.isRunning = true;
    this._rescheduleTimer();
    this.queue.emit('schedule:start');
    return this;
  }

  /**
   * Stop scheduler timer loop
   */
  stop() {
    this.isRunning = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.queue.emit('schedule:stop');
    return this;
  }

  /**
   * Clear all schedules and stop timer
   */
  clear() {
    this.stop();
    this.schedules.clear();
  }

  /**
   * Cleanup event listeners
   */
  destroy() {
    this.stop();
    this.schedules.clear();
    this.queue.removeListener('job:completed', this._onJobCompleted);
    this.queue.removeListener('job:failed', this._onJobFailed);
  }

  /**
   * Internal job settled handler for overlap tracking
   * @private
   */
  _handleJobSettled(job, err, result) {
    for (const s of this.schedules.values()) {
      if (s.activeJobId === job.id) {
        s.isRunning = false;
        s.activeJobId = null;
        this.queue.emit('schedule:finished', s, job, err ? { error: err } : { result });
        break;
      }
    }
  }

  /**
   * Re-evaluates next timer tick according to earliest due schedule
   * @private
   */
  _rescheduleTimer() {
    if (!this.isRunning) return;

    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    if (this.schedules.size === 0) return;

    const now = Date.now();
    let earliest = Infinity;

    for (const s of this.schedules.values()) {
      if (s.nextRunAt) {
        const time = s.nextRunAt.getTime();
        if (time < earliest) {
          earliest = time;
        }
      }
    }

    if (earliest === Infinity) return;

    const delay = Math.max(50, Math.min(earliest - now, this.maxIntervalMs));

    this._timer = setTimeout(() => this._tick(), delay);
  }

  /**
   * Clock tick: evaluates due schedules and dispatches them
   * @private
   */
  async _tick() {
    if (!this.isRunning) return;

    const now = new Date();
    const nowTime = now.getTime();

    const dueList = [];
    for (const s of this.schedules.values()) {
      if (s.nextRunAt && s.nextRunAt.getTime() <= nowTime) {
        dueList.push(s);
      }
    }

    for (const s of dueList) {
      // Calculate next run date immediately
      s.nextRunAt = s.cron.getNextDate(now);

      // Check overlap
      if (!s.options.overlap && s.isRunning) {
        this.queue.emit('schedule:skipped', s, 'overlap');
        s.lastRunAt = now;
        continue;
      }

      s.isRunning = true;
      s.lastRunAt = now;
      s.runsCount++;

      try {
        const job = await this.queue.dispatch(s.name, s.data, s.options);
        s.activeJobId = job.id;
        this.queue.emit('schedule:triggered', s, job);
      } catch (err) {
        s.isRunning = false;
        s.activeJobId = null;
        this.queue.emit('schedule:error', s, err);
      }

      // Check maxRuns
      if (s.options.maxRuns && s.runsCount >= s.options.maxRuns) {
        this.unschedule(s.id);
      }
    }

    this._rescheduleTimer();
  }
}

module.exports = {
  TaskScheduler,
};
