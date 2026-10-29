# Webspresso Plugin Ecosystem Guide

Webspresso applications are extended through a modular plugin architecture. Plugins hook into framework lifecycle events (`register(ctx)`, `onRoutesReady(ctx)`), mount Express routes, register Nunjucks template helpers, and supply Content-Security-Policy (CSP) headers.

---

## 1. Plugin Lifecycle & Anatomy

A Webspresso plugin is an object or factory function returning a plugin contract:

```js
export function myCustomPlugin(options = {}) {
  return {
    name: 'my-custom-plugin',
    version: '1.0.0',
    dependencies: [], // Optional dependent plugins
    csp: {
      scriptSrc: ["'self'", 'https://cdn.example.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },

    // 1. Register phase (before route mounting)
    register(ctx) {
      const { app, nunjucksEnv, options: appOptions, middlewares } = ctx;
      // Add Nunjucks filters or global middleware
      nunjucksEnv.addFilter('customFilter', (str) => str.toUpperCase());

      // Register named middleware for file routes: export const config = { middleware: ['myCustom'] }
      if (middlewares) {
        middlewares.myCustom = (routeOptions = {}) => (req, res, next) => {
          // Middleware logic...
          next();
        };
      }
    },

    // 2. On routes ready phase (after file-based routes mounted)
    onRoutesReady(ctx) {
      const { app, routes, db } = ctx;
      // Mount plugin-level Express routes
      app.get('/_my-plugin/status', (req, res) => res.json({ status: 'ok' }));
    },
  };
}
```

### 1.1 Named Middleware Registration via Plugins
Plugins can register route middlewares in `ctx.middlewares`:
- **Factory Registration**: `ctx.middlewares.basicAuth = (routeOpts) => createBasicAuthMiddleware(routeOpts)`
- **File Route Consumption**:
  ```js
  // pages/admin-only.njk or pages/api/secret.js
  export const config = {
    middleware: [
      'basicAuth', // Uses plugin defaults
      // or with options:
      ['basicAuth', { realm: 'Internal Area', users: { boss: 'secret' } }]
    ]
  };
  ```

---

## 2. Core & Official Plugins Reference

### 2.1 `basicAuthPlugin` (`plugins/basic-auth`)
Built-in HTTP Basic Authentication (RFC 7617) plugin with timing-safe equality checks (`crypto.timingSafeEqual`).
- **Options**:
  - `global`: Boolean, whether to protect the entire application.
  - `users`: Key-value map `{ username: 'password' }`.
  - `verify`: Async/sync custom verification function `(username, password, req) => boolean | userObject`.
  - `realm`: String for `WWW-Authenticate` header (default `'Restricted Area'`).
  - `challenge`: Boolean (default `true`), whether to send 401 challenge header.
  - `routes`: Array of route prefixes to protect when in global mode.
  - `skipPaths` / `skip`: Exclusion paths or predicate `(req) => boolean`.
  - `unauthorizedResponse`: Custom handler `(req, res) => ...` or message string/JSON.
  - `onAuthenticated`: Callback hook `(req, user) => ...`.
- **Named Middleware**: Registers `ctx.middlewares.basicAuth` for route files.

### 2.2 `apiKeyPlugin` (`plugins/api-key`)
Built-in B2B & Developer API Key Management Plugin with standard prefix format (`wsp_live_...`), SHA-256 secure hash storage, timing-safe constant-time verification (`crypto.timingSafeEqual`), granular scopes/permissions with wildcard support, non-blocking `last_used_at` usage tracking, and programmatic creation/revocation APIs.
- **Options**:
  - `db` / `knex`: Webspresso Database or Knex instance.
  - `tableName`: Database table name (default `'api_keys'`).
  - `prefix`: Default key prefix (default `'wsp_live_'`).
  - `byteLength`: Random byte count for key generation (default `24`).
  - `global`: Boolean, whether to protect routes globally (default `false`).
  - `routes`: Route prefix(es) to protect when `global: true`.
  - `skipPaths` / `skip`: Exclusion paths or predicate function `(req) => boolean`.
  - `keys`: Static in-memory keys for testing / serverless / simple setups (`[{ key, name, scopes }]` or map).
  - `trackUsage`: Boolean (default `true`), whether to automatically update `last_used_at` on verified keys.
  - `updateLastUsedThrottleMs`: Throttle period in ms to avoid DB write thrashing (default `60000`).
  - `allowQueryParam`: Boolean (default `false`), allow extracting API key via `?apiKey=...`.
  - `findKeyByHash` / `verify`: Custom key lookup or verification hook.
  - `getUser`: Custom async user resolver `(apiKeyRecord, req) => Promise<User | null>`.
  - `onAuthenticated`: Callback hook `(req, apiKeyRecord) => void`.
- **Named Middleware**:
  - `middleware: ['apiKey']`: Requires valid API key via `X-API-Key`, `api-key`, or `Authorization: Bearer <key>`.
  - `middleware: [['apiKey', { scopes: ['reports:read', 'orders:*'] }]]`: Enforces required granular scopes with prefix wildcard support (`*`, `namespace:*`).
  - `middleware: [['apiKey', { optional: true }]]`: Non-blocking authentication (populates `req.apiKey` if present, passes through if absent).
- **Request Context Injected**:
  - `req.apiKey`: The authenticated API key record (including name, key_hint, scopes, metadata).
  - `req.auth.apiKey`: Equivalent reference inside `req.auth`.
  - `req.auth.user` & `req.user`: Associated user record (if `user_id` or `getUser` resolved).
- **Programmatic API (`apiKeyPlugin.api`)**:
  - `generateKey(options)`: Generate fresh key with hash and masked hint (`wsp_live_...4f2a`).
  - `hashKey(rawKey)`: Compute SHA-256 hex string.
  - `maskKey(rawKey, prefix)`: Mask raw key for logs/UI.
  - `createApiKey(data, options)`: Generates key, hashes it, and stores in database table (returns raw key once).
  - `verifyApiKey(rawKey, options)`: Verify raw key against DB, checking expiration and revocation.
  - `revokeApiKey(idOrHash, options)`: Mark key as revoked in DB (`revoked_at = now()`).
  - `getMigrationTemplate(tableName)`: Knex migration script creating `api_keys` table.
  - `createApiKeyModel(tableName)`: Webspresso ORM model definition with hidden `key_hash`.

### 2.3 `webhooksPlugin` (`plugins/webhooks`)
Outgoing Webhook Dispatcher and Management Plugin. Dispatches events to subscribed external HTTP endpoints, signs payloads with HMAC-SHA256 (`X-Webspresso-Signature` and standard timestamped `webhook-signature`), filters events with wildcards (`*`, `order.*`), automatically retries failed deliveries using exponential backoff, hooks directly into Webspresso Queue (`core/queue`), and provides an interactive Mithril.js Admin Panel management UI.
- **Options**:
  - `db` / `knex`: Webspresso Database or Knex instance.
  - `endpointsTable`: Database table for endpoints (default `'webhook_endpoints'`).
  - `deliveriesTable`: Database table for delivery logs (default `'webhook_deliveries'`).
  - `maxAttempts`: Maximum retry attempts on delivery failure (default `3`).
  - `backoffBaseMs`: Base delay for exponential backoff in milliseconds (default `1000`).
  - `timeoutMs`: HTTP request timeout in milliseconds (default `10000`).
  - `wrapPayload`: Boolean (default `true`), wrap data in standard `{ id, event, timestamp, data }` event envelope.
  - `queue`: Custom `QueueManager` instance (auto-detected from `ctx.app.queue` if present).
  - `endpoints`: Static in-memory endpoints array (useful for testing or serverless setups).
  - `apiPrefix`: Admin REST API prefix (default `'/webhooks'`).
  - `includeDefaultPage`: Register Admin UI page and sidebar menu item (default `true`).
  - `pageTitle`: Admin page title (default `'Webhooks'`).
  - `menuOrder`: Admin sidebar order (default `92`).
