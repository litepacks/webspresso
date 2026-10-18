'use strict';

/**
 * Webspresso - Zero-Dependency High-Performance LRU Cache
 * O(1) Least-Recently-Used in-memory cache with memory byte budget, TTL expiration,
 * stampede protection (thundering herd prevention), and detailed observability metrics.
 * @module core/cache/lru
 */

const { approximateByteSize } = require('./byte-size');
const { parseDurationMs } = require('../utils/time');

/**
 * Deep clone utility to isolate cached values if cloning is requested
 * @param {*} value
 * @returns {*}
 */
function safeClone(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fallback if structuredClone fails on non-serializable elements
    }
  }
  if (Array.isArray(value)) {
    return value.map(item => safeClone(item));
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  const cloned = {};
  for (const [k, v] of Object.entries(value)) {
    cloned[k] = safeClone(v);
  }
  return cloned;
}

/**
 * @typedef {Object} LruCacheOptions
 * @property {number} [maxEntries=1000] - Maximum entry count (0 = unlimited count)
 * @property {number} [maxBytes=0] - Maximum byte capacity (0 = disabled)
 * @property {number} [maxMemoryMb=0] - Maximum megabytes capacity (converts to bytes)
 * @property {string|number} [defaultTtl=0] - Default TTL in ms or string duration ('5m', '1h', 0 = no expiry)
 * @property {function(*, string): number} [sizeCalculation] - Custom byte sizer function
 * @property {boolean} [clone=false] - Whether to deep-clone items on read/write
 * @property {function(string, *, 'evict'|'expire'|'delete'|'clear'): void} [onEvict] - Eviction callback
 */

class LruCache {
  /**
   * @param {LruCacheOptions} [options]
   */
  constructor(options = {}) {
    this.maxEntries = typeof options.maxEntries === 'number' ? Math.max(0, options.maxEntries) : 1000;
    
    // Memory budget configuration
    if (typeof options.maxMemoryMb === 'number' && options.maxMemoryMb > 0) {
      this.maxBytes = Math.floor(options.maxMemoryMb * 1024 * 1024);
    } else if (typeof options.maxBytes === 'number' && options.maxBytes > 0) {
      this.maxBytes = Math.floor(options.maxBytes);
    } else {
      this.maxBytes = 0; // 0 = unlimited bytes
    }

    this.defaultTtlMs = options.defaultTtl ? parseDurationMs(options.defaultTtl, 0) : 0;
    this.sizeCalculation = typeof options.sizeCalculation === 'function' ? options.sizeCalculation : null;
    this.clone = options.clone === true;
    this.onEvict = typeof options.onEvict === 'function' ? options.onEvict : null;

    /** @type {Map<string, { value: *, size: number, expiresAt: number }>} */
    this._store = new Map();

    /** @type {Map<string, Promise<*>>} In-flight promises for stampede protection */
    this._inFlight = new Map();

    this.currentBytes = 0;

    // Observability metrics
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
    this.expirations = 0;
  }

  /**
   * Number of active entries stored in the cache
   * @type {number}
   */
  get size() {
    return this._store.size;
  }

