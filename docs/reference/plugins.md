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

## Official plugins (34 Built-in Plugins)

| Plugin | Purpose | Guide / Reference |
|--------|---------|-------------------|
| `adminPanelPlugin` | Mithril.js CRUD admin SPA with user & role management | [Admin Panel](/guides/admin-panel) |
| `polarPlugin` | Polar.sh subscription billing, checkouts, and customer state sync | [Polar Billing](/guides/polar-billing) |
| `rateLimitPlugin` | Named route rate limiters and global DDoS throttling | — |
| `emailPlugin` | MJML template compilation, Nodemailer transport & delivery log | — |
| `uploadPlugin` | Multipart uploads with Local, S3, R2, and GCS storage providers | — |
| `fileManagerPlugin` | Filesystem media library, directory tree & modal asset picker | — |
| `contentPlugin` | Schema-driven headless CMS with inline page editing | — |
| `restResourcePlugin` | Zero-boilerplate RESTful CRUD API generated from ORM models | — |
| `corsPlugin` | Declarative Cross-Origin Resource Sharing handler | — |
| `csrfPlugin` | CSRF token defense supporting cookie and session modes | — |
| `basicAuthPlugin` | RFC 7617 HTTP Basic Authentication with named route middleware | — |
| `apiKeyPlugin` | B2B Developer API Key manager with SHA-256 and wildcard scopes | — |
| `webhooksPlugin` | Outgoing Webhooks with HMAC-SHA256 signatures and exponential retries | — |
| `oauthPlugin` | OAuth 2.0 social login client (Google, GitHub, Discord, Apple, etc.) | — |
| `rlsPlugin` | Dynamic model Row-Level Security (RLS) with tenant and user scoping | — |
| `redirectPlugin` | Declarative HTTP 301–308 URL redirects with method filtering | — |
| `healthCheckPlugin` | Lightweight `/health` HTTP probe for load balancers and monitors | — |
| `realtimePlugin` | Unified WebSocket, SSE, and Socket.IO realtime layer with Redis Pub/Sub | — |
| `queuePlugin` | Background worker queue bridge connecting jobs to server lifecycle | — |
| `siteAnalyticsPlugin` | Self-hosted privacy-friendly page view analytics & JS error tracker | — |
| `analyticsPlugin` | Tag & snippet injector for GA4, GTM, Yandex.Metrika, Bing, Meta | — |
| `seoCheckerPlugin` | In-browser client-side SEO analysis and diagnostics panel | — |
| `sitemapPlugin` | Dynamic XML sitemap generator (`/sitemap.xml`) & `robots.txt` responder | — |
| `auditLogPlugin` | Mutation audit trail for ORM models and Admin staff actions | — |
| `dataExchangePlugin` | Admin CSV/XLSX bulk import and Excel export engine | — |
| `xlsxPlugin` | Excel XLSX file generator, parser, and streaming model export | — |
| `csvPlugin` | RFC 4180 CSV generator, parser, formula sanitizer & streaming export | — |
| `swaggerPlugin` / `openapiPlugin` | Automated OpenAPI 3.0 generator with Swagger UI & Scalar playground | — |
| `schemaExplorerPlugin` | Interactive database schema & ER diagram visualizer | — |
| `ormCacheAdminPlugin` | In-memory cache inspection and invalidation dashboard | — |
| `dashboardPlugin` / `devToolbarPlugin` | Development toolbar with diagnostics and query inspection | — |
| `mcpPlugin` | Model Context Protocol (MCP) server exposing tools and resources | — |
| `recaptchaPlugin` | Google reCAPTCHA v2 checkbox & v3 invisible score verification | — |
| `lazyPlugin` / `defineLazyPlugin` | On-demand JIT plugin hydration wrapper for faster cold starts | — |

Import from `require('webspresso/plugins')`. Full source lives under `plugins/` in the repository.

---

## Composition tips

- Register `rateLimitPlugin` before `polarPlugin` when using Polar billing rate limits.
- Register `uploadPlugin` before `adminPanelPlugin` for file upload fields.
- Register `adminPanelPlugin` before admin-dependent plugins (`dataExchangePlugin`, `emailPlugin`, etc.).
- Pass `createApp({ db })` when using ORM-backed plugins.
