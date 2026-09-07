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
      await new Promise((r) => setTimeout(r, 2));
      job.progress(75, 'Step 2');
      await new Promise((r) => setTimeout(r, 2));
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

    await new Promise((r) => setTimeout(r, 15));
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
    await new Promise((r) => setTimeout(r, 80));
    expect(queue._currentPollInterval).toBeGreaterThan(50);

    // Dispatching a job should immediately reset to base pollInterval
    await queue.dispatch('test.backoff', {});
    expect(queue._currentPollInterval).toBe(50);
  });
});
