'use strict';

/**
 * Unit Tests for High-Performance LRU & Tagged Cache Engine
 * Tests LRU eviction, memory budget (maxBytes), TTL, stampede protection, tag invalidation, and app integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LruCache,
  createLruCache,
  TaggedLruCache,
  createTaggedLruCache,
  approximateByteSize,
} from '../../../core/cache';
import { getCache, hasCache, setAppContext, resetAppContext } from '../../../src/app-context';

describe('High-Performance Cache Engine (core/cache)', () => {
  describe('approximateByteSize', () => {
    it('calculates sizes of primitives correctly', () => {
      expect(approximateByteSize(null)).toBe(8);
      expect(approximateByteSize(undefined)).toBe(8);
      expect(approximateByteSize(true)).toBe(4);
      expect(approximateByteSize(12345)).toBe(8);
      expect(approximateByteSize('hello')).toBeGreaterThan(10);
      expect(approximateByteSize(100n)).toBe(16);
      expect(approximateByteSize(Symbol('sym'))).toBe(16);
    });

    it('calculates Buffers and TypedArrays', () => {
      const buf = Buffer.from('hello world');
      expect(approximateByteSize(buf)).toBe(buf.length + 32);

      const uint8 = new Uint8Array(64);
      expect(approximateByteSize(uint8)).toBe(64 + 32);
    });

    it('handles nested objects, arrays, and prevents circular reference loops', () => {
      const obj = { a: 1, b: 'test', c: [1, 2, 3] };
      const size = approximateByteSize(obj);
      expect(size).toBeGreaterThan(60);

      // Circular reference
      const circular = { name: 'cycle' };
      circular.self = circular;
      expect(() => approximateByteSize(circular)).not.toThrow();
      expect(approximateByteSize(circular)).toBeGreaterThan(0);
    });
  });

  describe('LruCache Core', () => {
    it('sets, gets, peeks, and checks keys correctly', () => {
      const cache = createLruCache({ maxEntries: 10 });
      cache.set('foo', 'bar');

      expect(cache.has('foo')).toBe(true);
      expect(cache.get('foo')).toBe('bar');
      expect(cache.peek('foo')).toBe('bar');
      expect(cache.size).toBe(1);

      expect(cache.has('unknown')).toBe(false);
      expect(cache.get('unknown')).toBeUndefined();
    });

    it('evicts least recently used item when maxEntries is exceeded', () => {
      const evicted = [];
      const cache = createLruCache({
        maxEntries: 3,
        onEvict: (k, v, reason) => evicted.push({ k, v, reason }),
      });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      expect(cache.size).toBe(3);

      // Adding 4th item evicts 'a' (oldest inserted)
      cache.set('d', 4);
      expect(cache.has('a')).toBe(false);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.size).toBe(3);

      expect(evicted).toEqual([{ k: 'a', v: 1, reason: 'evict' }]);
    });

    it('refreshes LRU position on get() so frequently accessed keys are retained', () => {
      const cache = createLruCache({ maxEntries: 3 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' so it becomes most recently used
      expect(cache.get('a')).toBe(1);

      // Now insert 'd'. 'b' should be evicted instead of 'a'!
      cache.set('d', 4);

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false); // evicted!
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('peek() reads value without updating LRU position', () => {
      const cache = createLruCache({ maxEntries: 3 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Peek 'a' (does not refresh LRU position)
      expect(cache.peek('a')).toBe(1);

      // Now insert 'd'. 'a' remains oldest and is evicted!
      cache.set('d', 4);

      expect(cache.has('a')).toBe(false); // evicted!
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('enforces memory byte budget (maxBytes) and evicts when bytes exceed limit', () => {
      // 100 bytes limit
      const cache = createLruCache({
        maxEntries: 100,
        maxBytes: 150,
        sizeCalculation: (val) => val.length, // simple 1 char = 1 byte
      });

      cache.set('a', 'x'.repeat(60));
      cache.set('b', 'y'.repeat(60));

      expect(cache.currentBytes).toBe(120);
      expect(cache.size).toBe(2);

      // Inserting 60 more bytes brings total to 180 > 150, must evict 'a'
      cache.set('c', 'z'.repeat(60));

      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.currentBytes).toBe(120);
    });

    it('converts maxMemoryMb into maxBytes properly', () => {
      const cache = createLruCache({ maxMemoryMb: 10 });
      expect(cache.maxBytes).toBe(10 * 1024 * 1024);
    });

    it('refuses to store a single item that exceeds the entire maxBytes limit', () => {
      const cache = createLruCache({
        maxBytes: 50,
        sizeCalculation: (val) => val.length,
      });

      cache.set('huge', 'x'.repeat(100));
      expect(cache.has('huge')).toBe(false);
      expect(cache.size).toBe(0);
      expect(cache.currentBytes).toBe(0);
    });

    it('expires items passively and via pruneExpired() based on TTL', async () => {
      const cache = createLruCache({ maxEntries: 10 });

      cache.set('temp', 'value', { ttlMs: 20 });
      cache.set('forever', 'persist');

      expect(cache.has('temp')).toBe(true);
      expect(cache.get('temp')).toBe('value');

      await new Promise((r) => setTimeout(r, 35));

      // Passive check
      expect(cache.has('temp')).toBe(false);
      expect(cache.get('temp')).toBeUndefined();
      expect(cache.get('forever')).toBe('persist');

      // Test active pruneExpired()
      cache.set('short1', 1, { ttlMs: 10 });
      cache.set('short2', 2, { ttlMs: 10 });
      await new Promise((r) => setTimeout(r, 20));

      const pruned = cache.pruneExpired();
      expect(pruned).toBe(2);
      expect(cache.has('short1')).toBe(false);
      expect(cache.has('short2')).toBe(false);
    });

    it('provides cache stampede (thundering herd) protection with getOrSet()', async () => {
      const cache = createLruCache({ maxEntries: 10 });
      let factoryCalls = 0;

      const expensiveFactory = async (key) => {
        factoryCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return `result_for_${key}`;
      };

      // 5 concurrent requests for the cold key
      const results = await Promise.all([
        cache.getOrSet('resource:1', expensiveFactory),
        cache.getOrSet('resource:1', expensiveFactory),
        cache.getOrSet('resource:1', expensiveFactory),
        cache.getOrSet('resource:1', expensiveFactory),
        cache.getOrSet('resource:1', expensiveFactory),
      ]);

      expect(results).toEqual([
        'result_for_resource:1',
        'result_for_resource:1',
        'result_for_resource:1',
        'result_for_resource:1',
        'result_for_resource:1',
      ]);

      // Expensive calculation executed exactly once!
      expect(factoryCalls).toBe(1);
      expect(cache.get('resource:1')).toBe('result_for_resource:1');
    });

    it('does not cache failed executions in getOrSet()', async () => {
      const cache = createLruCache({ maxEntries: 10 });
      let attempts = 0;

      const failingFactory = async () => {
        attempts++;
        throw new Error('Database connection failed');
      };

      await expect(cache.getOrSet('fail_key', failingFactory)).rejects.toThrow('Database connection failed');
      expect(cache.has('fail_key')).toBe(false);
      expect(attempts).toBe(1);
    });

    it('protects against outside mutation when clone is true', () => {
      const cache = createLruCache({ maxEntries: 10, clone: true });
      const original = { count: 10, nested: { value: 'secret' } };

      cache.set('state', original);

      const retrieved = cache.get('state');
      retrieved.count = 999;
      retrieved.nested.value = 'mutated';

      expect(cache.get('state').count).toBe(10);
      expect(cache.get('state').nested.value).toBe('secret');
    });

    it('tracks observability metrics (hits, misses, hitRate, sets, evictions)', () => {
      const cache = createLruCache({ maxEntries: 2 });

      cache.set('a', 1);
      cache.set('b', 2);

      cache.get('a'); // hit
      cache.get('a'); // hit
      cache.get('missing'); // miss

      cache.set('c', 3); // evicts 'b'

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
      expect(stats.sets).toBe(3);
      expect(stats.evictions).toBe(1);

      cache.resetStats();
      expect(cache.getStats().hits).toBe(0);
      expect(cache.getStats().misses).toBe(0);
      expect(cache.getStats().evictions).toBe(0);
    });

    it('supports keys, values, entries, and forEach iterators', () => {
      const cache = createLruCache({ maxEntries: 5 });
      cache.set('x', 10);
      cache.set('y', 20);

      expect(Array.from(cache.keys())).toEqual(['x', 'y']);
      expect(Array.from(cache.values())).toEqual([10, 20]);
      expect(Array.from(cache.entries())).toEqual([['x', 10], ['y', 20]]);

      const collected = {};
      cache.forEach((val, key) => {
        collected[key] = val;
      });
      expect(collected).toEqual({ x: 10, y: 20 });
    });
  });

  describe('TaggedLruCache (Tag-based Invalidation)', () => {
    it('invalidates single and multiple tags', () => {
      const cache = createTaggedLruCache({ maxEntries: 100 });

      cache.set('user:1:profile', { name: 'Alice' }, { tags: ['model:User', 'pk:1'] });
      cache.set('user:2:profile', { name: 'Bob' }, { tags: ['model:User', 'pk:2'] });
      cache.set('stats:active', { count: 2 }, { tags: ['stats', 'model:User'] });

      expect(cache.has('user:1:profile')).toBe(true);
      expect(cache.has('user:2:profile')).toBe(true);
      expect(cache.has('stats:active')).toBe(true);

      // Invalidate pk:1
      cache.invalidateTag('pk:1');
      expect(cache.has('user:1:profile')).toBe(false);
      expect(cache.has('user:2:profile')).toBe(true);
      expect(cache.has('stats:active')).toBe(true);

      // Invalidate all User model queries
      cache.invalidateTags(['model:User']);
      expect(cache.has('user:2:profile')).toBe(false);
      expect(cache.has('stats:active')).toBe(false);
      expect(cache.size).toBe(0);
    });

    it('symmetrically cleans up tag registrations when an entry is evicted via LRU (No Memory Leaks)', () => {
      const cache = createTaggedLruCache({ maxEntries: 2 });

      cache.set('key1', 'val1', { tags: ['ephemeralTag'] });
      cache.set('key2', 'val2', { tags: ['ephemeralTag'] });

      expect(cache.hasTag('ephemeralTag')).toBe(true);
      expect(cache.getKeysForTag('ephemeralTag')).toHaveLength(2);

      // Evict key1 by adding key3
      cache.set('key3', 'val3', { tags: ['otherTag'] });
      expect(cache.has('key1')).toBe(false);
      expect(cache.getKeysForTag('ephemeralTag')).toEqual(['key2']);

      // Evict key2 by adding key4
      cache.set('key4', 'val4', { tags: ['otherTag'] });
      expect(cache.has('key2')).toBe(false);

      // 'ephemeralTag' has 0 remaining keys and must be pruned from tag index
      expect(cache.hasTag('ephemeralTag')).toBe(false);
      expect(cache.tagToKeys.has('ephemeralTag')).toBe(false);
    });

    it('returns combined getSizeStats() with tag metrics', () => {
      const cache = createTaggedLruCache({ maxEntries: 50 });
      cache.set('a', 1, { tags: ['tagA', 'shared'] });
      cache.set('b', 2, { tags: ['tagB', 'shared'] });

      const stats = cache.getSizeStats();
      expect(stats.entries).toBe(2);
      expect(stats.tags).toBe(3); // tagA, tagB, shared
      expect(stats.currentBytes).toBeGreaterThan(0);
    });
  });

  describe('Framework Context Integration (app-context)', () => {
    beforeEach(() => {
      resetAppContext();
    });

    it('exposes getCache and hasCache on app-context', () => {
      expect(hasCache()).toBe(false);
      expect(getCache()).toBeNull();

      const testCache = createTaggedLruCache({ maxEntries: 10 });
      setAppContext({ cache: testCache });

      expect(hasCache()).toBe(true);
      expect(getCache()).toBe(testCache);

      resetAppContext();
      expect(hasCache()).toBe(false);
    });
  });

  describe('Integration with createApp & Express Request', () => {
    const path = require('path');
    const { createApp } = require('../../../src/server');
    const request = require('supertest');

    it('attaches app.cache and injects req.cache into request lifecycle', async () => {
      const app = createApp({
        pagesDir: path.join(__dirname, '../../fixtures/empty-pages'),
        logging: false,
        cache: { maxEntries: 50, defaultTtl: '10m' },
      });

      expect(app.cache).toBeInstanceOf(TaggedLruCache);
      expect(app.cache.maxEntries).toBe(50);

      app.get('/test-cache', (req, res) => {
        expect(req.cache).toBe(app.cache);
        expect(req.context.cache).toBe(app.cache);

        if (req.query.set) {
          req.cache.set('user:session', req.query.set, { tags: ['session'] });
          return res.json({ stored: req.query.set });
        }

        const value = req.cache.get('user:session');
        res.json({ value: value || null });
      });

      // 1. Initial read is miss
      const res1 = await request(app).get('/test-cache');
      expect(res1.body).toEqual({ value: null });

      // 2. Set value
      const res2 = await request(app).get('/test-cache?set=active_token_123');
      expect(res2.body).toEqual({ stored: 'active_token_123' });

      // 3. Subsequent read is hit
      const res3 = await request(app).get('/test-cache');
      expect(res3.body).toEqual({ value: 'active_token_123' });

      // 4. Invalidate via tag
      app.cache.invalidateTag('session');
      const res4 = await request(app).get('/test-cache');
      expect(res4.body).toEqual({ value: null });
    });

    it('allows disabling app.cache via cache: false', () => {
      const app = createApp({
        pagesDir: path.join(__dirname, '../../fixtures/empty-pages'),
        logging: false,
        cache: false,
      });

      expect(app.cache).toBeNull();
    });
  });
});

