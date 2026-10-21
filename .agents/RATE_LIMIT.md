# Native Zero-Dependency Rate Limiting Engine (`core/rate-limit`)

Webspresso features a high-performance, zero-dependency Rate Limiting Engine located in `core/rate-limit/`. It works seamlessly across both traditional Express middleware pipelines and modern edge/serverless contexts (such as Hono), providing standard RFC 6585 and IETF Draft rate limit headers with memory leak-free in-memory and distributed Redis sliding-window stores.

---

## 🎯 Native Core vs. Plugin Comparison

| Feature | Core Rate Limiter (`core/rate-limit`) | Rate Limit Plugin (`plugins/rate-limit`) |
| :--- | :--- | :--- |
| **Dependencies** | **Zero external dependencies** (pure Node.js) | Requires `express-rate-limit` peer dependency |
| **Import** | `const { rateLimit, RateLimiter } = require('webspresso')` | `const { rateLimitPlugin } = require('webspresso')` |
| **Framework Agnostic** | ✅ Express `(req, res, next)` & Hono `(c, next)` | Express only |
| **Stores** | Native Sliding Window `MemoryRateLimitStore` & `RedisRateLimitStore` | `express-rate-limit` memory or external store |
| **Headers** | RFC 6585 `RateLimit-*`, `Retry-After`, legacy `X-RateLimit-*` | `standardHeaders: 'draft-7'`, `legacyHeaders` |
| **File Route Usage** | Universal middleware in API routes and standalone apps | Named middleware via `ctx.middlewares.rateLimit` |

---

## 🚀 Quick Start

### 1. Basic Express Route Limiting

```javascript
const { rateLimit } = require('webspresso');

// 60 requests per minute
const apiLimiter = rateLimit({
  window: '1m',
  limit: 60,
});

// Use as standard middleware
app.use('/api', apiLimiter);
```

### 2. File-Based API Route (`pages/api/...`)

```javascript
const { defineApi, rateLimit } = require('webspresso');

const strictLimiter = rateLimit({
  window: '10s',
  limit: 5,
  message: { error: 'Too many requests. Please slow down.' },
});

module.exports = defineApi({
  middleware: [strictLimiter],
  handler: async (req, res) => {
    return res.json({ success: true });
  },
});
```

### 3. Distributed Redis Rate Limiting (Scale-Out)

```javascript
const { rateLimit, RedisRateLimitStore } = require('webspresso');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);

const limiter = rateLimit({
  window: '15m',
  limit: 100,
  store: new RedisRateLimitStore({
    client: redis,
    prefix: 'rl:auth:',
    passOnStoreError: true, // Fail-open if Redis drops
  }),
});
```

### 4. Edge / Hono Application Usage

The middleware automatically detects Hono's `(c, next)` context signature:

```javascript
const { Hono } = require('hono');
const { rateLimit } = require('webspresso');

const app = new Hono();
const limiter = rateLimit({ limit: 100, window: '1m' });

app.use('*', (c, next) => limiter(c, next));
```

---

## ⚙️ Options Reference

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `limit` / `max` | `number` | `60` | Maximum number of allowed requests within the time window. |
| `window` / `windowMs`| `string\|number` | `'1m'` | Window duration in ms or string shorthand (`'500ms'`, `'10s'`, `'1m'`, `'1h'`, `'1d'`). |
| `store` | `RateLimitStore` | `MemoryRateLimitStore` | Underlying storage engine. Defaults to sliding window in-memory store. |
| `keyGenerator` | `(req) => string` | `extractClientIp` | Function to identify client. Extracts Cloudflare, X-Forwarded-For, or socket IP by default. |
| `skip` | `(req) => boolean` | `() => false` | Condition to skip rate limiting (e.g. internal healthchecks). |
| `standardHeaders` | `boolean` | `true` | Send standard RFC headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy`). |
| `legacyHeaders` | `boolean` | `false` | Send legacy `X-RateLimit-*` headers. |
| `skipFailedRequests` | `boolean` | `false` | When `true`, failed requests (`statusCode >= 400`) decrement hit count upon finish. |
| `skipSuccessfulRequests`| `boolean` | `false` | When `true`, successful requests (`statusCode < 400`) decrement hit count upon finish. |
| `statusCode` | `number` | `429` | HTTP status code returned when limit is exceeded. |
| `message` | `string\|object` | `{ error: 'Too Many Requests', ... }` | Response payload on limit exceeded. |
| `handler` | `Function` | `null` | Custom callback when limit is exceeded `(req, res, next, info) => void`. |

---

## 📡 HTTP Response Headers

When enabled, the rate limiter emits standard headers:

```http
HTTP/1.1 200 OK
RateLimit-Limit: 60
RateLimit-Remaining: 58
RateLimit-Reset: 42
RateLimit-Policy: 60;w=60
```

When the limit is exceeded (HTTP 429 Too Many Requests):

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
RateLimit-Limit: 60
RateLimit-Remaining: 0
RateLimit-Reset: 42
RateLimit-Policy: 60;w=60
Content-Type: application/json

{"error":"Too Many Requests","message":"Too many requests, please try again later.","statusCode":429}
```

---

## 🛡️ Reverse Proxy & Client IP Extraction

`extractClientIp(req)` extracts client IP in the following priority order:
1. `req.ip` (Express `trust proxy`)
2. `CF-Connecting-IP` (Cloudflare)
3. `Fastly-Client-IP` / `True-Client-IP` (Fastly / Akamai)
4. `X-Forwarded-For` (First client IP in comma-separated list)
5. `X-Real-IP` (Nginx / HAProxy)
6. `socket.remoteAddress` (Normalized IPv4 / IPv6)
7. Fallback `127.0.0.1`
