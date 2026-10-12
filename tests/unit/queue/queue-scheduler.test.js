import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createQueueManager,
  CronExpression,
  isValidCron,
  parseCron,
  resolveCronAlias,
  TaskScheduler,
} from '../../../core/queue';
import queuePlugin from '../../../plugins/queue';

describe('Cron Expression Parser & Matcher', () => {
  describe('syntax parsing and validation', () => {
    it('validates standard 5-field cron expressions', () => {
      expect(isValidCron('* * * * *')).toBe(true);
      expect(isValidCron('0 0 * * *')).toBe(true);
      expect(isValidCron('*/15 * * * *')).toBe(true);
      expect(isValidCron('0 12 1 1 *')).toBe(true);
      expect(isValidCron('30 4 * * 1-5')).toBe(true);
      expect(isValidCron('59 23 31 12 0')).toBe(true);
    });

    it('validates standard aliases', () => {
      expect(isValidCron('@yearly')).toBe(true);
      expect(isValidCron('@annually')).toBe(true);
      expect(isValidCron('@monthly')).toBe(true);
      expect(isValidCron('@weekly')).toBe(true);
      expect(isValidCron('@daily')).toBe(true);
      expect(isValidCron('@midnight')).toBe(true);
      expect(isValidCron('@hourly')).toBe(true);
      expect(isValidCron('@every_minute')).toBe(true);
      expect(isValidCron('@minutely')).toBe(true);
    });

    it('resolves interval shortcuts like @every 5m and @every 2h', () => {
      expect(resolveCronAlias('@every 5m')).toBe('*/5 * * * *');
      expect(resolveCronAlias('@every 10m')).toBe('*/10 * * * *');
      expect(resolveCronAlias('@every 2h')).toBe('0 */2 * * *');
      expect(isValidCron('@every 15m')).toBe(true);
    });

    it('supports month and day of week names', () => {
      expect(isValidCron('0 0 1 JAN-DEC *')).toBe(true);
      expect(isValidCron('0 9 * * MON,WED,FRI')).toBe(true);
      expect(isValidCron('0 18 * * SUN-SAT')).toBe(true);
    });

    it('rejects invalid cron expressions', () => {
      expect(isValidCron('')).toBe(false);
      expect(isValidCron('invalid')).toBe(false);
      expect(isValidCron('* * * *')).toBe(false); // only 4 fields
      expect(isValidCron('* * * * * *')).toBe(false); // 6 fields
      expect(isValidCron('60 * * * *')).toBe(false); // minute out of range
      expect(isValidCron('* 24 * * *')).toBe(false); // hour out of range
      expect(isValidCron('* * 32 * *')).toBe(false); // day out of range
      expect(isValidCron('* * * 13 *')).toBe(false); // month out of range
      expect(isValidCron('* * * * 8')).toBe(false); // dow out of range
      expect(isValidCron('*/0 * * * *')).toBe(false); // step 0
      expect(isValidCron('5-2 * * * *')).toBe(false); // reverse range
    });
  });

  describe('matching and next date calculations', () => {
    it('correctly matches a specific date', () => {
      const expr = new CronExpression('30 14 * * 1', { utc: true });
      // 2026-10-12 is Monday, 14:30 UTC
      const matchingDate = new Date(Date.UTC(2026, 9, 12, 14, 30, 0));
      expect(expr.match(matchingDate)).toBe(true);

      const wrongMinute = new Date(Date.UTC(2026, 9, 12, 14, 31, 0));
      expect(expr.match(wrongMinute)).toBe(false);

      const wrongHour = new Date(Date.UTC(2026, 9, 12, 15, 30, 0));
      expect(expr.match(wrongHour)).toBe(false);

      const wrongDay = new Date(Date.UTC(2026, 9, 13, 14, 30, 0)); // Tuesday
      expect(expr.match(wrongDay)).toBe(false);
    });

    it('calculates the next date accurately in UTC mode', () => {
      const expr = new CronExpression('*/15 * * * *', { utc: true });
      const from = new Date(Date.UTC(2026, 9, 11, 10, 32, 15));
      const next = expr.getNextDate(from);

      expect(next.toISOString()).toBe('2026-10-11T10:45:00.000Z');
    });

    it('calculates multiple upcoming run dates', () => {
      const expr = new CronExpression('0 0 * * *', { utc: true }); // midnight daily
      const from = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));
      const dates = expr.getNextDates(3, from);

      expect(dates.length).toBe(3);
      expect(dates[0].toISOString()).toBe('2026-10-02T00:00:00.000Z');
      expect(dates[1].toISOString()).toBe('2026-10-03T00:00:00.000Z');
      expect(dates[2].toISOString()).toBe('2026-10-04T00:00:00.000Z');
    });
  });
});

