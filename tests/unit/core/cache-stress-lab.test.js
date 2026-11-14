import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createLruCache,
  createTaggedLruCache,
  approximateByteSize,
} = require('../../../core/cache');

function createMulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Core Cache Stress Lab (LRU, TaggedLru, Byte Budget, Stampede)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. enforces maxEntries and maxBytes budgets across 2,000 writes while preserving hot keys', () => {
    const evicted = [];
    const cache = createLruCache({
      maxEntries: 200,
      maxBytes: 8192,
      onEvict: (key, _val, reason) => evicted.push({ key, reason }),
    });

    cache.set('hot-key', { data: 'pin' });

    for (let i = 0; i < 2000; i++) {
      // Touch hot-key periodically so LRU keeps it alive
      if (i % 20 === 0) {
        expect(cache.get('hot-key')).toEqual({ data: 'pin' });
      }
      const payload = { id: i, text: 'x'.repeat((i % 7) * 40 + 10) };
      cache.set(`k-${i}`, payload);

      expect(cache.size).toBeLessThanOrEqual(200);
      expect(cache.currentBytes).toBeLessThanOrEqual(8192);
      expect(cache.currentBytes).toBeGreaterThanOrEqual(0);
    }

    expect(cache.get('hot-key')).toEqual({ data: 'pin' });
    expect(cache.evictions).toBeGreaterThan(1500);
    expect(evicted.some((e) => e.reason === 'evict')).toBe(true);
  });

  it('2. coalesces 100 concurrent getOrSet() callers (stampede protection) and recovers cleanly on factory failure', async () => {
    const cache = createTaggedLruCache({ maxEntries: 100 });
    let factoryCalls = 0;
    let release;
    const barrier = new Promise((r) => {
      release = r;
    });

    const pending = Array.from({ length: 100 }, () =>
      cache.getOrSet(
        'expensive-query',
        async () => {
          factoryCalls += 1;
          await barrier;
          return { rows: [1, 2, 3], computedAt: factoryCalls };
        },
        { tags: ['users', 'list'] }
      )
    );

    release();
    const results = await Promise.all(pending);
    expect(factoryCalls).toBe(1);
    expect(results.every((r) => r.computedAt === 1)).toBe(true);

    // Failure in factory must NOT poison _inFlight or cache
    let failCalls = 0;
    const failPromises = Array.from({ length: 10 }, () =>
      cache
        .getOrSet('flaky', async () => {
          failCalls += 1;
          throw new Error('DB timeout');
        })
        .catch((err) => ({ err }))
    );
    const failResults = await Promise.all(failPromises);
    expect(failCalls).toBe(1);
    expect(failResults.every((r) => r.err && r.err.message === 'DB timeout')).toBe(true);

    // Next attempt recovers immediately
    const recovered = await cache.getOrSet('flaky', async () => ({ ok: true }));
    expect(recovered).toEqual({ ok: true });
  });

  it('3. guarantees zero dangling tag references across 1,500 churned entries and tag invalidations', () => {
    const cache = createTaggedLruCache({ maxEntries: 100, maxBytes: 16384 });

    for (let i = 0; i < 1500; i++) {
      cache.set(
        `doc:${i}`,
        { id: i, body: 'payload-' + i },
        { tags: [`user:${i % 10}`, `org:${i % 5}`, 'global'] }
      );
    }

    // Internal tag maps must NEVER retain evicted keys
    expect(cache.size).toBeLessThanOrEqual(100);
    expect(cache.keyToTags.size).toBe(cache.size);
    for (const [tag, keySet] of cache.tagToKeys.entries()) {
      expect(keySet.size).toBeGreaterThan(0);
      for (const k of keySet) {
        expect(cache.has(k)).toBe(true);
      }
      expect(typeof tag).toBe('string');
    }

    // Invalidate org:0 and verify all remaining keys with org:0 are gone
    const removedCount = cache.invalidateTag('org:0');
    expect(removedCount).toBeGreaterThan(0);
    expect(cache.tagToKeys.has('org:0')).toBe(false);
    expect(cache.keyToTags.size).toBe(cache.size);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.currentBytes).toBe(0);
    expect(cache.tagToKeys.size).toBe(0);
    expect(cache.keyToTags.size).toBe(0);
  });

  it('4. expires TTL entries deterministically, prunes stale tags, and isolates cloned values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));

    const cache = createTaggedLruCache({
      maxEntries: 50,
      defaultTtl: 1000,
      clone: true,
    });

    const original = { nested: { count: 1 }, list: ['a'] };
    cache.set('item-1', original, { tags: ['t1'] });
    cache.set('item-2', { ok: true }, { ttl: 5000, tags: ['t2'] });

    // Mutating caller's object or returned object must NOT mutate cached entry
    original.nested.count = 999;
    const read1 = cache.get('item-1');
    expect(read1.nested.count).toBe(1);
    read1.list.push('mutated');
    expect(cache.get('item-1').list).toEqual(['a']);

    // Advance 1500ms: item-1 expires, item-2 remains valid
    vi.advanceTimersByTime(1500);
    expect(cache.get('item-1')).toBeUndefined();
    expect(cache.get('item-2')).toEqual({ ok: true });
    expect(cache.tagToKeys.has('t1')).toBe(false);
    expect(cache.tagToKeys.has('t2')).toBe(true);

    // Advance 4000ms and prune: item-2 purged cleanly
    vi.advanceTimersByTime(4000);
    const pruned = cache.pruneExpired();
    expect(pruned).toBe(1);
    expect(cache.size).toBe(0);
    expect(cache.tagToKeys.size).toBe(0);
  });

  it('5. maintains all size, byte-budget, and tag-index invariants across a 500-step seeded PRNG fuzz sequence', async () => {
    const rng = createMulberry32(987654321);
    const cache = createTaggedLruCache({ maxEntries: 64, maxBytes: 4096 });

    for (let step = 0; step < 500; step++) {
      const op = Math.floor(rng() * 7);
      const keyIdx = Math.floor(rng() * 120);
      const key = `k-${keyIdx}`;
      const tagA = `tag-${keyIdx % 8}`;
      const tagB = `grp-${keyIdx % 4}`;

      if (op === 0 || op === 1) {
        const len = Math.floor(rng() * 120) + 1;
        cache.set(key, { step, str: 'a'.repeat(len) }, { tags: [tagA, tagB] });
      } else if (op === 2) {
        cache.get(key);
      } else if (op === 3) {
        cache.delete(key);
      } else if (op === 4) {
        await cache.getOrSet(key, async () => ({ step, async: true }), { tags: [tagA] });
      } else if (op === 5) {
        cache.invalidateTag(tagA);
      } else if (op === 6 && step % 50 === 0) {
        cache.pruneExpired();
      }

      // Invariant checks on every single step
      expect(cache.size).toBeLessThanOrEqual(64);
      expect(cache.currentBytes).toBeLessThanOrEqual(4096);
      expect(cache.currentBytes).toBeGreaterThanOrEqual(0);
      expect(cache.keyToTags.size).toBe(cache.size);
    }

    expect(approximateByteSize({ a: 'hello', b: [1, 2, 3] })).toBeGreaterThan(0);
  });
});
