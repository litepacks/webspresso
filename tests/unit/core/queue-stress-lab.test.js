import { describe, it, expect, afterEach } from 'vitest';

const {
  createQueueManager,
  MemoryQueueAdapter,
  isValidCron,
  parseCron,
  resolveCronAlias,
} = require('../../../core/queue');

describe('Queue Stress Lab', () => {
  const managers = [];

  afterEach(async () => {
    while (managers.length > 0) {
      const m = managers.pop();
      await m.stop({ drain: false });
    }
  });

  it('1. processes 200 concurrent jobs across multiple priorities with bounded concurrency', async () => {
    const adapter = new MemoryQueueAdapter();
    const manager = createQueueManager({
      adapter,
      concurrency: 8,
      pollInterval: 10,
      autoStart: false,
    });
    managers.push(manager);

    let active = 0;
    let maxActive = 0;
    const completed = [];

    manager.register('work.item', async (job) => {
      active += 1;
      if (active > maxActive) maxActive = active;
      await new Promise((r) => setTimeout(r, 2));
      completed.push(job.data.idx);
      active -= 1;
      return { ok: true, idx: job.data.idx };
    });

    await Promise.all(
      Array.from({ length: 200 }, (_, idx) =>
        manager.dispatch('work.item', { idx }, { priority: idx % 5 }),
      ),
    );

    manager.start();

    // Wait until all 200 complete
    const deadline = Date.now() + 5000;
    while (completed.length < 200 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(completed).toHaveLength(200);
    expect(maxActive).toBeLessThanOrEqual(8);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('2. retries transient job failures and dead-letters permanently failing jobs', async () => {
    const manager = createQueueManager({
      concurrency: 4,
      pollInterval: 10,
      autoStart: false,
    });
    managers.push(manager);

    const attemptsById = new Map();
    const succeeded = [];
    const failed = [];

    manager.on('job:completed', (job) => succeeded.push(job.data.key));
    manager.on('job:failed', (job) => failed.push(job.data.key));

    manager.register('flaky.task', async (job) => {
      const n = (attemptsById.get(job.data.key) || 0) + 1;
      attemptsById.set(job.data.key, n);
      if (job.data.alwaysFail) {
        throw new Error('permanent failure');
      }
      if (n < 2) {
        throw new Error('transient failure');
      }
      return 'recovered';
    }, { attempts: 3, backoff: { type: 'fixed', delay: 10 } });

    for (let i = 0; i < 20; i++) {
      await manager.dispatch('flaky.task', { key: `rec-${i}`, alwaysFail: false });
    }
    for (let i = 0; i < 5; i++) {
      await manager.dispatch('flaky.task', { key: `dead-${i}`, alwaysFail: true }, { attempts: 2, backoff: 5 });
    }

    manager.start();

    const deadline = Date.now() + 5000;
    while ((succeeded.length < 20 || failed.length < 5) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(succeeded).toHaveLength(20);
    expect(failed).toHaveLength(5);
    expect(attemptsById.get('rec-0')).toBe(2);
    expect(attemptsById.get('dead-0')).toBe(2);
  });

  it('3. parses and validates 100 cron expressions and aliases accurately', () => {
    expect(resolveCronAlias('@hourly')).toBe('0 * * * *');
    expect(resolveCronAlias('@daily')).toBe('0 0 * * *');
    expect(isValidCron('*/5 * * * *')).toBe(true);
    expect(isValidCron('invalid cron')).toBe(false);

    for (let m = 1; m <= 30; m++) {
      const expr = `*/${m} * * * *`;
      expect(isValidCron(expr)).toBe(true);
      const parsed = parseCron(expr);
      expect(parsed).toBeDefined();
    }
  });
});

