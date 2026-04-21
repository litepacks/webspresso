---
name: webspresso-usage
description: >-
  Comprehensive Webspresso framework reference: file-based SSR and API routing,
  createApp options, session auth (createAuth, quickAuth, webspresso/core/auth),
  Nunjucks/fsy helpers, i18n, lifecycle hooks, Zod API validation,
  ORM (zdb, defineModel, repository, query builder, migrations), plugins (admin,
  analytics, sitemap, SEO, audit, recaptcha), CLI, env vars, and testing. Use when
  working in this repo or any Webspresso app—adding routes, APIs, models, plugins,
  auth, or debugging routing, ctx.db, session, or templates.
---

# Webspresso — agent reference

## 1. What this framework is

- **SSR**: Express + **Nunjucks**; URLs map to files under `pages/`.
- **API**: File-based handlers under `pages/api/` with method suffixes and optional **Zod** validation (`req.input`).
- **i18n**: JSON locales; `t('key')` in templates.
- **ORM**: Knex-backed layer in `core/orm` — `defineModel`, `zdb` schema helpers, repositories, query builder, migrations.
- **Plugins**: Register in `createApp({ plugins })`; optional `db` passed as `ctx.db`.

Public API surface: `require('webspresso')` / [`index.js`](../../../index.js) — `createApp`, file-router utilities, `createHelpers`, plugin manager, ORM exports, built-in plugins. **Session auth** lives in [`core/auth`](../../../core/auth) — import **`require('webspresso/core/auth')`** (`createAuth`, `quickAuth`, `hash`, `verify`, `setupAuthMiddleware`, `createRememberTokensTable`, policy helpers); wire with **`createApp({ auth })`**.

---

## 2. Typical project layout

```
project/
├── server.js                 # listen(); uses createApp()
├── pages/
│   ├── _hooks.js             # global lifecycle hooks (optional)
│   ├── locales/en.json       # global i18n
│   ├── index.njk             # GET /
│   ├── about/index.njk       # GET /about
│   ├── blog/[slug].njk       # dynamic
│   └── api/
│       ├── health.get.js
│       └── posts.post.js
├── views/                    # layouts (e.g. layout.njk)
├── public/                   # static assets
├── models/                   # ORM models (defineModel)
├── migrations/
├── webspresso.db.js          # or knexfile.js
└── plugins/                  # app-specific plugins (optional)
```

---

## 3. `createApp(options)` — essentials

**Required**

- `pagesDir` — path to `pages/`.

**Common optional**

| Option | Role |
|--------|------|
| `viewsDir` | Layouts / partials (Nunjucks paths) |
| `publicDir` | Static files (`express.static`) |
| `db` | DB instance from `createDatabase()` → **`ctx.db`** in `load`, `meta`, plugins |
| `middlewares` | Named map; reference by string in route/API config (`middleware: ['auth']`) |
| `plugins` | Array of plugin factories/objects |
| `errorPages` | `{ notFound, serverError, timeout }` — function or template path |
| `timeout` | e.g. `'30s'` or `false` |
| `helmet` | `true` / `false` / object |
| `assets` | `{ version, manifestPath, prefix }` for `fsy.asset` / `fsy.css` / `fsy.js` |
| `auth` | `AuthManager` from **`createAuth()`** / **`quickAuth()`** (`webspresso/core/auth`). Mounts cookie parser + **`express-session`** + per-request **`authenticate`**; sets **`req.user`**, **`req.auth`**. Injects named route middleware **`auth`** and **`guest`** (overwrites same keys in `middlewares` if you passed both — avoid reusing those names for custom handlers). |
| `setupRoutes(app, ctx)` | **Register custom Express routes here** — runs **after** file routes and plugins’ `onRoutesReady`, **before** 404. **`ctx.authMiddleware`** is set when `auth` was passed (guards: `requireAuth`, `requireGuest`, `requireCan`, `requireVerified`, …). Do not rely on `app.get` *after* `createApp` returns unless routes are appended before the 404 middleware (see [`src/server.js`](../../../src/server.js)). |

**Returns:** `{ app, nunjucksEnv, pluginManager, authMiddleware }` — `authMiddleware` is **`null`** when `auth` was not configured.

