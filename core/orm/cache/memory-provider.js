/**
 * In-memory CacheProvider (process-local, tag-based invalidation, true LRU & memory budget)
 * Upgraded with zero-allocation O(1) LRU eviction, byte budget constraints, and leak-free tag sets.
 * @module core/orm/cache/memory-provider
 */

const { createTaggedLruCache } = require('../../cache');

/**
 * @typedef {Object} MemoryCacheProviderOptions
 * @property {number} [maxEntries=10000] - Max stored keys; LRU evict on overflow
 * @property {number} [maxBytes=0] - Max byte size budget (0 = disabled)
 * @property {number} [maxMemoryMb=0] - Max megabytes budget (converts to bytes)
 * @property {number} [defaultTtlMs=0] - Default TTL in ms (0 = no expiry)
 * @property {function(*, string): number} [sizeCalculation] - Custom byte sizer
 */

/**
 * @param {MemoryCacheProviderOptions} [options]
 * @returns {import('./types').CacheProvider}
 */
function createMemoryCacheProvider(options = {}) {
  const maxEntries = options.maxEntries ?? 10000;
  const defaultTtlMs = options.defaultTtlMs ?? 0;
  const maxBytes = options.maxBytes ?? (options.maxMemoryMb ? options.maxMemoryMb * 1024 * 1024 : 0);

  const cache = createTaggedLruCache({
    maxEntries,
    defaultTtl: defaultTtlMs,
    maxBytes,
    sizeCalculation: options.sizeCalculation,
  });

  return {
    get: (key) => cache.get(key),
    set: (key, value, opts = {}) => cache.set(key, value, {
      tags: opts.tags,
      ttlMs: opts.ttlMs ?? defaultTtlMs,
      size: opts.size,
    }),
    invalidateTags: (tags) => cache.invalidateTags(tags),
    pruneExpired: () => cache.pruneExpired(),
    clear: () => cache.clear(),
    getSizeStats: () => cache.getSizeStats(),
    getStats: () => cache.getStats(),
  };
}

module.exports = {
  createMemoryCacheProvider,
};