- **Request & Application Context Injected**:
  - `req.webhooks`: Direct reference to the `WebhookDispatcher` instance.
  - `app.webhooks`: Direct reference on the Webspresso Application instance.
- **Built-in Services Registered**:
  - `'webhook.dispatch'`: Dispatch events via `ctx.service('webhook.dispatch', { event, payload })`.
  - `'webhook.ping'`: Test endpoint connectivity via `ctx.service('webhook.ping', { endpointId })`.
  - `'webhook.retry'`: Manually retry a delivery via `ctx.service('webhook.retry', { deliveryId })`.
- **Programmatic API (`webhooksPlugin.api` / `dispatcher`)**:
  - `dispatch(event, payload, options)`: Match endpoints and deliver payload asynchronously (or await with `wait: true`).
  - `pingEndpoint(endpointId)`: Send a test `ping` event to verify destination connectivity.
  - `retryDelivery(deliveryId)`: Re-send a failed delivery with incremented attempt count.
  - `createEndpoint(data)`: Register a new webhook endpoint with custom or auto-generated `whsec_` secret.
  - `updateEndpoint(id, data)` / `deleteEndpoint(id)`: Update or delete endpoint records.
  - `listEndpoints(filters)`: List endpoints with delivery statistics.
  - `listDeliveries(filters)`: Query delivery logs with filtering by endpoint, event, and success status.
  - `purgeDeliveries(options)`: Purge logs older than specified retention days.
  - `signPayload(payload, secret, options)`: Compute HMAC-SHA256 signature (`sha256=...` and `t=...,v1=...`).
  - `verifySignature(payload, header, secret, options)`: Constant-time signature verification with drift tolerance.
  - `getMigrationTemplate()`: Knex migration script for `webhook_endpoints` and `webhook_deliveries`.
  - `getModels()`: Webspresso ORM model definitions for `WebhookEndpoint` and `WebhookDelivery`.

### 2.4 `adminPanelPlugin` (`plugins/admin-panel`)
Mithril.js SPA Admin Panel mounted at `/_admin`.
- **Options**: `{ path: '/_admin', db, title: 'Webspresso Admin', lazy: false }`
- **Features**: Auto CRUD screens for ORM models, user staff auth, custom page registration, widgets, field renderers.
- **On-Demand Hydration (`lazy: true`)**: When set to `true`, the admin panel plugin wraps itself with `lazyPlugin()`, deferring route mounting and internal setup until the first HTTP request hits `/_admin`.

### 2.5 `contentPlugin` (`plugins/content`)
Schema-driven headless CMS & inline content editing.
- **Options**: `{ db, adminPath: '/_admin', inlineEdit: true }`
- **Features**: Dynamic content types & entries, public API (`/api/content/:type/:slug`), visual inline editor widget.

### 2.6 `uploadPlugin` (`plugins/upload`)
Multipart file upload manager with local disk, AWS S3, Google Cloud Storage (GCS), and Cloudflare R2 drivers.
- **Options**: `{ path: '/api/upload', provider, local: { destDir, publicBasePath }, maxBytes: 10000000, mimeAllowlist: ['image/png', 'image/jpeg'], presigned: true, presignedRoute: '/api/upload/presign' }`
- **Supported Storage Drivers**:
  - `createLocalFileProvider({ destDir, publicBasePath })`: Local disk storage (monolith / VPS).
  - `createS3FileProvider({ s3Client, bucket, publicBaseUrl, prefix })`: AWS S3, MinIO, or S3-compatible endpoints with direct presigned PUT URLs (`createSignedUploadUrl`).
  - `createGcsFileProvider({ bucket, storageClient, publicBaseUrl, prefix })`: Google Cloud Storage with V4 signed URLs for serverless direct uploads.
  - `createR2FileProvider({ bucket, publicBaseUrl, prefix })`: Cloudflare Workers native R2 binding.
- **Direct-to-Cloud Presigned Uploads**: Set `presigned: true` to mount `POST /api/upload/presign`, allowing web browsers to upload directly to S3 or GCS without passing large payloads through memory-limited or ephemeral containers.
- **Static Asset Sync**: `webspresso assets:sync [--bucket <name>] [--provider s3|gcs|r2] [--dry-run]` to upload compiled JS/CSS bundles to cloud storage with `Cache-Control: public, max-age=31536000, immutable`.
- **Orphan Pruning**: `scanOrphanedUploads({ db, destDir })` and `pruneOrphanedUploads({ db, destDir, dryRun })` to detect and remove disk files no longer referenced by any database model, accompanied by CLI command `webspresso upload:prune [--dry-run]`.



### 2.7 `fileManagerPlugin` (`plugins/file-manager`)
Filesystem-first media library, directory explorer, and modal asset picker for Admin Panel with image editing, code editing, batch ZIP ops, keyboard navigation, and storage quota visualization.
- **Options**: `{ baseDir: './public/uploads', publicBasePath: '/uploads', apiPrefix: '/files', pageTitle: 'File Manager', maxUploadBytes: 10485760, maxTotalStorageBytes: 1073741824, storageBreakdown: true, allowedExtensions, allowedMimeTypes, includePage: true, lazy: false }`
- **Features**:
  - **Directory Navigation & Safe Operations:** Breadcrumbs, safe subfolder creation (`mkdir`), item rename, delete, and move with path traversal attack protection (`resolveSafePath`).
  - **Grid & List Views:** Thumbnail gallery and detailed metadata table view modes.
  - **Image Transformation Suite:** Client-side HTML5 Canvas crop presets (`1:1`, `16:9`, `4:3`, `Free`), 90° rotation, flip H/V, dimension scaling, and WebP/original format export.
  - **Syntax-Aware Code & Text Editor:** In-browser modal editor with line numbers gutter, JSON validation & prettification, syntax badge indicator, and unsaved changes warning.
  - **Full-Surface Drag-and-Drop:** Backdrop-blur dropzone overlay on drag-over, real-time XHR byte/percentage progress bar, and request cancellation.
  - **Multi-Selection & Batch Operations:** Grid/list checkboxes, Select All toggle, floating batch toolbar, native zero-dependency PKWARE ZIP archive packaging & download, batch move, and batch delete.
  - **Keyboard Shortcuts & Rapid Navigation:** Arrow key focus navigation with visual ring highlighting, macOS Finder-style `Space` Quick Look preview, `Cmd+A` select all, `X` toggle select, `R`/`E`/`Delete` inline actions, `/` quick search, and `?` cheatsheet modal.
  - **Storage Usage & Quota Visualizer:** Multi-tier quota meter (Emerald < 75%, Amber 75-90%, Red > 90%), 15-second TTL in-memory disk cache, and 6-category breakdown (Images, Documents, Code, Media, Archives, Other) with manual reload (`🔄`).
  - **Media Library Asset Picker:** Integrated with `FileUploadField` and `zdb.file({ admin: { picker: true } })` form fields.
  - **On-Demand Hydration:** JIT plugin loading via `lazy: true`.
  - **Built-in Services:** `fileManager.list`, `fileManager.mkdir`, `fileManager.rename`, `fileManager.delete`, `fileManager.move`, `fileManager.upload`, `fileManager.saveContent`, `fileManager.saveImage`, `fileManager.batchDelete`, `fileManager.batchMove`, `fileManager.createZip`, `fileManager.getStorageStats`.
  - **Screenshots & Guide:** See [`docs/guides/file-manager.md`](../docs/guides/file-manager.md) and [`docs/assets/screenshots/file-manager/`](../docs/assets/screenshots/file-manager/).

