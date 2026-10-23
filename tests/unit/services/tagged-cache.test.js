const {
  wait
} = require('../../utils');

const {
  memoize,
  ServiceRegistry,
  createServiceRegistry,
} = require('../../../index');

describe('Services Tagged & Distributed Cache Integration', () => {
  describe('memoize with static tags', () => {
    it('should associate cached items with static tags and invalidate by tag', async () => {
      let callCount = 0;
      const fn = async ({ id }) => {
        callCount++;
        return { id, time: Date.now(), count: callCount };
      };

      const cached = memoize(fn, {
        ttl: '5m',
        tags: ['users', 'directory'],
      });

      const res1 = await cached({ id: 1 });
      const res2 = await cached({ id: 1 });
      expect(callCount).toBe(1);
      expect(res1).toEqual(res2);

      // Invalidate by unrelated tag -> no-op
      const removedUnrelated = cached.invalidateByTag('products');
      expect(removedUnrelated).toBe(0);

      const res3 = await cached({ id: 1 });
      expect(callCount).toBe(1);

      // Invalidate by matching tag 'users'
      const removed = cached.invalidateByTag('users');
      expect(removed).toBe(1);

      // Next call re-fetches
      const res4 = await cached({ id: 1 });
      expect(callCount).toBe(2);
      expect(res4.count).toBe(2);
    });

    it('should support invalidateByTags with multiple tags', async () => {
      let countA = 0;
      let countB = 0;

      const fnA = memoize(async (x) => ++countA, { tags: ['tagA'] });
      const fnB = memoize(async (x) => ++countB, { tags: ['tagB'] });

      await fnA(1);
      await fnB(1);
      expect(countA).toBe(1);
      expect(countB).toBe(1);

      fnA.invalidateByTags(['tagA', 'tagB']);
      fnB.invalidateByTags(['tagA', 'tagB']);

      await fnA(1);
      await fnB(1);
      expect(countA).toBe(2);
      expect(countB).toBe(2);
    });
  });

  describe('memoize with dynamic tag resolvers', () => {
    it('should resolve dynamic tags per input and selectively invalidate entries', async () => {
      let dbLoads = 0;
      const getUser = async ({ id }) => {
        dbLoads++;
        return { id, name: `User ${id}`, load: dbLoads };
      };

      const cached = memoize(getUser, {
        ttl: '10m',
        tags: (input) => ['users', `user:${input.id}`],
      });

      // Populate user 1 and user 2
      const u1_a = await cached({ id: 1 });
      const u2_a = await cached({ id: 2 });
      expect(dbLoads).toBe(2);

      // Cache hits
      const u1_b = await cached({ id: 1 });
      const u2_b = await cached({ id: 2 });
      expect(dbLoads).toBe(2);
      expect(u1_a.load).toBe(1);
      expect(u2_a.load).toBe(2);

      // Invalidate only user 1 via specific dynamic tag
      const pruned = cached.invalidateByTag('user:1');
      expect(pruned).toBe(1);

      // User 2 should still be cached!
      const u2_c = await cached({ id: 2 });
      expect(dbLoads).toBe(2);
      expect(u2_c.load).toBe(2);

      // User 1 must re-fetch
      const u1_c = await cached({ id: 1 });
      expect(dbLoads).toBe(3);
      expect(u1_c.load).toBe(3);

      // Global invalidation via 'users' tag should purge both user 1 and user 2
      const globalPurge = cached.invalidateByTag('users');
      expect(globalPurge).toBe(2);

      await cached({ id: 1 });
      await cached({ id: 2 });
      expect(dbLoads).toBe(5);
    });

    it('should handle tag resolver throwing without breaking cache storage', async () => {
      let runCount = 0;
      const faultyService = async () => ++runCount;

      const cached = memoize(faultyService, {
        tags: () => {
          throw new Error('Resolver exploded');
        },
      });

      await cached();
      await cached();
      expect(runCount).toBe(1); // Caching still worked safely without tags
    });
  });

  describe('ServiceRegistry tagged invalidation across multiple services', () => {
    it('should invalidate matching entries across all registered services with registry.invalidateByTag()', async () => {
      const registry = new ServiceRegistry();
      let userFetches = 0;
      let profileFetches = 0;
      let orderFetches = 0;

      registry.register('user.get', {
        cache: {
          ttl: '5m',
          tags: (input) => ['users', `user:${input.id}`],
        },
        async handler({ id }) {
          userFetches++;
          return { id, name: `User ${id}`, version: userFetches };
        },
      });

      registry.register('profile.get', {
        cache: {
          ttl: '5m',
          tags: ['users', 'profiles'],
        },
        async handler({ userId }) {
          profileFetches++;
          return { userId, avatar: `avatar-${userId}.png`, version: profileFetches };
        },
      });

      registry.register('order.get', {
        cache: {
          ttl: '5m',
          tags: ['orders'],
        },
        async handler({ orderId }) {
          orderFetches++;
          return { orderId, total: 99.9, version: orderFetches };
        },
      });

      // Populate all caches
      await registry.call('user.get', { id: 10 });
      await registry.call('profile.get', { userId: 10 });
      await registry.call('order.get', { orderId: 500 });
      expect(userFetches).toBe(1);
      expect(profileFetches).toBe(1);
      expect(orderFetches).toBe(1);

      // Repeat calls -> 100% cache hits
      await registry.call('user.get', { id: 10 });
      await registry.call('profile.get', { userId: 10 });
      await registry.call('order.get', { orderId: 500 });
      expect(userFetches).toBe(1);
      expect(profileFetches).toBe(1);
      expect(orderFetches).toBe(1);

      // Invalidate tag 'users' -> should clear user.get and profile.get, but NOT order.get
      const invalidatedCount = registry.invalidateByTag('users');
      expect(invalidatedCount).toBe(2);

      // order.get must still be cached
      await registry.call('order.get', { orderId: 500 });
      expect(orderFetches).toBe(1);

      // user.get and profile.get should reload
      await registry.call('user.get', { id: 10 });
      await registry.call('profile.get', { userId: 10 });
      expect(userFetches).toBe(2);
      expect(profileFetches).toBe(2);
    });

    it('should allow scoping registry.invalidateByTag to a specific service', async () => {
      const registry = new ServiceRegistry();
      let callCountA = 0;
      let callCountB = 0;

      registry.register('service.a', {
        cache: { tags: ['shared'] },
        async handler() {
          return ++callCountA;
        },
      });

      registry.register('service.b', {
        cache: { tags: ['shared'] },
        async handler() {
          return ++callCountB;
        },
      });

      await registry.call('service.a');
      await registry.call('service.b');
      expect(callCountA).toBe(1);
      expect(callCountB).toBe(1);

      // Invalidate only for service.a
      registry.invalidateByTag('shared', 'service.a');

      await registry.call('service.a');
      await registry.call('service.b');
      expect(callCountA).toBe(2);
      expect(callCountB).toBe(1); // service.b stayed cached!
    });
  });

  describe('ctx.service.invalidateByTag from within another service', () => {
    it('should invalidate cache when an update mutation service executes', async () => {
      const registry = new ServiceRegistry();
      let userQueryCount = 0;

      registry.register('user.find', {
        cache: {
          ttl: '10m',
          tags: (input) => ['users', `user:${input.id}`],
        },
        async handler({ id }) {
          userQueryCount++;
          return { id, name: 'Alice', version: userQueryCount };
        },
      });

      registry.register('user.update', {
        async handler({ id, name }, ctx) {
          // Invalidate specific user entry using tag
          ctx.service.invalidateByTag(`user:${id}`);
          return { id, name, success: true };
        },
      });

      // Warm cache
      const u1 = await registry.call('user.find', { id: 42 });
      const u2 = await registry.call('user.find', { id: 42 });
      expect(userQueryCount).toBe(1);
      expect(u1.version).toBe(1);
      expect(u2.version).toBe(1);

      // Trigger mutation service
      await registry.call('user.update', { id: 42, name: 'Alice Updated' });

      // Cache for user 42 was invalidated!
      const u3 = await registry.call('user.find', { id: 42 });
      expect(userQueryCount).toBe(2);
      expect(u3.version).toBe(2);
    });
  });

  describe('Pluggable External / Distributed Cache Provider', () => {
    it('should support async custom distributed provider with native invalidateTag method', async () => {
      const storage = new Map();
      let providerGetCount = 0;
      let providerSetCount = 0;

      const mockDistributedProvider = {
        async get(key) {
          providerGetCount++;
          const entry = storage.get(key);
          return entry ? entry.value : undefined;
        },
        async set(key, value, opts) {
          providerSetCount++;
          storage.set(key, { value, tags: opts?.tags || [] });
        },
        async delete(key) {
          return storage.delete(key);
        },
        async invalidateTag(tag) {
          let count = 0;
          for (const [k, v] of storage.entries()) {
            if (v.tags && v.tags.includes(tag)) {
              storage.delete(k);
              count++;
            }
          }
          return count;
        },
      };

      const registry = new ServiceRegistry({ cacheProvider: mockDistributedProvider });
      let queryHits = 0;

      registry.register('catalog.item', {
        cache: {
          ttl: '1h',
          tags: (input) => ['catalog', `item:${input.sku}`],
        },
        async handler({ sku }) {
          queryHits++;
          return { sku, price: 19.99, queryHits };
        },
      });

      // 1. Initial call -> sets in provider
      const item1 = await registry.call('catalog.item', { sku: 'SKU-100' });
      expect(queryHits).toBe(1);
      expect(providerSetCount).toBe(1);

      // 2. Second call -> gets from provider
      const item2 = await registry.call('catalog.item', { sku: 'SKU-100' });
      expect(queryHits).toBe(1);
      expect(providerGetCount).toBe(2);
      expect(item1.sku).toBe(item2.sku);

      // 3. Invalidate via tag
      const cleared = await registry.invalidateByTag('item:SKU-100');
      expect(cleared).toBe(1);

      // 4. Third call -> re-fetches
      const item3 = await registry.call('catalog.item', { sku: 'SKU-100' });
      expect(queryHits).toBe(2);
      expect(providerSetCount).toBe(2);
    });

    it('should provide fallback tag tracking for basic providers without native tag support', async () => {
      const basicStore = new Map();

      const basicProvider = {
        async get(key) {
          return basicStore.get(key);
        },
        async set(key, value) {
          basicStore.set(key, value);
        },
        async del(key) {
          return basicStore.delete(key);
        },
      };

      let calcCount = 0;
      const fn = memoize(async (x) => {
        calcCount++;
        return x * 2;
      }, {
        provider: basicProvider,
        tags: (x) => ['multipliers', `num:${x}`],
      });

      await fn(5);
      await fn(5);
      expect(calcCount).toBe(1);

      // Invalidate using fallback tag tracking
      const deletedCount = await fn.invalidateByTag('num:5');
      expect(deletedCount).toBe(1);

      await fn(5);
      expect(calcCount).toBe(2);
    });
  });

  describe('Thundering Herd Stampede Protection with Tagged Cache', () => {
    it('coalesces concurrent requests during tagged memoization', async () => {
      let slowCalls = 0;
      const slowFn = async ({ key }) => {
        slowCalls++;
        await wait(30);
        return { key, computed: slowCalls };
      };

      const cached = memoize(slowFn, {
        ttl: '1m',
        tags: ['batch'],
      });

      const results = await Promise.all([
        cached({ key: 'heavy' }),
        cached({ key: 'heavy' }),
        cached({ key: 'heavy' }),
        cached({ key: 'heavy' }),
      ]);

      expect(slowCalls).toBe(1);
      expect(results.length).toBe(4);
      for (const res of results) {
        expect(res.computed).toBe(1);
      }
    });
  });

  describe('Zero Dangling Tag Memory Leak Prevention', () => {
    it('cleans up all bidirectional tag sets when keys are invalidated or evicted', async () => {
      const fn = memoize(async (id) => ({ id }), {
        tags: (id) => ['items', `item:${id}`],
      });

      await fn(1);
      await fn(2);
      await fn(3);

      expect(fn.cache.hasTag('items')).toBe(true);
      expect(fn.cache.hasTag('item:1')).toBe(true);
      expect(fn.cache.getKeysForTag('items').length).toBe(3);

      // Invalidate item:1
      fn.invalidateByTag('item:1');
      expect(fn.cache.hasTag('item:1')).toBe(false);
      expect(fn.cache.getKeysForTag('items').length).toBe(2);

      // Invalidate all items
      fn.invalidateByTag('items');
      expect(fn.cache.hasTag('items')).toBe(false);
      expect(fn.cache.getKeysForTag('items').length).toBe(0);
      expect(fn.size).toBe(0);
    });
  });

  describe('App and Req context service helper decorations', () => {
    it('decorates core app service and ctx.service with tag invalidation methods', async () => {
      const { createCoreApp } = require('../../../core');
      const app = createCoreApp();

      expect(typeof app.service.invalidateByTag).toBe('function');
      expect(typeof app.service.invalidateByTags).toBe('function');
      expect(typeof app.service.invalidateTag).toBe('function');
      expect(typeof app.service.invalidateTags).toBe('function');

      const ctx = app.createContext();
      expect(typeof ctx.service.invalidateByTag).toBe('function');
      expect(typeof ctx.service.invalidateByTags).toBe('function');

      let dbHits = 0;
      app.serviceRegistry.register('data.fetch', {
        cache: { tags: ['data-tag'] },
        async handler() {
          return ++dbHits;
        },
      });

      await app.service('data.fetch');
      await app.service('data.fetch');
      expect(dbHits).toBe(1);

      // Invalidate via app.service.invalidateByTag
      app.service.invalidateByTag('data-tag');

      await app.service('data.fetch');
      expect(dbHits).toBe(2);

      await app.close();
    });
  });
});
