/**
 * Webspresso Services Memoization & Caching
 * Lightweight, zero-dependency in-memory cache with stampede protection, LRU eviction, and safe serialization
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
 * Safely deep clone an object or array to prevent cache mutation
 * @param {*} value
 * @returns {*} Cloned value
 */
function safeClone(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (e) {
      // Fallback for non-cloneable objects (buffers, functions, etc.)
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
 * Safe deterministic cache key serializer
 * Handles BigInt, Buffer, Date, RegExp, Symbols, and circular references safely
 * @param {*} input - Input arguments
 * @param {WeakSet} [seen] - Seen objects for circular reference detection
 * @returns {string} Serialized cache key
 */
function stableCacheKey(input, seen = new WeakSet()) {
  if (input === undefined) return '__undefined__';
  if (input === null) return '__null__';

  const type = typeof input;

  if (type === 'string') return JSON.stringify(input);
  if (type === 'number' || type === 'boolean') return String(input);
  if (type === 'bigint') return `${input.toString()}n`;
  if (type === 'symbol') return input.toString();
  if (type === 'function') return `[Function: ${input.name || 'anonymous'}]`;

  if (type === 'object') {
    if (seen.has(input)) {
      return '[Circular]';
    }
    seen.add(input);

    if (Buffer.isBuffer(input)) {
      return `[Buffer:${input.toString('hex')}]`;
    }
    if (input instanceof Date) {
      return `[Date:${input.toISOString()}]`;
    }
    if (input instanceof RegExp) {
      return `[RegExp:${input.toString()}]`;
    }

    if (Array.isArray(input)) {
      const items = input.map(item => stableCacheKey(item, seen));
      return `[${items.join(',')}]`;
    }

    // Deterministically sort keys
    const keys = Object.keys(input).sort();
    const pairs = keys.map(k => `${JSON.stringify(k)}:${stableCacheKey(input[k], seen)}`);
    return `{${pairs.join(',')}}`;
  }

  return String(input);
}

/**
 * Memoize an async or sync function with:
 * - Cache stampede / thundering herd protection (in-flight promise deduping)
 * - LRU cache eviction
 * - TTL expiration
 * - Cache mutation protection (safe cloning)
 * - Safe serialization (BigInt, circular refs, Buffers)
 * 
 * @param {Function} fn - Function to memoize
 * @param {Object} [options]
 * @param {string|number|boolean} [options.ttl='1m'] - Time to live
 * @param {number} [options.maxSize=500] - Max cache entries before LRU eviction
 * @param {boolean} [options.clone=true] - Clone cached results to prevent mutation
 * @param {Function} [options.key] - Custom cache key generator `(input, ctx) => string`
 * @returns {Function} Memoized function with .clear(), .invalidate(), .delete(), .has(), .size
 */
function memoize(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('memoize requires a function as first argument');
  }

  const ttlMs = parseTtlMs(options.ttl ?? options.cache ?? '1m');
  const maxSize = Number(options.maxSize) || 500;
  const shouldClone = options.clone !== false;
  const customKeyFn = typeof options.key === 'function' ? options.key : null;

  /** @type {Map<string, { value: *, expiresAt: number }>} */
  const cache = new Map();

  /** @type {Map<string, Promise<*>>} In-flight request deduplication map */
  const inFlight = new Map();

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
        // Refresh LRU position
        cache.delete(key);
        cache.set(key, hit);
        return shouldClone ? safeClone(hit.value) : hit.value;
      }
      cache.delete(key);
    }

    // 1. In-flight Promise Deduping (Thundering Herd / Cache Stampede Protection)
    if (inFlight.has(key)) {
      const inFlightResult = await inFlight.get(key);
      return shouldClone ? safeClone(inFlightResult) : inFlightResult;
    }

    // 2. Execute and track in-flight promise
    const executionPromise = (async () => {
      try {
        return await fn(input, ctx);
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, executionPromise);

    let result;
    try {
      result = await executionPromise;
    } catch (execErr) {
      // Do not cache failed executions
      throw execErr;
    }

    // 3. LRU Eviction when exceeding maxSize
    if (cache.size >= maxSize) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }

    cache.set(key, {
      value: shouldClone ? safeClone(result) : result,
      expiresAt: Date.now() + ttlMs,
    });

    return shouldClone ? safeClone(result) : result;
  }

  memoized.invalidate = function invalidate(input, ctx) {
    const key = getKey(input, ctx);
    inFlight.delete(key);
    return cache.delete(key);
  };

  memoized.delete = memoized.invalidate;

  memoized.clear = function clear() {
    inFlight.clear();
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
      // Clean expired entries on size access
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
  safeClone,
};
