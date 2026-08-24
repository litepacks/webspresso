# Webspresso Project Guidelines & Rules

## 1. Codebase Architecture

Webspresso is a lightweight, zero-dependency-sprawl Express SSR framework featuring file-based routing, an intuitive Knex-based ORM, a modular plugin ecosystem, and a customizable Mithril.js SPA Admin Panel.

### 1.1 Core SSR & Routing (`pages/`, `views/`)
- **File-based Routing**: Pages located in `pages/` automatically map to URL routes (e.g. `pages/index.njk` → `/`, `pages/products/[id].njk` → `/products/:id`).
- **Data Loaders (`load()`)**: Page routes export `async function load({ req, res, db, ctx })` to fetch data server-side before template rendering.
- **Templating & Helpers**: Nunjucks (`.njk`) templates rendered with layouts (e.g. `views/layout.njk`). Access helpers via `fsy` object in templates.
- **Asset Versioning & Cache-Busting**: Configured via `createApp({ assets: { version, manifestPath, prefix } })`. Supports query-string versioning (`?v=1.2.3`), Vite/Webpack manifest resolution (`.vite/manifest.json`), CDN prefixing, and `fsy.asset()`, `fsy.css()`, `fsy.js()`, `fsy.img()` template helpers.
- **Framework Exceptions & Central Error Boundary**: Built-in exception hierarchy (`WebspressoError`, `HttpError`, `ValidationError`, `SecurityError`, `RequestAbortedError`, `ConfigurationError`, `PluginError`, `RouteNotFoundError`) and custom handler hook (`app.setErrorHandler`). Async route handlers automatically propagate rejected promises. Production responses mask 500 stack traces and error details.
- **Graceful Shutdown & Lifecycle Management**: Configured via `createApp({ server: { shutdown: { enabled: true, mode: 'graceful'|'force', timeout: 10000 } } })`. Socket connection tracking, request draining with `Connection: close`, and reverse-order plugin disposer cleanup.
- **HTTP Response Compression**: Zero-dependency streaming zlib compression configured via `createApp({ server: { compression: true } })` with Brotli (`br`), Gzip (`gzip`), Deflate (`deflate`), threshold buffering (1 KB), and route-level opt-out (`res.compress(false)`).
- **Custom Error & 404 Pages**: Configured via `createApp({ errorPages: { notFound, serverError, timeout } })`. Supports template paths (e.g. `notFound: '404.njk'`) or custom handler functions, passing `{ fsy, locale, isDev, url, method }` to templates.
- **Middleware & Hooks**: Route lifecycle hooks can be declared per-page or globally via `pages/_hooks.js`.
- **API Endpoints**: Defined under `pages/api/...` or mounted programmatically via `createApp({ setupRoutes })`.

### 1.2 Services Layer (`services/`, `src/services/`)
- **File-based Auto-Discovery**: Services located in `services/` map directly to dot-separated service names (e.g. `services/user/create.js` → `'user.create'`) and camelCase aliases (`'user.reset-password'` & `'user.resetPassword'`).
- **Declarative Validation & Authorization**: Define optional Zod `schema`, `auth` (boolean, role string/array, predicate), `timeout` (ms), `transaction: true` (ACID transaction propagation across nested calls), and `cache: { ttl, key }`.
- **Unified Invocation**: Consumed via `ctx.service('service.name', input)` from SSR loaders, `req.service()` in Express routes, or standalone `createServiceRegistry()`.

### 1.3 ORM & Database Layer (`core/orm`, `models/`)
- **Model Definition**: Defined in `models/*.js` using `defineModel({ name, table, schema, relations, scopes, hidden, admin, cache })`.
- **Schema & Types**: Built with `zdb` schema builder (`zdb.string()`, `zdb.integer()`, `zdb.boolean()`, `zdb.file()`, `zdb.json()`).
- **Repositories**: Accessed via `db.getRepository(modelName)` or `ctx.db`. Supports `find`, `findById`, `findOne`, `create`, `update`, `delete`, and `query()`.
- **Query Caching**: Memory/provider query cache configured per database instance or model (`cache: 'auto'|'smart'|true`).
- **Migrations**: Database schema changes managed via Knex migrations in `migrations/` (`webspresso db:migrate`).

