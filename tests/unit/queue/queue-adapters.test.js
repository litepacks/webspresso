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
