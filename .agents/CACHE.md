# High-Performance In-Memory LRU & Tagged Cache Engine (`core/cache`)

Webspresso includes a zero-dependency, memory-bounded, leak-free in-memory cache engine featuring O(1) Least-Recently-Used (LRU) eviction, byte budget constraints (`maxBytes` / `maxMemoryMb`), TTL expiration, stampede protection (thundering herd prevention), and O(1) bidirectional tag-based invalidation.

---

## 🎯 Key Capabilities & Design Guarantees

1. **True O(1) LRU Eviction**: Built on V8's native insertion-order Map mechanics with zero extra memory allocation for linked-list node wrappers.
2. **Dual Capacity Boundaries**:
   - **`maxEntries`**: Restricts the maximum number of items stored.
   - **`maxBytes` / `maxMemoryMb`**: Enforces strict memory budgets using `approximateByteSize` to prevent process Out-Of-Memory (OOM) crashes under heavy or large payload loads.
   - **Zero-Overhead Fast Path**: When `maxBytes` is 0 (unlimited byte budget, count-only LRU), deep recursive byte size calculations are automatically bypassed (`0` byte allocation overhead), maximizing throughput on large query and JSON payloads unless explicitly requested via `trackBytes: true`.
3. **Symmetrical Tag Cleanup (Zero Leaks)**: When an item is evicted via LRU, expired via TTL, or deleted, all associated tag index sets are automatically pruned. Empty tag sets are deleted immediately, preventing the classic "dangling Set memory leak".
4. **Stampede / Thundering Herd Protection**: `getOrSet(key, asyncFactory)` coalesces concurrent requests for the same missing key, invoking the expensive calculation or DB query exactly once.
5. **Universal Integration**:
   - **ORM Query Cache**: Powers `core/orm/cache/memory-provider.js` with true LRU and memory budgets.
   - **Zod Schema Cache**: Powers `core/schema-cache.js` with bounded 2,000 schemas capacity.
   - **Application & Context**: Automatically mounted on `app.cache`, `req.cache`, and `req.context.cache` unless `cache: false` is configured.

---

## 🚀 Quick Usage

### 1. Standalone `LruCache`
```javascript
const { createLruCache } = require('webspresso');

const cache = createLruCache({
  maxEntries: 1000,
  maxMemoryMb: 50,          // 50 MB byte budget
  defaultTtl: '15m',        // 15 minutes default TTL
  clone: false,             // Set true if cached objects must not be mutated
});

cache.set('user:42', { name: 'Alice', role: 'admin' });

const user = cache.get('user:42'); // Refreshes LRU position
const peekUser = cache.peek('user:42'); // Reads without refreshing LRU position
```

### 2. Tagged Invalidation (`TaggedLruCache`)
```javascript
const { createTaggedLruCache } = require('webspresso');

const cache = createTaggedLruCache({
  maxEntries: 5000,
  maxMemoryMb: 100,
});

// Tag items by model and primary key
cache.set('query:users:active', usersList, { tags: ['model:User', 'q:active'] });
cache.set('user:1:profile', userProfile, { tags: ['model:User', 'pk:1'] });

// Invalidate single primary key
cache.invalidateTag('pk:1');

// Invalidate all queries related to the User model
cache.invalidateTags(['model:User']);
```

### 3. Stampede / Thundering Herd Protection (`getOrSet`)
```javascript
// 50 concurrent requests for 'expensive:report' will execute the factory only once:
const report = await cache.getOrSet('expensive:report', async (key) => {
  return await generateHeavyReport();
}, { ttl: '1h' });
```

---

## ⚙️ Application Configuration (`createApp`)

Configure the process-wide cache directly when bootstrapping Webspresso:

```javascript
const { createApp } = require('webspresso');

const app = createApp({
  pagesDir: './pages',
  cache: {
    maxEntries: 5000,
    maxMemoryMb: 64,        // 64 MB budget
    defaultTtl: '10m',
  },
});
```

To disable the app cache completely:
```javascript
const app = createApp({
  pagesDir: './pages',
  cache: false,
});
```

---

## 🌐 Context & Route Usage

Inside page loaders, services, or API route handlers:

```javascript
// In API routes (pages/api/stats.get.js)
module.exports = defineApi({
  handler: async (req, res) => {
    const stats = await req.cache.getOrSet('site:stats', async () => {
      return await req.db.getRepository('Order').getSummaryStats();
    }, { ttl: '5m', tags: ['stats', 'model:Order'] });

    return res.json(stats);
  },
});
```

```javascript
// From any background job or script using app-context
const { getCache } = require('webspresso');

const cache = getCache();
if (cache) {
  cache.invalidateTag('stats');
}
```

---

## 📊 Telemetry & Observability Metrics

Access real-time cache performance and memory metrics:

```javascript
const stats = app.cache.getStats();
console.log(stats);
// {
//   entries: 42,
//   tags: 5,
//   currentBytes: 124850,
//   maxBytes: 67108864,
//   maxEntries: 5000,
//   hits: 1540,
//   misses: 23,
//   hitRate: 0.985,
//   sets: 65,
//   evictions: 0,
//   expirations: 12
// }
```
