# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Lightweight Reusable Services Layer (`src/services`, `ctx.service`, `req.service`)
- **Auto-Discovery & File Naming**: Recursively scans `services/` directory and converts file paths into dot-separated service identifiers (e.g. `services/user/get.js` → `user.get`, `services/post/publish.js` → `post.publish`, `services/user/profile/get.js` → `user.profile.get`).
- **Shared Context Service Composition**: Execute services from SSR loaders (`ctx.service()`), API routes (`req.service()`), or within other services while sharing the exact same request context (`ctx.db`, `ctx.auth`, `ctx.session`, `ctx.user`).
- **Circular Call Detection**: Automatically tracks service call stacks and catches recursion/dependency cycles early (`user.get -> profile.get -> user.get`), throwing a clean `Circular service call detected` error.
- **Zod & Lightweight Input Schema Validation**: Validates arguments prior to handler execution using Zod functional schemas (`({ z }) => z.object(...)`), Zod instances, or simple type descriptors (`'number'`, `'string'`, `'email'`, `'boolean'`, `'object'`, `'array'`, `'date'`).
- **In-Memory Caching & Memoization (`src/services/memoize.js`)**: Cache service results with TTL expiration, Cache Stampede / Thundering Herd in-flight request deduping, true LRU eviction, object mutation protection (`clone: true`), and safe serialization for `BigInt`, `Buffer`, and circular references.
- **Cache Invalidation**: Explicitly invalidate cache keys via `ctx.service.invalidate(name, input)` or clear service cache via `ctx.service.clearCache(name)`.
- **Interactive CLI Runner (`webspresso service`)**: Test and run services interactively from the command line with automatic database resolution without spinning up the HTTP server.
- **Execution Timeouts (`timeout: '5s'`)**: Protect services against hanging handlers with automatic timeout abortion throwing `SERVICE_TIMEOUT` with HTTP 504 status.
- **Database Transaction Boundaries (`transaction: true`)**: Automatic Knex transaction lifecycle handling with seamless rollback on unhandled errors and single-transaction reuse across nested service calls.
- **Branch-Safe Concurrency & Call Stacks**: Parallel sibling service calls (`Promise.all`) execute across isolated call stack branches without colliding.
- **Authorization & Role-Based Access Control (`auth`)**: Built-in RBAC declarative guards (`auth: true`, `auth: 'admin'`, `auth: ['admin', 'finance']`, or custom predicate functions) throwing `UnauthorizedError` (401) or `ForbiddenError` (403).
- **`defineService` Helper & Registry**: Added `defineService()` / `service()` definition helpers and `createServiceRegistry()` factory with duplicate name detection and hot-reload support.

#### Zero-Dependency Native i18n & Localization Enhancements (`src/file-router.js`, `src/helpers.js`, `src/server.js`)
- **Native Pluralization (`Intl.PluralRules`)**: Support for CLDR plural forms (`zero`, `one`, `two`, `few`, `many`, `other`) and explicit numerical keys (`0`, `1`) via `t('key', { count })` and `t.plural(count, forms)`.
- **Automatic Fallback Locale Chain**: Missing dictionary keys in target locales fall back gracefully to `DEFAULT_LOCALE` (`en`) before returning key names. Check key presence via `t.has('key')` / `t.exists('key')`.
- **Built-in `Intl` Formatters on `t`**: Native locale-aware formatters: `t.number()` / `t.formatNumber()`, `t.currency()` / `t.formatCurrency()`, `t.date()` / `t.formatDate()`, and `t.relativeTime()` / `t.formatRelativeTime()`.
- **Nunjucks Template Helpers & Filter**: Added `{{ 'key' | t(params) }}` filter and `fsy.localeUrl(targetLocale)` URL switcher helper with preserved query strings.

