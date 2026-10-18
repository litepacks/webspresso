'use strict';

/**
 * Webspresso - Tagged LRU Cache
 * Combines zero-allocation O(1) LRU eviction, byte budget constraints, and
 * bidirectional tag-based invalidation for ORM query caching and full-app caching.
 * Guaranteed zero dangling Set memory leaks on LRU evictions.
 * @module core/cache/tagged-lru
 */

const { LruCache } = require('./lru');

/**
 * Normalizes input tags into clean string array
 * @param {string|string[]|Set<string>} tags
 * @returns {string[]}
 */
function normalizeTags(tags) {
  if (!tags) return [];
  if (typeof tags === 'string') return [tags.trim()];
  if (tags instanceof Set) return Array.from(tags).map(String);
  if (Array.isArray(tags)) return tags.map(String).filter(Boolean);
  return [];
}

class TaggedLruCache {
  /**
   * @param {import('./lru').LruCacheOptions} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, Set<string>>} */
    this.tagToKeys = new Map();

    /** @type {Map<string, Set<string>>} */
    this.keyToTags = new Map();

    const userOnEvict = options.onEvict;

    // Connect internal LRU eviction directly to tag cleanup
    this.lru = new LruCache({
      ...options,
      onEvict: (key, value, reason) => {
        this._removeKeyFromTags(key);
        if (typeof userOnEvict === 'function') {
          userOnEvict(key, value, reason);
        }
      },
    });
  }

  get size() {
    return this.lru.size;
  }

  get currentBytes() {
    return this.lru.currentBytes;
  }

  get maxBytes() {
    return this.lru.maxBytes;
  }

  get maxEntries() {
    return this.lru.maxEntries;
  }

  get hits() {
    return this.lru.hits;
  }

  get misses() {
    return this.lru.misses;
  }

  get hitRate() {
    return this.lru.hitRate;
  }

  get evictions() {
    return this.lru.evictions;
  }

  get expirations() {
    return this.lru.expirations;
  }

  /**
   * Clean up all tag mappings for a key (called on eviction, deletion, or tag rewrite)
   * @private
   */
  _removeKeyFromTags(key) {
    const tags = this.keyToTags.get(key);
    if (!tags) return;

    for (const tag of tags) {
      const set = this.tagToKeys.get(tag);
      if (set) {
        set.delete(key);
        if (set.size === 0) {
          this.tagToKeys.delete(tag);
        }
      }
    }

    this.keyToTags.delete(key);
  }

  /**
   * Associate tags with a key
   * @private
   */
  _addKeyToTags(key, tags) {
    if (!tags || tags.length === 0) return;

    const tagSet = new Set(tags);
    this.keyToTags.set(key, tagSet);

    for (const tag of tagSet) {
      let keySet = this.tagToKeys.get(tag);
      if (!keySet) {
        keySet = new Set();
        this.tagToKeys.set(tag, keySet);
      }
      keySet.add(key);
    }
  }

  /**
   * Retrieve item by key
   */
  get(key) {
    return this.lru.get(key);
  }

  /**
   * Peek item without updating LRU order
   */
  peek(key) {
    return this.lru.peek(key);
  }

  /**
   * Check existence
   */
  has(key) {
    return this.lru.has(key);
  }

  /**
   * Store item with optional tags, TTL, and size
   *
   * @param {string} key
   * @param {*} value
   * @param {Object} [options]
   * @param {string|string[]} [options.tags]
   * @param {string|number} [options.ttl]
   * @param {number} [options.ttlMs]
   * @param {number} [options.size]
   * @returns {this}
   */
  set(key, value, options = {}) {
    const tags = normalizeTags(options.tags);

    // If key already had tags, clean them up first before assigning new tags
    if (this.keyToTags.has(key)) {
      this._removeKeyFromTags(key);
    }

    this._addKeyToTags(key, tags);
    this.lru.set(key, value, options);

    return this;
  }

  /**
   * Delete single key
   */
  delete(key) {
    this._removeKeyFromTags(key);
    return this.lru.delete(key);
  }

  /**
   * Alias for delete
   */
  del(key) {
    return this.delete(key);
  }

  /**
   * Invalidate all keys matching a specific tag
   *
   * @param {string} tag
   * @returns {number} Count of invalidated keys
   */
  invalidateTag(tag) {
    const keySet = this.tagToKeys.get(String(tag));
    if (!keySet || keySet.size === 0) return 0;

    // Copy keys to array to avoid mutating set during iteration
    const keys = Array.from(keySet);
    for (const key of keys) {
      this.lru.delete(key);
    }

    this.tagToKeys.delete(String(tag));
    return keys.length;
  }

  /**
   * Invalidate multiple tags in a single operation
   *
   * @param {string[]|string} tags
   * @returns {number} Total count of invalidated keys
   */
  invalidateTags(tags) {
    const normalized = normalizeTags(tags);
    if (normalized.length === 0) return 0;

    const toDelete = new Set();
    for (const t of normalized) {
      const keys = this.tagToKeys.get(t);
      if (keys) {
        for (const k of keys) {
          toDelete.add(k);
        }
      }
    }

    for (const k of toDelete) {
      this.lru.delete(k);
    }

    return toDelete.size;
  }

  /**
   * Check if a tag exists and has active keys
   * @param {string} tag
   * @returns {boolean}
   */
  hasTag(tag) {
    const keys = this.tagToKeys.get(String(tag));
    return Boolean(keys && keys.size > 0);
  }

  /**
   * Get all active keys for a tag
   * @param {string} tag
   * @returns {string[]}
   */
  getKeysForTag(tag) {
    const keys = this.tagToKeys.get(String(tag));
    return keys ? Array.from(keys) : [];
  }

  /**
   * Purge everything
   */
  clear() {
    this.tagToKeys.clear();
    this.keyToTags.clear();
    this.lru.clear();
    return this;
  }

  /**
   * Actively prune expired entries
   */
  pruneExpired() {
    return this.lru.pruneExpired();
  }

  /**
   * Thundering herd stampede protection with tagging support
   */
  async getOrSet(key, asyncFactory, options = {}) {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    return this.lru.getOrSet(key, asyncFactory, options);
  }

  /**
   * Returns stats compatible with both LruCache and ORM CacheProvider
   */
  getSizeStats() {
    return {
      entries: this.lru.size,
      tags: this.tagToKeys.size,
      currentBytes: this.lru.currentBytes,
      maxBytes: this.lru.maxBytes,
      maxEntries: this.lru.maxEntries,
      hits: this.lru.hits,
      misses: this.lru.misses,
      hitRate: this.lru.hitRate,
      evictions: this.lru.evictions,
      expirations: this.lru.expirations,
    };
  }

  getStats() {
    return this.getSizeStats();
  }

  resetStats() {
    this.lru.resetStats();
  }

  keys() {
    return this.lru.keys();
  }

  values() {
    return this.lru.values();
  }

  entries() {
    return this.lru.entries();
  }

  [Symbol.iterator]() {
    return this.lru.entries();
  }

  forEach(callback, thisArg) {
    this.lru.forEach(callback, thisArg);
  }
}

/**
 * Factory helper
 * @param {import('./lru').LruCacheOptions} [options]
 * @returns {TaggedLruCache}
 */
function createTaggedLruCache(options) {
  return new TaggedLruCache(options);
}

module.exports = {
  TaggedLruCache,
  createTaggedLruCache,
  normalizeTags,
};
