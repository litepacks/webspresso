# Webspresso HTTP Response Compression Guide

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## 1. Overview

Webspresso provides a zero-dependency, streaming-first HTTP response compression layer built entirely with native `node:zlib`. It transparently compresses compressible responses (HTML, JSON, JS, CSS, SVG, XML) using Brotli (`br`), Gzip (`gzip`), or Deflate (`deflate`).

---

## 2. Configuration

Compression is disabled by default to avoid unnecessary CPU overhead. Enable via `createApp`:

```js
const { app } = createApp({
  pagesDir: './pages',
  server: {
    compression: true, // Enables default 1 KB threshold with Brotli + Gzip
  },
});
```

### Advanced Options:
```js
const { app } = createApp({
  pagesDir: './pages',
  server: {
    compression: {
      threshold: 2048,           // Only compress responses >= 2 KB (default: 1024)
      encodings: ['br', 'gzip'], // Algorithm preference
      level: 6,                  // Compression level (1-9)
      filter: (req, res) => {
        if (req.path.startsWith('/downloads')) return false;
        return true;
      },
    },
  },
});
```

---

## 3. Route-Level Opt-out

Individual routes can opt-out of compression (e.g. to mitigate BREACH attacks or for already-compressed dynamic payloads):

```js
// pages/api/sensitive-export.get.js
module.exports = async function handler(req, res) {
  res.compress(false); // Disables compression for this response

  res.json({
    secretToken: 'xyz-secret-token',
  });
};
```
