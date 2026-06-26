/**
 * Simple in-memory TTL cache for content reads.
 * @module core/content/cache
 */

/**
 * @param {number|null|undefined} [ttlMs] - Expiry in ms; null/undefined = no TTL (invalidate only on writes)
 */
function createContentCache(ttlMs = null) {
  /** @type {Map<string, { value: unknown, expires: number }>} */
  const store = new Map();
  const noExpiry = ttlMs == null || ttlMs === Infinity;

  /**
   * @param {string} key
   * @returns {unknown|undefined}
   */
  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (!noExpiry && Date.now() > entry.expires) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * @param {string} key
   * @param {unknown} value
   */
  function set(key, value) {
    store.set(key, {
      value,
      expires: noExpiry ? Number.POSITIVE_INFINITY : Date.now() + ttlMs,
    });
  }

  /**
   * @param {string} key
   */
  function del(key) {
    store.delete(key);
  }

  function invalidateAll() {
    store.clear();
  }

  /**
   * @param {string} prefix
   */
  function invalidatePrefix(prefix) {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
      }
    }
  }

  return { get, set, del, invalidateAll, invalidatePrefix };
}

module.exports = { createContentCache };