### 2.8 `corsPlugin` (`plugins/cors`)
Built-in Cross-Origin Resource Sharing (CORS) handler.
- **Options**: `{ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], credentials: true, maxAge: 86400 }`
- **Features**: Native header management, preflight OPTIONS handling.

### 2.9 `csrfPlugin` (`plugins/csrf`)
Cross-Site Request Forgery token validation with cookie/session storage and Nunjucks template helpers (`csrfToken()`, `csrfInput()`).
- **Options**: `{ mode: 'session' | 'cookie', cookie?: boolean | object, sessionKey?: string, methods?: string[], ignorePaths?: (string|RegExp|Function)[], global?: boolean, errorMessage?: string, errorStatus?: number }`
- **Features**: Double-submit cookie or session-backed token verification, `req.csrfToken()` injection, constant-time safe comparison.

### 2.10 `redirectPlugin` (`plugins/redirect`)
HTTP 301–308 URL redirect manager.
- **Options**: `{ rules: [{ from: '/old-path', to: '/new-path', status: 301 }] }`

### 2.11 `rateLimitPlugin` (`plugins/rate-limit`)
Request rate limiting using express-rate-limit logic.
- **Options**: `{ windowMs: 15 * 60 * 1000, max: 100 }`

### 2.12 `siteAnalyticsPlugin` (`plugins/site-analytics`)
Self-hosted privacy-focused page view analytics, client error tracking, and automated retention cleanup.
- **Options**:
  - `db`: Knex database instance.
  - `tableName`: Table name for page views (default: `'analytics_page_views'`).
  - `errorsTableName`: Table name for client errors (default: `'analytics_client_errors'`).
  - `retentionDays`: Page views retention window in days (default: `90`).
  - `errorRetentionDays`: Client error logs retention window in days (default: `30`).
  - `cleanupIntervalMs`: Background scheduled cleanup interval in milliseconds (default: `86400000` / 24 hours).
  - `autoCleanup`: Enable automated periodic background cleanup (default: `true`).
  - `cleanupOnStart`: Run an initial non-blocking cleanup shortly after startup (default: `true`).
  - `retention`: Shorthand object `{ enabled, days, errorDays, intervalMs, runOnStart }` or `false` to disable retention cleanup.
  - `excludePaths`, `excludeBots`, `customBots`, `anonymizeIp`, `trustProxy`, `collectErrors`, `dashboard`.
- **Programmatic API (`plugin.api`)**:
  - `purge({ days, errorDays, olderThan, errorsOlderThan })`: Manual purge of page views and error logs.
  - `purgeAnalyticsData(knex, options)`: Standalone query purge helper.
  - `startCleanup(intervalMs)` / `stopCleanup()`: Control background cleanup lifecycle.
  - `getRetentionConfig()`: Inspect active retention configuration.
- **Admin REST Endpoint**: `POST /_admin/api/analytics/purge` (accepts `{ days, errorDays }`).
- **Admin UI**: "Purge Old Data" button with confirmation prompt in the Analytics admin dashboard header.
- **CLI Command**:
  ```bash
  webspresso analytics:prune --days 90 --error-days 30
  ```
- **Lifecycle Integration**: Background timer uses `.unref()` to avoid keeping Node event loop open, and registers a framework disposer to clear timers on shutdown.

### 2.13 `emailPlugin` (`plugins/email`)
Transactional email compiler (MJML) & Nodemailer transport integration with database delivery logging and auto-retention cleanup.
- **Options**:
  - `transport` / `smtp`: Nodemailer transport or SMTP settings.
  - `defaults`: Default sender/reply-to address.
  - `templatesDir`: Directory containing `.mjml` templates.
  - `logToDb`: Store delivery history in database (default `true` when `db` is supplied).
  - `tableName`: Database table name (default `'email_logs'`).
  - `retentionDays`: Days to retain email logs (default `90`).
  - `cleanupIntervalMs`: Background cleanup timer frequency (default 24h).
  - `autoCleanup`: Enable scheduled background purge (default `true`).
  - `cleanupOnStart`: Run initial purge shortly after boot (default `true`).
  - `retention`: `{ enabled, days: 90, intervalMs: 86400000, runOnStart: true }` (or `false` to disable).
- **Pruning CLI**:
  ```bash
  webspresso email:prune --days 90
  ```
- **Admin Panel UI & Delivery Engine**:
  - **Delivery Logs Suite:** Real-time search across recipients, subject, and template; status filter (`sent`/`failed`); modal error traceback viewer; and 1-click retry/resend.
  - **Live Responsive Template Previewer:** Desktop (`680px`), Mobile (`375px` phone bezel), Fluid (`100%`) viewport modes; HTML vs Plain text tabs; sample JSON live editor; and quick test send.
  - **Manual Test Sender:** Full addressing form with CC/BCC inputs.
  - **SMTP Diagnostics:** Handshake tester measuring round-trip connection latency in milliseconds.
- **Built-in Services:** `mail.send`, `mail.preview`, `mail.get-log`, `mail.resend`, `mail.verify`.
- **Guide & Visuals:** See [Email Suite Guide](docs/guides/email.md) and [`.agents/EMAIL.md`](EMAIL.md).


### 2.14 `polarPlugin` (`plugins/polar`)
Polar.sh subscription billing — checkout, customer portal, webhooks, Customer State sync, tier columns. Pure native implementation (`crypto` + `fetch`).

- **Import paths** (via `package.json` exports — no `/index.js` suffix):
  ```js
  const { polarPlugin, rateLimitPlugin } = require('webspresso/plugins');
  const { quickAuth } = require('webspresso/core/auth');
  const { createWebhookRawBodyMiddleware } = require('webspresso/plugins/polar/src/webhooks');
  const { mergePolarCspDirectives } = require('webspresso/plugins/polar/src/urls');
  ```
- **Wiring** (rate limit **before** polar):
  ```js
  plugins: [
    rateLimitPlugin(),
    polarPlugin({ db, plans, tierMapping, rateLimit: true }),
  ]
  ```
