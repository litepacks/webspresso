const {
  wait
} = require('../../utils');

const {
  createRedisSessionTracker,
  createRedisSessionStore,
  InMemoryRedisClient,
} = require('../../../core/auth/redis-session');

describe('Redis Session Tracker & Store Bulk Performance', () => {
  let client;
  let tracker;

  beforeEach(() => {
    client = new InMemoryRedisClient();
    tracker = createRedisSessionTracker({ client, prefix: 'sess:' });
  });

  afterEach(async () => {
    await client.quit();
  });

  describe('createRedisSessionTracker.revokeOthers batching', () => {
    it('executes a single bulk DEL instead of N sequential DEL operations', async () => {
      await tracker.track('sess_1', 'user_1');
      await tracker.track('sess_2', 'user_1');
      await tracker.track('sess_3', 'user_1');
      await tracker.track('sess_4', 'user_1');

      const delCalls = [];
      const originalDel = client.del.bind(client);
      client.del = async (...args) => {
        delCalls.push(args);
        return originalDel(...args);
      };

      const count = await tracker.revokeOthers('user_1', 'sess_2');

      expect(count).toBe(3);
      // Must be called in a SINGLE batch operation
      expect(delCalls).toHaveLength(1);
      const deletedKeys = delCalls[0].flat();
      expect(deletedKeys).toContain('sess:device:sess_1');
      expect(deletedKeys).toContain('sess:device:sess_3');
      expect(deletedKeys).toContain('sess:device:sess_4');
      expect(deletedKeys).not.toContain('sess:device:sess_2');

      // Only sess_2 should remain
      const remaining = await tracker.list('user_1');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].session_id).toBe('sess_2');
    });

    it('returns 0 and skips DEL when user only has the current session', async () => {
      await tracker.track('single_sess', 'user_single');

      let delCalled = false;
      const originalDel = client.del.bind(client);
      client.del = async (...args) => {
        delCalled = true;
        return originalDel(...args);
      };

      const count = await tracker.revokeOthers('user_single', 'single_sess');
      expect(count).toBe(0);
      expect(delCalled).toBe(false);

      const remaining = await tracker.list('user_single');
      expect(remaining).toHaveLength(1);
    });

    it('handles empty or non-existent user gracefully', async () => {
      expect(await tracker.revokeOthers('', 'any_sess')).toBe(0);
      expect(await tracker.revokeOthers('nonexistent_user', 'any_sess')).toBe(0);
    });
  });

  describe('createRedisSessionTracker.revokeAll batching', () => {
    it('executes a single bulk DEL for all device keys and the user set key', async () => {
      await tracker.track('sess_a', 'user_2');
      await tracker.track('sess_b', 'user_2');
      await tracker.track('sess_c', 'user_2');

      const delCalls = [];
      const originalDel = client.del.bind(client);
      client.del = async (...args) => {
        delCalls.push(args);
        return originalDel(...args);
      };

      const count = await tracker.revokeAll('user_2');

      expect(count).toBe(3);
      // Single DEL call with all keys including user key
      expect(delCalls).toHaveLength(1);
      const deletedKeys = delCalls[0].flat();
      expect(deletedKeys).toHaveLength(4);
      expect(deletedKeys).toContain('sess:device:sess_a');
      expect(deletedKeys).toContain('sess:device:sess_b');
      expect(deletedKeys).toContain('sess:device:sess_c');
      expect(deletedKeys).toContain('sess:user:user_2');

      const remaining = await tracker.list('user_2');
      expect(remaining).toHaveLength(0);
    });

    it('handles empty or non-existent user in revokeAll', async () => {
      expect(await tracker.revokeAll(null)).toBe(0);
      expect(await tracker.revokeAll('no_such_user')).toBe(0);
    });
  });

  describe('createRedisSessionTracker.list parallel retrieval', () => {
    it('fetches all device sessions concurrently with Promise.all', async () => {
      await tracker.track('sid_1', 'user_parallel');
      await tracker.track('sid_2', 'user_parallel');
      await tracker.track('sid_3', 'user_parallel');
      await tracker.track('sid_4', 'user_parallel');

      let concurrentCalls = 0;
      let maxConcurrency = 0;
      const originalGet = client.get.bind(client);

      client.get = async (...args) => {
        concurrentCalls++;
        if (concurrentCalls > maxConcurrency) {
          maxConcurrency = concurrentCalls;
        }
        // Small delay to simulate async network latency and verify overlap
        await wait(10);
        const res = await originalGet(...args);
        concurrentCalls--;
        return res;
      };

      const sessions = await tracker.list('user_parallel', 'sid_2');

      expect(sessions).toHaveLength(4);
      // Under Promise.all, all 4 get operations overlap
      expect(maxConcurrency).toBeGreaterThan(1);
      expect(maxConcurrency).toBe(4);

      const current = sessions.find((s) => s.session_id === 'sid_2');
      expect(current.is_current).toBe(true);

      const others = sessions.filter((s) => s.session_id !== 'sid_2');
      expect(others.every((s) => s.is_current === false)).toBe(true);
    });

    it('cleans up expired or corrupted session records via srem without failing', async () => {
      await tracker.track('valid_1', 'user_mix');
      await tracker.track('corrupt_2', 'user_mix');
      await tracker.track('expired_3', 'user_mix');

      // Corrupt one record
      await client.set('sess:device:corrupt_2', 'NOT_VALID_JSON{{{');
      // Expire another by deleting the device key directly
      await client.del('sess:device:expired_3');

      const list = await tracker.list('user_mix');

      expect(list).toHaveLength(1);
      expect(list[0].session_id).toBe('valid_1');

      // The corrupt and expired sids should have been cleaned up from user set
      const remainingSids = await client.smembers('sess:user:user_mix');
      expect(remainingSids).toEqual(['valid_1']);
    });
  });

  describe('RedisSessionStore.all parallel retrieval', () => {
    it('retrieves all sessions concurrently with Promise.all', async () => {
      const store = createRedisSessionStore({ client, prefix: 'sess:' });

      await new Promise((resolve) => store.set('s1', { user: 'u1' }, resolve));
      await new Promise((resolve) => store.set('s2', { user: 'u2' }, resolve));
      await new Promise((resolve) => store.set('s3', { user: 'u3' }, resolve));

      let concurrentCalls = 0;
      let maxConcurrency = 0;
      const originalGet = client.get.bind(client);

      client.get = async (...args) => {
        concurrentCalls++;
        if (concurrentCalls > maxConcurrency) {
          maxConcurrency = concurrentCalls;
        }
        await wait(10);
        const res = await originalGet(...args);
        concurrentCalls--;
        return res;
      };

      const sessions = await new Promise((resolve, reject) => {
        store.all((err, list) => (err ? reject(err) : resolve(list)));
      });

      expect(sessions).toHaveLength(3);
      expect(maxConcurrency).toBe(3);
      expect(sessions.map((s) => s.user).sort()).toEqual(['u1', 'u2', 'u3']);
    });

    it('returns empty array when no sessions match prefix', async () => {
      const store = createRedisSessionStore({ client, prefix: 'empty:' });
      const sessions = await new Promise((resolve, reject) => {
        store.all((err, list) => (err ? reject(err) : resolve(list)));
      });
      expect(sessions).toEqual([]);
    });
  });
});
