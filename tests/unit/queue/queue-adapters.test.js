/**
 * Unit Tests for Queue Adapters (Memory, Database, Redis)
 */

const knex = require('knex');
const {
  Job,
  MemoryQueueAdapter,
  DatabaseQueueAdapter,
  RedisQueueAdapter,
} = require('../../../core/queue');

describe('Queue Adapters', () => {
  describe('MemoryQueueAdapter', () => {
    let adapter;

    beforeEach(() => {
      adapter = new MemoryQueueAdapter();
    });

    it('enqueues, dequeues, completes and gets stats', async () => {
      const job = new Job({ name: 'email.send', data: { to: 'a@example.com' }, priority: 20 });
      await adapter.enqueue(job);

      const stats1 = await adapter.getStats();
      expect(stats1.pending).toBe(1);
      expect(stats1.running).toBe(0);

      const dequeued = await adapter.dequeue(['email.send']);
      expect(dequeued).not.toBeNull();
      expect(dequeued.id).toBe(job.id);
      expect(dequeued.status).toBe('running');
      expect(dequeued.attempts).toBe(1);

      await adapter.complete(job.id, { sent: true });
      const completed = await adapter.getJob(job.id);
      expect(completed.status).toBe('completed');
      expect(completed.result).toEqual({ sent: true });

      const stats2 = await adapter.getStats();
      expect(stats2.completed).toBe(1);
      expect(stats2.pending).toBe(0);
    });

    it('handles retries and failures', async () => {
      const job = new Job({ name: 'retry.job', priority: 10 });
      await adapter.enqueue(job);

      const dequeued = await adapter.dequeue();
      await adapter.retry(dequeued.id, 500, new Error('Temp error'));

      const retryingJob = await adapter.getJob(job.id);
      expect(retryingJob.status).toBe('pending');
      expect(retryingJob.runAt.getTime()).toBeGreaterThan(Date.now());

      await adapter.fail(job.id, new Error('Fatal error'));
      const failedJob = await adapter.getJob(job.id);
      expect(failedJob.status).toBe('failed');
    });
  });

  describe('DatabaseQueueAdapter (SQLite)', () => {
    let db;
    let adapter;

    beforeAll(async () => {
      db = knex({
        client: 'better-sqlite3',
        connection: {
          filename: ':memory:',
        },
        useNullAsDefault: true,
      });

      adapter = new DatabaseQueueAdapter({ knex: db, tableName: 'test_jobs' });
      await adapter.ensureTable();
    });

    afterAll(async () => {
      await db.destroy();
    });

    beforeEach(async () => {
      await adapter.clear();
    });

    it('recoverStale requeues jobs abandoned in running state by a dead worker', async () => {
      const age = (ms) => new Date(Date.now() - ms);
      const stuck = new Job({ name: 'db.stuck', timeout: 1000, maxAttempts: 3 });
      const exhausted = new Job({ name: 'db.exhausted', timeout: 1000, maxAttempts: 1 });
      const fresh = new Job({ name: 'db.fresh', timeout: 1000 });
      const local = new Job({ name: 'db.local', timeout: 1000 });
      for (const j of [stuck, exhausted, fresh, local]) await adapter.enqueue(j);

      // Simulate workers that claimed jobs and then died
      await db('test_jobs').whereIn('id', [stuck.id, exhausted.id, local.id])
        .update({ status: 'running', attempts: 1, updated_at: age(10000) });
      await db('test_jobs').where('id', fresh.id).update({ status: 'running', attempts: 1, updated_at: new Date() });

      const recovered = await adapter.recoverStale({ graceMs: 1000, excludeIds: [local.id] });
      expect(recovered).toBe(2);

      expect((await adapter.getJob(stuck.id)).status).toBe('pending');
      const failed = await adapter.getJob(exhausted.id);
      expect(failed.status).toBe('failed');
      expect(String(failed.error)).toContain('Worker stopped');
      expect((await adapter.getJob(fresh.id)).status).toBe('running'); // still within timeout + grace
      expect((await adapter.getJob(local.id)).status).toBe('running'); // owned by this process

      const again = await adapter.dequeue(['db.stuck']);
      expect(again.id).toBe(stuck.id);
      expect(again.attempts).toBe(2);
    });

    it('enqueues and dequeues persistent jobs in DB', async () => {
      const job = new Job({ name: 'db.job', data: { val: 42 }, priority: 15 });
      await adapter.enqueue(job);

      const stats1 = await adapter.getStats();
      expect(stats1.pending).toBe(1);

      const dequeued = await adapter.dequeue(['db.job']);
      expect(dequeued).not.toBeNull();
      expect(dequeued.id).toBe(job.id);
      expect(dequeued.data).toEqual({ val: 42 });
      expect(dequeued.status).toBe('running');

      await adapter.complete(job.id, { processed: true });
      const completed = await adapter.getJob(job.id);
      expect(completed.status).toBe('completed');
      expect(completed.result).toEqual({ processed: true });

      const stats2 = await adapter.getStats();
      expect(stats2.completed).toBe(1);
      expect(stats2.pending).toBe(0);
    });

    it('reschedules retry and updates status in DB', async () => {
      const job = new Job({ name: 'db.retry', priority: 10 });
      await adapter.enqueue(job);

      const dequeued = await adapter.dequeue();
      await adapter.retry(dequeued.id, 1000, new Error('DB Error'));

      const retrying = await adapter.getJob(job.id);
      expect(retrying.status).toBe('pending');
      expect(retrying.error).toBe('DB Error');

      await adapter.fail(job.id, new Error('Permanent Failure'));
      const failed = await adapter.getJob(job.id);
      expect(failed.status).toBe('failed');
      expect(failed.error).toBe('Permanent Failure');
    });

    it('dequeues multiple jobs at once with dequeueMany', async () => {
      await adapter.enqueue(new Job({ name: 'batch.1', priority: 10 }));
      await adapter.enqueue(new Job({ name: 'batch.2', priority: 20 }));
      await adapter.enqueue(new Job({ name: 'batch.3', priority: 30 }));

      const dequeued = await adapter.dequeueMany(['batch.1', 'batch.2', 'batch.3'], 2);
      expect(dequeued.length).toBe(2);
      expect(dequeued[0].name).toBe('batch.3');
      expect(dequeued[1].name).toBe('batch.2');
      expect(dequeued[0].status).toBe('running');
      expect(dequeued[1].status).toBe('running');

      const remaining = await adapter.dequeueMany([], 5);
      expect(remaining.length).toBe(1);
      expect(remaining[0].name).toBe('batch.1');
    });
  });

  describe('RedisQueueAdapter', () => {
    let mockRedis;
    let adapter;

    beforeEach(() => {
      const storage = new Map();
      const zsets = new Map();
      const sets = new Map();

      mockRedis = {
        get: async (k) => storage.get(k) || null,
        set: async (k, v) => storage.set(k, v),
        del: async (k) => { storage.delete(k); zsets.delete(k); sets.delete(k); },
        zadd: async (k, score, member) => {
          if (!zsets.has(k)) zsets.set(k, new Map());
          zsets.get(k).set(member, score);
        },
        zrem: async (k, member) => {
          if (zsets.has(k)) zsets.get(k).delete(member);
        },
        zrange: async (k, start, stop) => {
          if (!zsets.has(k)) return [];
          const entries = Array.from(zsets.get(k).entries());
          entries.sort((a, b) => a[1] - b[1]);
          return entries.slice(start, stop + 1).map((e) => e[0]);
        },
        zrangebyscore: async (k, min, max) => {
          if (!zsets.has(k)) return [];
          const entries = Array.from(zsets.get(k).entries());
          return entries.filter((e) => e[1] >= min && e[1] <= max).map((e) => e[0]);
        },
        zcard: async (k) => (zsets.has(k) ? zsets.get(k).size : 0),
        sadd: async (k, member) => {
          if (!sets.has(k)) sets.set(k, new Set());
          sets.get(k).add(member);
        },
        srem: async (k, member) => {
          if (sets.has(k)) sets.get(k).delete(member);
        },
        scard: async (k) => (sets.has(k) ? sets.get(k).size : 0),
      };

      adapter = new RedisQueueAdapter({ client: mockRedis, prefix: 'test:' });
    });

    it('enqueues, dequeues and completes jobs in Redis', async () => {
      const job = new Job({ name: 'redis.job', data: { x: 1 }, priority: 30 });
      await adapter.enqueue(job);

      const dequeued = await adapter.dequeue(['redis.job']);
      expect(dequeued).not.toBeNull();
      expect(dequeued.id).toBe(job.id);
      expect(dequeued.status).toBe('running');

      await adapter.complete(job.id, { ok: true });
      const completed = await adapter.getJob(job.id);
      expect(completed.status).toBe('completed');
      expect(completed.result).toEqual({ ok: true });

      const stats = await adapter.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.running).toBe(0);
    });
  });
});