- **Options**: `{ db, userModel, userTable, plans, tierMapping, routes, urls, fields, hooks, syncMiddleware, syncBeforeCheckout, rateLimit, requireAuth }`
- **Rate limit**: Per-route limiters when `rateLimitPlugin` is loaded first. Uses `express-rate-limit` v8 `ipKeyGenerator` (never raw `req.ip`). Defaults: webhook 120/min (IP), checkout 5/min, portal 10/min, status 60/min (user id or IP).
- **Auto routes**: webhook (`POST`), checkout (`GET`/`POST`), portal (`GET`), status (`GET`)
  - **POST checkout**: HTML `<form method="post">` — needs CSP `form-action 'self'` (included in `polarCspDirectives()`)
  - **GET checkout**: simple `<a href="…">` link — fewer CSP constraints
- **External tier tables** (when paid status is not on `users.tier`):
  ```js
  polarPlugin({
    db,
    syncBeforeCheckout: false,
    hooks: {
      async isPaidUser({ user, knex }) {
        const sub = await knex('subscriptions').where('user_id', user.id).first();
        return sub?.plan_tier === 'pro';
      },
      async onSubscriptionChange({ user, tier, knex, update }) {
        await knex('subscriptions').where('user_id', user.id).update({ plan_tier: tier });
        return knex('users').where('id', user.id).update(update);
      },
    },
  })
  ```
  Legacy hook signature `(user, knex, config)` still supported when declared with 2+ parameters.
- **Webhook user lookup**: `metadata.user_id` is sent as a **string** (nanoid/UUID safe; numeric ids also work).
- **CSP**: Plugin `csp` export is **union-merged** by plugin manager (does not replace Helmet). `polarCspDirectives()` includes `'self'` + Polar domains. Use `mergePolarCspDirectives(existing)` for manual Helmet config.
- **CLI**: `webspresso polar:migrate` — idempotent billing columns migration
- **SDK** (`plugin.api`): `verifyPolarWebhook`, `syncPolarBillingForUser`, `syncBillingForAppUser`, `getPolarCheckoutUrl`, `getPolarPortalUrl`, `handlePolarWebhookEvent`, `resolveUserFromPolarData`, `generateMigration`, `parseEnv`, `polarCspDirectives`, `mergePolarCspDirectives`, `createWebhookRawBodyMiddleware`
- **Guides**:
  - [docs/guides/polar-billing.md](../docs/guides/polar-billing.md)
  - [docs/guides/polar-production-checklist.md](../docs/guides/polar-production-checklist.md)

### 2.15 `auditLogPlugin` (`plugins/audit-log`)
Admin mutation tracking, record change timeline, and audit history with scheduled retention and manual purge API.
- **Options**:
  - `db`: Database instance (must expose `.knex`).
  - `tableName`: Database table name (default `'audit_logs'`).
  - `registerRecordAction`: Register built-in "Timeline" action on all admin models (default `true`).
  - `retentionDays`: Days to retain audit trail entries (default `90`).
  - `cleanupIntervalMs`: Background cleanup timer frequency (default 24h).
  - `autoCleanup`: Enable scheduled background purge (default `true`).
  - `cleanupOnStart`: Run initial purge shortly after boot (default `true`).
  - `retention`: `{ enabled, days: 90, intervalMs: 86400000, runOnStart: true }` (or `false` to disable).
- **Timeline UI Features**:
  - **Dual Mode**: Switch seamlessly between **Timeline View** and **Table View**.
  - **Record Focus Mode**: Clicking any `Model #ID` tag instantly filters and displays that specific record's revision timeline.
  - **Visual Spine & Status Icons**: Color-coded action nodes for `create` (emerald +), `update` (blue ✏️), `delete` (rose 🗑️), and `restore` (amber ↺).
  - **Changed Fields Diff**: Clearly lists modified fields (e.g. `title`, `price`) on every update event.
  - **Expandable Details**: Inspect full HTTP request path, actor IP, user agent, and pretty-printed JSON metadata.
  - **Built-in Record Action**: One-click "Timeline" button on record lists and edit forms jumps straight to that record's audit history.
- **API & Admin Panel Endpoints**:
  - `GET /_admin/api/audit-logs`: List paginated logs with filters (`model`, `recordId`, `action`, `search`, `from`, `to`).
  - `GET /_admin/api/audit-logs/timeline/:model/:id`: Dedicated chronological record change timeline with summary stats.
  - `POST /_admin/api/audit-logs/purge`: `{ days: 90 }` or `{ olderThan: '2026-01-01' }`.
- **Programmatic Plugin API**:
  ```javascript
  const audit = ctx.usePlugin('audit-log');
  const history = await audit.queryTimeline('Post', 42);
  const logs = await audit.queryLogs({ model: 'User', action: 'delete' });
  ```
- **Pruning CLI**:
  ```bash
  webspresso audit:prune --days 90
  ```

### 2.16 `ormCacheAdminPlugin` (`plugins/orm-cache-admin`)
ORM Cache inspection and invalidation dashboard.

### 2.17 `schemaExplorerPlugin` (`plugins/schema-explorer`)
Interactive Database Schema & ER Diagram Explorer for both raw JSON/OpenAPI endpoints and Admin Panel SPA.
- **Admin Panel Page (`/_admin/schema`)**:
  - Interactive Table & Column details (Primary Keys, Foreign Keys, Nullability, Types, Constraints, Scopes).
  - Visual Relationship Map (ER Diagram) with bidirectional incoming & outgoing relation links.
  - Interactive table cards highlighting connected models and key mappings (`posts.author_id ➔ authors.id`).
  - One-click Mermaid.js ER diagram code generation and copy.
  - JSON schema export.
- **Options**:
  - `admin: true` — Automatically registers into `adminPanelPlugin` when present.
  - `adminPath: '/schema'` — Custom path inside Admin Panel.
  - `menuLabel: 'Schema Explorer'` — Sidebar menu label.
  - `menuIcon: 'database'` — Sidebar icon.
  - `path: '/_schema'` — Raw JSON endpoint path.
  - `exclude: ['SecretModel']` — Models to exclude.
- **Usage**:
  ```js
  const { createApp } = require('webspresso');
  const { adminPanelPlugin, schemaExplorerPlugin } = require('webspresso/plugins');

  const { app } = createApp({
    plugins: [
      adminPanelPlugin({ db }),
      schemaExplorerPlugin({ admin: true }),
    ],
  });
  ```

### 2.18 `swaggerPlugin` / `openapiPlugin` (`plugins/swagger`)
Interactive OpenAPI 3.0 API documentation supporting both modern **Scalar API Reference** and classic **Swagger UI**, automated parameter/tag/summary inference, auth detection, Admin Panel embedding, and CLI export.

- **Options**:
  - `path`: Base path for documentation (default: `/_swagger`). Spec served at `{path}/openapi.json`.
  - `ui`: Default playground engine: `'swagger'` or `'scalar'` (default: `'swagger'`).
  - `theme`: Theme for Scalar UI (`'default'`, `'purple'`, `'moon'`, `'solarized'`, etc.).
  - `darkMode`: Scalar dark mode toggle (default: `true`).
  - `admin`: Auto-register inside Admin Panel (`/_admin/#!/api-docs`) when `admin-panel` plugin is loaded (default: `true`).
  - `adminTitle`: Admin navigation label (default: `'API Docs'`).
  - `includeOrmSchemas`: Merge ORM models into `components.schemas` (default: `false`).
  - `authorize`: Custom `(req) => boolean` guard function.