### 1.4 Admin Panel Architecture (`plugins/admin-panel`)
- **SPA CRUD Engine**: Modular Mithril.js SPA mounted at `/_admin` powered by `adminPanelPlugin({ db })`.
- **Admin Module Registration**: Registered using `adminApi.registerModule` or `adminApi.registerPageDir`.
- **Custom Admin Pages**:
  - `componentFile`: Path to a clean Mithril component `.js` file.
  - `pagesDir`: Directory auto-discovery containing page folders with `page.json` and `component.js`.
  - **Auto Layout Wrapping**: By default (`layout: true`), custom page views are automatically wrapped inside the Admin `Layout` and `Breadcrumb` containers without requiring manual `m(Layout, ...)` nesting. Set `layout: false` for full-screen / custom canvas pages.
- **Extension Points**:
  - Custom Field Renderers: `registry.registerFieldRenderer(type, { display, edit })`.
  - Widgets: `registry.registerWidget(id, config)`.
  - Actions & Bulk Actions: Single record buttons (`registerAction`) and multi-select table actions (`registerBulkAction`).
- **Session Isolation**: Admin staff authentication uses a separate session (`req.session.adminUser` / `/_admin/api/auth/*`), isolated from public site auth (`req.user`).

### 1.4 Plugin Ecosystem (`plugins/`)
Plugins expose `name`, `version`, `dependencies`, and lifecycle hooks (`register(ctx)`, `onRoutesReady(ctx)`):
- `adminPanelPlugin`: Model CRUD, custom pages, widgets, user management.
- `basicAuthPlugin`: Zero-dependency HTTP Basic Authentication (RFC 7617) with named route middleware (`ctx.middlewares.basicAuth`) and global protection.
- `contentPlugin`: Schema-driven CMS with inline editing and headless API.
- `uploadPlugin`: Multipart file uploads with local/cloud storage providers.
- `redirectPlugin`: Configurable HTTP 301–308 redirects.
- `rateLimitPlugin`: Named rate limiters (`express-rate-limit`).
- `siteAnalyticsPlugin`: Self-hosted page view analytics and client JS error tracking.
- `emailPlugin`: MJML template compilation & Nodemailer integration.
- `auditLogPlugin`: Admin mutation audit logging.
- `ormCacheAdminPlugin`: Cache inspection and invalidation dashboard.
- `corsPlugin`: Zero-dependency Cross-Origin Resource Sharing handler.
- `csrfPlugin`: CSRF token validation and Nunjucks form helpers.
- `realtimePlugin`: Framework-agnostic, plugin-based realtime layer (`core/realtime`) with WebSocket, SSE, and Socket.IO adapters.

---

## 2. Development & Testing Workflow

### 2.1 Essential Commands
- **Dev Server**: `npm run dev` or `webspresso dev`
- **Run Vitest Unit Tests**: `npm test` or `npx vitest run tests/unit/admin-panel/`
- **Run Migrations**: `npx webspresso db:migrate`
- **Project Sanity Check**: `npx webspresso doctor`
- **Scaffold Agent Skill**: `npx webspresso skill --preset webspresso`

### 2.2 Testing & Quality Assurance
- **Zero Regression Policy**: Always run unit tests before declaring any task complete.
- **Targeted Test Execution**: Run specific unit test files during development for fast feedback (`npx vitest run tests/unit/admin-panel/admin-module-files.test.js`).
- **API Backward Compatibility**: Never break existing `registerModule`, `registerPage`, or `adminApi` contracts. Always add new parameters as optional or backward-compatible enhancements.

---

## 3. Coding Standards & Conventions

1. **Strict Signature & Schema Verification**: Always verify function signatures and object schemas by viewing authoritative source files before calling or extending them.
2. **File & Component Separation**: Keep client-side components in clean standalone JS files (`component.js` / `componentFile`) rather than escaping inline template strings.
3. **Log & Traceback Inspection**: Base all bug fixes strictly on exact runtime error log tracebacks and empirical test output. Never swallow errors or return dummy fallbacks.