#### Security Hardening & Automated Security Testing
- **Open Redirect Protection (`plugins/redirect/index.js`)**: Hardened `isExternalTarget(to)` against backslash evasion (`\\`, `/\`, `\/`) and dangerous pseudo-schemes (`javascript:`, `data:`).
- **Admin Panel Filter Validation (`plugins/admin-panel/api.js`)**: Validates `req.query.filter` column keys strictly against `model.columns` to prevent query builder injection.
- **Prototype Pollution Immunity (`core/orm/utils.js`)**: Protected `deepClone` against `__proto__`, `constructor`, and `prototype` manipulation.
- **CRLF Header Splitting Defense (`plugins/basic-auth/index.js`)**: Sanitized `config.realm` against newline characters before injecting into `WWW-Authenticate` headers.
- **XSS & Script Breakout Defense (`src/server.js`, `src/helpers.js`)**: Nunjucks `json` filter encodes `<` to `\u003c` preventing `</script>` breakouts in templates; `AssetManager.buildAttributes` strictly validates HTML attribute key characters.
- **Configurable `trustProxy`**: Support for `options.trustProxy` (or `options.server.trustProxy`), allowing applications to disable proxy trust (`trustProxy: false`) when running directly without reverse proxies.
- **Automated Security Test Suite & Policy**: Added 14 dedicated security test suites in `tests/security/` (`npm run test:security`), added `npm run security` script, and created [`SECURITY.md`](file:///Users/ahmet/projects/webspresso/SECURITY.md).

## [0.0.86] - 2026-08-13

### Added

#### 3-State Column Sorting in Admin Panel SPA (`plugins/admin-panel`)
- **3-State Dynamic Column Sorting**: Interactive column header sorting cycling through `Unsorted` (↕) → `Ascending` (`asc`, ▲) → `Descending` (`desc`, ▼) → `Unsorted` on click.
- **URL Parameter Sync**: Automatically synchronizes `sort` and `order` query parameters with browser history (`window.history.replaceState`) for shareable, bookmarkable table views.
- **Column-Level Configuration**: Configure sorting per column in `zdb` schemas via `zdb.string({ sortable: true })` / `zdb.text({ sortable: false })` or chainable `.config({ sortable: boolean })`. Complex column types (`json`, `array`, `file`) default to non-sortable.
- **Model-Level Configuration**: Configure model-level sortable column whitelists (`sortableColumns: ['name', 'price']`) or disable table sorting completely (`sortable: false`) in `defineModel({ admin: { ... } })`.

### Fixed

#### Safe Date Parsing in Admin Panel Field Renderers
- **RangeError Prevention**: Fixed `RangeError: Invalid time value` in Mithril.js Admin Panel SPA date/datetime field renderers (`basic.js` and `04-field-renderers.js`) by validating date validity (`!isNaN(d.getTime())`) before calling `.toISOString()`.
- **Model Admin Sorting Options Propagation (`core/orm/model.js`)**: Ensured `sortable`, `sortableColumns`, and `columns` admin configuration options set in `defineModel` are correctly preserved on `model.admin`.

## [0.0.85] - 2026-08-12

### Added

#### Zero-Dependency JWT & Refresh Token System (`core/auth`)
- **HS256 JWT Generator & Verifier (`core/auth/jwt.js`)**: Native, zero-dependency JWT signing (`signJwt`), verification (`verifyJwt`), and decoding (`decodeJwt`) using Node.js's native `crypto` module (HMAC-SHA256, timing-safe signatures, duration parsing for `'15m'`, `'24h'`, `'30d'`, etc.).
- **Dual Authentication Architecture**: Supports **Session + Cookie** (stateful for browser SSR routes & Admin Panel) and **JWT Bearer + Refresh Tokens** (stateless for REST APIs, Mobile Apps & SPAs).
- **Refresh Token Rotation**: `auth.generateRefreshToken(user)` creates long-lived refresh tokens with `jti` nonces. `auth.refreshAccessToken(refreshToken, { rotate: true })` handles token rotation and issues fresh access/refresh token pairs. Automatically rejects refresh tokens when passed to access endpoints.
- **Request & Middleware Integration**:
  - `req.auth` helper methods: `generateUserToken`, `generateRefreshToken`, `refreshAccessToken`, `createJwt`, `verifyJwt`.
  - Global `authenticate` middleware automatically prioritizes `Authorization: Bearer <token>` headers before falling back to Session and Remember-Me cookies.
  - Guard middleware `requireJwt()` (and `middleware: ['jwt']` on file-based API routes) enforces valid Bearer Access Tokens.
- **`quickAuth({ db, jwt: true })`**: Opt-in `jwt` option (`jwt: true` or `jwt: { secret, refreshSecret, expiresIn, refreshExpiresIn }`) to enable JWT & Refresh Token support alongside ORM integration.

#### Zero-Dependency CORS Plugin (`plugins/cors.js`)
- **`corsPlugin(options)`**: Zero-dependency CORS plugin supporting string origins (`'https://app.com'`), origin arrays, RegExp patterns (`/\.domain\.com$/`), and custom callback functions `(origin, callback)`.
- **Preflight & Credentials Support**: Handles `OPTIONS` preflight requests (`204 No Content`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, `Access-Control-Max-Age`). Supports `credentials: true` with automatic `Access-Control-Allow-Credentials: true` and dynamic origin reflection.
- **Route Filtering**: Supports route prefix filtering (`routes: ['/api']`) and registers named route middleware (`middleware: ['cors']`).
- **Exported from `plugins`**: Re-exported via `webspresso/plugins`.

### Fixed

#### Server Middleware Registration (`src/server.js`)
- Registered `middlewares.jwt` in `createApp` when `authManager` is provided, enabling file-based API route configs (`pages/api/*`) to specify `middleware: ['jwt']` natively.

### Security

#### CodeQL Vulnerability Audit & Fixes
- **CSRF Cookie Options & Storage (`plugins/csrf/index.js`)**: Resolved CodeQL "Clear text storage of sensitive information" alert by computing `effectiveCookieOptions` dynamically inside CSRF middleware, ensuring `httpOnly: true`, `sameSite: 'lax'`, and dynamic HTTPS/secure evaluation (`req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production'`).
- **DOM XSS Sanitization (`plugins/content/client/inline-edit.js`)**: Resolved CodeQL "DOM text reinterpreted as HTML" alert by introducing `sanitizeClientHtml(htmlStr)` using browser `DOMParser` to strip dangerous tags (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, `<base>`), inline `on...` event attributes, and `javascript:` URIs before updating DOM elements.
- **HTML Sanitization Regex in Tests (`tests/unit/content/field-types.test.js`)**: Resolved CodeQL "Bad HTML filtering regexp" alert by replacing naive regex `/<script>.*?<\/script>/g` in test mock with the robust `sanitize-html` library.
- **Session Cookie Security in Tests (`tests/integration/csrf.test.js`)**: Resolved CodeQL "Clear text transmission of sensitive cookie" alert by updating test session configuration to explicitly set `secure: process.env.NODE_ENV === 'production'`, `httpOnly: true`, and `sameSite: 'lax'`.
- **Windows Command Execution (`bin/commands/orm-map.js`)**: Resolved CodeQL "Shell command built from environment values" alert by replacing `execFileSync('cmd', ['/c', 'start', '', fp])` with direct `execFileSync('explorer.exe', [fp.replace(/\//g, '\\')])` on Windows, eliminating shell interpreter invocation and command injection risk.
- **Auth Session Cookie Configuration (`core/auth/manager.js`)**: Resolved CodeQL "Clear text transmission of sensitive cookie" alert by enforcing `httpOnly: true` and `sameSite: 'lax'` defaults in `getSessionConfig()` alongside dynamic secure cookie computation.

## [0.0.84] - 2026-08-10

### Added

#### Admin Panel Custom HTML & External URL Pages (`plugins/admin-panel`)
- **Custom Pages (`url` / `iframeUrl`, `html` / `htmlFile`)**: `registerPage` and `registerModule` support embedding external web pages (`url` inside `<iframe>`) or custom HTML documents (`html` or `htmlFile` path rendered directly into the native DOM via `m.trust` with full Tailwind CSS styling and script execution). Optional `iframe: true` allows sandboxed iframe isolation if needed.
- **Automatic Layout Wrapping**: Custom pages are automatically wrapped inside the Admin Panel layout (breadcrumbs, header, title) unless `layout: false` is configured for full-screen pages.

#### SSR Script & Style Import Registration (`plugins/admin-panel`)
- **`registerScript` & `registerStyle`**: Added `registerScript(script)` and `registerStyle(style)` methods to `AdminRegistry`, `adminApi`, and `registerModule({ scripts: [...], styles: [...] })`.
- **SSR Injection**: External scripts (e.g. `<script src="https://unpkg.com/euixjs@latest/dist/EUIXEngine.umd.js"></script>`) and custom CSS links are rendered directly into the Admin Panel SSR `<head>` and `</body>` markup.

### Fixed

#### Inline HTML Script Tag Escaping (`plugins/admin-panel/index.js`)
- Escaped `<` as `\u003c` during JSON serialization of `window.__ADMIN_CONFIG__` in `generateAdminPanelHtml`, preventing raw HTML documents embedded in custom pages from breaking the Admin Panel `<script>` context.

#### SPA Navigation & Route Resolution (`plugins/admin-panel/modules/menu.js`, `plugins/admin-panel/app.js`)
- Updated `MenuItem` href generation to correctly prefix custom route paths with `adminPath` (`/_admin/euix`).
- Scheduled `m.redraw()` on async route resolution to ensure seamless client-side SPA navigation without manual workaround hacks.

#### E2E & Unit Test Coverage
- Added automated E2E tests for interactive EUIX counter components and EUIX documentation site embedding (`tests/e2e/admin-panel.spec.js`).

## [0.0.83] - 2026-08-02

### Fixed

#### Admin Panel Module API Error Handling (`plugins/admin-panel/core/admin-module.js`)
- **`registerModule` API routes**: Wrapped registered API route handlers in an `async (req, res, next)` error wrapper (`safeHandler`). Synchronous errors and rejected Promises in module API routes are caught and forwarded to Express global error handling (`next(err)`), preventing Node.js process crashes.

#### Custom Page Closure Component Lifecycle (`plugins/admin-panel/app.js`)
- **`wrapCustomPageWithLayout`**: Instantiates closure component factory functions (`typeof rawComp === 'function'`) into `vnode.state.instance` during `oninit`. Executes component lifecycle hooks (`oninit`, `oncreate`, `onupdate`, `onbeforeremove`, `onremove`) on `vnode.state.instance`, ensuring custom pages (such as `audit-log` admin UI) run their `oninit` data loaders properly.

#### Audit Log Admin Component (`plugins/audit-log/admin-component.js`)
- **`m.redraw()` on async fetch**: Added `m.redraw()` invocation inside `AuditLogPage`'s `api.get` `.then()` and `.catch()` handlers so Mithril re-renders the component view as soon as data arrives.

#### Audit Log E2E Test (`tests/e2e/audit-log.spec.js`)
- Updated test locator to wait directly for the `/Total:/` text element on page load.

### Security

#### Locale & i18n file paths (`src/file-router.js`)
- **`detectLocale`**: **`?lang`** and **`Accept-Language`** resolve only to **`SUPPORTED_LOCALES`** entries and a safe **`[a-z0-9-]{1,16}`** tag shape; rejects traversal-style **`lang`** for **`loadI18n`** / **`pages/locales/*.json`**. Defaults fall back via **`DEFAULT_LOCALE`** then first configured locale.

#### Translator & SSR utilities
- **`createTranslator`**: interpolates **`{{ key }}`** with **RegExp-escaped keys** when replacing params.
- **`filePathToRoute`**: **`[segment]` / `[...segment]`** conversion uses a linear scan (**no bracket regex** flagged by analyzers).

#### Logging
- **`loadI18nFile`**, **`loadRouteConfig`**: **`console.error`** uses fixed first message + separate arguments (avoid format-string quirks with attacker-influenced paths).

#### Slash trimming (ReDoS-hardened)
- New **`core/url-path-normalize.js`** — **`trimUrlPathSlashes`**: linear-time leading/trailing **`/`** trimming (avoids polynomial regexes like **`/^\/+|\/+$/g`** on long slash runs) in **`plugins/swagger.js`**, **`plugins/rest-resources`**, **`core/orm/model`** (**`rest.path`**), **`plugins/upload/local-file-provider`**.

#### OpenAPI generator (`core/openapi/build-from-api-routes.js`)
- **`paths`** nested maps use **`Object.create(null)`**; only allowlisted lowercase HTTP methods (**`get`**, **`post`**, **`put`**, **`patch`**, **`delete`**, **`head`**, **`options`**) populate operations.

#### Session cookies (`core/auth/manager.js`)
- **`getSessionConfig`**: **`cookie.secure`** is **`true`** when **`NODE_ENV === 'production'`**, **`COOKIE_SECURE === 'true'`**, or **`BASE_URL`** is **`https:`**; an explicit **`session.cookie.secure` boolean from the caller still wins.

#### CLI / tooling
- **`orm:map`**: browser **`open`** / **`xdg-open`** only after the written HTML resolves under **`process.cwd()`** or the OS temp dir (**`realpathSync`** checks).

#### Admin rich-text HTML (`plugins/admin-panel`)
- **`sanitize-html`** (dependency): model **create/update** routes sanitize **`admin.customFields`** columns with **`type: 'rich-text'`** before persistence (whitelist tuned for Quill). Nullable columns normalize empty HTML to **`null`** after sanitization.
- **`adminPanelPlugin({ richTextSanitize: false })`** disables server-side sanitization (increases XSS risk if HTML is rendered unsafely).

#### Admin rich-text emptiness (`plugins/admin-panel`)
- Shared **`lib/is-rich-text-empty.js`** with **repeat-until-stable** stripping of **`/<[^>]*>/`**; **`api.js`** imports it; **SPA bundle prepends** the same file via **`client/load-parts.js`**.

#### Tests
- **`tests/unit/admin-panel/sanitize-rich-html.test.js`**, **`tests/integration/admin-rich-text-sanitize.test.js`**: rich-text HTML sanitization behavior and **`richTextSanitize: false`** opt-out.
- **`tests/unit/cli.test.js`**: interactive **`webspresso new`** flows use **`spawnSync`** + stdin (no shell pipeline); quoted favicon args parsed with **`tokenizeCliLine`**.
- **`tests/unit/error-pages.test.js`**: custom 404 example uses **`encodeURIComponent(req.path)`** instead of raw reflection.
- **`tests/integration/admin-panel.test.js`**: rich-text empty check asserts **`isRichTextEmpty`** from the shared lib.

### Fixed

#### Standalone docs on GitHub Pages (`doc/index.html`)
- **Tailwind Play CDN** (**`cdn.tailwindcss.com`**) loads **without SRI / `crossorigin="anonymous"`** — that combination triggers **CORS** failures (redirect chain, missing **`Access-Control-Allow-Origin`**) on **`*.github.io`**.
- Inline config wrapped in **`typeof tailwind !== 'undefined'`** so a failed CDN load does not throw **`ReferenceError`**.

### Changed

#### Error pages & SSR (`src/server.js`)
- **`createErrorContext`** uses **`detectLocale(req)`** instead of **`req.query.lang`** directly (aligned with i18n allowlist behaviour).

#### File router (`src/file-router.js`)
- API route registration: removed redundant no-op **`/^\/api`** replace before **`filePathToRoute`**.

### Added

#### API routes: runtime Zod + object export
- **`schema`** on `pages/api/*.js` is applied before **`middleware`** and **`handler`**; validated data on **`req.input`**; failures **`400`** `{ error: 'Validation Error', issues }`
- Documented **object export**: `{ middleware: ['name'], schema, handler }` with **`createApp({ middlewares: { name } })`**

#### App context (`req.db`, `getDb()`, `attachDbMiddleware`)
- **`req.db`** — set on each **`pages/api/*`** request when **`createApp({ db })`** is used (before handler and per-route **`middleware`**)
- **`getDb()`**, **`hasDb()`**, **`getAppContext()`** — same instance for scripts/jobs/tests; registry filled by **`createApp`**
- **`attachDbMiddleware`** — use in **`setupRoutes`** for manually registered routes that need **`req.db`**
- **`resetAppContext()`** / **`setAppContext()`** — testing and advanced use

#### ORM: Nanoid column type
- **`zdb.nanoid()`** / **`zdb.nanoid({ maxLength })`**: URL-safe string primary key (VARCHAR in migrations; default length 21).
- **`zdb.foreignNanoid(table, opts)`**: Foreign key to a nanoid primary key (`referenceColumn`, `nullable`, `maxLength`).
- **Auto-fill on create:** Omitting the PK on `repository.create()` generates an id via built-in **`generateNanoid`** (same default alphabet as the `nanoid` package; no extra npm dependency). **`generateNanoid`** is exported from `webspresso`.
- **`zodNanoid(z, size?)`**: Zod helper for API `schema` validation (params/query/body) matching the same alphabet and length as **`generateNanoid`** / **`zdb.nanoid({ maxLength })`**.
- **`z.nanoid()`** on the `z` passed to **`schema: ({ z }) => …`**: same as **`zodNanoid`**, via **`extendZ`** (also exported). Supports **`z.nanoid()`**, **`z.nanoid(12)`**, **`z.nanoid({ maxLength: 12 })`**.
- OpenAPI, admin field renderers, and seeders recognize the `nanoid` column type.

#### Admin panel: dark mode
- **Tailwind `darkMode: 'class'`** on `<html>` with **`localStorage`** key **`webspresso-admin-theme`**: **system** (default, follows `prefers-color-scheme`), **light**, or **dark**.
- **Theme toggle** (monitor / sun / moon) in the **sidebar header** and **mobile top bar**; initial theme script in the admin HTML avoids flash.
- **UI**: `dark:` variants across admin Mithril views; **Quill** rich-text toolbar/editor styled in dark mode via scoped CSS.

#### Plugin Error Handling (Graceful Degradation)
- **Warning instead of crash**: Plugin errors do not crash the app; only `console.warn` is logged
- **Missing / incompatible dependencies**: Warning instead of throw for missing or version-mismatched `dependencies`; plugin still loads
- **Circular dependency**: Warning instead of throw when detected; plugins in the cycle are skipped
- **Duplicate / nameless plugin**: Warning instead of throw for duplicate name or missing `name`
- **`register()` and `onRoutesReady()` errors**: Wrapped in try/catch; on error a warning is logged and the server stays up
- A single faulty plugin no longer blocks the entire application

#### Site Analytics Plugin (New)
- **Self-hosted Analytics**: Privacy-first page view tracking with no external dependencies
- **Tracking Middleware**: Non-blocking Express middleware that records page views asynchronously
- **Bot Detection**: 40+ user-agent patterns (Googlebot, GPTBot, curl, Python, WhatsApp, etc.)
- **Country Detection**: Automatic country identification via CDN headers (Cloudflare, Vercel) with Accept-Language fallback
- **IP Hashing**: Privacy-first design - IP addresses are SHA-256 hashed before storage
- **Session Tracking**: Cookie-free visitor fingerprinting (IP + User-Agent hash) with 30-minute session windows
- **Auto-migration**: `analytics_page_views` table created automatically on first request
- **Admin Dashboard Page**: Full analytics page in the admin panel with:
  - Summary cards (views, visitors, unique pages, sessions)
  - Views over time chart (Chart.js line chart with daily breakdown)
  - Bot activity list with horizontal bar visualization
  - Top pages ranked by view count (scrollable, max-height container)
  - Recent activity feed with country flags and timestamps (scrollable, max-height container)
  - Country statistics with flag emojis and distribution bars
  - Date range filter (Last 7 / 30 / 90 days)
- **6 API Endpoints**: `/stats`, `/views-over-time`, `/top-pages`, `/bot-activity`, `/countries`, `/recent`
- **Database Agnostic**: Works with SQLite, PostgreSQL, and MySQL via Knex
- **Configurable**: `excludePaths`, `trackBots`, custom `tableName` options

#### Admin Panel Extensibility
- **Plugin API**: Admin panel now exposes `api` property for inter-plugin communication (`getRegistry()`, `getAdminPath()`, `serveAdminPanel`, `requireAuth`, `optionalAuth`)
- **Client Components**: New `registerClientComponent(pageId, jsCode)` method on registry for injecting custom Mithril.js page components from external plugins
- **Dynamic Page Routing**: Mithril.js router now automatically creates routes for custom pages registered via the registry
- **`hasClientComponent` Flag**: `toClientConfig()` includes `hasClientComponent` field for each page

#### Admin Module Registration System (New)
- **`registerModule(config)` API**: Declarative method on admin panel API for registering pages, menu items, API routes, widgets, and menu groups in a single call
- **Pages**: Register custom admin pages with optional Mithril.js client component code; SPA routes are created automatically
- **Menu Items & Groups**: Register sidebar menu items and collapsible groups
- **API Routes**: Define API endpoints with configurable prefix, HTTP methods, and per-route auth control (`auth: true/false`)
- **Widgets**: Register dashboard widgets with data loaders
- **Config Validation**: Clear error messages for missing or invalid configuration fields
- **Non-breaking**: Existing manual registry/route registration APIs remain fully supported; `registerModule` is a convenience layer on top
- **Site Analytics Refactored**: `site-analytics` plugin now uses `registerModule` internally, reducing ~20 lines of boilerplate to a single declarative config object

#### ctx.db - Database Access in Plugins and Pages
- **Plugin Context**: `ctx.db` available in `register(ctx)` and `onRoutesReady(ctx)` when `createApp({ db })` is used
- **Page load/meta**: `ctx.db` passed to `load(req, ctx)` and `meta(req, ctx)` in SSR route configs
- **No imports required**: Plugins and pages access the database through context without importing `createDatabase` or passing db in plugin options
- **Nullable**: `ctx.db` is `null` when db is not passed to createApp — check `if (ctx.db)` before use

#### Admin Panel - Mobile Responsive Sidebar
- **Hamburger Menu**: Mobile header with hamburger button for sidebar toggle on small screens
- **Slide-in Sidebar**: Sidebar slides in from the left with `translate-x` animation on mobile
- **Backdrop Overlay**: Semi-transparent dark overlay behind sidebar when open on mobile
- **Close Button**: X button in sidebar header for closing on mobile (visible only on `< lg`)
- **Auto-close on Navigation**: Sidebar automatically closes when a menu item is clicked
- **Responsive Layout**: Main content area uses `lg:ml-64` (desktop sidebar offset) and `pt-20` (mobile header offset) for proper responsive spacing
- **Z-index Layering**: Proper stacking order - mobile header (z-20), backdrop (z-30), sidebar (z-40)

#### Sitemap Plugin v2.0 - Dynamic Database Content
- **Dynamic Sources**: Generate sitemap URLs from database records using `dynamicSources` option
- **Model-based URLs**: Automatically fetch records from ORM models and generate URLs
- **Custom Query Support**: Use custom query functions for complex filtering and joins
- **URL Pattern Placeholders**: Support for `:param` and `[param]` style placeholders
- **Field Mapping**: Map URL placeholders to different database field names
- **Filter Function**: Filter which records appear in sitemap
- **Transform Function**: Transform records before URL generation
- **Caching**: Configurable cache with `cacheMaxAge` option (default: 5 minutes)
- **Cache Invalidation**: `api.invalidateCache()` method for manual cache clearing
- **New API Methods**: `addDynamicSource()`, `getDynamicSources()`, `invalidateCache()`
- **Per-source i18n Control**: Disable i18n for specific sources with `i18n: false`

#### Server Enhancements
- **Request Timeout**: Added `connect-timeout` middleware with configurable timeout (default: 30s)
- **Timeout Options**: `timeout` option in `createApp()` to configure or disable request timeout
- **Timeout Error Pages**: Custom 503 error page support via `errorPages.timeout`
- **Graceful Timeout Handling**: Proper request termination with `haltOnTimedout` helper

#### Script Injection System
- **ScriptInjector Class**: New class for managing dynamic content injection into templates
- **Head Injection**: `fsy.injectHead()` helper to inject content into `<head>` section
- **Body Injection**: `fsy.injectBody()` helper to inject content at end of `<body>`
- **Style Injection**: Inject CSS styles dynamically from plugins
- **Priority Sorting**: Content sorted by priority (higher priority first)
- **Plugin API**: `ctx.injectHead()`, `ctx.injectBody()`, `ctx.injectStyle()` methods for plugins

#### Dev Toolbar
- **Development Toolbar**: Fixed toolbar at bottom of page in development mode
- **Quick Links**: Default links to Dashboard, Admin Panel, Schema Explorer
- **Plugin Registration**: Plugins can register custom links via `ctx.registerDevLink()`
- **Hover Expand**: Toolbar expands on hover, minimized by default
- **Modern Design**: Dark theme with gradient background and smooth animations
- **Auto-hide in Production**: Toolbar automatically hidden in production mode

#### Admin Panel Filter Redesign
- **Descriptive Filter Operators**: Changed symbols (~, =, >, etc.) to readable text (Contains, Equals, Greater than)
- **Quick Filters Bar**: Search input and "All Filters" button above table
- **Filter Drawer**: Slide-in panel for advanced filtering options
- **Boolean Filter UI**: Radio buttons (Yes/No/Any) for boolean field filtering
- **Active Filters Display**: Badge-style display of currently applied filters

#### SEO Checker Plugin (New)
- **Client-side SEO Analysis**: Inspired by django-check-seo, performs 40+ SEO checks in browser
- **7 Check Categories**: Meta, Headings, Content, Links, Images, Structured Data, URL
- **Meta Checks**: Title/description length, canonical, viewport, robots, charset, language
- **Heading Checks**: H1 existence/uniqueness, heading hierarchy, non-empty headings
- **Content Checks**: Word count, paragraph structure, keyword usage and placement
- **Link Checks**: Internal/external links, nofollow analysis, anchor text quality
- **Image Checks**: Alt text, descriptive alt, dimensions, lazy loading
- **Structured Data Checks**: Open Graph, Twitter Card, JSON-LD, hreflang
- **URL Checks**: Length, depth, readability, HTTPS
- **Score Calculation**: Overall SEO score (0-100) based on weighted checks
- **Dev Toolbar Integration**: "SEO Check" button in dev toolbar
- **Floating Panel**: Beautiful dark-themed floating panel with category tabs
- **Configurable Settings**: Customize thresholds for title length, word count, etc.
- **Auto-disabled in Production**: Only active in development mode

### Fixed

#### Admin panel: Quill / CSP
- **jsDelivr in CSP**: `cdn.quilljs.com` now redirects to `cdn.jsdelivr.net`; plugin CSP includes **`https://cdn.jsdelivr.net`** for `style-src`, `script-src`, and `connect-src` so the rich-text editor (Quill) loads in production.

#### ORM Boolean Field Handling
- **SQLite Boolean Coercion**: Fixed `z.boolean()` validation failing with SQLite's 0/1 values
- **String Boolean Support**: Added support for string values ('true', 'false', '0', '1')
- **Preprocess Integration**: Used `z.preprocess()` for automatic type conversion before validation

### Changed
- **Sitemap Plugin Version**: Bumped to 2.0.0 with breaking changes in dynamic URL handling

#### W-Runtime (Experimental)
- **Resumability**: Zero JavaScript execution on page load, islands hydrate lazily on first interaction
- **Event Delegation**: Only 3 global event listeners (click, input, submit) instead of N listeners per element
- **Lazy Hydration**: Islands hydrate only when needed, unused islands never load
- **Attribute-based bindings**: `w-root`, `w-model`, `w-text`, `w-show`, `w-hide`, `w-disabled`, `w-on:click`, `w-on:submit`
- **Backend-driven configuration**: Island state and actions defined server-side as JSON descriptors
- **Descriptor-based actions**: `apiCall` action type for declarative API calls
- **SSR-friendly**: Config embedded as JSON in HTML, initial values rendered server-side
- **Runtime API**: `w.resume()`, `w.init()`, `w.hydrate()`, `w.getStats()` methods
- **Performance**: ~6.6x faster Time to Interactive (TTI), ~20x less initial JS execution

#### Template Helpers
- **dayjs integration**: Added dayjs as a core dependency for date/time manipulation in templates
- **Date helpers**: `fsy.date()`, `fsy.dateFormat()`, `fsy.dateFromNow()`, `fsy.dateAgo()`, `fsy.dateUntil()`
- **Date comparison**: `fsy.dateIsBefore()`, `fsy.dateIsAfter()`, `fsy.dateIsSame()`
- **Date arithmetic**: `fsy.dateAdd()`, `fsy.dateSubtract()`, `fsy.dateDiff()`
- **Date utilities**: `fsy.dateStartOf()`, `fsy.dateEndOf()`
- **Full dayjs API**: Access full dayjs functionality via `fsy.date()` which returns a dayjs instance
- **Plugins included**: relativeTime, utc, timezone, customParseFormat

#### CLI Enhancements
- **Interactive project creation**: `webspresso new` command now accepts optional project name
- **Current directory installation**: Prompt to install in current directory when no project name provided
- **Project name validation**: Interactive prompts for project name when using current directory
- **Better error handling**: Warnings when current directory is not empty or already contains Webspresso project
- **Interactive installation flow**: After project creation, prompts to install dependencies and build CSS
- **Auto dev server start**: Option to automatically start development server after installation
- **CSS watch integration**: Dev server automatically includes `watch:css` when Tailwind is enabled
- **Seed CLI command**: `webspresso seed` command for existing projects to run database seeders
- **Seed setup option**: `--setup` flag to automatically create seed files if they don't exist
- **Automatic seed execution**: Seed command automatically loads models and generates fake data
- **Database selection**: Interactive prompt to select database (SQLite, PostgreSQL, MySQL) during project creation
- **Database driver installation**: Automatically adds appropriate database driver (`better-sqlite3`, `pg`, `mysql2`) to `package.json`
- **Database config generation**: Creates `webspresso.db.js` with proper configuration for selected database
- **Migrations directory**: Automatically creates `migrations/` directory when database is selected
- **Models directory**: Automatically creates `models/` directory when database is selected
- **Seed data generation**: Interactive prompt to generate seed data based on existing models
- **Automatic seed setup**: When seed is selected, adds `@faker-js/faker` dependency and creates `seeds/index.js` with auto-detection
- **Seed script**: Adds `npm run seed` command to `package.json` for easy seed execution
- **Smart model detection**: Seed script automatically loads all models from `models/` directory and generates fake data
- **DATABASE_URL in .env.example**: Adds appropriate `DATABASE_URL` template to `.env.example` based on selected database
- **Streamlined workflow**: `webspresso new` → database selection → seed setup → install → build → dev server (with CSS watch) in one flow
- **--install flag enhancement**: Now also prompts for dev server start (previously only installed dependencies)

#### Documentation
- **W-Runtime documentation**: Complete guide with examples, resumability explanation, and limitations
- **CLI documentation**: Updated `new` command documentation with interactive mode examples

#### Testing
- **W-Runtime unit tests**: 41 comprehensive tests covering path utilities, island hydration, action descriptors, and integration scenarios
- **CLI test updates**: Tests for interactive mode, optional parameters, and error handling

### Changed

- **CLI `new` command**: Project name parameter is now optional (`[project-name]` instead of `<project-name>`)
- **README**: Added W-Runtime section with resumability explanation and performance metrics

### Technical Details

#### W-Runtime Implementation
- **File**: `public/w-runtime.js` (~515 lines)
- **Resumability pattern**: Inspired by Qwik framework
- **Island cache**: WeakMap-based for garbage collection friendly storage
- **Event delegation**: Single global listener per event type with `closest()` traversal
- **State management**: Simple object-based state with path resolution (`state.a`, `state.user.name`)
- **Rerender strategy**: Full rerender on any state change (no dependency tracking in v0)

#### Performance Metrics
| Metric | Before (Hydration) | After (Resumability) | Improvement |
|--------|-------------------|---------------------|-------------|
| Time to Interactive | ~100ms | ~15ms | **6.6x faster** |
| Initial JS Execution | 40ms | 2ms | **20x faster** |
| Event Listeners | 50+ | 3 | **17x fewer** |
| Memory (10 islands) | ~500KB | ~50KB* | **10x less** |

*Only hydrated islands consume memory

## [0.0.7] - 2025-01-07

### Added
- File-based routing with dynamic routes (`[param]`, `[...rest]`)
- API endpoints with method suffixes (`.get.js`, `.post.js`, etc.)
- Zod-based request validation for body, params, and query
- Built-in i18n with JSON-based translations
- Lifecycle hooks (global and route-level)
- Template helpers (Laravel-inspired)
- Plugin system with version control
- Built-in plugins: dashboard, sitemap, analytics
- ORM with Knex integration
- Database migrations CLI commands
- Schema explorer plugin

### Changed
- Initial release structure

---

## Version History

- **0.0.7**: Core framework with routing, ORM, plugins
- **Unreleased**: W-Runtime (experimental), CLI improvements, site analytics plugin, admin panel extensibility

---

## Notes

- W-Runtime is in **experimental** stage. API may change without notice.
- Resumability requires SSR to render initial values in HTML for immediate display.
- Interactive CLI mode requires terminal input, automated testing is limited.
