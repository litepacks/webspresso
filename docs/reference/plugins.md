---
title: Plugin Ecosystem
description: Official built-in Webspresso plugins, lifecycle hooks, named middleware registration, and configuration overview.
---

# Plugin Ecosystem

Webspresso applications extend through modular plugins with lifecycle hooks (`register`, `onRoutesReady`), Express routes, Nunjucks helpers, and CSP directives.

```javascript
const { createApp } = require('webspresso');
const { adminPanelPlugin, polarPlugin, rateLimitPlugin } = require('webspresso/plugins');

createApp({
  db,
  plugins: [
    rateLimitPlugin(),
    adminPanelPlugin({ db }),
    polarPlugin({ db }),
  ],
});
```

---

## Plugin lifecycle

| Phase | Hook | Use for |
|-------|------|---------|
| Register | `register(ctx)` | Global middleware, Nunjucks filters, named route middleware |
| Routes ready | `onRoutesReady(ctx)` | Mount Express routes via `ctx.addRoute()` |

Named middleware registered on `ctx.middlewares` is available in file routes:

```javascript
// pages/api/secret.get.js
module.exports = {
  middleware: [['basicAuth', { users: { admin: 'secret' } }]],
  handler(req, res) { /* ... */ },
};
```

---

## Official plugins

| Plugin | Purpose | Guide |
|--------|---------|-------|
| `adminPanelPlugin` | Mithril.js CRUD admin SPA | [Admin Panel](/guides/admin-panel) |
| `polarPlugin` | Polar.sh billing (checkout, webhooks) | [Polar Billing](/guides/polar-billing) |
| `rateLimitPlugin` | Named + global rate limiters | — |
| `emailPlugin` | MJML + Nodemailer | — |
| `uploadPlugin` | Multipart file uploads | — |
| `fileManagerPlugin` | Filesystem media library & asset picker | — |
| `contentPlugin` | Headless CMS | — |
| `restResourcePlugin` | Auto REST CRUD from models | — |
| `corsPlugin` | CORS handler | — |
| `csrfPlugin` | CSRF tokens | — |
| `basicAuthPlugin` | HTTP Basic Auth | — |
| `redirectPlugin` | HTTP redirects | — |
| `healthCheckPlugin` | Liveness probe | — |
| `realtimePlugin` | WebSocket / SSE / Socket.IO | — |
| `siteAnalyticsPlugin` | Self-hosted analytics | — |
| `auditLogPlugin` | Admin audit trail | — |
| `dataExchangePlugin` | Admin CSV/XLSX import/export | — |
| `swaggerPlugin` | OpenAPI + Swagger UI | — |
| `recaptchaPlugin` | reCAPTCHA verification | — |
| `sitemapPlugin` | sitemap.xml / robots.txt | — |

Import from `require('webspresso/plugins')`. Full source lives under `plugins/` in the repository.

---

## Composition tips

- Register `rateLimitPlugin` before `polarPlugin` when using Polar billing rate limits.
- Register `uploadPlugin` before `adminPanelPlugin` for file upload fields.
- Register `adminPanelPlugin` before admin-dependent plugins (`dataExchangePlugin`, `emailPlugin`, etc.).
- Pass `createApp({ db })` when using ORM-backed plugins.
