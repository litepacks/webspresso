# Webspresso Project Guidelines & Rules

## 1. Codebase Architecture

Webspresso is a lightweight, zero-dependency-sprawl full-stack Node.js SSR & API framework featuring Next.js/Nuxt-style file-based routing, an intuitive Knex-based ORM, a modular plugin ecosystem, and a customizable Mithril.js SPA Admin Panel.

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
- **API Endpoints & Routing Architecture**:
  - ⚠️ **CRITICAL ANTI-PATTERN: NEVER create a `routes/` or `src/routes/` directory. NEVER use `express.Router()`, `app.get()`, or `app.post()` for application endpoints.**
  - **100% File-Based Routing**: All API routes MUST be created inside `pages/api/...` with HTTP method extensions:
    - `pages/api/notes.get.js` → `GET /api/notes`
    - `pages/api/notes.post.js` → `POST /api/notes`
    - `pages/api/notes/[id].get.js` → `GET /api/notes/:id`
    - `pages/api/notes/[id].delete.js` → `DELETE /api/notes/:id`
  - **Standard API Route Module Contract**:
    ```javascript
    module.exports = {
      schema: ({ z }) => ({
        body: z.object({ title: z.string().min(1) }),
        params: z.object({ id: z.string().optional() }),
      }),
      middleware: ['auth'], // optional named middleware
      handler: async (req, res) => {
        // req.db and req.service are automatically injected
        // req.input.body contains the validated payload
        const item = await req.db.getRepository('Note').create(req.input.body);
        return res.status(201).json(item);
      },
    };
    ```

### 1.2 Services Layer (`services/`, `src/services/`)
- **File-based Auto-Discovery**: Services located in `services/` map directly to dot-separated service names (e.g. `services/user/create.js` → `'user.create'`) and camelCase aliases (`'user.reset-password'` & `'user.resetPassword'`).
- **Declarative Validation & Authorization**: Define optional Zod `schema`, `auth` (boolean, role string/array, predicate), `timeout` (ms), `transaction: true` (ACID transaction propagation across nested calls), and `cache: { ttl, key }`.
- **Unified Invocation**: Consumed via `ctx.service('service.name', input)` from SSR loaders, `req.service()` in API routes, or standalone `createServiceRegistry()`.

### 1.3 ORM & Database Layer (`core/orm`, `models/`)
- ⚠️ **CRITICAL ANTI-PATTERN: NEVER use raw Knex queries (e.g. `db('table')` or `knex('table')`) in application code.** Raw queries bypass schema validation, lifecycle hooks, soft-deletes, multi-tenant scopes, hidden fields, and query caching.
- **ALWAYS Use Repositories**: Accessed via `db.getRepository('ModelName')` or `req.db.getRepository('ModelName')`:
  - `await repo.findById(id)`
  - `await repo.find({ status: 'active' })`
  - `await repo.findOne({ slug })`
  - `await repo.create(data)` *(validates schema & executes hooks)*
  - `await repo.update(id, data)`
  - `await repo.delete(id)` *(respects soft deletes)*
  - `await repo.query().where('price', '>', 50).paginate({ page, limit })`
  - `await repo.query().include('user', 'tags').find()` *(eager loading)*
- **Model Definition**: Defined in `models/*.js` using `defineModel({ name, table, schema, relations, scopes, hidden, admin, cache })`.
- **Schema & Types**: Built with `zdb` schema builder (`zdb.id()`, `zdb.string()`, `zdb.integer()`, `zdb.boolean()`, `zdb.file()`, `zdb.json()`).
- **Ambient Transactions**: Repositories automatically bind to ambient transactions (`AsyncLocalStorage`) inside `db.transaction()` and services (`transaction: true`) without manual `trx` passing.
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
- `realtimePlugin`: Framework-agnostic, plugin-based realtime layer (`core/realtime`) with WebSocket, SSE, Socket.IO, and distributed Redis Pub/Sub adapters.
- `restResourcePlugin`: Zero-boilerplate RESTful CRUD API generator directly from ORM models with eager loading, sanitization, filtering, pagination, and soft-delete scoping.

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
4. **Strict File-Based Routing (NO `routes/` or `app.get()`)**: Webspresso is strictly file-based. Never create manual router files (`src/routes/*.js`), never call `app.get()`, and never use `express.Router()`. All application pages belong in `pages/` and all API endpoints belong in `pages/api/` with HTTP method extensions (`.get.js`, `.post.js`, `.delete.js`, `.patch.js`, `.put.js`).
5. **Strict Repository Pattern (NO Raw `db('table')`)**: Never write raw Knex table queries in route handlers or services. Always use `req.db.getRepository('ModelName')` to ensure schema validation, hooks, scopes, and query caching are applied.
6. **Strict Services Layer (NO `controllers/`)**: Never create a `controllers/` folder or controller classes. Encapsulate business logic in `services/domain/action.js` and call via `ctx.service('domain.action', input)`.
7. **Native Dual Auth (NO External JWT/Passport Packages)**: Never install `jsonwebtoken`, `passport`, or `express-session`. Always use native `req.auth` and `webspresso/core/auth`.
8. **Page Data Loaders (NO Manual `res.render()`)**: Never call `res.render()` inside custom handlers for web pages. Use companion loaders `pages/*.js` exporting `async function load({ req, res, db, ctx })`.
9. **Semantic Exceptions (NO Generic Errors / Manual Responses)**: Never return manual `res.status(404).json(...)` inside services or loaders. Always throw semantic errors: `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`.
10. **Background Jobs (NO BullMQ / `setTimeout`)**: Never use unmanaged `setTimeout` or external queues. Place job workers in `jobs/` and dispatch via `req.queue.dispatch()`.
