# Webspresso Codebase Architecture & Structure

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## 1. Core SSR & Routing (`pages/`, `views/`, `src/`)

- **File-based Routing**: Pages located in `pages/` automatically map to URL routes:
  - `pages/index.njk` → `/`
  - `pages/products/[id].njk` → `/products/:id`
  - `pages/api/posts.post.js` → `POST /api/posts`
- **Data Loaders (`load()`)**: Page routes export `async function load({ req, res, db, ctx })` to fetch data server-side before Nunjucks template rendering.
- **API Endpoints**: Defined as file route modules exporting `{ schema, middleware, handler }`. Input validation via Zod (`schema: ({ z }) => ({ body, query, params })`) assigns validated data to `req.input.body` / `req.input.query`.
- **Templating**: Nunjucks (`.njk`) templates rendered with layouts (e.g. `views/layout.njk`). Access helpers via `fsy` object in templates.
- **Middleware & Hooks**: Route lifecycle hooks can be declared per-page (`module.exports = { middleware: ['auth', 'jwt'] }`) or globally via `pages/_hooks.js`.

---

## 2. ORM & Database Layer (`core/orm`, `models/`)

- **Model Definition**: Defined in `models/*.js` using `defineModel({ name, table, schema, relations, scopes, hidden, admin, cache })`.
- **Schema & Types**: Built with `zdb` schema builder:
  - `zdb.id()`, `zdb.uuid()`, `zdb.nanoid()`
  - `zdb.string()`, `zdb.integer()`, `zdb.boolean()`
  - `zdb.file({ maxLength, nullable })` (URL/path string for uploaded assets)
  - `zdb.json()`, `zdb.timestamp()`
- **Repositories**: Accessed via `db.getRepository(modelName)` or `ctx.db`. Supports `find`, `findById`, `findOne`, `create`, `update`, `delete`, and `query()`.
- **Query Caching**: Memory/provider query cache configured per database instance or model (`cache: 'auto'|'smart'|true`).
- **Migrations**: Database schema changes managed via Knex migrations in `migrations/` (`webspresso db:migrate`).

---

## 3. Admin Panel Architecture (`plugins/admin-panel`)

- **SPA CRUD Engine**: Modular Mithril.js SPA mounted at `/_admin` powered by `adminPanelPlugin({ db })`.
- **Admin Module Registration**: Registered using `adminApi.registerModule` or `adminApi.registerPageDir`.
- **Custom Admin Pages**:
  - Supports clean Mithril component `.js` files (`componentFile`), external URLs (`url` / `iframeUrl`), or custom HTML documents (`html` / `htmlFile`).
  - **Auto Layout Wrapping**: Custom page views are automatically wrapped inside Admin `Layout` and `Breadcrumb` containers unless `layout: false` is configured for full-screen pages.
  - **SSR Scripts & Styles**: `registerScript(url)` and `registerStyle(url)` inject external CSS/JS dependencies into Admin SPA markup.
- **Session Isolation**: Admin staff authentication uses a separate session (`req.session.adminUser` / `/_admin/api/auth/*`), isolated from public site auth (`req.user`).

---

## 4. Plugin Ecosystem (`plugins/`)

Plugins expose `name`, `version`, `dependencies`, and lifecycle hooks (`register(ctx)`, `onRoutesReady(ctx)`):

| Plugin | Feature set | One-line purpose |
|--------|-------------|------------------|
| `corsPlugin` | Security / HTTP | Zero-dependency CORS middleware & preflight handling |
| `adminPanelPlugin` | Admin / SPA | ORM-backed CRUD SPA with user management & custom pages |
| `contentPlugin` | Admin / CMS | Schema-driven CMS with inline editing and public REST API |
| `uploadPlugin` | HTTP / Admin | Multipart upload endpoint + pluggable storage providers |
| `redirectPlugin` | HTTP | Configurable HTTP 301–308 redirects before file routes |
| `rateLimitPlugin` | HTTP | Named rate-limit middleware + optional global limiter |
| `siteAnalyticsPlugin` | Analytics | Self-hosted page view analytics and client JS error tracking |
| `emailPlugin` | Email | MJML template compilation & Nodemailer integration |
| `csrfPlugin` | Security | Session & cookie double-submit CSRF protection + helpers |
| `auditLogPlugin` | Security | Admin mutation audit logging |
| `ormCacheAdminPlugin` | Admin / ORM | Cache inspection and invalidation dashboard |
