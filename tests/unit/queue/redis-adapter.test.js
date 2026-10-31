'use strict';

const { RedisQueueAdapter } = require('../../../core/queue/adapters/redis');
const { Job } = require('../../../core/queue/job');

describe('RedisQueueAdapter', () => {
  describe('Constructor & Setup', () => {
    it('throws if options.client is missing', () => {
      expect(() => new RedisQueueAdapter()).toThrow(/requires a Redis client/i);
      expect(() => new RedisQueueAdapter({})).toThrow(/requires a Redis client/i);
    });

    it('sets default prefix if none provided', () => {
      const adapter = new RedisQueueAdapter({ client: {} });
      expect(adapter.prefix).toBe('webspresso:queue:');
      expect(adapter._key('test')).toBe('webspresso:queue:test');
    });

    it('uses custom prefix when specified', () => {
      const adapter = new RedisQueueAdapter({ client: {}, prefix: 'custom:q:' });
      expect(adapter.prefix).toBe('custom:q:');
      expect(adapter._key('foo')).toBe('custom:q:foo');
    });
  });

  describe('IORedis-style Client (lowercase commands)', () => {
    function createMockIoRedis() {
      const store = new Map();
      const zsets = new Map(); // key -> [{ score, member }]
      const sets = new Map();  // key -> Set

      return {
        store,
        zsets,
        sets,
        async set(key, value) {
          store.set(key, value);
          return 'OK';
        },
        async get(key) {
          return store.get(key) || null;
        },
        async del(key) {
          store.delete(key);
          zsets.delete(key);
          sets.delete(key);
          return 1;
        },
        async zadd(key, score, member) {
          if (!zsets.has(key)) zsets.set(key, []);
          const list = zsets.get(key);
          const idx = list.findIndex(item => item.member === member);
          if (idx >= 0) list.splice(idx, 1);
          list.push({ score, member });
          list.sort((a, b) => a.score - b.score);
          return 1;
        },
        async zrangebyscore(key, min, max) {
          const list = zsets.get(key) || [];
          return list
            .filter(item => item.score >= min && item.score <= max)
            .map(item => item.member);
        },
        async zrange(key, start, stop) {
          const list = zsets.get(key) || [];
          return list.slice(start, stop + 1).map(item => item.member);
        },
        async zrem(key, member) {
          const list = zsets.get(key) || [];
          const idx = list.findIndex(item => item.member === member);
          if (idx >= 0) {
            list.splice(idx, 1);
            return 1;
          }
          return 0;
        },
        async zcard(key) {
          return (zsets.get(key) || []).length;
        },
        async sadd(key, member) {
          if (!sets.has(key)) sets.set(key, new Set());
          sets.get(key).add(member);
          return 1;
        },
        async srem(key, member) {
          const s = sets.get(key);
          if (!s) return 0;
          return s.delete(member) ? 1 : 0;
        },
        async scard(key) {
          return (sets.get(key) || new Set()).size;
        },
        async smembers(key) {
          return Array.from(sets.get(key) || []);
        },
      };
    }

    it('enqueues immediate job with priority score', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      const job = new Job({ id: 'j1', name: 'send.email', priority: 50 });
      const returned = await adapter.enqueue(job);

      expect(returned.id).toBe('j1');
      expect(client.store.has(adapter._key('job:j1'))).toBe(true);
      const waitingList = client.zsets.get(adapter._key('waiting'));
      expect(waitingList).toHaveLength(1);
      expect(waitingList[0].member).toBe('j1');
    });

    it('hands a job to only one of several concurrent workers', async () => {
      const raw = createMockIoRedis();
      // Yield between every command, like a network round trip, so workers interleave
      const client = {};
      for (const [k, fn] of Object.entries(raw)) {
        client[k] = typeof fn === 'function'
          ? async (...args) => { await new Promise((r) => setImmediate(r)); return fn(...args); }
          : fn;
      }
      const workers = [1, 2, 3].map(() => new RedisQueueAdapter({ client }));

      await workers[0].enqueue(new Job({ id: 'only-once', name: 'payment.capture' }));
      const results = await Promise.all(workers.map((w) => w.dequeue()));

      const claimed = results.filter(Boolean);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].id).toBe('only-once');
      expect(claimed[0].attempts).toBe(1);
    });

    it('recoverStale requeues active jobs abandoned by a dead worker', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      await adapter.enqueue(new Job({ id: 'lost', name: 'report.build', timeout: 1000, maxAttempts: 3 }));
      await adapter.enqueue(new Job({ id: 'busy', name: 'report.build', timeout: 1000, maxAttempts: 3 }));
      const lost = await adapter.dequeue();
      const busy = await adapter.dequeue();
      expect([lost.id, busy.id].sort()).toEqual(['busy', 'lost']);

      // Age the 'lost' job as if its worker died long ago
      const key = adapter._key('job:lost');
      const payload = JSON.parse(client.store.get(key));
      payload.updatedAt = new Date(Date.now() - 10000).toISOString();
      client.store.set(key, JSON.stringify(payload));

      expect(await adapter.recoverStale({ graceMs: 1000 })).toBe(1);
      expect(Array.from(client.sets.get(adapter._key('active')))).toEqual(['busy']);

      const again = await adapter.dequeue();
      expect(again.id).toBe('lost');
      expect(again.attempts).toBe(2);
    });

    it('enqueues delayed job when runAt is in future', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      const future = new Date(Date.now() + 60000);
      const job = new Job({ id: 'j_delayed', name: 'send.digest', runAt: future });
      await adapter.enqueue(job);

      expect(client.zsets.has(adapter._key('waiting'))).toBe(false);
      const delayedList = client.zsets.get(adapter._key('delayed'));
      expect(delayedList).toHaveLength(1);
      expect(delayedList[0].member).toBe('j_delayed');
      expect(delayedList[0].score).toBe(future.getTime());
    });

    it('promotes delayed jobs when due during dequeue', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      const baseNow = 1700000000000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(baseNow);

      const job = new Job({ id: 'j_past', name: 'process.data', runAt: new Date(baseNow + 5000), priority: 20 });
      await adapter.enqueue(job);

      // It was initially in delayed
      expect(client.zsets.get(adapter._key('delayed'))).toHaveLength(1);

      // Advance time so the delayed job becomes due
      dateSpy.mockReturnValue(baseNow + 10000);

      // Dequeue will call _promoteDelayed()
      const dequeued = await adapter.dequeue();
      expect(dequeued).not.toBeNull();
      expect(dequeued.id).toBe('j_past');
      expect(dequeued.status).toBe('running');
      expect(dequeued.attempts).toBe(1);

      // Now delayed is empty and active has j_past
      expect(client.zsets.get(adapter._key('delayed'))).toHaveLength(0);
      expect(client.sets.get(adapter._key('active')).has('j_past')).toBe(true);

      dateSpy.mockRestore();
    });

    it('skips non-matching job names during dequeue', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      const jobA = new Job({ id: 'j_a', name: 'type.a' });
      const jobB = new Job({ id: 'j_b', name: 'type.b' });
      await adapter.enqueue(jobA);
      await adapter.enqueue(jobB);

      const dequeuedB = await adapter.dequeue(['type.b']);
      expect(dequeuedB).not.toBeNull();
      expect(dequeuedB.id).toBe('j_b');
    });

    it('cleans up stale job ID when job payload is missing in storage', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      await client.zadd(adapter._key('waiting'), 100, 'ghost_job');
      const dequeued = await adapter.dequeue();
      expect(dequeued).toBeNull();
      expect(client.zsets.get(adapter._key('waiting'))).toHaveLength(0);
    });

    it('dequeueMany returns up to specified limit', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      await adapter.enqueue(new Job({ id: 'm1', name: 'batch' }));
      await adapter.enqueue(new Job({ id: 'm2', name: 'batch' }));
      await adapter.enqueue(new Job({ id: 'm3', name: 'batch' }));

      // limit <= 1
      const single = await adapter.dequeueMany(['batch'], 1);
      expect(single).toHaveLength(1);
      expect(single[0].id).toBe('m1');

      // limit = 2
      const multi = await adapter.dequeueMany(['batch'], 2);
      expect(multi).toHaveLength(2);
      expect(multi[0].id).toBe('m2');
      expect(multi[1].id).toBe('m3');

      // limit when empty
      const empty = await adapter.dequeueMany(['batch'], 2);
      expect(empty).toHaveLength(0);
    });

    it('completes an active job', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      await adapter.enqueue(new Job({ id: 'c1', name: 'task' }));
      await adapter.dequeue();

      const completed = await adapter.complete('c1', { success: true });
      expect(completed.status).toBe('completed');
      expect(completed.result).toEqual({ success: true });
      expect(completed.progressValue).toBe(100);

      expect(client.sets.get(adapter._key('active')).has('c1')).toBe(false);
      expect(client.sets.get(adapter._key('completed')).has('c1')).toBe(true);

      // completing missing job returns null
      const missing = await adapter.complete('ghost');
      expect(missing).toBeNull();
    });

    it('fails an active job', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      await adapter.enqueue(new Job({ id: 'f1', name: 'task' }));
      await adapter.dequeue();

      const failed = await adapter.fail('f1', 'Network timeout');
      expect(failed.status).toBe('failed');
      expect(failed.error).toBe('Network timeout');

      expect(client.sets.get(adapter._key('active')).has('f1')).toBe(false);
      expect(client.sets.get(adapter._key('failed')).has('f1')).toBe(true);

      // failing missing job returns null
      const missing = await adapter.fail('ghost');
      expect(missing).toBeNull();
    });

    it('retries an active job with backoff delay', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      await adapter.enqueue(new Job({ id: 'r1', name: 'task' }));
      await adapter.dequeue();

      const retried = await adapter.retry('r1', 5000, 'Temporary 503');
      expect(retried.status).toBe('pending');
      expect(retried.error).toBe('Temporary 503');
      expect(retried.runAt.getTime()).toBeGreaterThan(Date.now());

      expect(client.sets.get(adapter._key('active')).has('r1')).toBe(false);
      expect(client.zsets.get(adapter._key('delayed'))).toHaveLength(1);

      // retrying missing job returns null
      const missing = await adapter.retry('ghost', 1000);
      expect(missing).toBeNull();
    });

    it('calculates queue stats accurately', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      await adapter.enqueue(new Job({ id: 's1', name: 'q1' })); // waiting
      await adapter.enqueue(new Job({ id: 's2', name: 'q2', runAt: new Date(Date.now() + 10000) })); // delayed

      let stats = await adapter.getStats();
      expect(stats.pending).toBe(2);
      expect(stats.running).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.total).toBe(2);

      await adapter.dequeue(); // s1 is running
      await adapter.complete('s1'); // s1 is completed

      stats = await adapter.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(1); // s2 is still delayed
    });

    it('clears all queue keys', async () => {
      const client = createMockIoRedis();
      const adapter = new RedisQueueAdapter({ client });

      await adapter.enqueue(new Job({ id: 'cl1', name: 'task' }));
      await adapter.clear();

      expect(client.zsets.has(adapter._key('waiting'))).toBe(false);
      expect(client.zsets.has(adapter._key('delayed'))).toBe(false);
      expect(client.sets.has(adapter._key('active'))).toBe(false);
      expect(client.sets.has(adapter._key('completed'))).toBe(false);
      expect(client.sets.has(adapter._key('failed'))).toBe(false);
    });
  });

  describe('Node-Redis v4 Style Client (camelCase commands)', () => {
    function createMockNodeRedis() {
      const store = new Map();
      const zsets = new Map();
      const sets = new Map();

      return {
        store,
        zsets,
        sets,
        async set(key, value) {
          store.set(key, value);
          return 'OK';
        },
        async get(key) {
          return store.get(key) || null;
        },
        async del(key) {
          store.delete(key);
          zsets.delete(key);
          sets.delete(key);
          return 1;
        },
        async zAdd(key, items) {
          if (!zsets.has(key)) zsets.set(key, []);
          const list = zsets.get(key);
          for (const item of items) {
            const idx = list.findIndex(i => i.member === item.value);
            if (idx >= 0) list.splice(idx, 1);
            list.push({ score: item.score, member: item.value });
          }
          list.sort((a, b) => a.score - b.score);
          return items.length;
        },
        async zRangeByScore(key, min, max) {
          const list = zsets.get(key) || [];
          return list
            .filter(item => item.score >= min && item.score <= max)
            .map(item => item.member);
        },
        async zRange(key, start, stop) {
          const list = zsets.get(key) || [];
          return list.slice(start, stop + 1).map(item => item.member);
        },
        async zRem(key, member) {
          const list = zsets.get(key) || [];
          const idx = list.findIndex(item => item.member === member);
          if (idx >= 0) {
            list.splice(idx, 1);
            return 1;
          }
          return 0;
        },
        async zCard(key) {
          return (zsets.get(key) || []).length;
        },
        async sAdd(key, member) {
          if (!sets.has(key)) sets.set(key, new Set());
          sets.get(key).add(member);
          return 1;
        },
        async sRem(key, member) {
          const s = sets.get(key);
          if (!s) return 0;
          return s.delete(member) ? 1 : 0;
        },
        async sCard(key) {
          return (sets.get(key) || new Set()).size;
        },
        async sMembers(key) {
          return Array.from(sets.get(key) || []);
        },
      };
    }

    it('works seamlessly with camelCase zAdd, zRem, sAdd, sRem, zCard, sCard', async () => {
      const client = createMockNodeRedis();
      const adapter = new RedisQueueAdapter({ client });

      const immediateJob = new Job({ id: 'v4_1', name: 'node.redis' });
      await adapter.enqueue(immediateJob);

      const delayedJob = new Job({ id: 'v4_2', name: 'node.redis', runAt: new Date(Date.now() + 50000) });
      await adapter.enqueue(delayedJob);

      const dequeued = await adapter.dequeue();
      expect(dequeued.id).toBe('v4_1');

      const completed = await adapter.complete('v4_1', { done: true });
      expect(completed.status).toBe('completed');

      const failed = await adapter.fail('v4_2', 'failed reason');
      expect(failed.status).toBe('failed');

      const retried = await adapter.retry('v4_2', 1000);
      expect(retried.status).toBe('pending');

      const stats = await adapter.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Clean & Maintenance Edge Cases', () => {
    function createMockClientWithJobs(jobs) {
      const store = new Map();
      const sets = new Map([
        ['webspresso:queue:completed', new Set()],
        ['webspresso:queue:failed', new Set()],
      ]);

      for (const j of jobs) {
        store.set(`webspresso:queue:job:${j.id}`, JSON.stringify(j));
        if (j.status === 'completed') {
          sets.get('webspresso:queue:completed').add(j.id);
        } else if (j.status === 'failed') {
          sets.get('webspresso:queue:failed').add(j.id);
        }
      }

      return {
        store,
        sets,
        async get(key) {
          return store.get(key) || null;
        },
        async del(key) {
          store.delete(key);
          return 1;
        },
        async srem(key, member) {
          const s = sets.get(key);
          return s ? s.delete(member) ? 1 : 0 : 0;
        },
        async smembers(key) {
          return Array.from(sets.get(key) || []);
        },
      };
    }

    it('throws when olderThan is an invalid date', async () => {
      const adapter = new RedisQueueAdapter({ client: {} });
      await expect(adapter.clean({ olderThan: 'invalid-date-string' })).rejects.toThrow(/invalid olderThan date/i);
    });

    it('throws when days is not a non-negative number', async () => {
      const adapter = new RedisQueueAdapter({ client: {} });
      await expect(adapter.clean({ days: -5 })).rejects.toThrow(/days must be a non-negative number/i);
      await expect(adapter.clean({ days: 'not-a-number' })).rejects.toThrow(/days must be a non-negative number/i);
    });

    it('cleans completed jobs older than specified cutoff', async () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const freshDate = new Date();

      const client = createMockClientWithJobs([
        { id: 'old_1', status: 'completed', updatedAt: oldDate },
        { id: 'fresh_1', status: 'completed', updatedAt: freshDate },
      ]);

      const adapter = new RedisQueueAdapter({ client });
      const cleaned = await adapter.clean({ days: 7 });

      expect(cleaned).toBe(1);
      expect(client.store.has('webspresso:queue:job:old_1')).toBe(false);
      expect(client.store.has('webspresso:queue:job:fresh_1')).toBe(true);
    });

    it('cleans both completed and failed when status is * or all', async () => {
      const oldDate = new Date(Date.now() - 20000);
      const client = createMockClientWithJobs([
        { id: 'c_old', status: 'completed', updatedAt: oldDate },
        { id: 'f_old', status: 'failed', updatedAt: oldDate },
      ]);

      const adapter = new RedisQueueAdapter({ client });
      const cleaned = await adapter.clean({ status: '*', olderThan: new Date(Date.now() - 10000) });

      expect(cleaned).toBe(2);
      expect(client.store.has('webspresso:queue:job:c_old')).toBe(false);
      expect(client.store.has('webspresso:queue:job:f_old')).toBe(false);
    });

    it('cleans comma-separated status strings and respects limit', async () => {
      const oldDate = new Date(Date.now() - 20000);
      const client = createMockClientWithJobs([
        { id: 'c1', status: 'completed', updatedAt: oldDate },
        { id: 'c2', status: 'completed', updatedAt: oldDate },
        { id: 'f1', status: 'failed', updatedAt: oldDate },
      ]);

      const adapter = new RedisQueueAdapter({ client });
      const cleaned = await adapter.clean({
        status: 'completed, failed',
        olderThan: new Date(),
        limit: 2,
      });

      expect(cleaned).toBe(2);
    });

    it('removes orphaned records when getJob returns null during clean', async () => {
      const client = {
        async smembers() {
          return ['orphan_id'];
        },
        srem: vi.fn(),
        del: vi.fn(),
        async get() {
          return null; // Missing job
        },
      };

      const adapter = new RedisQueueAdapter({ client });
      const cleaned = await adapter.clean({ olderThan: new Date() });

      expect(cleaned).toBe(1);
      expect(client.srem).toHaveBeenCalledWith('webspresso:queue:completed', 'orphan_id');
      expect(client.del).toHaveBeenCalledWith('webspresso:queue:job:orphan_id');
    });

    it('gracefully handles client command failures in getStats and clean', async () => {
      const failingClient = {
        async zcard() {
          throw new Error('Connection refused');
        },
        async smembers() {
          throw new Error('Redis down');
        },
      };

      const adapter = new RedisQueueAdapter({ client: failingClient });
      const stats = await adapter.getStats();
      expect(stats.total).toBe(0);

      const cleaned = await adapter.clean({ olderThan: new Date() });
      expect(cleaned).toBe(0);
    });
  });
});
