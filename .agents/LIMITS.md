# Configurable Payload Size Limits & DoS Protection (`core/limits`)

Webspresso provides a built-in, configurable request body size limiter and Denial of Service (DoS) protection layer. It safeguards Node.js memory against payload exhaustion attacks while supporting per-route overrides, streaming bypass, and native raw body capture for HMAC webhook verification.

---

## 🎯 Key Capabilities

1. **Multi-Parser Configuration**:
   - `json`: Size limit for `application/json` (default: `'1mb'`).
   - `urlencoded`: Size limit for `application/x-www-form-urlencoded` (default: `'1mb'`).
   - `parameterLimit`: Maximum number of URL-encoded form parameters (default: `1000`).
   - `raw`: Size limit for `application/octet-stream` (default: `false` / disabled).
   - `text`: Size limit for `text/plain` (default: `false` / disabled).
2. **Standard Exception Mapping**:
   - Limit exceeded -> Throws `PayloadTooLargeError` (HTTP 413) with `{ limit, length, expected }` details and `code: 'PAYLOAD_TOO_LARGE'`.
   - Parameter exhaustion -> Throws `PayloadTooLargeError` (HTTP 413) with `code: 'PARAMETERS_TOO_MANY'`.
   - Malformed JSON -> Throws `BadRequestError` (HTTP 400) with `code: 'INVALID_JSON_PAYLOAD'`.
3. **Webhook & HMAC Signature Verification**:
   - `captureRawBody: true` stores incoming unparsed `Buffer` on `req.rawBody` for zero-overhead cryptographic signatures (Polar, Stripe, LemonSqueezy, GitHub).
4. **Route Overrides & Streaming Bypass**:
   - `limits.routes`: Generous limits for specific paths (e.g. `/api/upload` -> 25MB) without loosening server-wide protection.
   - `limits.exclude`: Completely skips global body parsers for streaming and custom multipart endpoints.

---

## 🚀 Configuration Examples

### 1. Global Configuration

```javascript
const { createApp } = require('webspresso');

const app = createApp({
  pagesDir: 'pages',
  limits: {
    json: '2mb',           // 2 Megabytes for JSON
    urlencoded: '1mb',     // 1 Megabyte for Forms
    parameterLimit: 2000,  // Up to 2000 parameters
    raw: '10mb',           // Enable raw buffer parsing for binary data
    captureRawBody: true,  // Automatically populate req.rawBody
  },
});
```

Shorthand (applies to both JSON and URL-encoded):
```javascript
const app = createApp({
  pagesDir: 'pages',
  limits: '5mb', // Both json and urlencoded set to 5 MB
});
```

### 2. Route Overrides & Exclusions

```javascript
const app = createApp({
  pagesDir: 'pages',
  limits: {
    json: '500kb', // Tight global limit for standard APIs
    routes: {
      '/api/import/json': { json: '25mb' }, // Relaxed limit for batch import
      '/api/webhooks/*': { raw: '5mb', captureRawBody: true },
    },
    exclude: [
      '/api/stream/upload', // Skip global body parser entirely for socket streaming
    ],
  },
});
```

### 3. Webhook Signature Verification with `req.rawBody`

```javascript
// pages/api/webhooks/polar.post.js
const crypto = require('crypto');
const { defineApi, UnauthorizedError } = require('webspresso');

module.exports = defineApi({
  handler: async (req, res) => {
    const signature = req.headers['webhook-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.POLAR_WEBHOOK_SECRET)
      .update(req.rawBody) // Native Buffer captured via captureRawBody
      .digest('hex');

    if (signature !== expected) {
      throw new UnauthorizedError('Invalid signature');
    }

    return res.json({ received: true });
  },
});
```

---

## 🛡️ Standalone Middleware Usage

For manual route mounting or custom Express routers:

```javascript
const { createLimitsMiddleware } = require('webspresso');

// Mount on custom router or endpoint
app.post('/custom-endpoint', createLimitsMiddleware({ json: '50mb' }), (req, res) => {
  res.json({ size: req.body.length });
});
```
