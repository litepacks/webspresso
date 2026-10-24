const { parseDurationMs } = require('../utils/time');
const { TaggedLruCache, normalizeTags } = require('../cache/tagged-lru');

/**
 * Parse TTL duration into milliseconds
 * @param {string|number|boolean} ttl - Duration string ('5s', '1m', '5m', '1h', '1d'), ms number, or boolean
 * @returns {number} Milliseconds
 */
const parseTtlMs = parseDurationMs;

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
 * - Zero-allocation O(1) LRU cache eviction
 * - TTL expiration
 * - Bidirectional tag-based invalidation with zero memory leaks
 * - Dynamic tag resolvers: `(input, ctx) => ['user:' + input.id]`
 * - Pluggable custom or distributed cache providers (Redis, memory, etc.)
 * - Cache mutation protection (safe cloning)
 * - Safe serialization (BigInt, circular refs, Buffers)
 * 
 * @param {Function} fn - Function to memoize
 * @param {Object} [options]
 * @param {string|number|boolean} [options.ttl='1m'] - Time to live
 * @param {number} [options.maxSize=500] - Max cache entries before LRU eviction
 * @param {boolean} [options.clone=true] - Clone cached results to prevent mutation
 * @param {Function} [options.key] - Custom cache key generator `(input, ctx) => string`
 * @param {string|string[]|Function} [options.tags] - Static tags or dynamic tag resolver `(input, ctx) => string|string[]`
 * @param {Object} [options.provider] - Pluggable cache provider (e.g. Redis, distributed store)
 * @returns {Function} Memoized function with .clear(), .invalidate(), .delete(), .has(), .size, .invalidateByTag(), .invalidateByTags()
 */
