const {
  memoize,
  parseTtlMs,
  stableCacheKey,
  createServiceRegistry,
  ServiceRegistry,
} = require('../../index');

describe('Services Memoize & Caching (Hardened)', () => {
  describe('parseTtlMs helper', () => {
    it('should parse seconds, minutes, hours, days, ms, and boolean', () => {
      expect(parseTtlMs('5s')).toBe(5000);
      expect(parseTtlMs('2m')).toBe(120000);
      expect(parseTtlMs('1h')).toBe(3600000);
      expect(parseTtlMs('1d')).toBe(86400000);
      expect(parseTtlMs(1500)).toBe(1500);
      expect(parseTtlMs(true)).toBe(60000);
      expect(parseTtlMs(null)).toBe(60000);
    });
  });

  describe('stableCacheKey helper (Safe Serialization)', () => {
    it('should sort keys deterministically', () => {
      const key1 = stableCacheKey({ b: 2, a: 1 });
      const key2 = stableCacheKey({ a: 1, b: 2 });
      expect(key1).toBe(key2);
      expect(key1).toBe('{"a":1,"b":2}');
    });

    it('should safely serialize BigInt without throwing', () => {
      const key = stableCacheKey({ id: BigInt(9007199254740991) });
      expect(key).toContain('9007199254740991n');
    });

    it('should safely handle circular references without throwing', () => {
      const obj = { name: 'circular' };
      obj.self = obj;
      expect(() => stableCacheKey(obj)).not.toThrow();
      const key = stableCacheKey(obj);
      expect(key).toContain('[Circular]');
    });

    it('should safely serialize Buffers, Dates, RegExps', () => {
      const buf = Buffer.from('hello');
      const date = new Date('2026-08-24T12:00:00.000Z');
      const reg = /test-pattern/i;

      const key = stableCacheKey({ buf, date, reg });
      expect(key).toContain('[Buffer:68656c6c6f]');
      expect(key).toContain('[Date:2026-08-24T12:00:00.000Z]');
      expect(key).toContain('[RegExp:/test-pattern/i]');
    });

    it('should handle primitives and arrays', () => {
      expect(stableCacheKey('hello')).toBe('"hello"');
      expect(stableCacheKey(42)).toBe('42');
      expect(stableCacheKey([1, 2])).toBe('[1,2]');
      expect(stableCacheKey(null)).toBe('__null__');
      expect(stableCacheKey(undefined)).toBe('__undefined__');
    });
  });

  describe('Cache Stampede / Thundering Herd Prevention', () => {
    it('should coalesce concurrent in-flight requests into a single execution', async () => {
      let backendCalls = 0;

      const slowDbQuery = async ({ category }) => {
        backendCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { category, data: [1, 2, 3], fetchedAt: Date.now() };
      };

      const memoized = memoize(slowDbQuery, { ttl: '5s' });

      // Launch 15 concurrent calls simultaneously
      const promises = Array.from({ length: 15 }).map(() =>
        memoized({ category: 'electronics' })
      );

      const results = await Promise.all(promises);

      expect(backendCalls).toBe(1);
      expect(results.length).toBe(15);
      for (const res of results) {
        expect(res.category).toBe('electronics');
        expect(res.data).toEqual([1, 2, 3]);
      }
    });

    it('should cleanup inFlight map when execution fails so next call can retry', async () => {
      let attempts = 0;

      const flakyService = async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Database connection failed');
        }
        return { success: true, attempts };
      };

      const memoized = memoize(flakyService, { ttl: '1m' });

      // First call fails
      await expect(memoized()).rejects.toThrow('Database connection failed');

      // Subsequent call should retry and succeed
      const res = await memoized();
      expect(res.success).toBe(true);
      expect(res.attempts).toBe(2);
    });
  });

  describe('Cached Object Mutation Protection', () => {
    it('should prevent callers from mutating cached object values', async () => {
      const getPermissions = async () => {
        return {
          roles: ['user', 'viewer'],
          settings: { theme: 'dark' },
        };
      };

      const memoized = memoize(getPermissions, { ttl: '5m', clone: true });

      // Consumer 1 mutates the returned object
      const user1Perms = await memoized();
      user1Perms.roles.push('superadmin');
      user1Perms.settings.theme = 'light';

      // Consumer 2 retrieves the cached object
      const user2Perms = await memoized();
      expect(user2Perms.roles).toEqual(['user', 'viewer']);
      expect(user2Perms.settings.theme).toBe('dark');
    });
  });

  describe('True LRU Cache Eviction', () => {
    it('should promote accessed items to MRU and evict the true least recently used item', async () => {
      const fn = memoize(async (key) => `val:${key}`, { maxSize: 3 });

      await fn('a'); // cache: [a]
      await fn('b'); // cache: [a, b]
      await fn('c'); // cache: [a, b, c]

      // Access 'a' again -> makes 'a' most recently used -> cache order: [b, c, a]
      await fn('a');

      // Add 'd' -> should evict 'b' (least recently used)
      await fn('d');

      expect(fn.has('b')).toBe(false); // evicted!
      expect(fn.has('a')).toBe(true);  // kept!
      expect(fn.has('c')).toBe(true);  // kept!
      expect(fn.has('d')).toBe(true);  // kept!
    });
  });

  describe('ServiceRegistry cache option & invalidation', () => {
    it('should automatically cache services with cache: "5m"', async () => {
      const registry = new ServiceRegistry();
      let queryCount = 0;

      registry.register('product.stats', {
        cache: '5m',
        async handler({ productId }) {
          queryCount++;
          return { productId, views: queryCount * 100 };
        },
      });

      const res1 = await registry.call('product.stats', { productId: 50 });
      const res2 = await registry.call('product.stats', { productId: 50 });

      expect(queryCount).toBe(1);
      expect(res1.views).toBe(100);
      expect(res2.views).toBe(100);

      // Invalidate via registry
      registry.invalidate('product.stats', { productId: 50 });

      const res3 = await registry.call('product.stats', { productId: 50 });
      expect(queryCount).toBe(2);
      expect(res3.views).toBe(200);
    });

    it('should allow ctx.service.invalidate() from within another service', async () => {
      const registry = new ServiceRegistry();
      let dbLoads = 0;

      registry.register('user.find', {
        cache: '10m',
        async handler({ id }) {
          dbLoads++;
          return { id, version: dbLoads };
        },
      });

      registry.register('user.update', {
        async handler({ id, name }, ctx) {
          ctx.service.invalidate('user.find', { id });
          return { id, name, updated: true };
        },
      });

      const u1 = await registry.call('user.find', { id: 1 });
      const u2 = await registry.call('user.find', { id: 1 });
      expect(dbLoads).toBe(1);
      expect(u1.version).toBe(1);
      expect(u2.version).toBe(1);

      // Call update which invalidates
      await registry.call('user.update', { id: 1, name: 'New Name' });

      const u3 = await registry.call('user.find', { id: 1 });
      expect(dbLoads).toBe(2);
      expect(u3.version).toBe(2);
    });

    it('should allow clearing all cache via registry.clearCache()', async () => {
      const registry = new ServiceRegistry();
      let count = 0;

      registry.register('stats.get', {
        cache: true,
        async handler() {
          count++;
          return count;
        },
      });

      await registry.call('stats.get');
      await registry.call('stats.get');
      expect(count).toBe(1);

      registry.clearCache();

      await registry.call('stats.get');
      expect(count).toBe(2);
    });
  });
});