### Session authentication — essentials

- **Import:** `const { createAuth, quickAuth, hash, verify, createRememberTokensTable } = require('webspresso/core/auth')` (published `core/` tree on npm; **not** re-exported from package root).
- **`createAuth({ findUserById, findUserByCredentials, session: { secret }, rememberTokens?, ... })`** — adapter pattern; optional **remember-me** via `rememberTokens: { create, find, delete, deleteAllForUser }` + **`createRememberTokensTable(knex)`** for the default table shape.
- **`quickAuth({ db, userModel, identifierField, passwordField, rememberMe })`** — wires **`getRepository`** + bcrypt **`verify`**; optional Knex **`remember_tokens`** when `rememberMe: true`.
- **Request API** (after global authenticate): **`req.auth.attempt(id, password, { remember })`**, **`login`**, **`logout`**, **`check`**, **`guest`**, **`user`**, **`id`**, **`can` / `cannot` / `authorize`** (policies: **`auth.definePolicy`**, **`defineGate`**, **`beforePolicy`**).
- **Route config:** `middleware: ['auth']` (must be logged in) or `['guest']` (logged-out only). For JSON APIs mounted in **`setupRoutes`**, use **`ctx.authMiddleware.requireAuth({ api: true })`** for 401 JSON instead of redirect.
- **Login page pitfall:** a **`pages/login.njk`** can register **before** `setupRoutes` and bypass **`requireGuest`**. Prefer login GET/POST in **`setupRoutes`** with templates under **`views/`** only, or omit **`pages/login.njk`** — see [`tests/e2e/auth.spec.js`](../../../tests/e2e/auth.spec.js).
- **Admin panel** uses a **separate** session (`req.session.adminUser`, `/_admin/api/auth/*`); it does **not** replace **`createApp({ auth })`** for site users.