function memoize(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('memoize requires a function as first argument');
  }

  const ttlMs = parseTtlMs(options.ttl ?? options.cache ?? '1m');
  const maxSize = Number(options.maxSize) || 500;
  const shouldClone = options.clone !== false;
  const customKeyFn = typeof options.key === 'function' ? options.key : null;
  const tagsOption = options.tags;
  const provider = options.provider || null;

  /** @type {Map<string, Promise<*>>} In-flight request deduplication map (Stampede protection) */
  const inFlight = new Map();

  /** @type {TaggedLruCache|null} Local zero-leak tagged LRU cache if no external provider */
  const localCache = provider
    ? null
    : new TaggedLruCache({
        maxEntries: maxSize,
        defaultTtl: ttlMs,
      });

  // Fallback tag tracking for basic external providers that lack native tag support
  const providerTagToKeys = new Map();
  const providerKeyToTags = new Map();

  function trackProviderTags(key, tags) {
    if (!tags || tags.length === 0) return;
    untrackProviderKey(key);
    providerKeyToTags.set(key, new Set(tags));
    for (const t of tags) {
      let set = providerTagToKeys.get(t);
      if (!set) {
        set = new Set();
        providerTagToKeys.set(t, set);
      }
      set.add(key);
    }
  }

  function untrackProviderKey(key) {
    const tags = providerKeyToTags.get(key);
    if (!tags) return;
    for (const t of tags) {
      const set = providerTagToKeys.get(t);
      if (set) {
        set.delete(key);
        if (set.size === 0) {
          providerTagToKeys.delete(t);
        }
      }
    }
    providerKeyToTags.delete(key);
  }

  function getKey(input, ctx) {
    if (customKeyFn) {
      return String(customKeyFn(input, ctx));
    }
    return stableCacheKey(input);
  }

  function resolveTags(input, ctx) {
    if (!tagsOption) return [];
    if (typeof tagsOption === 'function') {
      try {
        return normalizeTags(tagsOption(input, ctx));
      } catch (_) {
        return [];
      }
    }
    return normalizeTags(tagsOption);
  }

  async function memoized(input, ctx) {
    const key = getKey(input, ctx);

    // 1. In-flight Promise Deduping (Thundering Herd / Cache Stampede Protection)
    if (inFlight.has(key)) {
      const inFlightResult = await inFlight.get(key);
      return shouldClone ? safeClone(inFlightResult) : inFlightResult;
    }

    // 2. Check Cache Hit
    if (provider) {
      const hit = await provider.get(key);
      if (hit !== undefined && hit !== null) {
        return shouldClone ? safeClone(hit) : hit;
      }
      if (typeof provider.has === 'function') {
        const exists = await provider.has(key);
        if (exists) {
          return shouldClone ? safeClone(hit) : hit;
        }
      }
    } else {
      const hit = localCache.get(key);
      if (hit !== undefined) {
        return shouldClone ? safeClone(hit) : hit;
      }
      if (localCache.has(key)) {
        return undefined;
      }
    }

    // 3. Execute and track in-flight promise
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

    // 4. Store result with tags
    const entryTags = resolveTags(input, ctx);
    const valToStore = shouldClone ? safeClone(result) : result;

    if (provider) {
      const hasNativeTagSupport = typeof provider.invalidateTag === 'function' ||
        typeof provider.invalidateByTag === 'function' ||
        typeof provider.invalidateTags === 'function' ||
        typeof provider.invalidateByTags === 'function';

      if (!hasNativeTagSupport && entryTags.length > 0) {
        trackProviderTags(key, entryTags);
      }

      if (typeof provider.set === 'function') {
        await provider.set(key, valToStore, {
          ttl: ttlMs,
          ttlMs,
          tags: entryTags,
        });
      }
    } else {
      localCache.set(key, valToStore, {
        tags: entryTags,
        ttlMs,
        ttl: ttlMs,
      });
    }

    return shouldClone ? safeClone(result) : result;
  }

  memoized.invalidate = function invalidate(input, ctx) {
    const key = getKey(input, ctx);
    inFlight.delete(key);
    if (provider) {
      untrackProviderKey(key);
      if (typeof provider.delete === 'function') return provider.delete(key);
      if (typeof provider.del === 'function') return provider.del(key);
      return false;
    }
    return localCache.delete(key);
  };

  memoized.delete = memoized.invalidate;

  memoized.invalidateByTag = function invalidateByTag(tag) {
    const tagStr = String(tag);

    if (provider) {
      if (typeof provider.invalidateTag === 'function') {
        return provider.invalidateTag(tagStr);
      }
      if (typeof provider.invalidateByTag === 'function') {
        return provider.invalidateByTag(tagStr);
      }
      if (typeof provider.invalidateTags === 'function') {
        return provider.invalidateTags([tagStr]);
      }
      if (typeof provider.invalidateByTags === 'function') {
        return provider.invalidateByTags([tagStr]);
      }

      // Fallback tag tracking for basic providers
      const keys = providerTagToKeys.get(tagStr);
      if (!keys || keys.size === 0) return 0;
      const keyArr = Array.from(keys);
      providerTagToKeys.delete(tagStr);
      for (const k of keyArr) {
        inFlight.delete(k);
        untrackProviderKey(k);
      }
      const delOps = keyArr.map(k => {
        if (typeof provider.delete === 'function') return provider.delete(k);
        if (typeof provider.del === 'function') return provider.del(k);
        return false;
      });
      const hasPromise = delOps.some(p => p && typeof p.then === 'function');
      if (hasPromise) {
        return Promise.all(delOps).then(() => keyArr.length);
      }
      return keyArr.length;
    }

    // TaggedLruCache
    const keys = localCache.getKeysForTag(tagStr);
    for (const k of keys) {
      inFlight.delete(k);
    }
    return localCache.invalidateTag(tagStr);
  };

  memoized.invalidateByTags = function invalidateByTags(tags) {
    const normTags = normalizeTags(tags);
    if (normTags.length === 0) return 0;

    if (provider) {
      if (typeof provider.invalidateTags === 'function') {
        return provider.invalidateTags(normTags);
      }
      if (typeof provider.invalidateByTags === 'function') {
        return provider.invalidateByTags(normTags);
      }
      const results = [];
      for (const t of normTags) {
        results.push(memoized.invalidateByTag(t));
      }
      const hasPromise = results.some(r => r && typeof r.then === 'function');
      if (hasPromise) {
        return Promise.all(results).then(counts =>
          counts.reduce((acc, c) => acc + (typeof c === 'number' ? c : 0), 0)
        );
      }
      return results.reduce((acc, c) => acc + (typeof c === 'number' ? c : 0), 0);
    }

    // TaggedLruCache
    for (const t of normTags) {
      const keys = localCache.getKeysForTag(t);
      for (const k of keys) {
        inFlight.delete(k);
      }
    }
    return localCache.invalidateTags(normTags);
  };

  memoized.invalidateTag = memoized.invalidateByTag;
  memoized.invalidateTags = memoized.invalidateByTags;

  memoized.clear = function clear() {
    inFlight.clear();
    if (provider) {
      providerTagToKeys.clear();
      providerKeyToTags.clear();
      if (typeof provider.clear === 'function') return provider.clear();
      return true;
    }
    return localCache.clear();
  };

  memoized.has = function has(input, ctx) {
    const key = getKey(input, ctx);
    if (provider) {
      if (typeof provider.has === 'function') return provider.has(key);
      return false;
    }
    return localCache.has(key);
  };

  Object.defineProperty(memoized, 'size', {
    get() {
      if (provider) {
        if (typeof provider.size === 'number') return provider.size;
        if (typeof provider.getSizeStats === 'function') return provider.getSizeStats().entries;
        return providerKeyToTags.size;
      }
      localCache.pruneExpired();
      return localCache.size;
    },
    configurable: true,
  });

  memoized.cache = provider || localCache;

  return memoized;
}

module.exports = {
  memoize,
  parseTtlMs,
  stableCacheKey,
  safeClone,
  normalizeTags,
};
