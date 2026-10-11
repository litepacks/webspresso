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
Zero-dependency HTTP Basic Authentication (RFC 7617) plugin with timing-safe equality checks (`crypto.timingSafeEqual`).
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

### 2.2 `adminPanelPlugin` (`plugins/admin-panel`)
Mithril.js SPA Admin Panel mounted at `/_admin`.
- **Options**: `{ path: '/_admin', db, title: 'Webspresso Admin' }`
- **Features**: Auto CRUD screens for ORM models, user staff auth, custom page registration, widgets, field renderers.

### 2.3 `contentPlugin` (`plugins/content`)
Schema-driven headless CMS & inline content editing.
- **Options**: `{ db, adminPath: '/_admin', inlineEdit: true }`
- **Features**: Dynamic content types & entries, public API (`/api/content/:type/:slug`), visual inline editor widget.

### 2.4 `uploadPlugin` (`plugins/upload`)
Multipart file upload manager with local / cloud storage providers.
- **Options**: `{ path: '/api/upload', local: { destDir, publicBasePath }, maxBytes: 10000000, mimeAllowlist: ['image/png', 'image/jpeg'] }`
- **Features**: Single & multi-file uploads, file size & extension validation, storage drivers.
- **Orphan Pruning**: `scanOrphanedUploads({ db, destDir })` and `pruneOrphanedUploads({ db, destDir, dryRun })` to detect and remove disk files no longer referenced by any database model, accompanied by CLI command `webspresso upload:prune [--dry-run]`.


### 2.5 `fileManagerPlugin` (`plugins/file-manager`)
Filesystem-first media library, directory explorer, and modal asset picker for Admin Panel.
- **Options**: `{ baseDir: './public/uploads', publicBasePath: '/uploads', apiPrefix: '/files', pageTitle: 'Dosya Yöneticisi', maxUploadBytes: 10485760, allowedExtensions, allowedMimeTypes, includePage: true }`
- **Features**:
  - Directory tree navigation (breadcrumbs), safe subfolder creation (`mkdir`), item rename, delete, and move.
  - Path traversal attack protection (`resolveSafePath`).
  - Grid (thumbnail gallery) & List (table) view modes.
  - Search by filename and type filter (Images, Documents, Videos, Audio, Archives, Code).
  - Media preview modal with copy URL and direct playback/preview.
  - "Kütüphaneden Seç" modal picker integrated with `FileUploadField` and `zdb.file()` form fields.
  - Built-in services: `fileManager.list`, `fileManager.mkdir`, `fileManager.rename`, `fileManager.delete`, `fileManager.move`, `fileManager.upload`.

### 2.6 `corsPlugin` (`plugins/cors`)
Zero-dependency Cross-Origin Resource Sharing (CORS) handler.
- **Options**: `{ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], credentials: true, maxAge: 86400 }`
- **Features**: Native header management, preflight OPTIONS handling.

### 2.6 `csrfPlugin` (`plugins/csrf`)
Cross-Site Request Forgery token validation.
- **Options**: `{ mode: 'session', secret: 'csrf-secret', ignorePaths: ['/api/*'] }`

### 2.7 `redirectPlugin` (`plugins/redirect`)
HTTP 301–308 URL redirect manager.
- **Options**: `{ rules: [{ from: '/old-path', to: '/new-path', status: 301 }] }`

### 2.8 `rateLimitPlugin` (`plugins/rate-limit`)
Request rate limiting using express-rate-limit logic.
- **Options**: `{ windowMs: 15 * 60 * 1000, max: 100 }`

### 2.9 `siteAnalyticsPlugin` (`plugins/site-analytics`)
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

### 2.10 `emailPlugin` (`plugins/email`)
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
- **Admin Panel UI**: Includes log listing, test email dispatch, template preview, connection verification, and "Purge 90d" action.

### 2.11 `polarPlugin` (`plugins/polar`)
Polar.sh subscription billing — checkout, customer portal, webhooks, Customer State sync, tier columns. Zero extra deps (`crypto` + `fetch`).

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

### 2.12 `auditLogPlugin` (`plugins/audit-log`)
Admin mutation tracking and audit history with scheduled retention and manual purge API.
- **Options**:
  - `db`: Database instance (must expose `.knex`).
  - `tableName`: Database table name (default `'audit_logs'`).
  - `retentionDays`: Days to retain audit trail entries (default `90`).
  - `cleanupIntervalMs`: Background cleanup timer frequency (default 24h).
  - `autoCleanup`: Enable scheduled background purge (default `true`).
  - `cleanupOnStart`: Run initial purge shortly after boot (default `true`).
  - `retention`: `{ enabled, days: 90, intervalMs: 86400000, runOnStart: true }` (or `false` to disable).
- **Pruning CLI**:
  ```bash
  webspresso audit:prune --days 90
  ```
- **API & Admin Panel**:
  - `POST /_admin/api/audit-logs/purge`: `{ days: 90 }` or `{ olderThan: '2026-01-01' }`
  - "Purge 90d" button directly in the Admin Panel audit log viewer.
  - Lifecycle integration: background timers use `.unref()` and clean up on server shutdown.

### 2.13 `ormCacheAdminPlugin` (`plugins/orm-cache-admin`)
ORM Cache inspection and invalidation dashboard.

### 2.14 `schemaExplorerPlugin` (`plugins/schema-explorer`)
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

### 2.15 `swaggerPlugin` / `openapiPlugin` (`plugins/swagger`)
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

### 2.16 `realtimePlugin` (`plugins/realtime`, `core/realtime`)
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

### 2.17 `restResourcePlugin` (`plugins/rest-resources`)
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

### 2.16 `mcpPlugin` (`plugins/mcp`)
Model Context Protocol (MCP) server for connecting Webspresso applications directly to AI agents (Antigravity, Claude Desktop, Cursor, Zed, Windsurf).
- **Options**:
  - `path`: URL mount path (default: `'/_mcp'`).
  - `auth`: `{ token, localhostOnly, verify }`.
  - `services`: Boolean or `{ include, exclude, readOnly, role }` auto-bridging `services/` to MCP Tools.
  - `orm`: Boolean or `{ readOnly, models }` exposing models as Tools (`orm_find`, `orm_create`, etc.) and Resources (`webspresso://models`).
  - `system`: Boolean, exposes `webspresso://routes`, `webspresso://services`, and `webspresso://health`.
  - `discovery`: Boolean (default: `true`), scans project `mcp/` directory for custom tools, resources, and prompts.
- **Dual Transport**: Supports HTTP/SSE inside Webspresso server and Stdio via `webspresso mcp` CLI.

### 2.17 `xlsxPlugin` (`plugins/xlsx`)
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

### 2.18 `csvPlugin` (`plugins/csv`)
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

### 2.19 `dashboardPlugin` / `devToolbarPlugin` (`plugins/dashboard`)
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