  /**
   * Hit rate ratio (0.0 to 1.0)
   * @type {number}
   */
  get hitRate() {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  /**
   * Calculate size of an item
   * @private
   */
  _calcSize(value, key, explicitSize) {
    if (typeof explicitSize === 'number' && explicitSize >= 0) {
      return explicitSize;
    }
    if (this.sizeCalculation) {
      return Math.max(0, this.sizeCalculation(value, key));
    }
    return Math.max(0, approximateByteSize(value));
  }

  /**
   * Check if an entry has expired
   * @private
   */
  _isExpired(entry) {
    return entry.expiresAt > 0 && Date.now() > entry.expiresAt;
  }

  /**
   * Remove an entry and invoke eviction handler
   * @private
   */
  _removeEntry(key, entry, reason) {
    this._store.delete(key);
    this.currentBytes = Math.max(0, this.currentBytes - entry.size);

    if (this.onEvict) {
      try {
        this.onEvict(key, entry.value, reason);
      } catch (err) {
        // Eviction callbacks must never crash the cache operations
        process.nextTick(() => {
          console.error(`[LruCache] onEvict callback failed for key "${key}":`, err);
        });
      }
    }
  }

  /**
   * Evict the least recently used item (the first key in Map insertion order)
   * @private
   */
  _evictLru() {
    const oldestKey = this._store.keys().next().value;
    if (oldestKey === undefined) return false;

    const entry = this._store.get(oldestKey);
    if (!entry) return false;

    this.evictions++;
    this._removeEntry(oldestKey, entry, 'evict');
    return true;
  }

  /**
   * Retrieve an item from the cache. Updates its LRU position to most-recently used.
   *
   * @param {string} key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    const entry = this._store.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (this._isExpired(entry)) {
      this.expirations++;
      this.misses++;
      this._removeEntry(key, entry, 'expire');
      return undefined;
    }

    // Refresh LRU position by deleting and re-inserting at the end of the Map
    this._store.delete(key);
    this._store.set(key, entry);

    this.hits++;
    return this.clone ? safeClone(entry.value) : entry.value;
  }

  /**
   * Read value without updating LRU position
   *
   * @param {string} key
   * @returns {*}
   */
  peek(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;

    if (this._isExpired(entry)) {
      this.expirations++;
      this._removeEntry(key, entry, 'expire');
      return undefined;
    }

    return this.clone ? safeClone(entry.value) : entry.value;
  }

  /**
   * Check if a key exists and is not expired
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this._store.get(key);
    if (!entry) return false;

    if (this._isExpired(entry)) {
      this.expirations++;
      this._removeEntry(key, entry, 'expire');
      return false;
    }

    return true;
  }

  /**
   * Store a key/value pair in the cache
   *
   * @param {string} key
   * @param {*} value
   * @param {Object} [options]
   * @param {number|string} [options.ttl] - TTL duration string or ms
   * @param {number} [options.ttlMs] - TTL duration in ms
   * @param {number} [options.size] - Explicit byte size
   * @returns {this}
   */
  set(key, value, options = {}) {
    const entrySize = this._calcSize(value, key, options.size);

    // If a single entry exceeds the entire byte budget, it cannot fit
    if (this.maxBytes > 0 && entrySize > this.maxBytes) {
      return this;
    }

    // If key already exists, subtract its previous size before calculating space
    const existing = this._store.get(key);
    if (existing) {
      this._removeEntry(key, existing, 'delete');
    }

    // Capacity enforcement loop: evict LRU entries until under entry and byte limits
    while (
      (this.maxEntries > 0 && this._store.size >= this.maxEntries) ||
      (this.maxBytes > 0 && (this.currentBytes + entrySize) > this.maxBytes)
    ) {
      const evicted = this._evictLru();
      if (!evicted) break;
    }

    let ttlMs = this.defaultTtlMs;
    if (typeof options.ttlMs === 'number') {
      ttlMs = Math.max(0, options.ttlMs);
    } else if (options.ttl !== undefined) {
      ttlMs = parseDurationMs(options.ttl, 0);
    }

    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0;
    const storedValue = this.clone ? safeClone(value) : value;

    const entry = {
      value: storedValue,
      size: entrySize,
      expiresAt,
    };

    this._store.set(key, entry);
    this.currentBytes += entrySize;
    this.sets++;

    return this;
  }

  /**
   * Delete an entry by key
   *
   * @param {string} key
   * @returns {boolean} True if deleted, false if not found
   */
  delete(key) {
    const entry = this._store.get(key);
    if (!entry) return false;

    this._removeEntry(key, entry, 'delete');
    return true;
  }

  /**
   * Alias for delete
   */
  del(key) {
    return this.delete(key);
  }

  /**
   * Purge all items from the cache
   * @returns {this}
   */
  clear() {
    if (this.onEvict) {
      for (const [k, entry] of this._store.entries()) {
        try {
          this.onEvict(k, entry.value, 'clear');
        } catch {
          // Ignore clear errors
        }
      }
    }
    this._store.clear();
    this._inFlight.clear();
    this.currentBytes = 0;
    return this;
  }

  /**
   * Sweeps and removes all expired entries actively
   * @returns {number} Number of expired items pruned
   */
  pruneExpired() {
    let count = 0;
    const now = Date.now();
    for (const [key, entry] of this._store.entries()) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this.expirations++;
        this._removeEntry(key, entry, 'expire');
        count++;
      }
    }
    return count;
  }

  /**
   * Thundering herd / cache stampede protection.
   * If item exists, returns it. If not, calls asyncFactory once and deduplicates
   * concurrent requests awaiting the exact same key.
   *
   * @param {string} key
   * @param {function(string): Promise<*>} asyncFactory
   * @param {Object} [options] - Options passed to .set()
   * @returns {Promise<*>}
   */
  async getOrSet(key, asyncFactory, options = {}) {
    // 1. Check immediate cache hit
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // 2. Check if another concurrent request is already fetching this key
    if (this._inFlight.has(key)) {
      const inFlightVal = await this._inFlight.get(key);
      return this.clone ? safeClone(inFlightVal) : inFlightVal;
    }

    // 3. Launch execution and track in-flight promise
    const executionPromise = (async () => {
      try {
        return await asyncFactory(key);
      } finally {
        this._inFlight.delete(key);
      }
    })();

    this._inFlight.set(key, executionPromise);

    let result;
    try {
      result = await executionPromise;
    } catch (err) {
      // Do not cache rejected promises / errors
      throw err;
    }

    this.set(key, result, options);
    return this.clone ? safeClone(result) : result;
  }

  /**
   * Retrieve telemetry snapshot
   */
  getStats() {
    return {
      entries: this._store.size,
      currentBytes: this.currentBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hitRate,
      sets: this.sets,
      evictions: this.evictions,
      expirations: this.expirations,
    };
  }

  /**
   * Reset observability counters
   */
  resetStats() {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
    this.expirations = 0;
  }

  /**
   * Iterate over keys
   */
  keys() {
    return this._store.keys();
  }

  /**
   * Iterate over values
   */
  *values() {
    const now = Date.now();
    for (const entry of this._store.values()) {
      if (!this._isExpired(entry)) {
        yield this.clone ? safeClone(entry.value) : entry.value;
      }
    }
  }

  /**
   * Iterate over [key, value] pairs
   */
  *entries() {
    const now = Date.now();
    for (const [key, entry] of this._store.entries()) {
      if (!this._isExpired(entry)) {
        yield [key, this.clone ? safeClone(entry.value) : entry.value];
      }
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  forEach(callback, thisArg) {
    for (const [key, val] of this.entries()) {
      callback.call(thisArg, val, key, this);
    }
  }
}

/**
 * Factory helper
 * @param {LruCacheOptions} [options]
 * @returns {LruCache}
 */
function createLruCache(options) {
  return new LruCache(options);
}

module.exports = {
  LruCache,
  createLruCache,
  safeClone,
};
