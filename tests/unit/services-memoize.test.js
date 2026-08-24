const {
  memoize,
  parseTtlMs,
  stableCacheKey,
  createServiceRegistry,
  ServiceRegistry,
} = require('../../index');

describe('Services Memoize & Caching', () => {
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

  describe('stableCacheKey helper', () => {
    it('should sort keys deterministically', () => {
      const key1 = stableCacheKey({ b: 2, a: 1 });
      const key2 = stableCacheKey({ a: 1, b: 2 });
      expect(key1).toBe(key2);
      expect(key1).toBe('{"a":1,"b":2}');
    });

    it('should handle primitives and arrays', () => {
      expect(stableCacheKey('hello')).toBe('hello');
      expect(stableCacheKey(42)).toBe('42');
      expect(stableCacheKey([1, 2])).toBe('[1,2]');
      expect(stableCacheKey(null)).toBe('__null__');
    });
  });

  describe('memoize standalone utility', () => {
    it('should memoize async functions and avoid repeated executions', async () => {
      let callCount = 0;
      const fetchUser = async ({ id }) => {
        callCount++;
        return { id, timestamp: Date.now(), name: `User ${id}` };
      };

      const memoized = memoize(fetchUser, { ttl: '1m' });

      const res1 = await memoized({ id: 10 });
      const res2 = await memoized({ id: 10 });
      const res3 = await memoized({ id: 20 });

      expect(callCount).toBe(2);
      expect(res1).toEqual(res2);
      expect(res3.id).toBe(20);
      expect(memoized.size).toBe(2);
    });

    it('should support manual cache invalidation with delete / invalidate', async () => {
      let count = 0;
      const getCounter = async (input) => {
        count++;
        return { count, input };
      };

      const memoized = memoize(getCounter, { ttl: '5m' });

      const val1 = await memoized({ tag: 'a' });
      expect(val1.count).toBe(1);

      const val2 = await memoized({ tag: 'a' });
      expect(val2.count).toBe(1);

      // Invalidate
      const deleted = memoized.invalidate({ tag: 'a' });
      expect(deleted).toBe(true);

      const val3 = await memoized({ tag: 'a' });
      expect(val3.count).toBe(2);
    });

    it('should clear all cache entries with clear()', async () => {
      const fn = memoize(async (x) => x * 2);
      await fn(1);
      await fn(2);
      expect(fn.size).toBe(2);

      fn.clear();
      expect(fn.size).toBe(0);
    });

    it('should support custom key generator', async () => {
      let executions = 0;
      const compute = async (payload) => {
        executions++;
        return payload.data.value * 2;
      };

      const memoized = memoize(compute, {
        ttl: '1m',
        key: (payload) => payload.data.id,
      });

      const r1 = await memoized({ data: { id: 'item-1', value: 10 } });
      const r2 = await memoized({ data: { id: 'item-1', value: 99 } }); // different value but same key

      expect(executions).toBe(1);
      expect(r1).toBe(20);
      expect(r2).toBe(20);
    });

    it('should evict oldest entries when reaching maxSize', async () => {
      const fn = memoize(async (i) => i * 10, { maxSize: 2 });

      await fn(1);
      await fn(2);
      expect(fn.has(1)).toBe(true);
      expect(fn.has(2)).toBe(true);

      // Add 3rd -> evicts 1
      await fn(3);
      expect(fn.has(1)).toBe(false);
      expect(fn.has(2)).toBe(true);
      expect(fn.has(3)).toBe(true);
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
          // Mutate DB and invalidate cache
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
