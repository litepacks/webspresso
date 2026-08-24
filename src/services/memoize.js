/**
 * Webspresso Services Memoization & Caching
 * Lightweight, zero-dependency in-memory cache for services and async functions
 * @module src/services/memoize
 */

/**
 * Parse TTL duration into milliseconds
 * @param {string|number|boolean} ttl - Duration string ('5s', '1m', '5m', '1h', '1d'), ms number, or boolean
 * @returns {number} Milliseconds
 */
function parseTtlMs(ttl) {
  if (typeof ttl === 'number') {
    return ttl > 0 ? ttl : 60_000;
  }
  if (ttl === true || !ttl) {
    return 60_000; // Default 1 minute
  }
  if (typeof ttl === 'string') {
    const match = ttl.trim().match(/^(\d+)\s*([smhd])?$/i);
    if (match) {
      const val = parseInt(match[1], 10);
      const unit = (match[2] || 's').toLowerCase();
      switch (unit) {
        case 's': return val * 1_000;
        case 'm': return val * 60_000;
        case 'h': return val * 3_600_000;
        case 'd': return val * 86_400_000;
        default: return val * 1_000;
      }
    }
    const num = parseInt(ttl, 10);
    return !Number.isNaN(num) && num > 0 ? num : 60_000;
  }
  return 60_000;
}

/**
 * Generate stable cache key from input
 * @param {*} input - Input arguments
 * @returns {string} Serialized cache key
 */
function stableCacheKey(input) {
  if (input === undefined || input === null) {
    return '__null__';
  }
  if (typeof input !== 'object') {
    return String(input);
  }
  if (Array.isArray(input)) {
    return JSON.stringify(input);
  }
  // Sort keys for deterministic hash
  const sorted = Object.keys(input)
    .sort()
    .reduce((acc, k) => {
      acc[k] = input[k];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

/**
 * Memoize an async or sync function with TTL, eviction, and invalidation helpers
 * @param {Function} fn - Function to memoize
 * @param {Object} [options]
 * @param {string|number|boolean} [options.ttl='1m'] - Time to live
 * @param {number} [options.maxSize=500] - Max cache entries before eviction
 * @param {Function} [options.key] - Custom cache key generator `(input, ctx) => string`
 * @returns {Function} Memoized function with .clear(), .invalidate(), .delete(), .has(), .size
 */
function memoize(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('memoize requires a function as first argument');
  }

  const ttlMs = parseTtlMs(options.ttl ?? options.cache ?? '1m');
  const maxSize = Number(options.maxSize) || 500;
  const customKeyFn = typeof options.key === 'function' ? options.key : null;

  /** @type {Map<string, { value: *, expiresAt: number }>} */
  const cache = new Map();

  function getKey(input, ctx) {
    if (customKeyFn) {
      return String(customKeyFn(input, ctx));
    }
    return stableCacheKey(input);
  }

  async function memoized(input, ctx) {
    const key = getKey(input, ctx);
    const now = Date.now();
    const hit = cache.get(key);

    if (hit) {
      if (hit.expiresAt > now) {
        return hit.value;
      }
      cache.delete(key);
    }

    // Execute function
    const result = await fn(input, ctx);

    // Evict oldest if reaching maxSize
    if (cache.size >= maxSize) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }

    cache.set(key, {
      value: result,
      expiresAt: now + ttlMs,
    });

    return result;
  }

  memoized.invalidate = function invalidate(input, ctx) {
    const key = getKey(input, ctx);
    return cache.delete(key);
  };

  memoized.delete = memoized.invalidate;

  memoized.clear = function clear() {
    cache.clear();
  };

  memoized.has = function has(input, ctx) {
    const key = getKey(input, ctx);
    const hit = cache.get(key);
    if (!hit) return false;
    if (hit.expiresAt <= Date.now()) {
      cache.delete(key);
      return false;
    }
    return true;
  };

  Object.defineProperty(memoized, 'size', {
    get() {
      // Clean expired on access
      const now = Date.now();
      for (const [k, v] of cache.entries()) {
        if (v.expiresAt <= now) {
          cache.delete(k);
        }
      }
      return cache.size;
    },
  });

  return memoized;
}

module.exports = {
  memoize,
  parseTtlMs,
  stableCacheKey,
};