Longer narrative: **[`doc/index.html#authentication`](../../../doc/index.html#authentication)** · README **Authentication (session)**.

---

## 4. File-based routing (SSR)

| Path pattern | URL |
|--------------|-----|
| `pages/index.njk` | `/` |
| `pages/about/index.njk` | `/about` |
| `pages/tools/[slug].njk` | `/tools/:slug` |
| `pages/docs/[...rest].njk` | `/docs/*` (catch-all) |

**Route config** — sibling `.js` file (e.g. `pages/tools/index.js`):

- `middleware` — array of Express functions, **string names** from `createApp({ middlewares })`, or **`['name', options]` tuples** when the registry entry is a **factory** `(options) => (req, res, next) => …` (bare string calls the factory with `{}`). Built-in **`auth`** / **`guest`** (with `createApp({ auth })`) are factories — e.g. **`['auth', { api: true }]`** for JSON 401 on APIs.
- `load(req, ctx)` — async; return object merged into template context; use **`ctx.db`** when `createApp({ db })` is set.
- `meta(req, ctx)` — title, description, etc.
- `hooks` — `beforeLoad`, `afterRender`, etc. (see hook order below).

---

## 5. File-based API (`pages/api/`)

| File | Route |
|------|-------|
| `api/health.get.js` | `GET /api/health` |
| `api/items.post.js` | `POST /api/items` |
| `api/users/[id].get.js` | `GET /api/users/:id` |

**Shapes**

1. **Function** — `module.exports = async (req, res) => { ... }`
2. **Object** — **`handler`**, optional **`middleware`** (names, functions, or **`['name', options]`** tuples with factory registry entries), optional **`schema`**

**Order:** `req.db` (if any) → **Zod** `schema` → **`middleware`** → **`handler`**.

**Zod** — `schema: ({ z }) => ({ body, query, params, response })` → **`req.input`**; invalid → **400** `{ error: 'Validation Error', issues }`.

---

## 6. Global and route hooks

**Global:** `pages/_hooks.js` exports `onRequest`, `beforeLoad`, `afterLoad`, `beforeRender`, `afterRender`, `onError`, etc.

**Rough order:** global `onRequest` → route middleware chain → `load` → render → `afterRender`. (See README “Hook Execution Order” for full list.)

---

## 7. i18n

- **Global:** `pages/locales/<locale>.json` (nested keys).
- **Route-specific:** `pages/<route>/locales/<locale>.json` overrides global.
- Templates: `{{ t('nav.home') }}`.
- Env: `DEFAULT_LOCALE`, `SUPPORTED_LOCALES` (comma-separated).

---

## 8. Template helpers (`fsy`)

Available in all Nunjucks templates:

- **URL:** `fsy.url`, `fsy.fullUrl`, `fsy.route`, `fsy.canonical`
- **Request:** `fsy.q`, `fsy.param`, `fsy.hdr`
- **Utils:** `fsy.slugify`, `fsy.truncate`, `fsy.prettyBytes`, `fsy.prettyMs`
- **Dates:** `fsy.date`, `fsy.dateFormat`, `fsy.dateFromNow`, `fsy.dateDiff`, …
- **Assets:** `fsy.asset`, `fsy.css`, `fsy.js`, `fsy.img` (with `assets` config)
- **Dev:** `fsy.isDev()`
- **SEO:** `fsy.jsonld`

Analytics plugin adds `fsy.analyticsHead`, `fsy.verificationTags`, etc., when configured.

---

## 9. ORM overview

**Define schema** with **`zdb`** (`zdb.id()`, `zdb.uuid()`, `zdb.nanoid()`, `zdb.string({...})`, `zdb.foreignKey`, `zdb.foreignUuid`, `zdb.foreignNanoid`, `zdb.timestamp`, `zdb.json`, …).

**Define model** with **`defineModel({ name, table, schema, relations, scopes, hidden, admin })`**.

- **Relations:** `belongsTo`, `hasMany`, `hasOne` with `model: () => OtherModel`.
- **Scopes:** `softDelete`, `timestamps`, optional `tenant` column.
- **`hidden`:** columns never exposed in admin/API (e.g. `password_hash`).
- **Nanoid PK:** `zdb.nanoid()` / `zdb.nanoid({ maxLength: 12 })` — string primary key; migrations use `string(length)`. On **`create()`**, omitting the PK auto-fills a URL-safe id (built-in generator, same alphabet as `nanoid`). Use **`zdb.foreignNanoid('table', { maxLength })`** when the parent uses nanoid PKs; **`generateNanoid`** is exported from `webspresso` for manual ids. In API **`schema`**, use **`z.nanoid()`** / **`z.nanoid(12)`** / **`z.nanoid({ maxLength })`** (the `z` from `schema: ({ z })` is extended by Webspresso). **`zodNanoid`** / **`extendZ`** are also exported for non-route use.

**Database:** `createDatabase({ client, connection, models: './models' })` — auto-loads `models/*.js` (ignore `_prefix`).

**Repository:** `db.getRepository('User')` → `findById`, `findOne`, `findAll`, `create`, `update`, `delete`, `query()`, …

**Query builder:** `UserRepo.query().where(...).with('relation').orderBy(...).list()` / `.first()` / `.paginate()` / `.count()`. **`with()`** eager-loads relations; **`count()`** ignores builder `.limit`/`.offset` for total; see ORM docs for edge cases.

**Migrations:** `webspresso db:migrate`, `db:rollback`, `db:status`, `db:make`.

**Transactions:** `db.transaction(async (trx) => { trx.getRepository('User') })`.

**Query cache (optional):** `createDatabase({ ..., cache: true })` or `cache: { defaultStrategy: 'auto'|'smart', memory: { maxEntries, defaultTtlMs }, provider?: custom }`. Opt-in per model: `defineModel({ ..., cache: 'auto'|'smart'|true })`. API: `db.cache` → `getMetrics()`, `purge()`, `invalidateModel(name)`, `invalidateTags(tags[])`, `resetMetrics()`. Reads bypass cache when using a transaction knex. Admin UI: `ormCacheAdminPlugin({ db })` (needs `admin-panel` and `cache` enabled).

Pass **`db`** into **`createApp({ db })`** so **`ctx.db`** works in pages and plugins. **`pages/api/`** handlers receive **`req.db`** (and route **`middleware`** runs after it). Outside requests, use **`getDb()`** / **`hasDb()`**; for **`setupRoutes`**-only routes, use **`attachDbMiddleware`**.

---

## 10. Plugins (built-in — concise)

| Plugin | Purpose |
|--------|---------|
| `dashboardPlugin` | Dev route `/_webspresso` — route list |
| `sitemapPlugin` | `/sitemap.xml`, robots; optional DB-driven URLs |
| `analyticsPlugin` | GA / GTM / Yandex / Bing / Facebook — `fsy` helpers |
| `adminPanelPlugin` | SPA admin CRUD — needs `db` |
| `siteAnalyticsPlugin` | Self-hosted page views + admin charts |
| `auditLogPlugin` | Admin mutation audit trail |
| `recaptchaPlugin` | v2/v3 + middleware |
| `seoCheckerPlugin` | Dev SEO panel |
| `restResourcePlugin` | Opt-in REST CRUD from models; `?include=` uses ORM eager load (single-level relations only) |
| `ormCacheAdminPlugin` | Admin page for ORM cache metrics / purge / invalidate (`db.cache` required) |

**Custom plugin:** `name`, `version`, `register(ctx)`, `onRoutesReady(ctx)` — use `ctx.app`, `ctx.db`, `ctx.addHelper`, `ctx.addRoute`, `ctx.usePlugin('other')`. Plugin failures **warn**; app keeps running.

---

## 11. CLI (project directory)

| Command | Role |
|---------|------|
| `webspresso new` | Scaffold project |
| `webspresso dev` / `start` | Servers |
| `webspresso page` / `api` | Interactive scaffolding |
| `webspresso db:*` | migrate, rollback, status, make |
| `webspresso seed` | Seed data |
| `webspresso doctor` | Env / layout / optional `--db` check |
| `webspresso skill` | Cursor `SKILL.md` scaffold |
| `webspresso skill --preset webspresso` | Copy bundled **Webspresso agent reference** skill |
| `webspresso add tailwind` | Tailwind setup |
| `webspresso favicon:generate` | Favicons + manifest |
| `webspresso admin:setup` / `admin:password` | Admin users |
| `webspresso audit:prune` | Audit log retention |

---

## 12. Environment variables (common)

| Var | Notes |
|-----|-------|
| `NODE_ENV` | `development` / `production` |
| `DEFAULT_LOCALE` | Default locale |
| `SUPPORTED_LOCALES` | Comma-separated |
| `BASE_URL` | Canonical / links |
| `DATABASE_URL` | DB connection |
| `SESSION_SECRET` | Session cookie signing — set on auth config **`session.secret`** or read from env in app code |

---

## 13. Testing

- **Unit / integration:** `npm test` (Vitest).
- **E2E:** `npm run test:e2e` (Playwright).

Touching **CLI**, **ORM**, or **server routing** — run the relevant suite.

---

## 14. Pitfalls (for agents)

1. **Custom Express routes** must be registered in a way that runs **before** the catch-all 404 inside `createApp` — use **`setupRoutes`** (see [`src/server.js`](../../../src/server.js)), not only `app.use` after `createApp` returns.
2. **File-router wins first:** If both `pages/foo.njk` and a manual route exist, understand **order** — prefer file-based structure for SSR.
3. **`ctx.db` is undefined** unless `createApp({ db })` receives a `createDatabase()` instance.
4. **ORM hidden fields** — never return `hidden` columns to clients; use explicit selects if needed.
5. **Zod on API** — invalid input surfaces as validation errors; handlers should assume **`req.input`** is validated when schema is set.
6. **Built-in `auth` option** — if you pass **`createApp({ auth })`**, do not expect a custom **`middlewares.auth`** to apply; the framework assigns **`auth`** / **`guest`** to the session guards.
7. **Login route vs file router** — **`pages/login.njk`** can shadow custom login handlers; align with **`setupRoutes`** + **`views/`** pattern above.

---

## 15. When to load this skill

- Adding or changing **pages**, **API routes**, **models**, **migrations**, **plugins**, **locales**, or **session auth** (`createAuth`, `createApp({ auth })`, policies).
- Explaining **Webspresso** behavior vs plain Express.
- Debugging **404 order**, **i18n**, **session/auth**, **ORM**, or **admin** integration.

For authoritative long-form detail, see **[README.md](../../../README.md)** and **[`doc/index.html`](../../../doc/index.html)** (e.g. **Authentication**) in the repo.