describe('TaskScheduler & QueueManager Recurring Jobs', () => {
  let queue;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-queue-test-'));
  });

  afterEach(async () => {
    if (queue) {
      await queue.drain(1000);
      queue.scheduler.destroy();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('schedules and dispatches jobs with queue.schedule and queue.cron', async () => {
    queue = createQueueManager({ concurrency: 2, pollInterval: 20 });
    let executedPayload = null;

    queue.define('reports.daily', async (job) => {
      executedPayload = job.data;
      return { sent: true };
    });

    const schedule = queue.schedule('@daily', 'reports.daily', { region: 'EU' });
    expect(schedule.id).toBeDefined();
    expect(schedule.name).toBe('reports.daily');
    expect(schedule.cronExpression).toBe('@daily');
    expect(queue.getSchedules().length).toBe(1);

    // Manually trigger scheduled job out-of-band
    await queue.scheduler.trigger(schedule.id);

    // Wait for queue worker to process
    await new Promise((r) => setTimeout(r, 80));

    expect(executedPayload).toEqual({ region: 'EU' });
    expect(schedule.runsCount).toBe(1);
    expect(schedule.lastRunAt).toBeInstanceOf(Date);
  });

  it('supports unschedule by ID or job name', () => {
    queue = createQueueManager({ concurrency: 1, pollInterval: 50 });

    const s1 = queue.schedule('0 0 * * *', 'job.one', {}, { id: 's1' });
    const s2 = queue.cron('0 12 * * *', 'job.two');

    expect(queue.getSchedules().length).toBe(2);

    expect(queue.unschedule('s1')).toBe(true);
    expect(queue.getSchedules().length).toBe(1);
    expect(queue.getSchedule('s1')).toBeNull();

    expect(queue.unschedule('job.two')).toBe(true);
    expect(queue.getSchedules().length).toBe(0);
  });

  it('prevents overlapping runs when overlap: false (default)', async () => {
    queue = createQueueManager({ concurrency: 2, pollInterval: 20 });
    let finishJob = null;
    let runCount = 0;
    let skippedCount = 0;

    queue.define('heavy.job', async () => {
      runCount++;
      return new Promise((resolve) => {
        finishJob = resolve;
      });
    });

    queue.on('schedule:skipped', (s, reason) => {
      if (reason === 'overlap') skippedCount++;
    });

    const s = queue.schedule('*/5 * * * *', 'heavy.job', {}, { overlap: false });

    // Trigger first run (running)
    const run1 = queue.scheduler.trigger(s.id);
    await new Promise((r) => setTimeout(r, 40));
    expect(s.isRunning).toBe(true);

    // Attempt concurrent trigger while first is still running
    await queue.scheduler.trigger(s.id);
    expect(skippedCount).toBe(1);
    expect(runCount).toBe(1);

    // Complete the first run
    finishJob();
    await run1;
    await new Promise((r) => setTimeout(r, 40));

    expect(s.isRunning).toBe(false);

    // Subsequent trigger now proceeds
    await queue.scheduler.trigger(s.id);
    await new Promise((r) => setTimeout(r, 40));
    expect(runCount).toBe(2);

    finishJob();
  });

  it('automatically unschedules when maxRuns limit is reached', async () => {
    queue = createQueueManager({ concurrency: 2, pollInterval: 20 });
    let counter = 0;

    queue.define('limited.task', async () => {
      counter++;
    });

    const s = queue.schedule('*/5 * * * *', 'limited.task', {}, { maxRuns: 2 });

    await queue.scheduler.trigger(s.id);
    await new Promise((r) => setTimeout(r, 40));
    expect(queue.getSchedule(s.id)).toBeDefined();

    await queue.scheduler.trigger(s.id);
    await new Promise((r) => setTimeout(r, 40));

    expect(counter).toBe(2);
    expect(queue.getSchedule(s.id)).toBeNull(); // Auto-unscheduled!
    expect(queue.getSchedules().length).toBe(0);
  });

  it('runs immediately when runImmediately: true is passed', async () => {
    queue = createQueueManager({ concurrency: 2, pollInterval: 20 });
    let ran = false;

    queue.define('immediate.job', async () => {
      ran = true;
    });

    queue.schedule('@daily', 'immediate.job', {}, { runImmediately: true });

    await new Promise((r) => setTimeout(r, 80));
    expect(ran).toBe(true);
  });

  it('stops and resumes scheduler during queue lifecycle', () => {
    queue = createQueueManager({ concurrency: 1, pollInterval: 50, autoStart: false });
    expect(queue.scheduler.isRunning).toBe(false);

    queue.start();
    expect(queue.scheduler.isRunning).toBe(true);

    queue.pause();
    expect(queue.scheduler.isRunning).toBe(false);

    queue.resume();
    expect(queue.scheduler.isRunning).toBe(true);

    queue.stop();
    expect(queue.scheduler.isRunning).toBe(false);
  });
});

describe('File-Based Cron Job Auto-Discovery', () => {
  let tempDir;
  let queue;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-cron-discovery-'));
  });

  afterEach(async () => {
    if (queue) {
      await queue.drain(1000);
      queue.scheduler.destroy();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('auto-discovers and registers scheduled jobs from jobs directory', async () => {
    const jobsDir = path.join(tempDir, 'jobs');
    fs.mkdirSync(path.join(jobsDir, 'reports'), { recursive: true });

    // Job with explicit cron property
    fs.writeFileSync(
      path.join(jobsDir, 'reports', 'weekly.js'),
      `module.exports = {
        cron: '@weekly',
        data: { reportType: 'summary' },
        handler: async (job) => {
          return { generated: true };
        }
      };`
    );

    // Job with .cron.js file extension
    fs.writeFileSync(
      path.join(jobsDir, 'cleanup.cron.js'),
      `module.exports = {
        cron: '0 3 * * *',
        handler: async (job) => {
          return { deleted: 10 };
        }
      };`
    );

    // Standard non-recurring job
    fs.writeFileSync(
      path.join(jobsDir, 'standard.js'),
      `module.exports = async (job) => {
        return { ok: true };
      };`
    );

    queue = createQueueManager({ jobsDir, pollInterval: 20 });

    expect(queue.has('reports.weekly')).toBe(true);
    expect(queue.has('cleanup')).toBe(true);
    expect(queue.has('standard')).toBe(true);

    const schedules = queue.getSchedules();
    expect(schedules.length).toBe(2);

    const weeklySched = schedules.find((s) => s.name === 'reports.weekly');
    expect(weeklySched).toBeDefined();
    expect(weeklySched.cronExpression).toBe('@weekly');
    expect(weeklySched.data).toEqual({ reportType: 'summary' });

    const cleanupSched = schedules.find((s) => s.name === 'cleanup');
    expect(cleanupSched).toBeDefined();
    expect(cleanupSched.cronExpression).toBe('0 3 * * *');
  });

  it('integrates seamlessly with queuePlugin', async () => {
    const jobsDir = path.join(tempDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });

    fs.writeFileSync(
      path.join(jobsDir, 'ping.cron.js'),
      `module.exports = {
        cron: '@hourly',
        handler: async () => 'pong'
      };`
    );

    const plugin = queuePlugin({ jobsDir, pollInterval: 20 });
    const fakeCtx = { app: { use: vi.fn(), set: vi.fn() }, db: {} };

    plugin.register(fakeCtx);
    plugin.onRoutesReady(fakeCtx);

    const qm = plugin.api.getQueueManager();
    expect(qm).toBeDefined();
    expect(qm.getSchedules().length).toBe(1);

    expect(plugin.api.getSchedules().length).toBe(1);
    expect(plugin.api.getSchedules()[0].name).toBe('ping');

    await plugin.dispose();
    expect(qm.scheduler.isRunning).toBe(false);
  });
});