- **Endpoints**:
  - `GET /_swagger`: Primary UI (Scalar or Swagger based on `ui` option).
  - `GET /_swagger/scalar`: Always serves modern Scalar UI.
  - `GET /_swagger/swagger`: Always serves Swagger UI.
  - `GET /_swagger/openapi.json`: OpenAPI 3.0 specification document.
- **Example**:
  ```javascript
  const { createApp, openapiPlugin } = require('webspresso');

  const { app } = createApp({
    plugins: [
      openapiPlugin({
        ui: 'scalar',
        theme: 'purple',
        includeOrmSchemas: true,
      }),
    ],
  });
  ```

### 2.19 `realtimePlugin` (`plugins/realtime`, `core/realtime`)
Framework-agnostic, plugin-based, and adapter-driven Realtime layer supporting WebSocket, SSE, Socket.IO, and distributed Redis Pub/Sub transports with zero SSR execution hazards.

- **Architecture**:
  - `core/realtime`: Connection lifecycle, subscription registry (`identifier::params` composite keys), auth strategies, exponential backoff reconnect with jitter, and capability assertions.
  - `core/realtime/adapters`: `websocket`, `sse`, `socketIo`, `redis`.
  - `plugins/realtime`: Webspresso app integration and shutdown lifecycle management.

- **Examples**:

#### 1. Basic (WebSocket + Cookie Auth)
```js
const { createApp } = require('webspresso');
const { realtimePlugin, websocket } = require('webspresso/plugins');

const { app } = createApp({
  plugins: [
    realtimePlugin({
      adapter: websocket({ url: '/realtime' }),
      auth: { strategy: 'cookie' },
      autoConnect: true,
    }),
  ],
});
```

#### 2. Token Auth & Refresh
```js
const { realtime, websocket } = require('webspresso');

const client = realtime({
  adapter: websocket({ url: 'wss://api.example.com/realtime' }),
  auth: {
    strategy: 'token',
    getToken: async () => localStorage.getItem('token'),
    refreshToken: async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      const { token } = await res.json();
      localStorage.setItem('token', token);
      return token;
    },
    onUnauthorized: (err) => {
      window.location.href = '/login';
    },
  },
});
```

#### 3. Subscriptions & Messages
```js
const sub = app.realtime.subscribe('project:123', { role: 'editor' }, {
  connected() {
    console.log('Subscribed to project:123');
  },
  disconnected() {
    console.log('Temporarily disconnected');
  },
  received(data) {
    console.log('New update received:', data);
  },
  rejected(err) {
    console.error('Subscription denied:', err);
  },
});
```

#### 4. Perform Action & Send Data
```js
// Send raw data
sub.send({ text: 'Hello team!' });

// Perform named RPC action
sub.perform('user_typing', { userId: 42, isTyping: true });
```

#### 5. Cleanup & Unsubscribe
```js
// Unsubscribe single topic
sub.unsubscribe();

// Destroy entire realtime client and teardown socket connections
app.realtime.destroy();
```

#### 6. Reauthenticate Workflow
```js
// Trigger token refresh, disconnect, reconnect, and automatic subscription restore
await app.realtime.reauthenticate();
```

### 2.20 `restResourcePlugin` (`plugins/rest-resources`)
Zero-boilerplate RESTful CRUD endpoint generator directly from Knex ORM models, complete with relationship eager-loading (`?include=...`), pagination, sorting, column filtering, soft-delete scopes, and recursive hidden field sanitization.

- **Options**:
  - `path`: Base path prefix for REST routes (default: `'/api/rest'`).
  - `middleware`: Array of Express middleware executed prior to database resolution and endpoint handlers (e.g. `[authMiddleware]`).
  - `models`: Whitelist of model names to expose (bypasses `rest.enabled: true` requirement).
  - `excludeModels`: Array of model names to exclude.
  - `filter`: Custom predicate function `(modelDefinition) => boolean`.

- **Model Configuration (`defineModel`)**:
  ```js
  defineModel({
    name: 'User',
    table: 'users',
    schema: UserSchema,
    hidden: ['password_hash', 'internal_notes'],
    scopes: { softDelete: true, timestamps: true },
    relations: {
      company: { type: 'belongsTo', model: () => Company, foreignKey: 'company_id' },
      posts: { type: 'hasMany', model: () => Post, foreignKey: 'user_id' }
    },
    rest: {
      enabled: true,               // Opt-in flag (or use plugin models whitelist)
      path: 'users',               // Optional custom URL segment (default: pluralized name)
      allowInclude: ['company'],   // Allowed relations for ?include=
    }
  });
  ```

- **Generated RESTful Endpoints**:
  | Method | Path | Description | Query Parameters / Body |
  |---|---|---|---|
  | `GET` | `/api/rest/:resource` | Paginated list of records | `page`, `perPage`, `sort`, `order`, `include`, `trashed`, column filters |
  | `GET` | `/api/rest/:resource/:id` | Single record by primary key | `include` |
  | `POST` | `/api/rest/:resource` | Create new record (201 Created) | JSON body (writable columns only) |
  | `PATCH` | `/api/rest/:resource/:id` | Update record by ID | JSON body (writable columns only) |
  | `DELETE` | `/api/rest/:resource/:id` | Delete / Soft-delete by ID | N/A (Returns `{ success: true }`) |

- **Query Parameters**:
  - `page`: Page number (1-indexed, default `1`).
  - `perPage`: Items per page (default `15`, clamped between `1` and `100`).
  - `sort`: Multi-column sort supported via comma-separated list (`?sort=-price,created_at:asc`), array (`?sort[]=price:desc&sort[]=name:asc`), or single column (`?sort=price&order=desc`). Prepending `-` indicates descending, `+` indicates ascending.
  - `order`: `'asc'` or `'desc'` (default `'desc'`).
  - `include`: Comma-separated allowed relation names (e.g. `?include=company,profile`). Eager loads without N+1 query overhead. Disallowed or nested relations are safely ignored.
  - `trashed`: For soft-delete models, `'include'` queries active + deleted records; `'only'` queries exclusively soft-deleted records.
  - **Rich Column Filtering**: Direct query parameters or dedicated `filter` object with comprehensive SQL operators:
    - **Equality & Inequality**: `?status=active`, `?status[eq]=active`, `?status[ne]=banned`
    - **Comparison Ranges**: `?price[gte]=100&price[lte]=500`, `?age[gt]=18`, `?age[lt]=65`
    - **Set Membership**: `?status[in]=active,pending` (or `?status[in][]=active`), `?status[nin]=banned,deleted`
    - **String Pattern Matching**: `?name[contains]=phone`, `?sku[startsWith]=APL-`, `?email[endsWith]=@gmail.com`, `?name[like]=app%`
    - **Null Checks**: `?deleted_at[isNull]=true`, `?avatar[isNotNull]=true`
    - **Between Range**: `?price[between]=100,500`
    - **Dedicated Filter Object**: `?filter[name][contains]=phone&filter[price][gte]=100`

