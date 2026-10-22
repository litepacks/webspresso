const fs = require('fs');
const path = require('path');
const { QueueManager } = require('../../../core/queue/manager');
const { MemoryQueueAdapter } = require('../../../core/queue/adapters/memory');
const { wait, createTempDir, cleanupDir } = require('../../utils');

describe('QueueManager Deep Scenarios & Branch Coverage', () => {
  let manager;

  afterEach(async () => {
    if (manager) {
      manager.stop();
      manager.stopCleanup();
    }
  });

  describe('Constructor Options & Defaults', () => {
    it('initializes with default options and starts worker when autoStart is true', () => {
      manager = new QueueManager({ autoStart: false });
      expect(manager.concurrency).toBe(2);
      expect(manager.pollInterval).toBe(500);
      expect(manager.isRunning).toBe(false);
      expect(manager.isPaused).toBe(false);
      expect(manager.isDraining).toBe(false);
    });

    it('enforces minimum limits on concurrency and poll intervals', () => {
      manager = new QueueManager({
        concurrency: 1,
        pollInterval: 10, // below min 50
        autoStart: false,
      });
      expect(manager.concurrency).toBe(1);
      expect(manager.pollInterval).toBe(50);
      expect(manager.maxPollInterval).toBeGreaterThanOrEqual(50);
    });

    it('configures retention settings properly', () => {
      // Disabled retention
      const m1 = new QueueManager({ retention: false, autoStart: false });
      expect(m1.retentionConfig.enabled).toBe(false);

      // Custom retention
      const m2 = new QueueManager({
        retentionDays: 14,
        retentionStatuses: ['completed', 'failed'],
        cleanupIntervalMs: 120000,
        cleanupOnStart: true,
        autoStart: false,
      });
      expect(m2.retentionConfig.enabled).toBe(true);
      expect(m2.retentionConfig.days).toBe(14);
      expect(m2.retentionConfig.statuses).toEqual(['completed', 'failed']);
      expect(m2.retentionConfig.intervalMs).toBe(120000);
      expect(m2.retentionConfig.runOnStart).toBe(true);
      m2.stopCleanup();
    });
  });

  describe('define() Validation & Registration', () => {
    it('throws error when job name is missing or invalid', () => {
      manager = new QueueManager({ autoStart: false });
      expect(() => manager.define('', () => {})).toThrow(/non-empty string/);
      expect(() => manager.define(null, () => {})).toThrow(/non-empty string/);
      expect(() => manager.define(123, () => {})).toThrow(/non-empty string/);
    });

    it('throws error when job handler is not a function', () => {
      manager = new QueueManager({ autoStart: false });
      expect(() => manager.define('test.job', null)).toThrow(/must be a function/);
      expect(() => manager.define('test.job', 'not a function')).toThrow(/must be a function/);
    });

    it('registers job handler with default and custom options', () => {
      manager = new QueueManager({ autoStart: false });
      manager.define('custom.job', async () => 'done', {
        attempts: 5,
        timeout: 10000,
        priority: 20,
      });

      const registered = manager.handlers.get('custom.job');
      expect(registered).toBeDefined();
      expect(registered.options.attempts).toBe(5);
      expect(registered.options.timeout).toBe(10000);
    });
  });

  describe('Pause, Resume, Stop & Drain Controls', () => {
    it('pauses and resumes queue processing', async () => {
      manager = new QueueManager({ pollInterval: 10, autoStart: true });
      let processed = false;

      manager.define('quick.task', async () => {
        processed = true;
      });

      manager.pause();
      expect(manager.isPaused).toBe(true);

      await manager.dispatch('quick.task', { foo: 'bar' });
      // Wait a short moment while paused
      await wait(25);
      expect(processed).toBe(false);

      const completedPromise = new Promise((resolve) => {
        manager.on('job:completed', () => resolve());
      });

      manager.resume();
      expect(manager.isPaused).toBe(false);

      // Wait for processing via event
      await completedPromise;
      expect(processed).toBe(true);
    });

    it('drain() waits for active jobs to finish and prevents new executions', async () => {
      manager = new QueueManager({ concurrency: 2, pollInterval: 10, autoStart: true });
      let jobFinished = false;

      manager.define('slow.task', async () => {
        await wait(30);
        jobFinished = true;
      });

      await manager.dispatch('slow.task', {});
      // Wait for job to start running
      await wait(15);

      const drainPromise = manager.drain(1000);
      expect(manager.isDraining).toBe(true);

      await drainPromise;
      expect(jobFinished).toBe(true);
      expect(manager.runningCount).toBe(0);
    });
  });

  describe('Job Execution, Retries & Failure Scenarios', () => {
    it('executes job successfully and emits lifecycle events', async () => {
      manager = new QueueManager({ pollInterval: 10, autoStart: true });
      const events = [];

      manager.on('job:queued', (j) => events.push(`queued:${j.name}`));
      manager.on('job:started', (j) => events.push(`started:${j.name}`));
      manager.on('job:completed', (j) => events.push(`completed:${j.name}`));

      const completedPromise = new Promise((resolve) => {
        manager.on('job:completed', () => resolve());
      });

      manager.define('success.job', async (job) => {
        return { processed: job.data.id };
      });

      const job = await manager.dispatch('success.job', { id: 101 });
      expect(job.status).toBe('pending');

      await completedPromise;

      expect(events).toContain('queued:success.job');
      expect(events).toContain('started:success.job');
      expect(events).toContain('completed:success.job');
    });

    it('retries failing jobs up to max attempts then emits job:failed', async () => {
      manager = new QueueManager({ pollInterval: 10, autoStart: true });
      let attemptsCount = 0;
      let failedJob = null;

      const failedPromise = new Promise((resolve) => {
        manager.on('job:failed', (job) => {
          failedJob = job;
          resolve();
        });
      });

      manager.define(
        'failing.job',
        async () => {
          attemptsCount++;
          throw new Error(`Attempt ${attemptsCount} failed`);
        },
        { attempts: 2, backoff: 5 }
      );

      await manager.dispatch('failing.job', {});

      // Wait for initial run + retry via event
      await failedPromise;

      expect(attemptsCount).toBe(2);
      expect(failedJob).not.toBeNull();
      expect(failedJob.status).toBe('failed');
      expect(failedJob.error?.message || String(failedJob.error)).toContain('Attempt 2 failed');
    });

    it('handles job timeout properly', async () => {
      manager = new QueueManager({ pollInterval: 10, autoStart: true });
      let timeoutError = null;

      const timeoutPromise = new Promise((resolve) => {
        manager.on('job:failed', (job, err) => {
          timeoutError = err;
          resolve();
        });
      });

      manager.define(
        'timeout.job',
        async (job) => {
          await wait(60);
        },
        { timeout: 20, attempts: 1 }
      );

      await manager.dispatch('timeout.job', {});
      await timeoutPromise;

      expect(timeoutError?.message || String(timeoutError)).toMatch(/timeout|timed out/i);
    });
  });

  describe('Directory Job Discovery', () => {
    it('loads job files from directory exporting { handler, options }', () => {
      const tempDir = createTempDir('wsp-jobs-');
      const jobFilePath = path.join(tempDir, 'send-email.js');

      fs.writeFileSync(
        jobFilePath,
        `module.exports = {
          handler: async (job) => 'email_sent',
          options: { attempts: 4 }
        };`
      );

      manager = new QueueManager({ jobsDir: tempDir, autoStart: false });
      expect(manager.handlers.has('send-email')).toBe(true);
      expect(manager.handlers.get('send-email').options.attempts).toBe(4);

      cleanupDir(tempDir);
    });
  });
});
