const {
  wait
} = require('../../utils');

/**
 * Unit Tests for QueueManager (core/queue/manager.js)
 */

const { createQueueManager } = require('../../../core/queue');

describe('QueueManager Core Engine', () => {
  let queue;

  beforeEach(() => {
    if (queue) {
      queue.pause();
    }
  });

  afterEach(async () => {
    if (queue) {
      await queue.drain(100);
      await queue.stop();
    }
  });

  it('defines and executes a simple background job', async () => {
    queue = createQueueManager({ concurrency: 2, pollInterval: 20 });
    let executedData = null;

    queue.define('test.simple', async (job) => {
      executedData = job.data;
      return { success: true };
    });

    const completionPromise = new Promise((resolve) => {
      queue.on('job:completed', (job, result) => {
        if (job.name === 'test.simple') {
          resolve({ job, result });
        }
      });
    });

    const job = await queue.dispatch('test.simple', { message: 'hello' });
    expect(job.name).toBe('test.simple');
    expect(job.status).toBe('pending');

    const { job: completedJob, result } = await completionPromise;
    expect(executedData).toEqual({ message: 'hello' });
    expect(completedJob.status).toBe('completed');
    expect(result).toEqual({ success: true });
  });

  it('respects priority when multiple jobs are pending', async () => {
    queue = createQueueManager({ concurrency: 1, pollInterval: 20, autoStart: false });
    const executedOrder = [];

    queue.define('test.priority', async (job) => {
      executedOrder.push(job.data.id);
    });

    // Enqueue jobs while queue is paused
    await queue.dispatch('test.priority', { id: 'low' }, { priority: 5 });
    await queue.dispatch('test.priority', { id: 'high' }, { priority: 90 });
    await queue.dispatch('test.priority', { id: 'medium' }, { priority: 50 });

    const allDone = new Promise((resolve) => {
      let count = 0;
      queue.on('job:completed', () => {
        count++;
        if (count === 3) resolve();
      });
    });

    queue.start();
    await allDone;

    expect(executedOrder).toEqual(['high', 'medium', 'low']);
  });

  it('handles automatic retries with backoff and eventual failure', async () => {
    queue = createQueueManager({ concurrency: 1, pollInterval: 20 });
    let attemptCount = 0;
    const retryDelays = [];

    queue.define('test.retry', async () => {
      attemptCount++;
      throw new Error(`Failure on attempt ${attemptCount}`);
    }, { attempts: 3, backoff: { type: 'fixed', delay: 5 } });

    const retryingPromise = new Promise((resolve) => {
      const delays = [];
      queue.on('job:retrying', (job, err, delay) => {
        delays.push(delay);
        if (job.attempts === 2) {
          resolve(delays);
        }
      });
    });

    const failurePromise = new Promise((resolve) => {
      queue.on('job:failed', (job, err) => {
        resolve({ job, err });
      });
    });

    await queue.dispatch('test.retry', {}, { attempts: 3, backoff: { type: 'fixed', delay: 5 } });

    const delays = await retryingPromise;
    expect(delays.length).toBeGreaterThanOrEqual(1);

    const { job: failedJob, err } = await failurePromise;
    expect(attemptCount).toBe(3);
    expect(failedJob.status).toBe('failed');
    expect(err.message).toContain('Failure on attempt 3');
  });

  it('tracks job progress updates', async () => {
    queue = createQueueManager({ concurrency: 1, pollInterval: 5 });
    const progressEvents = [];

    queue.define('test.progress', async (job) => {
      job.progress(25, 'Step 1');
      await wait(2);
      job.progress(75, 'Step 2');
      await wait(2);
      return 'done';
    });

    queue.on('job:progress', (job, percent, msg) => {
      progressEvents.push({ percent, msg });
    });

    const completed = new Promise((resolve) => {
      queue.on('job:completed', resolve);
    });

    await queue.dispatch('test.progress', {});
    await completed;

    expect(progressEvents).toEqual([
      { percent: 25, msg: 'Step 1' },
      { percent: 75, msg: 'Step 2' },
    ]);
  });

  it('pauses and resumes processing cleanly', async () => {
    queue = createQueueManager({ concurrency: 1, pollInterval: 5, autoStart: false });
    let executed = false;

    queue.define('test.pause', async () => {
      executed = true;
    });

    await queue.dispatch('test.pause', {});
    expect(queue.isPaused).toBe(false);

    queue.pause();
    expect(queue.isPaused).toBe(true);

    await wait(15);
    expect(executed).toBe(false);

    queue.resume();
    expect(queue.isPaused).toBe(false);

    await new Promise((resolve) => {
      queue.on('job:completed', resolve);
    });
    expect(executed).toBe(true);
  });

  it('backs off polling interval when idle and resets immediately on dispatch', async () => {
    queue = createQueueManager({ concurrency: 2, pollInterval: 50, maxPollInterval: 250 });
    queue.define('test.backoff', async () => 'ok');

    expect(queue._currentPollInterval).toBe(50);

    // Allow multiple idle ticks to back off
    await wait(80);
    expect(queue._currentPollInterval).toBeGreaterThan(50);

    // Dispatching a job should immediately reset to base pollInterval
    await queue.dispatch('test.backoff', {});
    expect(queue._currentPollInterval).toBe(50);
  });

  it('drains active running jobs gracefully and emits drain event', async () => {
    queue = createQueueManager({ concurrency: 2, pollInterval: 10 });
    let jobFinished = false;

    queue.define('test.drain.active', async () => {
      await wait(30);
      jobFinished = true;
      return 'done';
    });

    await queue.dispatch('test.drain.active', {});
    // Give it a moment to dequeue and enter running state
    await wait(15);
    expect(queue.runningCount).toBe(1);

    let drainEmitted = false;
    queue.on('drain', () => {
      drainEmitted = true;
    });

    await queue.drain(2000);
    expect(jobFinished).toBe(true);
    expect(queue.runningCount).toBe(0);
    expect(drainEmitted).toBe(true);
    expect(queue.isDraining).toBe(false);
  });

  it('emits drain event and cleans up immediately when queue has zero active jobs', async () => {
    queue = createQueueManager({ concurrency: 2, pollInterval: 50 });
    let drainEmitted = false;
    queue.on('drain', () => {
      drainEmitted = true;
    });

    await queue.drain(500);
    expect(drainEmitted).toBe(true);
    expect(queue.isDraining).toBe(false);
    expect(queue.isRunning).toBe(false);
  });

  it('emits idle event when the last running job settles', async () => {
    queue = createQueueManager({ concurrency: 1, pollInterval: 10 });
    let idleEmitted = false;

    queue.define('test.idle', async () => {
      await wait(10);
    });

    queue.on('idle', () => {
      idleEmitted = true;
    });

    await queue.dispatch('test.idle', {});
    await new Promise((resolve) => queue.on('job:completed', resolve));

    expect(idleEmitted).toBe(true);
  });

  it('shields adapter failures in complete/fail without unhandled rejections', async () => {
    const errorEvents = [];
    queue = createQueueManager({ concurrency: 1, pollInterval: 10 });
    queue.on('error', (err) => {
      errorEvents.push(err);
    });

    queue.define('test.adapter.failure', async () => {
      return { ok: true };
    });

    // Mock adapter.complete to reject (e.g. database connection lost)
    const originalComplete = queue.adapter.complete.bind(queue.adapter);
    queue.adapter.complete = async () => {
      throw new Error('Database network disconnected');
    };

    await queue.dispatch('test.adapter.failure', {});
    await wait(40);

    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0].message).toBe('Database network disconnected');

    queue.adapter.complete = originalComplete;
  });
});