- **Security & Data Sanitization**:
  - **Hidden Fields**: Columns in `model.hidden` are stripped recursively across the primary record and all eager-loaded relations.
  - **Writable Columns**: `POST` and `PATCH` payloads are stripped of primary auto-increment keys, non-existent columns, and hidden fields before hitting the repository.
  - **Include Protection**: Only relations declared in `model.rest.allowInclude` (or all relations if omitted) can be eager-loaded. Dotted nested includes (`posts.comments`) are ignored to prevent denial-of-service / memory leaks.
  - **Parameterized Queries**: All filters and search operators are parameterized through Knex to prevent SQL injection. Non-existent model columns are safely ignored.

- **Example Usage**:
  ```js
  const { createApp, restResourcePlugin } = require('webspresso');
  const db = require('./models');

  const { app } = createApp({
    db,
    plugins: [
      restResourcePlugin({
        path: '/api/v1',
        middleware: [authenticateApiToken],
      }),
    ],
  });
  ```

### 2.21 `mcpPlugin` (`plugins/mcp`)
Model Context Protocol (MCP) server for connecting Webspresso applications directly to AI agents (Antigravity, Claude Desktop, Cursor, Zed, Windsurf).
- **Options**:
  - `path`: URL mount path (default: `'/_mcp'`).
  - `auth`: `{ token, localhostOnly, verify }`.
  - `services`: Boolean or `{ include, exclude, readOnly, role }` auto-bridging `services/` to MCP Tools.
  - `orm`: Boolean or `{ readOnly, models }` exposing models as Tools (`orm_find`, `orm_create`, etc.) and Resources (`webspresso://models`).
  - `system`: Boolean, exposes `webspresso://routes`, `webspresso://services`, and `webspresso://health`.
  - `discovery`: Boolean (default: `true`), scans project `mcp/` directory for custom tools, resources, and prompts.
- **Dual Transport**: Supports HTTP/SSE inside Webspresso server and Stdio via `webspresso mcp` CLI.

### 2.22 `xlsxPlugin` (`plugins/xlsx`)
High-performance Excel spreadsheet generation, parsing, ORM model export, streaming writer, formula injection security, and Express `res.xlsx()` decorator.
- **Options**:
  - `sanitizeFormulas`: Boolean (default `true`), escapes formula injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) to prevent spreadsheet macro exploits.
  - `headerStyle`: Custom styling `{ fill: '4F46E5', color: 'FFFFFF', bold: true }`.
  - `db`: Database instance for ORM model export service.
- **Response Helper (`res.xlsx`)**:
  ```javascript
  // pages/api/export-users.get.js
  module.exports = {
    handler: async (req, res) => {
      const users = await req.db.getRepository('User').find({ active: true });
      return res.xlsx(users, 'active_users.xlsx');
    },
  };
  ```
- **Toolkit API (`xlsx`)**:
  - `xlsx.generate({ sheets: [...], title })` → `Promise<Buffer>`
  - `xlsx.parse(bufferOrStream, { sheet, transformRow })` → `Promise<Array|Object>`
  - `xlsx.fromModel(repository, filterOrQuery, options)` → `Promise<Buffer>`
  - `xlsx.createStreamWriter(stream, options)` → `ExcelJS.stream.xlsx.WorkbookWriter`
- **Built-in Services**: `xlsx.generate`, `xlsx.parse`, `xlsx.exportModel` accessible via `ctx.service()` or `req.service()`.

