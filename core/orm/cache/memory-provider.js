/**
 * In-memory CacheProvider (process-local, tag-based invalidation)
 * @module core/orm/cache/memory-provider
 */

/**
 * @typedef {Object} MemoryCacheProviderOptions
 * @property {number} [maxEntries=10000] - Max stored keys; FIFO evict on overflow
 * @property {number} [defaultTtlMs=0] - Default TTL (0 = no expiry)
 */

/**
 * @param {MemoryCacheProviderOptions} [options]
 * @returns {import('./types').CacheProvider}
 */
function createMemoryCacheProvider(options = {}) {
  const maxEntries = options.maxEntries ?? 10000;
  const defaultTtlMs = options.defaultTtlMs ?? 0;

  /** @type {Map<string, { value: *, expiresAt: number, tags: Set<string> }>} */
  const store = new Map();
  /** @type {Map<string, Set<string>>} */
  const tagToKeys = new Map();
  /** @type {Map<string, Set<string>>} */
  const keyToTags = new Map();

  function removeKey(key) {
    const tags = keyToTags.get(key);
    if (tags) {
      for (const t of tags) {
        const set = tagToKeys.get(t);
        if (set) {
          set.delete(key);
          if (set.size === 0) tagToKeys.delete(t);
        }
      }
    }
    keyToTags.delete(key);
    store.delete(key);
  }

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      removeKey(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value, opts = {}) {
    const tags = Array.isArray(opts.tags) ? opts.tags : [];
    const ttlMs = opts.ttlMs ?? defaultTtlMs;

    if (store.has(key)) removeKey(key);

    if (maxEntries > 0 && store.size >= maxEntries) {
      const first = store.keys().next().value;
      if (first !== undefined) removeKey(first);
    }

    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0;
    const tagSet = new Set(tags);
    store.set(key, { value, expiresAt, tags: tagSet });
    keyToTags.set(key, new Set(tags));

    for (const t of tags) {
      if (!tagToKeys.has(t)) tagToKeys.set(t, new Set());
      tagToKeys.get(t).add(key);
    }
  }

  function invalidateTags(tags) {
    const toDelete = new Set();
    for (const t of tags) {
      const keys = tagToKeys.get(t);
      if (!keys) continue;
      for (const k of keys) toDelete.add(k);
    }
    for (const k of toDelete) removeKey(k);
    for (const t of tags) tagToKeys.delete(t);
  }

  function clear() {
    store.clear();
    tagToKeys.clear();
    keyToTags.clear();
  }

  function getSizeStats() {
    return {
      entries: store.size,
      tags: tagToKeys.size,
    };
  }

  return {
    get,
    set,
    invalidateTags,
    clear,
    getSizeStats,
  };
}

module.exports = {
  createMemoryCacheProvider,
};