### 2.23 `csvPlugin` (`plugins/csv`)
RFC 4180 compliant CSV generator, parser, ORM model export, streaming chunk writer, Excel UTF-8 BOM compatibility, and Express `res.csv()` decorator.
- **Options**:
  - `delimiter`: String (default `','`), supports `;`, `\t`, `|`.
  - `bom`: Boolean (default `true`), adds UTF-8 Byte Order Mark (`\uFEFF`) ensuring Microsoft Excel opens Turkish and international characters properly.
  - `sanitizeFormulas`: Boolean (default `true`), escapes formula injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`).
  - `db`: Database instance for ORM model export service.
- **Response Helper (`res.csv`)**:
  ```javascript
  // pages/api/export-orders.get.js
  module.exports = {
    handler: async (req, res) => {
      const orders = await req.db.getRepository('Order').find({ status: 'completed' });
      return res.csv(orders, 'orders_export.csv');
    },
  };
  ```
- **Toolkit API (`csv`)**:
  - `csv.generate({ rows, columns, delimiter, bom, asBuffer })` → `Buffer|string`
  - `csv.parse(bufferOrStreamOrString, { delimiter, transformRow })` → `Promise<Array<Object>>`
  - `csv.fromModel(repository, filterOrQuery, options)` → `Promise<Buffer>`
  - `csv.createStreamWriter(stream, options)` → `{ writeHeader, writeRow, writeRows, end }`
- **Built-in Services**: `csv.generate`, `csv.parse`, `csv.exportModel` accessible via `ctx.service()` or `req.service()`.

### 2.24 `dashboardPlugin` / `devToolbarPlugin` (`plugins/dashboard`)
Interactive Webspresso Developer Dashboard SPA mounted at `/_webspresso` and Floating In-Page DevTools bar (`fsy.devToolbar()`) inspired by Django Debug Toolbar and Nuxt DevTools.

- **Aliases**: `dashboardPlugin`, `devToolbarPlugin`, `devtoolsPlugin`.
- **Options**:
  - `path`: Base URL path for dashboard (default `/_webspresso`).
  - `title`: Dashboard browser title (default `'Webspresso Developer Dashboard'`).
  - `enabled`: Boolean to force enable in production (default `process.env.NODE_ENV !== 'production'`).
- **Dashboard Features (`/_webspresso`)**:
  - **Routes Tab**: Full table of file-based SSR and API routes with live search, method badges, dynamic parameters (`[id]`), and target files.
  - **Models Tab**: All registered ORM models with database tables, columns list, cache strategy (`smart` / `auto`), and soft-delete status.
  - **Services Tab**: All business services with transaction safety status, authentication guards (`admin`, roles), schemas, and cache TTL.
  - **Plugins & Config Tabs**: Active plugin manifests, dependencies, and sanitized framework configuration.
  - **JSON API Endpoints**:
    - `GET /_webspresso/api/routes`
    - `GET /_webspresso/api/plugins`
    - `GET /_webspresso/api/config`
    - `GET /_webspresso/api/models`
    - `GET /_webspresso/api/services`
    - `GET /_webspresso/api/overview` (aggregate system metrics, memory, uptime, node version)
- **Floating In-Page Dev Toolbar (`fsy.devToolbar()`)**:
  - Automatically embedded in `views/layout.njk` during development (`NODE_ENV !== 'production'`).
  - **Collapsed Bottom Pill**:
    - `⚡ DEV` toggle button with `Alt+D` hotkey shortcut.
    - Current route method, HTTP status code (`[GET 200] /path`).
    - Ambient database queries pill (`🗄️ N queries (Xms)`) from `AsyncLocalStorage` request profiler.
    - Prominent N+1 warning alert badge (`⚠️ N+1 (M)`).
    - Quick access buttons to `Dashboard (/_webspresso)`, `Admin (/_admin)`, `API Docs (/_swagger)`, and `Schema (/_schema)`.
  - **Expandable DevTools Drawer (toggled via click or `Alt+D`)**:
    - **🗄️ SQL Queries Tab**: Execution duration (<40ms green, >40ms red), table pills, formatted SQL statement, and N+1 warning box with actionable suggestions (`repo.query().include(...)`).
    - **📄 Route & Page Tab**: Route path, matched file, template name, params, and parsed query string.
    - **🚀 Quick Links Tab**: Configurable tool cards for fast navigation between admin, swagger, and custom tooling.
    - **💻 System Tab**: Process uptime, memory usage, environment, and Node platform metrics.
  - **Zero Production Overhead**: When `process.env.NODE_ENV === 'production'`, `devToolbar()` immediately returns `""` with zero overhead.

### 2.25 `oauthPlugin` (`plugins/oauth`)
Built-in OAuth 2.0 & Social Login plugin supporting Google, GitHub, and custom providers with RFC 7636 PKCE, HMAC-signed anti-CSRF state tokens, and Dual Auth integration.
- **Options**:
  - `secret`: Secret key for HMAC state signing (`process.env.OAUTH_SECRET || process.env.SESSION_SECRET`).
  - `pathPrefix`: Base path for OAuth routes (default `'/auth'`).
  - `providers`: Provider configuration dictionary (`google`, `github`, or custom).
  - `defaultReturnTo`: Fallback redirect path after successful login (default `'/'`).
  - `failureRedirect`: Redirect path on OAuth failure (default `'/login'`).
  - `findOrCreateUser`: `async ({ provider, profile, tokens, db, req, res }) => user`.
  - `onSuccess`: `async ({ provider, user, profile, tokens, stateData, req, res, client }) => void`.
  - `onError`: `async ({ error, provider, req, res, client }) => void`.
- **Automatic Routes**:
  - `GET /auth/:provider`: Initiates OAuth authorization flow with PKCE and signed state.
  - `GET /auth/:provider/callback`: Exchanges authorization code, fetches normalized profile, links or creates user, and logs into session or returns JWT token.
- **Template Helper**:
  - `fsy.oauthUrl('google')` ➔ `"/auth/google"`
  - `fsy.oauthUrl('github', { returnTo: '/dashboard' })` ➔ `"/auth/github?returnTo=%2Fdashboard"`

### 2.26 `lazyPlugin` / `defineLazyPlugin` (`plugins/lazy`)
Built-in on-demand plugin hydration wrapper that defers heavy plugin initialization, route mounting, and service registration until the first matching HTTP request or service invocation.
- **Why**: Drastically slashes application cold start time and peak memory footprint when mounting heavy modules (such as admin panels, media libraries, documentation portals, or internal diagnostic tools) that are not needed on every server startup.
- **Usage**:
  ```javascript
  const { lazyPlugin, adminPanelPlugin, fileManagerPlugin } = require('webspresso/plugins');

  // Option 1: Using built-in lazy option
  adminPanelPlugin({ db, lazy: true });
  fileManagerPlugin({ lazy: true });

  // Option 2: Wrapping custom or 3rd-party plugins
  const heavyPlugin = lazyPlugin(
    () => require('./my-heavy-plugin')({ config: 123 }),
    {
      name: 'my-heavy-plugin',
      prefix: '/heavy',            // Hydrates when request path starts with /heavy
      services: ['heavy.process'],  // Hydrates when ctx.service('heavy.process') is called
      helpers: ['heavyHelper'],     // Hydrates when fsy.heavyHelper() is evaluated
      events: ['heavy.*'],          // Hydrates when matching event is dispatched
      onHydrate: (plugin) => console.log('Plugin hydrated!'),
    }
  );
  ```
- **How It Works**:
  - Mounts a lightweight Express router proxy at `prefix`.
  - Stubs placeholder services into `ServiceRegistry` and proxy helpers into Nunjucks context.
  - Intercepts incoming requests/calls, executes the plugin factory function, runs `register(ctx)` and `onRoutesReady(ctx)`, replaces proxies seamlessly with the real router/services, and forwards the initial call with zero dropped requests.

### 2.27 `rlsPlugin` (`plugins/rls`)
Built-in Dynamic Model Row-Level Security (RLS) plugin that bridges request authentication (`req.user`, `req.auth`, `req.tenantId`) to ORM repositories with automatic query scoping, role-based bypass, and route-level overrides.
- **Why**: Eliminates manual `where({ user_id: req.user.id })` boilerplate across all API endpoints, prevents accidental cross-tenant/cross-user data leakage, and provides declarative data access boundaries.
- **Options**:
  - `bypassRoles`: Global roles that bypass RLS across all models (default: `['admin', 'superadmin']`). Set to `false` to disable.
  - `getUser`: Custom extractor for current user from `req` (default: `req.user || req.adminUser || req.auth?.user`).
  - `getTenantId`: Custom extractor for current tenant ID from `req` (default: `req.tenantId || req.user?.tenant_id`).
  - `global`: Mount global middleware wrapping `req.db` (default: `true`).
  - `enabled`: Toggle RLS plugin active state (default: `true`).
- **Usage**:
  ```javascript
  const { createApp, rlsPlugin } = require('webspresso');

  const app = createApp({
    plugins: [
      rlsPlugin({
        bypassRoles: ['admin', 'superadmin'],
      }),
    ],
  });
  ```
- **How It Works**:
  - Automatically wraps `req.db.getRepository()` and `req.db.query()` with the active `user` and `tenantId`.
  - Admins bypass filters automatically unless model specifies `bypassRoles: false`.
  - Endpoints can explicitly bypass RLS when needed via `req.db.getRepository('Model').withoutRls()`.
  - Named middleware `middleware: ['rls']` available for selective route application.

### 2.28 `sitemapPlugin` (`plugins/sitemap.js`)
Automatic XML sitemap generator (`/sitemap.xml`) and `robots.txt` responder with dynamic database source discovery and multi-language hreflang support.
- **Why**: Eliminates manual sitemap maintenance and crawler management.
- **Options**:
  - `hostname`: Base URL (default: `process.env.BASE_URL || 'http://localhost:7331'`).
  - `exclude`: Patterns to exclude (default: `['/api/*']`).
  - `changefreq`: Default change frequency (`'always'`, `'hourly'`, `'daily'`, `'weekly'`, `'monthly'`, `'yearly'`, `'never'`; default: `'weekly'`).
  - `priority`: Default priority (`0.0` - `1.0`; default: `0.8`).
  - `i18n`: Enable i18n hreflang alternatives (default: `false`).
  - `locales`: Supported locale list (default: from `SUPPORTED_LOCALES` or `['en']`).
  - `robots`: Auto-serve `/robots.txt` referencing sitemap (default: `true`).
  - `robotsDisallow`: Array of path patterns to disallow in `robots.txt`.
  - `dynamicSources`: Array of dynamic sources `{ model, query, urlPattern, fields, lastmodField, changefreq, priority }`.
  - `cacheMaxAge`: In-memory XML cache TTL in ms (default: 5 minutes).
- **Usage**:
  ```javascript
  const { sitemapPlugin } = require('webspresso/plugins');

  sitemapPlugin({
    hostname: 'https://example.com',
    exclude: ['/api/*', '/_admin/*'],
    dynamicSources: [
      {
        model: 'Post',
        urlPattern: '/blog/:slug',
        fields: { slug: 'slug' },
        lastmodField: 'updated_at',
        priority: 0.9,
      },
    ],
  });
  ```

### 2.29 `seoCheckerPlugin` (`plugins/seo-checker`)
In-browser client-side SEO analysis and diagnostics panel integrated into the development toolbar (inspired by `django-check-seo`).
- **Why**: Catches missing meta tags, broken OpenGraph attributes, missing canonical links, heading hierarchy issues, and alt text omissions directly in the browser during development.
- **Options**:
  - `enabled`: Toggle plugin (default: `process.env.NODE_ENV !== 'production'`).
  - `settings`: Custom thresholds for title/meta lengths and required tags.
- **Usage**:
  ```javascript
  const { seoCheckerPlugin } = require('webspresso/plugins');

  seoCheckerPlugin();
  ```

### 2.30 `analyticsPlugin` (`plugins/analytics.js`)
Zero-dependency tag and tracking snippet injector for external analytics and webmaster verification.
- **Why**: Injects standardized snippets and verification meta tags for Google Analytics (GA4/gtag), Google Tag Manager (GTM + noscript), Yandex.Metrika (with Webvisor), Microsoft/Bing UET, and Meta/Facebook Pixel.
- **Options**:
  - `google`: `{ measurementId, adsId, verificationCode }`.
  - `gtm`: `{ containerId }`.
  - `yandex`: `{ counterId, verificationCode, webvisor, clickmap, trackLinks, accurateTrackBounce }`.
  - `bing`: `{ uetId, verificationCode }`.
  - `facebook`: `{ pixelId, domainVerification }`.
  - `pinterest`: `{ verificationCode }`.
- **Usage**:
  ```javascript
  const { analyticsPlugin } = require('webspresso/plugins');

  analyticsPlugin({
    google: { measurementId: 'G-XXXXXXXXXX', verificationCode: 'abc...' },
    gtm: { containerId: 'GTM-XXXXXXX' },
  });
  ```
  Provides Nunjucks template helpers: `{{ fsy.gtag() }}`, `{{ fsy.gtm() }}`, `{{ fsy.gtmNoscript() }}`, `{{ fsy.yandexMetrika() }}`, `{{ fsy.bingUet() }}`, `{{ fsy.facebookPixel() }}`, and `{{ fsy.verificationTags() }}`.

### 2.31 `recaptchaPlugin` (`plugins/recaptcha`)
Server-side token verification and Nunjucks form helpers for Google reCAPTCHA (v2 Checkbox and v3 Invisible Score).
- **Why**: Prevents bot abuse and spam submissions on forms without manual curl/fetch verification.
- **Options**:
  - `siteKey`: Public site key (required).
  - `secretKey`: Secret key (defaults to `process.env.RECAPTCHA_SECRET_KEY`).
  - `version`: `'v2'` or `'v3'` (default: `'v2'`).
  - `minScore`: Minimum score threshold for v3 (default: `0.5`).
  - `expectedAction`: Expected action string for v3 verification.
- **Usage**:
  ```javascript
  const { recaptchaPlugin } = require('webspresso/plugins');

  recaptchaPlugin({
    siteKey: process.env.RECAPTCHA_SITE_KEY,
    secretKey: process.env.RECAPTCHA_SECRET_KEY,
    version: 'v3',
    minScore: 0.7,
  });
  ```
  Provides named middleware `middleware: ['recaptcha']` and template helpers `{{ fsy.recaptchaScript() }}`, `{{ fsy.recaptchaWidget() }}`, `{{ fsy.recaptchaExecute() }}`.

### 2.32 `dataExchangePlugin` (`plugins/data-exchange`)
Spreadsheet import (CSV/XLSX) and Excel export engine integrated into the Mithril.js Admin Panel.
- **Why**: Allows non-technical staff to export filtered ORM model records to formatted `.xlsx` files and bulk-import records from CSV/Excel spreadsheets with field validation.
- **Options**:
  - `enabled`: Toggle plugin (default: `true`).
  - `db`: Database instance (default: `ctx.db`).
  - `adminPath`: Mount path (default: `'/_admin'`).
  - `maxRows`: Maximum row limit (default: `10000`).
  - `maxFileBytes`: Maximum upload size in bytes (default: `10485760` / 10MB).
- **Usage**:
  ```javascript
  const { dataExchangePlugin, adminPanelPlugin } = require('webspresso/plugins');

  createApp({
    plugins: [
      adminPanelPlugin({ db }),
      dataExchangePlugin({ maxRows: 25000 }),
    ],
  });
  ```

### 2.33 `healthCheckPlugin` (`plugins/health-check.js`)
Dedicated HTTP health check endpoint (`/health`) for load balancer probes, Kubernetes liveness, and uptime monitoring.
- **Why**: Lightweight, non-intrusive probe endpoint that reports framework version, uptime, and executes custom diagnostic checks.
- **Options**:
  - `path`: Endpoint route (default: `'/health'`).
  - `enabled`: Toggle plugin (default: `true`).
  - `authorize`: Optional gate function `(req) => boolean`.
  - `verbose`: Include timestamp, uptime, framework version (default: `true`).
  - `checks`: Async function `async ({ req, db, options }) => ({ db: 'ok' })`. Thrown errors return HTTP 503.
- **Usage**:
  ```javascript
  const { healthCheckPlugin } = require('webspresso/plugins');

  healthCheckPlugin({
    path: '/health',
    checks: async ({ db }) => {
      await db.raw('SELECT 1');
      return { database: 'ok' };
    },
  });
  ```

### 2.34 `queuePlugin` (`plugins/queue`)
Modular plugin wrapper for Webspresso's background job queue engine (`core/queue`).
- **Why**: Connects background workers (`jobs/`) to Express lifecycle, automatically starts worker poll loops on server listen, and gracefully drains jobs on shutdown.
- **Options**:
  - `adapter`: `'memory'`, `'database'` / `'db'`, `'redis'`, `'wait-until'`, `'cloudflare'`, or a custom `QueueAdapter` instance (default: `'memory'`).
  - `db`: Database instance for database adapter.
  - `redisClient`: Redis client instance for redis adapter.
  - `concurrency`: Number of concurrent job workers (default: `2`).
  - `pollInterval`: Polling interval in ms (default: `500`).
  - `jobsDir`: Path to jobs directory (default: `<cwd>/jobs`).
  - `autoStart`: Automatically start worker loop (default: `true`).
  - `retention`: Auto-retention cleanup config.
- **Usage**:
  ```javascript
  const { queuePlugin } = require('webspresso/plugins');

  queuePlugin({
    adapter: 'database',
    concurrency: 4,
    pollInterval: 1000,
  });
  ```

