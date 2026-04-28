# Webspresso

[![npm version](https://img.shields.io/npm/v/webspresso.svg?style=flat-square)](https://www.npmjs.com/package/webspresso)
[![vulnerabilities](https://npmx.dev/api/registry/badge/vulnerabilities/webspresso?style=shieldsio)](https://npmx.dev/package/webspresso)

A minimal, file-based SSR framework for Node.js with Nunjucks templating.

## Features

- **File-Based Routing**: Create pages by adding `.njk` files to a `pages/` directory
- **Dynamic Routes**: Use `[param]` for dynamic params and `[...rest]` for catch-all routes
- **API Endpoints**: Add `.js` files to `pages/api/` with method suffixes (e.g., `health.get.js`)
- **Schema Validation**: Zod-based request validation for body, params, and query
- **Built-in i18n**: JSON-based translations with automatic locale detection
- **Lifecycle Hooks**: Global and route-level hooks for request processing
- **Template Helpers**: Laravel-inspired helper functions available in templates
- **Plugin System**: Extensible architecture with version control and inter-plugin communication
- **Built-in Plugins**: Development dashboard, sitemap generator, SEO checker, analytics integration (Google, Yandex, Bing), self-hosted site analytics, optional Swagger UI for HTTP APIs, configurable HTTP health probe endpoint, optional REST CRUD routes from ORM models, optional admin UI for ORM query cache metrics and purge, optional **admin-only spreadsheet exchange** (Excel export, CSV/XLSX import via `dataExchangePlugin`)
- **Session authentication** (optional): `createAuth` / `quickAuth` in **`webspresso/core/auth`** — pass the manager to **`createApp({ auth })`** for `express-session`, `req.user` / `req.auth`, remember-me tokens, and policy-style authorization. Full walkthrough: **[`doc/index.html#authentication`](doc/index.html#authentication)**.
- **Optional client runtime** (Alpine.js + [swup](https://swup.js.org/)): **`createApp({ clientRuntime: { alpine, swup } })`** serves scripts under **`/__webspresso/client-runtime/`** and exposes **`clientRuntime`** in Nunjucks; layouts can include **`views/partials/webspresso-client-runtime.njk`**. Env overrides: **`WEBSPRESSO_ALPINE`**, **`WEBSPRESSO_SWUP`**. Demo: **`examples/alpine-swup-demo/`**. Details: **[`doc/index.html#client-runtime`](doc/index.html#client-runtime)**.
- **TypeScript**: Published **`index.d.ts`** (via `package.json` `"types"`) for `createApp`, ORM, plugins, and router helpers — use from TS/JS with IDE autocomplete; runtime stays CommonJS
- **Application kernel (optional)**: In-process **`kernel`** API (`require('webspresso').kernel`) — event bus (`dispatch` / `publish`), **`kernel.createApp()`** (namespaced differently from SSR **`createApp`**), **`definePlugin`** / **`defineFlow`**, minimal **`{{ }}` view resolver**, and simulated **`BaseRepository`** with `orm.<resource>.*` events. Ships as **`core/kernel/`** on npm. Demo: **`node core/kernel/run-demo.js`**. Docs: **[`doc/index.html#application-kernel`](doc/index.html#application-kernel)**.

## Installation

```bash
npm install -g webspresso
# or
npm install webspresso
```

## TypeScript

The npm package ships with **[`index.d.ts`](index.d.ts)** so consumers get typings for the public API (`createApp`, `defineModel`, `createDatabase`, `zdb`, plugins, etc.). No extra `@types/webspresso` package is required.

```typescript
import { createApp, defineModel, zdb } from 'webspresso';
```

Install **`@types/express`** in your app if you want full **`Express.Application`** / **`Request`** / **`Response`** inference when you touch `createApp().app` or write middleware. **`knex`** and **`zod`** bring their own types.

Framework development (this repo): run **`npm run check:types`** to typecheck the declarations against a small smoke file (`tests/ts-smoke/`).

## Application kernel (`kernel`)

Do **not** confuse **`kernel.createApp()`** with the package root **`createApp`** used for SSR—it returns a different object (event bus, optional flows, and a minimal view resolver). It does **not** modify Knex ORM behavior or Express routing.

```javascript
const { kernel } = require('webspresso');
const app = kernel.createApp();
app.events.on('orm.post.afterCreate', async (ctx) => { /* ... */ });
```

See **[`doc/index.html#application-kernel`](doc/index.html#application-kernel)** · source modules: [`core/kernel/`](core/kernel/). Cursor skill: **`REFERENCE-kernel.md`** (installed via `webspresso skill --preset webspresso`).

## Quick Start

### Using CLI (Recommended)

```bash
# Create a new project (Tailwind CSS included by default)
webspresso new my-app

# Navigate to project
cd my-app

# Install dependencies
npm install

# Build Tailwind CSS
npm run build:css

# Start development server (watches both CSS and server)
webspresso dev
# or
npm run dev
```

> **Note:** New projects include Tailwind CSS by default. Use `--no-tailwind` flag to skip it.

## CLI Commands

### `webspresso new [project-name]`

Create a new Webspresso project with Tailwind CSS (default).

```bash
# Create in a new directory
webspresso new my-app

# Create in current directory (interactive)
webspresso new
# → Prompts: "Install in current directory?"
# → If yes, asks for project name (for package.json)

# Auto install dependencies and build CSS
webspresso new my-app --install

# Without Tailwind
webspresso new my-app --no-tailwind
```

**Interactive Mode (no arguments):**
- Asks if you want to install in the current directory
- If current directory is not empty, shows a warning
- Prompts for project name (defaults to current folder name)
- Asks if you will use a database (SQLite, PostgreSQL, or MySQL)
- If yes, adds the appropriate driver to `package.json` and creates `webspresso.db.js` config
- After project creation, asks if you want to install dependencies
- If yes, runs `npm install` and `npm run build:css`
- Then asks if you want to start the development server
- If yes, starts `npm run dev` automatically

**Auto Installation:**
```bash
# With --install flag (semi-interactive)
webspresso new my-app --install
# → Automatically runs: npm install && npm run build:css
# → Then prompts: "Start development server?" [Y/n]
# → If yes: starts npm run dev (with watch:css if Tailwind enabled)

# Without --install flag (fully interactive)
webspresso new my-app
# → Prompts: "Install dependencies and build CSS now?" [Y/n]
# → If yes: runs npm install && npm run build:css
# → Then: "Start development server?" [Y/n]
# → If yes: starts npm run dev (with watch:css if Tailwind enabled)
```

**Note:** When dev server starts with Tailwind CSS, it automatically runs `watch:css` in the background to watch for CSS changes.

**Database Selection:**
During project creation, you'll be asked if you want to use a database:
- **SQLite** (better-sqlite3) - Recommended for development and small projects
- **PostgreSQL** (pg) - For production applications
- **MySQL** (mysql2) - Alternative SQL database

If you select a database:
- The appropriate driver is added to `package.json` dependencies
- `webspresso.db.js` config file is created with proper settings
- `migrations/` directory is created
- `models/` directory is created
- `DATABASE_URL` is added to `.env.example` with a template

**Scaffold: `config/` and environment files**

New projects include:

- **`config/load-env.js`** — loads, in order, `.env`, `.env.local`, `.env.${NODE_ENV}`, and `.env.${NODE_ENV}.local` (each file overrides keys from earlier ones).
- **`config/env.schema.js`** — validates `process.env` with **Zod** before the app starts (`PORT`, `NODE_ENV`, i18n vars, `BASE_URL`, optional `DATABASE_URL`).
- **`config/app.js`** — returns `createApp()` options (paths; if `webspresso.db.js` exists, also **`createDatabase`** as `db`).
- **`server.js`** — calls `loadEnv()`, then `createApp(getCreateAppOptions())`, then `listen` using the parsed `PORT`.

Copy **`.env.example`** to **`.env`** (and use `.env.local` for machine-specific overrides). Patterns such as `.env.development.local` are gitignored via `.env.*.local`.

**Seed Data Generation:**
After selecting a database, you'll be asked if you want to generate seed data:
- If yes, `@faker-js/faker` is added to dependencies
- `seeds/` directory is created with `seeds/index.js`
- `npm run seed` script is added to `package.json`
- The seed script automatically detects models in `models/` directory and generates fake data based on their schemas

To run seeds after creating models:
```bash
npm run seed
```

The seed script will:
- Load all models from `models/` directory
- Generate 10 fake records per model (by default)
- Use smart field detection based on column names (email, name, title, etc.)

You can always add database support later by:
1. Installing the driver: `npm install better-sqlite3` (or `pg`, `mysql2`)
2. Creating `webspresso.db.js` config file
3. Adding `DATABASE_URL` to your `.env` file
4. Creating `models/` directory and defining your models
5. Optionally adding seed support: `npm install @faker-js/faker` and creating `seeds/index.js`

Options:
- `-i, --install` - Auto run `npm install` and `npm run build:css` (non-interactive)
- `--no-tailwind` - Skip Tailwind CSS setup

The project includes:
- Tailwind CSS with build process
- Optimized layout template with navigation and footer
- Responsive starter page
- i18n setup (e.g. en/de)
- Development and production scripts

### `webspresso page`

Add a new page to your project (interactive prompt).

```bash
webspresso page
```

The CLI will ask you:
- Route path (e.g., `/about` or `/blog/post`)
- Whether to add a route config file
- Whether to add locale files

### `webspresso api`

Add a new API endpoint (interactive prompt).

```bash
webspresso api
```

The CLI will ask you:
- API route path (e.g., `/api/users` or `/api/users/[id]`)
- HTTP method (GET, POST, PUT, PATCH, DELETE)

### `webspresso dev`

Start development server with hot reload.

```bash
webspresso dev
# or with custom port
webspresso dev --port 3001
```

### `webspresso start`

Start production server.

```bash
webspresso start
# or with custom port
webspresso start --port 3000
```

### `webspresso doctor`

Check Node.js version, `package.json` / `engines.node`, typical project files (`server.js`, `pages/`), and whether `webspresso.db.js` or `knexfile.js` exists. Use `--db` to run a quick connection test when a config is present. Warnings alone exit with code `0`; pass `--strict` to fail (exit `1`) on any warning—useful in CI.

```bash
webspresso doctor
webspresso doctor --db
webspresso doctor --strict
```

### `webspresso skill`

Scaffold a **Cursor Agent Skill**: creates `.cursor/skills/<name>/SKILL.md` with valid YAML frontmatter (`name`, `description`) and a short markdown template for AI tooling. Use `--global` to write under `~/.cursor/skills/` instead of the current project.

**Bundled preset:** `--preset webspresso` copies **`SKILL.md`** (short index), **`REFERENCE-framework.md`** (SSR `createApp`, routes, ORM, auth, plugins, CLI), and **`REFERENCE-kernel.md`** (`kernel` event bus / flows) into **`.cursor/skills/webspresso-usage/`** — no prompts.

```bash
webspresso skill my-workflow
webspresso skill review-pr --description "Runs PR review checklist. Use when reviewing pull requests."
webspresso skill deploy-check -g

# Install the bundled Webspresso agent reference (same content shipped in templates/skills/)
webspresso skill --preset webspresso
webspresso skill -p webspresso --global
```

### `webspresso add tailwind`

Add Tailwind CSS to your project with build process.

```bash
webspresso add tailwind
```

This command will:
- Install Tailwind CSS, PostCSS, and Autoprefixer as dev dependencies
- Create `tailwind.config.js` and `postcss.config.js`
- Create `src/input.css` with Tailwind directives
- Add build scripts to `package.json`
- Update your layout to use the built CSS instead of CDN
- Create `public/css/style.css` for the compiled output

After running this command:
```bash
npm install
npm run build:css      # Build CSS once
npm run watch:css      # Watch and rebuild CSS on changes
npm run dev            # Starts both CSS watch and dev server
```

### `webspresso favicon:generate <source.png>`

Generate favicon PNG files and `favicons.njk` partial from a single source PNG.

```bash
# Basic usage (creates files in public/, views/partials/)
webspresso favicon:generate logo.png

# With PWA manifest options
webspresso favicon:generate logo.png --name "My App" --short-name "App" --theme-color "#22c55e"

# Custom output directory
webspresso favicon:generate logo.png -o static

# Skip adding include to layout.njk
webspresso favicon:generate logo.png --no-layout
```

This command will:
- Resize the source PNG to all required sizes (Apple touch 57–180px, Android 192px, favicon 16/32/96px, MS Tile 144px)
- Write PNGs to `public/` (or `-o` path)
- Create `public/manifest.json` (PWA format)
- Create `views/partials/favicons.njk` with `<link>` and `<meta>` tags
- Add `{% include "partials/favicons.njk" %}` to `views/layout.njk` (unless `--no-layout`)

**Options:**
- `-o, --output-dir <path>` – Output directory for PNGs (default: `public`)
- `--partial-dir <path>` – Directory for favicons.njk (default: `views/partials`)
- `--layout-file <path>` – Layout file to update (default: `views/layout.njk`)
- `--theme-color <hex>` – theme-color and msapplication-TileColor (default: `#ffffff`)
- `--name <string>` – manifest.json `name` (PWA)
- `--short-name <string>` – manifest.json `short_name` (PWA)
- `--no-layout` – Do not add include to layout.njk

### Admin Panel Commands

```bash
# Create admin_users table migration
webspresso admin:setup

# List all admin users
webspresso admin:list

# Reset admin password (interactive)
webspresso admin:password

# Reset with options
webspresso admin:password -e admin@example.com -p yeni_sifre123
webspresso admin:password -c ./webspresso.db.js -E production
```

> **Note:** Requires `webspresso.db.js` or `knexfile.js` in project root. Run from project directory.

## Project Structure

Create your app with this structure:

```
my-app/
├── pages/
│   ├── locales/          # Global i18n translations
│   │   ├── en.json
│   │   └── de.json
│   ├── _hooks.js         # Global lifecycle hooks
│   ├── index.njk         # Home page (GET /)
│   ├── about/
│   │   ├── index.njk     # About page (GET /about)
│   │   └── locales/      # Route-specific translations
│   ├── tools/
│   │   ├── index.njk     # Tools list (GET /tools)
│   │   ├── index.js      # Route config with load()
│   │   ├── [slug].njk    # Dynamic tool page (GET /tools/:slug)
│   │   └── [slug].js     # Route config for dynamic page
│   └── api/
│       ├── health.get.js # GET /api/health
│       └── echo.post.js  # POST /api/echo
├── views/
│   └── layout.njk        # Base layout template
├── public/               # Static files
└── server.js
```

## API

### `createApp(options)`

Creates and configures the Express app.

**Options:**
- `pagesDir` (required): Path to pages directory
- `viewsDir` (optional): Path to views/layouts directory
- `publicDir` (optional): Path to public/static directory
- `db` (optional): Database instance — exposed as `ctx.db` in plugin hooks (`register`, `onRoutesReady`) and in page `load`/`meta` functions; also registered for [`getDb()` / `getAppContext()`](#app-context-getdb-hasdb-getappcontext) below
- `logging` (optional): Enable request logging (default: true in development)
- `helmet` (optional): Helmet security configuration
  - `true` or `undefined`: Use default secure configuration
  - `false`: Disable Helmet
  - `Object`: Custom Helmet configuration (merged with defaults)
- `middlewares` (optional): Named middleware registry for routes
- `clientRuntime` (optional): **`{ alpine?: boolean | object, swup?: boolean | object }`**. When either flag is enabled, mounts vendored Alpine 3 / swup 4 (+ Head + Scripts plugins) at **`/__webspresso/client-runtime/*`** and passes resolved **`{ alpine, swup }`** into SSR templates as **`clientRuntime`**. Override with env **`WEBSPRESSO_ALPINE`** / **`WEBSPRESSO_SWUP`** (`1` or `true`). Package exports **`resolveClientRuntime`** and **`CLIENT_RUNTIME_BASE`**. See **[Client runtime](#client-runtime)** below and **[`doc/index.html#client-runtime`](doc/index.html#client-runtime)**.
- `auth` (optional): `AuthManager` from **`createAuth()`** / **`quickAuth()`** (`require('webspresso/core/auth')`). Registers session + cookie parsing, attaches **`req.auth`** / **`req.user`**, and injects named route middleware **`auth`** and **`guest`** (do not reuse those names for custom handlers if you pass `auth`). See **[`doc/index.html#authentication`](doc/index.html#authentication)**.
- `setupRoutes(app, ctx)` (optional): Register custom Express routes after file routes and plugin `onRoutesReady`, before the 404 handler — use for login/logout handlers when using the auth module; **`ctx.authMiddleware`** exposes `requireAuth`, `requireGuest`, etc.; **`ctx.clientRuntime`** is **`{ alpine, swup }`**

**Example with middlewares:**

```javascript
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  middlewares: {
    auth: (req, res, next) => {
      if (!req.session?.user) {
        return res.redirect('/login');
      }
      next();
    },
    admin: (req, res, next) => {
      if (req.session?.user?.role !== 'admin') {
        return res.status(403).send('Forbidden');
      }
      next();
    },
    rateLimit: require('express-rate-limit')({ windowMs: 60000, max: 100 })
  }
});
```

Then use in route configs by name:

```javascript
// pages/admin/index.js
module.exports = {
  middleware: ['auth', 'admin'], // Use named middlewares
  load(req, ctx) { ... }
};

// pages/api/data.get.js
module.exports = {
  middleware: ['auth', 'rateLimit'],
  handler: (req, res) => res.json({ data: 'protected' })
};
```

**Parameterized named middleware:** entries in `middlewares` can be **factories** `(options) => (req, res, next) => …`. A bare string calls the factory with `{}`; a **tuple** passes options:

```javascript
// pages/api/account.get.js
module.exports = {
  middleware: [['auth', { api: true }], 'rateLimit'], // JSON 401 instead of redirect when using createApp({ auth })
  handler: (req, res) => res.json({ ok: true }),
};

// server.js — custom factory
middlewares: {
  oauth: (opts) => (req, res, next) => {
    if (opts.google && !req.headers['x-google']) return res.status(401).end();
    next();
  },
};
// pages/example/index.js → middleware: [['oauth', { google: true }], 'auth']
```

Plain `(req, res, next) => …` handlers still work as today. Tuple form **requires** a factory for that name (you get a clear error if you mix a plain handler with `['name', opts]`).

### Client runtime

Alpine.js + swup — opt-in progressive enhancement for SSR pages:

- **`clientRuntime: { alpine: true, swup: true }`** (each can be toggled independently). Default is off; no scripts are injected when both are disabled.
- Include **`{% include "partials/webspresso-client-runtime.njk" %}`** in your layout (copy from the npm package’s **`views/partials/`** or the framework repo). When **swup** is on, wrap the main content in **`<main id="swup">…</main>`** so transitions replace the correct region.
- **swup** uses Head + Scripts plugins; **Alpine** is re-bound after each visit via **`Alpine.initTree`** on the container. Use **`data-no-swup`** on links for a full page load. Paths **`/_admin`** and **`/_webspresso`** are ignored by the default bootstrap; the admin panel and dev dashboard stay separate Mithril apps.
- Dynamic UI can call **`pages/api/*`** from Alpine with **`fetch`** (see **`examples/alpine-swup-demo/`**).
- **Helmet / CSP**: production **`script-src 'self'`** works for **`/__webspresso/client-runtime/`**; some Alpine builds may need **`unsafe-eval`** — validate for your version or use a stricter build.

```javascript
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  publicDir: './public',
  clientRuntime: { alpine: true, swup: true },
});
```

### App context (`req.db`, `getDb`, `attachDbMiddleware`)

With **`createApp({ db })`**, file-based **API** routes (`pages/api/*.js`) get the same ORM instance on **`req.db`** before your **`middleware`** array and the handler run — no extra `require` in the handler:

```javascript
module.exports = async function handler(req, res) {
  if (!req.db) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const posts = await req.db.getRepository('Post').query().limit(10).list();
  res.json(posts);
};

module.exports.middleware = ['auth']; // can use req.db too
```

The framework also registers that instance for **non-request** code (scripts, jobs) and for tests:

```javascript
const { getDb, hasDb } = require('webspresso');
// hasDb() / getDb() — getDb() throws if createApp had no db
```

For routes you add manually in **`setupRoutes`**, run **`attachDbMiddleware`** early so those handlers get `req.db`:

```javascript
const { createApp, attachDbMiddleware } = require('webspresso');

createApp({
  pagesDir: './pages',
  db,
  setupRoutes(app) {
    app.use(attachDbMiddleware);
    app.get('/custom/api', (req, res) => res.json({ ok: !!req.db }));
  },
});
```

| Export | Role |
|--------|------|
| `req.db` | Set on each API request when `createApp({ db })` was used (file-based API routes + after `attachDbMiddleware`) |
| `getDb()` | Same instance as `req.db`; **throws** if no `db` was passed to `createApp` |
| `hasDb()` | `true` if `createApp` was given `db` |
| `getAppContext()` | `{ db }` — `db` may be `null` |
| `attachDbMiddleware` | Express middleware to populate `req.db` for non–file-router routes |
| `resetAppContext()` | Clears context (mainly for tests) |
| `setAppContext(partial)` | Low-level merge; normally only `createApp` uses this |

**Custom Error Pages:**

```javascript
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  errorPages: {
    // Option 1: Custom handler function
    notFound: (req, res) => {
      res.render('errors/404.njk', { url: req.url });
    },
    
    // Option 2: Template path (rendered with Nunjucks)
    serverError: 'errors/500.njk',
    
    // Timeout error page (503)
    timeout: 'errors/503.njk'
  }
});
```

Error templates receive these variables:
- `404.njk`: `{ url, method }`
- `500.njk`: `{ error, status, isDev }`
- `503.njk`: `{ url, method, isDev }`

**Request Timeout:**

Configure request timeout with `connect-timeout`:

```javascript
const { app } = createApp({
  pagesDir: './pages',
  timeout: '30s',  // Default: 30 seconds
  // timeout: '1m',  // 1 minute
  // timeout: false, // Disable timeout
});
```

**Asset Management:**

Configure asset handling with versioning and manifest support:

```javascript
const { createApp } = require('webspresso');
const path = require('path');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  publicDir: './public',
  assets: {
    // Option 1: Simple versioning (cache busting)
    version: '1.2.3',  // or process.env.APP_VERSION
    
    // Option 2: Manifest file (Vite, Webpack, etc.)
    manifestPath: path.join(__dirname, 'public/.vite/manifest.json'),
    
    // URL prefix for assets
    prefix: '/static'
  }
});
```

Use asset helpers in templates:

```njk
{# Using fsy helpers (auto-resolved) #}
<link rel="stylesheet" href="{{ fsy.asset('/css/style.css') }}">

{# Or generate full HTML tags #}
{{ fsy.css('/css/style.css') | safe }}
{{ fsy.js('/js/app.js', { defer: true, type: 'module' }) | safe }}
{{ fsy.img('/images/logo.png', 'Site Logo', { class: 'logo', loading: 'lazy' }) | safe }}
```

Asset helpers available in `fsy`:
- `asset(path)` - Returns versioned/manifest-resolved URL
- `css(href, attrs)` - Generates `<link>` tag
- `js(src, attrs)` - Generates `<script>` tag
- `img(src, alt, attrs)` - Generates `<img>` tag

**Manifest Support:**

Works with Vite and Webpack manifest formats:

```json
// Vite manifest format (.vite/manifest.json)
{
  "css/style.css": { "file": "assets/style-abc123.css" },
  "js/app.js": { "file": "assets/app-xyz789.js" }
}

// Webpack manifest format
{
  "/css/style.css": "/dist/style.abc123.css",
  "/js/app.js": "/dist/app.xyz789.js"
}
```

**Returns:** `{ app, nunjucksEnv, pluginManager, authMiddleware }` — `authMiddleware` is `null` when `auth` was not passed.

### Authentication (session)

Optional **session-based** auth lives under **`webspresso/core/auth`**: **`createAuth`**, **`quickAuth`**, **`hash`** / **`verify`**, **`setupAuthMiddleware`**, **`createRememberTokensTable`**, and policy helpers. Pass the manager to **`createApp({ auth })`** so routes can use **`middleware: ['auth']`** or **`['guest']`** and handlers can call **`req.auth.attempt()`**, **`req.auth.logout()`**, **`req.auth.can()`**, etc.

The **admin panel** plugin uses its **own** session and `/api/auth/*` routes (`req.session.adminUser`) — it is separate from **`createApp({ auth })`**.

For integration patterns (remember-me table, `setupRoutes`, file-router ordering), see **[`doc/index.html#authentication`](doc/index.html#authentication)**.

## Plugin System

Webspresso has a built-in plugin system with version control and dependency management.

**Error handling:** On plugin errors (missing dependencies, version mismatch, `register()` or `onRoutesReady()` failure), the app does not crash; only a `console.warn` is logged and other plugins continue to run.

### Using Plugins

```javascript
const { createApp } = require('webspresso');
const { sitemapPlugin, analyticsPlugin, dashboardPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  plugins: [
    dashboardPlugin(),  // Dev dashboard at /_webspresso
    sitemapPlugin({
      hostname: 'https://example.com',
      exclude: ['/admin/*', '/api/*'],
      i18n: true,
      locales: ['en', 'de']
    }),
    analyticsPlugin({
      google: {
        measurementId: 'G-XXXXXXXXXX',
        verificationCode: 'xxxxx'
      },
      yandex: {
        counterId: '12345678',
        verificationCode: 'xxxxx'
      },
      bing: {
        uetId: '12345678',
        verificationCode: 'xxxxx'
      }
    })
  ]
});
```

### Built-in Plugins

**Dashboard Plugin:**
- Development dashboard at `/_webspresso`
- Monitor all routes (SSR pages and API endpoints)
- View loaded plugins and configuration
- Filter and search routes
- Only active in development mode (disabled in production)

```javascript
const { dashboardPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    dashboardPlugin()  // Available at /_webspresso in dev mode
  ]
});
```

Options:
- `path` - Custom dashboard path (default: `/_webspresso`)
- `enabled` - Force enable/disable (default: auto based on NODE_ENV)

**Redirect plugin:**
- Runs in `register()` **before** file-based routes, so configured paths override SSR pages.
- Rules: `from` (string or `RegExp`), `to` (path or URL), optional `status` (301/302/303/307/308), optional `methods` (`'*'` or a list; default plugin methods are `GET` and `HEAD` only).
- `preserveQuery` (default `true`) appends the request query when `to` has no `?`. External `to` values require `allowExternal: true`.

```javascript
const { redirectPlugin } = require('webspresso/plugins');

redirectPlugin({
  rules: [
    { from: '/old-blog', to: '/blog', status: 301 },
    { from: /^\/wiki\/(.*)$/, to: '/docs' },
  ],
});
```

**Sitemap Plugin:**
- Generates `/sitemap.xml` from routes automatically
- **Dynamic Database Content**: Generate URLs from database records
- Excludes dynamic routes and API endpoints
- Supports i18n with hreflang tags
- Generates `/robots.txt`
- Configurable caching for performance

```javascript
sitemapPlugin({
  hostname: 'https://example.com',
  db, // Database instance
  dynamicSources: [
    {
      model: 'Post',                    // Model name
      urlPattern: '/blog/:slug',        // URL pattern
      lastmodField: 'updated_at',       // Field for lastmod
      filter: (r) => r.published,       // Filter records
      priority: 0.9,
    },
    {
      // Custom query function
      query: async (db) => {
        return db.getRepository('Product')
          .query()
          .where('active', true)
          .list();
      },
      urlPattern: '/products/:slug',
    },
  ],
})
```

**Analytics Plugin:**
- Google Analytics (GA4) and Google Ads
- Google Tag Manager
- Yandex.Metrika
- Microsoft/Bing UET
- Facebook Pixel
- Verification meta tags for all services

Template helpers from analytics plugin:

```njk
<head>
  {{ fsy.verificationTags() | safe }}
  {{ fsy.analyticsHead() | safe }}
</head>
<body>
  {{ fsy.analyticsBodyOpen() | safe }}
  ...
</body>
```

Individual helpers: `gtag()`, `gtm()`, `gtmNoscript()`, `yandexMetrika()`, `bingUET()`, `facebookPixel()`, `allAnalytics()`

**Admin Panel Plugin:**
- Modular admin panel with SPA (Mithril.js)
- Model CRUD UI (auto-generated from ORM)
- Extensible via custom pages, menu items, API routes, and dashboard widgets
- Other plugins (e.g. site-analytics) can register their own admin pages

```javascript
const { adminPanelPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    adminPanelPlugin({
      db,
      path: '/_admin',           // Admin URL (default: /_admin)
      auth: authManager,         // Optional: for user management
      userManagement: { enabled: true, model: 'User' },
    })
  ]
});
```

Options:
- `db` (required) - Database instance
- `path` - Admin panel path (default: `/_admin`)
- `auth` - Same **`AuthManager`** instance as **`createApp({ auth })`** when you use **`userManagement`** — enables **Active Sessions** / revoke APIs if **`rememberTokens`** (remember-me) is configured; optional for user CRUD-only
- `userManagement` - Site-user admin UI (`enabled`, `model` matching ORM user table, optional `fields` map). SPA routes: `/_admin/users`, `/_admin/users/new`, …; APIs: `/_admin/api/users*`. Admin staff still use **`admin_users`** / `/_admin` login; this is separate from **`req.user`** on the public site
- `configure` - Callback `(registry) => void` for manual setup

See **`doc/index.html#admin-user-management`** and **Session authentication** in **`.cursor/skills/webspresso-usage/REFERENCE-framework.md`** for the split between **`adminUser`** and **`createApp({ auth })`**.

**Custom Admin Pages (registerModule):**

Plugins can add custom admin pages using `registerModule` in `onRoutesReady`:

```javascript
// In your plugin's onRoutesReady(ctx)
const adminApi = ctx.usePlugin('admin-panel');
if (adminApi) {
  adminApi.registerModule({
    id: 'my-module',

    pages: [{
      id: 'reports',
      title: 'Reports',
      path: '/reports',
      icon: 'chart',
      description: 'View reports',
      component: `window.__customPages["reports"] = { view: () => m("div", "My Report") };`,  // Mithril.js
    }],

    menu: [{ id: 'reports', label: 'Reports', path: '/reports', icon: 'chart', order: 5 }],

    api: {
      prefix: '/reports',
      routes: [
        { method: 'get', path: '/summary', handler: getSummaryHandler, auth: true },
      ],
    },

    widgets: [{
      id: 'reports-widget',
      title: 'Quick Stats',
      dataLoader: async () => ({ count: 42 }),
    }],

    menuGroups: [{ id: 'analytics', label: 'Analytics', order: 2 }],
  });
}
```

**registerModule config:**
| Field | Description |
|-------|-------------|
| `id` | Unique module identifier (required) |
| `pages` | Custom admin pages (each: `id`, `title`, `path`, `icon`, `description`, optional `component`) |
| `menu` | Sidebar menu items (`id`, `label`, `path`, `icon`, `order`) |
| `menuGroups` | Collapsible menu groups (`id`, `label`, `order`) |
| `api` | API routes (`prefix`, `routes`: `method`, `path`, `handler`, `auth`) |
| `widgets` | Dashboard widgets (`id`, `title`, `dataLoader`) |

For pages with `component`: provide Mithril.js code that assigns to `window.__customPages[pageId]`. Without `component`, the page shows a static placeholder.

**Manual registry API** (alternative to registerModule):

```javascript
adminPanelPlugin({
  db,
  configure(registry) {
    registry.registerPage('custom', { title: 'Custom', path: '/custom', icon: 'tool' });
    registry.registerClientComponent('custom', 'window.__customPages["custom"] = { view: () => m("p","Hi") };');
    registry.registerMenuItem({ id: 'custom', label: 'Custom', path: '/custom', icon: 'tool' });
  },
})
```

### Data exchange plugin (`dataExchangePlugin`)

- **Admin session only** — same `requireAuth` / `req.session.adminUser` as the admin panel; paths live under your admin prefix (default `/_admin`).
- **Excel export** (`.xlsx`) for models with `admin.enabled`; record selection matches the built-in JSON/CSV export (`ids`, `selectAll`, `filters` via query or POST body).
- **Import** — `multipart/form-data` field `file` (`.csv` or `.xlsx`); query/body `mode=insert|upsert`, `upsertKey` (default primary key). Rows are validated through the ORM (`repository.create` / `update`). Hidden columns are excluded; caps: `maxRows`, `maxFileBytes`.
- **UI** — when the plugin is loaded, the admin model list adds **Export Excel**, **Import**, and bulk **Export Excel** (alongside the existing JSON/CSV export actions). Registers bulk action `export-xlsx` for download URLs.
- **Dependencies** — implemented with `exceljs` and `csv-parse` (declared on the `webspresso` package).

Register **after** `adminPanelPlugin` so session middleware and the admin registry exist; use the **same** `db` and `adminPath`:

```javascript
const { adminPanelPlugin, dataExchangePlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  db,
  plugins: [
    adminPanelPlugin({ db, path: '/_admin' }),
    dataExchangePlugin({
      db,
      adminPath: '/_admin',
      maxRows: 10_000,
      maxFileBytes: 10 * 1024 * 1024,
    }),
  ],
});
```

Options:
- `db` — database instance (defaults to `ctx.db` in `onRoutesReady` if omitted but `createApp({ db })` was set)
- `adminPath` — must match the admin panel path (default `/_admin`)
- `enabled` — set `false` to skip registering routes (default `true`)
- `maxRows` — export and import row limit (default `10000`)
- `maxFileBytes` — multipart upload limit (default 10 MiB)

API (all require admin cookie):
- `GET|POST ${adminPath}/api/data-exchange/export/:model` — spreadsheet download
- `POST ${adminPath}/api/data-exchange/import/:model` — import summary `{ success, created, updated, failed, errors: [{ row, message }] }`

**Site Analytics Plugin:**
- Self-hosted page view analytics (no external services required)
- Automatic page view tracking via Express middleware
- Bot detection (40+ patterns: Googlebot, GPTBot, curl, etc.)
- Country detection (CDN headers, Accept-Language fallback)
- Admin panel dashboard with Chart.js visualizations
- Privacy-first: IP addresses are hashed, no cookies required

```javascript
const { siteAnalyticsPlugin, adminPanelPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    adminPanelPlugin({ db }),
    siteAnalyticsPlugin({
      db,
      excludePaths: ['/health', '/favicon.ico'],
      trackBots: true,  // Record bot visits separately (default: true)
    }),
  ]
});
```

Admin panel analytics page includes:
- **Summary cards**: Total views, unique visitors, unique pages, sessions
- **Views over time**: Line chart (Chart.js) with daily views/visitors/sessions
- **Bot activity**: Bot request counts with horizontal bar visualization
- **Top pages**: Most viewed pages sorted by view count
- **Recent activity**: Latest page views with country flags and timestamps
- **Country stats**: Country breakdown with flag emojis and bar charts
- **Date filtering**: Last 7, 30, or 90 days toggle

Options:
- `db` (required) - Database instance
- `excludePaths` - Additional paths to exclude from tracking (admin, API, and static files are auto-excluded)
- `trackBots` - Whether to record bot visits (default: `true`)
- `tableName` - Custom table name (default: `analytics_page_views`)

The `analytics_page_views` table is automatically created on first request.

**Audit log plugin:**
- Records successful (`2xx`) admin panel model mutations: `create`, `update`, `delete`, `restore` on `${adminPath}/api/models/:model/records…`
- Actor from `req.session.adminUser` after login; optional IP / user-agent; update metadata stores changed field names only (not full body)
- `GET ${adminPath}/api/audit-logs` with pagination and filters (`page`, `perPage`, `model`, `action`, `from`, `to`) — use from custom admin pages or the bundled Mithril list (`includeDefaultPage` default `true`)
- Run `webspresso db:migrate` after adding the migration (see `plugins/audit-log/migration-template.js` or the example under `migrations/`). Prune old rows with the CLI (recommended on a schedule):

```bash
npx webspresso audit:prune --days 90
```

```javascript
const { adminPanelPlugin, auditLogPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    adminPanelPlugin({ db }),
    auditLogPlugin({
      db,
      // adminPath: '/_admin', // must match admin panel `path`
      // tableName: 'audit_logs',
      // includeDefaultPage: true,
      // apiPrefix: '/audit-logs',
    }),
  ],
});
```

Programmatic API (other plugins): `ctx.usePlugin('audit-log')` exposes `queryLogs`, `purgeAuditLogs`, and `getMigrationTemplate()`.

**ORM cache admin plugin:**
- Depends on **`adminPanelPlugin`** and a database instance created with **`createDatabase({ cache: true | { … } })`** so **`db.cache`** is non-null
- Registers an **ORM Cache** admin page (metrics, full purge, per-model invalidation, reset counters) backed by **`db.cache`**
- If `db.cache` is disabled, the plugin logs a warning and skips registration

```javascript
const { adminPanelPlugin, ormCacheAdminPlugin } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    adminPanelPlugin({ db }),
    ormCacheAdminPlugin({ db }),
  ],
});
```

**reCAPTCHA plugin:**
- Google reCAPTCHA **v2** (checkbox) or **v3** (score): server verification via `https://www.google.com/recaptcha/api/siteverify` (no extra npm dependency; Node 18+ `fetch`)
- Registers CSP entries for Google scripts/iframes; Nunjucks helpers: `recaptchaScript`, `recaptchaWidget` (v2), `recaptchaV3Token` (hidden input + execute for v3 — use with `version: 'v3'` and `recaptchaScript` loads `api.js?render=siteKey`)
- Secret key: `options.secretKey` or env `RECAPTCHA_SECRET_KEY` (never expose to templates)

```javascript
const {
  recaptchaPlugin,
  createRecaptchaMiddleware,
  resolveRecaptchaMiddlewareParams,
} = require('webspresso/plugins/recaptcha');

const recaptchaConfig = {
  siteKey: process.env.RECAPTCHA_SITE_KEY,
  secretKey: process.env.RECAPTCHA_SECRET_KEY,
  version: 'v2', // or 'v3'
  minScore: 0.5,
  expectedAction: 'contact', // v3 verification only
  defaultV3Action: 'submit', // for recaptchaV3Token helper
};

const { app } = createApp({
  pagesDir: './pages',
  plugins: [recaptchaPlugin(recaptchaConfig)],
  middlewares: {
    recaptcha: createRecaptchaMiddleware({
      ...resolveRecaptchaMiddlewareParams(recaptchaConfig),
      bodyField: 'g-recaptcha-response',
    }),
  },
});
```

**File-based API** (`pages/api/...post.js`): use the named middleware instead of duplicating verification in the handler; on success, `req.recaptcha` contains a short summary of Google’s response.

```javascript
// pages/api/contact.post.js
module.exports = async function post(req, res) {
  // recaptcha middleware already returned 400 if token invalid
  return res.json({ ok: true, hostname: req.recaptcha.hostname });
};

module.exports.middleware = ['recaptcha'];
```

Optional: after `createApp`, use `pluginManager.getPluginAPI('recaptcha').createMiddleware({ bodyField: '...' })` to override plugin defaults and attach to the `app.use` chain (after body parsers).

Low-level usage (without middleware): import `verifyRecaptcha` / `getRemoteIp` from `webspresso/plugins/recaptcha/verify`.

**SEO Checker Plugin:**
- Client-side SEO analysis tool (inspired by django-check-seo)
- Integrated with dev toolbar
- 40+ SEO checks across 7 categories
- Real-time analysis with score calculation
- Only active in development mode

```javascript
const { seoCheckerPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    seoCheckerPlugin({
      settings: {
        titleLength: [30, 60],        // Min/max title length
        descriptionLength: [50, 160], // Min/max description length
        minContentWords: 300,         // Minimum content words
        minInternalLinks: 1,          // Minimum internal links
        minExternalLinks: 1,          // Minimum external links
        maxUrlLength: 75,             // Maximum URL length
        maxUrlDepth: 3                // Maximum URL depth
      }
    })
  ]
});
```

SEO Check Categories:
| Category | Checks |
|----------|--------|
| **Meta** | Title, Description, Canonical, Viewport, Robots, Charset, Lang |
| **Headings** | H1 existence, Single H1, Hierarchy, Non-empty headings |
| **Content** | Word count, Paragraphs, Keyword usage, Keywords early |
| **Links** | Internal links, External links, Nofollow, Anchor text |
| **Images** | Alt text, Descriptive alt, Dimensions, Lazy loading |
| **Structured** | Open Graph, Twitter Card, JSON-LD, Hreflang |
| **URL** | Length, Depth, Readability, HTTPS |

The SEO Checker panel appears as a floating widget and can be opened via:
- Dev toolbar "SEO Check" button
- Floating toggle button (🔍) in bottom-right corner

### Creating Custom Plugins

```javascript
const myPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  // Optional: depend on other plugins
  dependencies: {
    'analytics': '^1.0.0'
  },
  
  // Optional: expose API for other plugins
  api: {
    getData() { return this.data; }
  },
  
  // Called during registration
  register(ctx) {
    // Access Express app
    ctx.app.use((req, res, next) => next());
    
    // Access database (when createApp({ db }) is used)
    if (ctx.db) {
      // Use ctx.db.getRepository('Model'), ctx.db.knex, etc.
    }
    
    // Add template helpers
    ctx.addHelper('myHelper', () => 'Hello!');
    
    // Add Nunjucks filters
    ctx.addFilter('myFilter', (val) => val.toUpperCase());
    
    // Use other plugins
    const analytics = ctx.usePlugin('analytics');
  },
  
  // Called after all routes are mounted
  onRoutesReady(ctx) {
    // ctx.db available when createApp({ db }) is used
    // Access route metadata
    console.log('Routes:', ctx.routes);
    
    // Add custom routes
    ctx.addRoute('get', '/my-route', (req, res) => {
      res.json({ hello: 'world' });
    });
  },
  
  // Called before server starts
  onReady(ctx) {
    console.log('Server ready!');
  }
};

// Use as factory function for configuration
function myPluginFactory(options = {}) {
  return {
    name: 'my-plugin',
    version: '1.0.0',
    _options: options,
    register(ctx) {
      // ctx.options contains the passed options
    }
  };
}
```

### Plugin Error Handling

The plugin system does not crash the app on errors; it only logs warnings:

- **Missing dependency**: If a plugin in `dependencies` is not loaded → warning, plugin still loads
- **Version mismatch**: If a dependent plugin version is incompatible → warning, plugin still loads
- **Circular dependency**: If two plugins depend on each other → warning, plugins in the cycle are skipped
- **Duplicate plugin name**: Two plugins with the same name → warning, second one is skipped
- **`register()` error**: If `register(ctx)` throws → warning, plugin is removed from the registry
- **`onRoutesReady()` error**: If the hook throws → warning, server stays up

A single faulty plugin does not block the entire application.

## File-Based Routing

### SSR Pages

Create `.njk` files in the `pages/` directory:

| File Path | Route |
|-----------|-------|
| `pages/index.njk` | `/` |
| `pages/about/index.njk` | `/about` |
| `pages/tools/[slug].njk` | `/tools/:slug` |
| `pages/docs/[...rest].njk` | `/docs/*` |

### API Routes

Create `.js` files in `pages/api/` with optional method suffixes:

| File Path | Route |
|-----------|-------|
| `pages/api/health.get.js` | `GET /api/health` |
| `pages/api/echo.post.js` | `POST /api/echo` |
| `pages/api/users/[id].get.js` | `GET /api/users/:id` |

**Basic API Handler:**

```javascript
// pages/api/health.get.js
module.exports = async function handler(req, res) {
  res.json({ status: 'ok' });
};
```

**Object export (`handler`, `middleware`, `schema`):**

Use a single export object when you need **named middleware** from `createApp({ middlewares })` and/or a **Zod** `schema`. Order at runtime: **`req.db`** (if configured) → **schema** (`req.input`) → **middleware** chain → **handler**.

```javascript
// pages/api/search.post.js
module.exports = {
  middleware: ['requireAuth'],
  schema: ({ z }) => ({
    body: z.object({ q: z.string() }),
  }),
  handler: async (req, res) => {
    const { q } = req.input.body;
    const results = [];
    return res.json({ results, q });
  },
};
```

Register `requireAuth` (and any other names) on the app:

```javascript
createApp({
  pagesDir: './pages',
  middlewares: {
    requireAuth: (req, res, next) => {
      if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
      next();
    },
  },
});
```

**With Schema Validation (same object shape):**

```javascript
// pages/api/posts.post.js
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(3).max(100),
      content: z.string(),
      tags: z.array(z.string()).optional()
    }),
    query: z.object({
      draft: z.coerce.boolean().default(false)
    })
  }),

  async handler(req, res) {
    // Validated & parsed data available in req.input
    const { title, content, tags } = req.input.body;
    const { draft } = req.input.query;
    
    // Original req.body, req.query remain untouched
    res.json({ success: true, title, draft });
  }
};
```

**Schema Options:**

| Key | Description |
|-----|-------------|
| `body` | Validates `req.body` (POST/PUT/PATCH) |
| `params` | Validates route parameters (e.g., `:id`) |
| `query` | Validates query string parameters |
| `response` | Response schema (for documentation, not enforced) |

All schemas use [Zod](https://zod.dev) for validation. Invalid requests receive **`400 JSON`**: `{ error: 'Validation Error', issues: [...] }` (no `handler` / `middleware` run).

For **nanoid** route parameters (same alphabet and default length as **`generateNanoid`** / **`zdb.nanoid()`**), use **`z.nanoid()`** on the `z` passed into your API schema (Webspresso extends it; no extra import). Optional: **`z.nanoid(12)`** or **`z.nanoid({ maxLength: 12 })`** (matches **`zdb.nanoid({ maxLength })`**). For scripts or tests outside `schema: ({ z })`, **`zodNanoid(z, size?)`** and **`extendZ(z)`** are exported from `webspresso`.

```javascript
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.nanoid(),                  // default 21 chars
      shortId: z.nanoid(12),           // numeric length
      other: z.nanoid({ maxLength: 8 }), // zdb-style options
    }),
  }),
  async handler(req, res) {
    const { id } = req.input.params;
    // ...
  },
};
```

**Dynamic Route with Params Validation:**

```javascript
// pages/api/users/[id].get.js
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.string().uuid()
    }),
    query: z.object({
      fields: z.string().optional()
    })
  }),

  async handler(req, res) {
    const { id } = req.input.params;  // Validated UUID
    const user = await getUser(id);
    res.json(user);
  }
};
```

### Route Config

Add a `.js` file alongside your `.njk` file to configure the route:

```javascript
// pages/tools/index.js
module.exports = {
  // Middleware for this route
  middleware: [(req, res, next) => next()],
  
  // Load data for SSR
  async load(req, ctx) {
    // ctx.db is available when createApp({ db }) is used
    if (ctx.db) {
      const posts = await ctx.db.getRepository('Post').query().limit(10);
      return { posts };
    }
    return { tools: await fetchTools() };
  },
  
  // Override meta tags
  meta(req, ctx) {
    return {
      title: 'Tools',
      description: 'Developer tools'
    };
  },
  
  // Route-level hooks
  hooks: {
    beforeLoad: async (ctx) => {},
    afterRender: async (ctx) => {}
  }
};
```

## i18n

### Global Translations

Add JSON files to `pages/locales/`:

```json
{
  "nav": {
    "home": "Home",
    "about": "About"
  }
}
```

### Route-Specific Translations

Add a `locales/` folder inside any route directory to override global translations.

### Using Translations

In templates:

```nunjucks
<h1>{{ t('nav.home') }}</h1>
```

## Template Helpers

The `fsy` object is available in all templates:

```nunjucks
{# URL helpers #}
{{ fsy.url('/tools', { page: 1 }) }}
{{ fsy.fullUrl('/tools') }}
{{ fsy.route('/tools/:slug', { slug: 'test' }) }}

{# Request helpers #}
{{ fsy.q('page', 1) }}
{{ fsy.param('slug') }}
{{ fsy.hdr('User-Agent') }}

{# Utility helpers #}
{{ fsy.slugify('Hello World') }}
{{ fsy.truncate(text, 100) }}
{{ fsy.prettyBytes(1024) }}
{{ fsy.prettyMs(5000) }}

{# Date/Time helpers (dayjs) #}
{{ fsy.dateFormat(post.created_at, 'YYYY-MM-DD HH:mm') }}
{{ fsy.dateFromNow(post.created_at) }} {# "2 hours ago" #}
{{ fsy.dateAgo(post.created_at) }} {# "2 hours ago" #}
{{ fsy.dateUntil(event.date) }} {# "in 2 hours" #}
{{ fsy.date(post.created_at).format('MMMM D, YYYY') }} {# Full dayjs API #}
{% if fsy.dateIsBefore(post.created_at, fsy.date()) %}Published{% endif %}
{{ fsy.dateDiff(post.created_at, fsy.date(), 'day') }} days ago
{{ fsy.dateAdd(post.created_at, 7, 'day').format('YYYY-MM-DD') }}
{{ fsy.dateStartOf(post.created_at, 'month').format('YYYY-MM-DD') }}

{# Environment #}
{% if fsy.isDev() %}Dev mode{% endif %}

{# SEO #}
{{ fsy.canonical() }}
{{ fsy.jsonld(schema) | safe }}
```

## Lifecycle Hooks

### Global Hooks

Create `pages/_hooks.js`:

```javascript
module.exports = {
  onRequest(ctx) {},
  beforeLoad(ctx) {},
  afterLoad(ctx) {},
  beforeRender(ctx) {},
  afterRender(ctx) {},
  onError(ctx, err) {}
};
```

### Hook Execution Order

1. Global `onRequest`
2. Route `onRequest`
3. Route `beforeMiddleware`
4. Route middleware
5. Route `afterMiddleware`
6. Route `beforeLoad`
7. Route `load()`
8. Route `afterLoad`
9. Route `beforeRender`
10. Nunjucks render
11. Route `afterRender`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment |
| `DEFAULT_LOCALE` | `en` | Default locale |
| `SUPPORTED_LOCALES` | `en` | Comma-separated locales |
| `BASE_URL` | `http://localhost:3000` | Base URL for canonical URLs |
| `DATABASE_URL` | - | Database connection string (for ORM) |

## ORM (Database)

Webspresso includes a minimal, Eloquent-inspired ORM built on Knex with Zod schemas as the single source of truth.

### Quick Start

```javascript
const { zdb, defineModel, createDatabase } = require('webspresso');

// 1. Define your schema with database metadata
const UserSchema = zdb.schema({
  id: zdb.id(),
  email: zdb.string({ unique: true, index: true }),
  name: zdb.string({ maxLength: 100 }),
  status: zdb.enum(['active', 'inactive'], { default: 'active' }),
  company_id: zdb.foreignKey('companies', { nullable: true }),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
  deleted_at: zdb.timestamp({ nullable: true }),
});

// 3. Define your model
const User = defineModel({
  name: 'User',
  table: 'users',
  schema: UserSchema,
  relations: {
    company: { type: 'belongsTo', model: () => Company, foreignKey: 'company_id' },
    posts: { type: 'hasMany', model: () => Post, foreignKey: 'user_id' },
  },
  scopes: { softDelete: true, timestamps: true },
});

// 4. Create database (models auto-loaded from ./models directory)
const db = createDatabase({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  models: './models', // Optional, defaults to './models'
});

// Models are automatically loaded from models/ directory
// Use getRepository with model name
const UserRepo = db.getRepository('User');
const user = await UserRepo.findById(1, { with: ['company', 'posts'] });
```

### Schema Helpers (zdb)

The `zdb` helpers wrap Zod schemas with database column metadata:

| Helper | Description | Options |
|--------|-------------|---------|
| `zdb.id()` | Primary key (bigint, auto-increment) | |
| `zdb.uuid()` | UUID primary key | |
| `zdb.nanoid(opts)` | Nanoid primary key (URL-safe string, stored as VARCHAR) | `maxLength` (default `21`) |
| `zdb.string(opts)` | VARCHAR column | `maxLength`, `unique`, `index`, `nullable` |
| `zdb.text(opts)` | TEXT column | `nullable` |
| `zdb.integer(opts)` | INTEGER column | `nullable`, `default` |
| `zdb.bigint(opts)` | BIGINT column | `nullable` |
| `zdb.float(opts)` | FLOAT column | `nullable` |
| `zdb.decimal(opts)` | DECIMAL column | `precision`, `scale`, `nullable` |
| `zdb.boolean(opts)` | BOOLEAN column | `default`, `nullable` |
| `zdb.date(opts)` | DATE column | `nullable` |
| `zdb.datetime(opts)` | DATETIME column | `nullable` |
| `zdb.timestamp(opts)` | TIMESTAMP column | `auto: 'create'\|'update'`, `nullable` |
| `zdb.json(opts)` | JSON column | `nullable` |
| `zdb.array(itemSchema, opts)` | ARRAY column (stored as JSON) | `nullable` |
| `zdb.enum(values, opts)` | ENUM column | `default`, `nullable` |
| `zdb.foreignKey(table, opts)` | Foreign key (bigint) | `referenceColumn`, `nullable` |
| `zdb.foreignUuid(table, opts)` | Foreign key (uuid) | `referenceColumn`, `nullable` |
| `zdb.foreignNanoid(table, opts)` | Foreign key (nanoid string) | `referenceColumn`, `nullable`, `maxLength` (must match referenced PK) |

**Nanoid columns:** Migration scaffolding emits `table.string(column, maxLength)`. For a **nanoid primary key**, if you omit the primary key on `repository.create()`, Webspresso fills it with a cryptographically random ID using the same default alphabet as the [`nanoid`](https://github.com/ai/nanoid) package (implemented in-framework; no extra dependency). You can also call **`generateNanoid`** (exported from `webspresso`) anywhere you need the same generator.

### Model Definition

```javascript
const User = defineModel({
  name: 'User',           // Model name
  table: 'users',         // Database table
  schema: UserSchema,     // Zod schema
  primaryKey: 'id',       // Primary key column (default: 'id')
  
  relations: {
    // belongsTo: this model has foreign key
    company: {
      type: 'belongsTo',
      model: () => Company,
      foreignKey: 'company_id',
    },
    // hasMany: related model has foreign key
    posts: {
      type: 'hasMany',
      model: () => Post,
      foreignKey: 'user_id',
    },
    // hasOne: like hasMany but returns single record
    profile: {
      type: 'hasOne',
      model: () => Profile,
      foreignKey: 'user_id',
    },
  },
  
  scopes: {
    softDelete: true,     // Use deleted_at column
    timestamps: true,     // Auto-manage created_at/updated_at
    tenant: 'tenant_id',  // Multi-tenant column (optional)
  },

  hidden: ['password_hash', 'api_token'],  // Never expose in API/templates (security)
});
```

**Hidden columns:** Add column names to `hidden` so they are never exposed in admin API responses, exports, or when passing to templates. Use for sensitive data like `password_hash`, `api_token`, `secret_key`. The admin panel will exclude these from list views and forms automatically.

### Auto-Loading Models

Models are automatically loaded from the `models/` directory when you create a database instance:

```javascript
// models/User.js
const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'User',
  table: 'users',
  schema: zdb.schema({
    id: zdb.id(),
    email: zdb.string({ unique: true }),
    name: zdb.string(),
    created_at: zdb.timestamp({ auto: 'create' }),
    updated_at: zdb.timestamp({ auto: 'update' }),
  }),
});

// In your application code
const db = createDatabase({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  models: './models', // Optional, defaults to './models'
});

// Models are automatically loaded, use getRepository with model name
const UserRepo = db.getRepository('User');
```

Pass `db` to `createApp({ db })` to expose it as `ctx.db` in plugin hooks and page `load`/`meta` functions.

**Model File Structure:**
- Place model files in `models/` directory (or custom path via `config.models`)
- Each file should export a model defined with `defineModel()`
- Files starting with `_` are ignored (useful for shared utilities)
- Models are loaded in alphabetical order

### Repository API

```javascript
const db = createDatabase({ client: 'pg', connection: '...' });
const UserRepo = db.getRepository('User'); // Use model name string

// Find by ID (with eager loading)
const user = await UserRepo.findById(1, { with: ['company', 'posts'] });

// Find one by conditions
const admin = await UserRepo.findOne({ email: 'admin@example.com' });

// Find all
const users = await UserRepo.findAll({ with: ['company'] });

// Create
const newUser = await UserRepo.create({
  email: 'new@example.com',
  name: 'New User',
});

// Create many
const users = await UserRepo.createMany([
  { email: 'user1@test.com', name: 'User 1' },
  { email: 'user2@test.com', name: 'User 2' },
]);

// Update
const updated = await UserRepo.update(1, { name: 'Updated Name' });

// Update where
await UserRepo.updateWhere({ status: 'inactive' }, { status: 'banned' });

// Delete (soft delete if enabled)
await UserRepo.delete(1);

// Force delete (permanent)
await UserRepo.forceDelete(1);

// Restore soft-deleted
await UserRepo.restore(1);

// Count
const count = await UserRepo.count({ status: 'active' });

// Exists
const exists = await UserRepo.exists({ email: 'test@example.com' });
```

### Query Builder

```javascript
const users = await UserRepo.query()
  .where({ status: 'active' })
  .where('created_at', '>', '2024-01-01')
  .whereIn('role', ['admin', 'moderator'])
  .whereNotNull('email_verified_at')
  .orderBy('name', 'asc')
  .orderBy('created_at', 'desc')
  .limit(10)
  .offset(20)
  .with('company', 'posts')
  .list();

// First result
const user = await UserRepo.query()
  .where({ email: 'admin@example.com' })
  .first();

// Count
const count = await UserRepo.query()
  .where({ status: 'active' })
  .count();

// Pagination
const result = await UserRepo.query()
  .where({ status: 'active' })
  .orderBy('created_at', 'desc')
  .paginate(1, 20);  // page 1, 20 per page

// result = { data: [...], total: 150, page: 1, perPage: 20, totalPages: 8 }

// Soft delete scopes
await UserRepo.query().withTrashed().list();   // Include deleted
await UserRepo.query().onlyTrashed().list();   // Only deleted

// Multi-tenant
await UserRepo.query().forTenant(tenantId).list();
```

`list()`, `first()`, and `paginate()` emit the same `beforeFind` / `afterFind` lifecycle hooks as `findAll` / `findOne` (one `afterFind` per row). `count()` ignores any `.limit()` / `.offset()` on the builder so it returns the full matching row count.

`query().delete()` runs a SQL `DELETE` for matching rows. On models with soft deletes, use `UserRepo.delete(id)` (or equivalent) to set `deleted_at`; the query builder does not convert deletes to soft deletes.

### Transactions

```javascript
await db.transaction(async (trx) => {
  const userRepo = trx.getRepository('User'); // Use model name
  const postRepo = trx.getRepository('Post');
  
  const user = await userRepo.create({ email: 'new@test.com', name: 'New' });
  await postRepo.create({ title: 'First Post', user_id: user.id });
  
  // All changes committed on success
  // Rolled back on error
});
```

**ORM reads inside `db.transaction()` always bypass the query cache** (Knex transaction client), so you never serve stale rows mid-transaction.

### ORM query cache (optional)

Enable an in-process, tag-based cache for common read paths. Default provider is in-memory (`createMemoryCacheProvider`); you can pass a custom **`provider`** with the same shape (`get`, `set` with optional `tags` / `ttlMs`, `invalidateTags`, `clear`, `getSizeStats`).

**Turn it on:**

```javascript
const db = createDatabase({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  models: './models',
  cache: true, // same as { enabled: true, defaultStrategy: 'auto', memory provider }
  // cache: {
  //   enabled: true,
  //   defaultStrategy: 'auto', // or 'smart'
  //   memory: { maxEntries: 50_000, defaultTtlMs: undefined },
  //   // provider: myRedisLikeAdapter,
  // },
});
```

When enabled, **`db.cache`** exposes **`purge()`**, **`invalidateTags(string[])`**, **`invalidateModel('ModelName')`**, **`getMetrics()`**, and **`resetMetrics()`**. When the cache is off, **`db.cache`** is **`null`**.

**Per-model opt-in / strategy** (inherits the database **`defaultStrategy`** when set to `true`):

```javascript
defineModel({
  name: 'User',
  table: 'users',
  schema: UserSchema,
  cache: true,              // use db defaultStrategy
  // cache: 'auto', // invalidate all cached reads for this model on any row change
  // cache: 'smart', // finer-grained tags: PK reads vs list/collection queries
  // cache: { strategy: 'smart' },
  // cache: false,         // never cache this model
});
```

**What gets cached:** **`findById`**, **`findOne`**, **`findAll`**, and query builder **`first`**, **`list`**, **`count`**, **`paginate`** — only when the model participates in caching and the read is not on a transaction connection. Some query shapes are never cached (e.g. raw `where` fragments); the layer increments a **`bypassed`** metric for those.

**Invalidation:** Hooks on **`afterCreate`**, **`afterUpdate`**, **`afterDelete`**, and **`afterRestore`** schedule tag invalidation after the Knex transaction commits (when applicable). With **`auto`**, every mutation clears all cache entries tagged for that model. With **`smart`**, creates invalidate collection query tags; updates/deletes target the row’s primary key tag plus collection tags when the record exposes an id (falls back to full-model invalidation if the id is missing). Bulk **`updateWhere`** / query-builder **`update`** / **`delete`** that affect rows call **`invalidateModelAll`** for safety.

**Exports:** **`createMemoryCacheProvider`**, **`OrmCacheLayer`**, and **`createOrmCacheFromConfig`** are available from **`webspresso`** for advanced/testing setups.

### Migrations

**CLI Commands:**

```bash
# Run pending migrations
webspresso db:migrate

# Rollback last batch
webspresso db:rollback

# Rollback all
webspresso db:rollback --all

# Show migration status
webspresso db:status

# Create empty migration
webspresso db:make create_posts_table

# Create migration from model (scaffolding)
webspresso db:make create_users_table --model User

# Admin Panel Setup
webspresso admin:setup   # Create admin_users migration
webspresso admin:list    # List all admin users
webspresso admin:password  # Reset admin password (interactive or -e -p)
```

**Admin CLI Commands:**

```bash
# Create admin_users table migration
webspresso admin:setup

# List all admin users
webspresso admin:list

# Reset admin password (interactive: prompts for email and password)
webspresso admin:password

# Reset with options
webspresso admin:password -e admin@example.com -p yeni_sifre123

# Use custom config or environment
webspresso admin:password -c ./webspresso.db.js -E production
webspresso admin:list -c ./webspresso.db.js
```

> **Note:** Database config is loaded from `webspresso.db.js` or `knexfile.js` in the project root. Run commands from your project directory.

**Database Config File (`webspresso.db.js`):**

```javascript
module.exports = {
  client: 'pg',  // or 'mysql2', 'better-sqlite3'
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  
  // Environment overrides
  production: {
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 10 },
  },
};
```

**Programmatic API:**

```javascript
const db = createDatabase({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: { directory: './migrations' },
});

await db.migrate.latest();                      // Run pending
await db.migrate.rollback();                    // Rollback last batch
await db.migrate.rollback({ all: true });       // Rollback all
const status = await db.migrate.status();       // Get status
```

### Migration Scaffolding

Generate migration from model schema:

```javascript
const { scaffoldMigration } = require('webspresso');

const migration = scaffoldMigration(User);
// Outputs complete migration file content with:
// - All columns with proper types
// - Indexes
// - Foreign key constraints
// - Up and down functions
```

### Supported Databases

Install the appropriate driver as a peer dependency:

```bash
# PostgreSQL
npm install pg

# MySQL
npm install mysql2

# SQLite
npm install better-sqlite3
```

### Design Philosophy

| Boundary | Zod's Job | ORM's Job |
|----------|-----------|-----------|
| Schema definition | Type shape, validation rules | Column metadata extraction |
| Input validation | `.parse()` / `.safeParse()` | Never - pass through to Zod |
| Query building | N/A | Full ownership |
| Relation resolution | N/A | Eager loading with batch queries |
| Timestamps/SoftDelete | N/A | Auto-inject on operations |

**N+1 Prevention:** Relations are always loaded with batch `WHERE IN (...)` queries, never with individual queries per record.

### Database Seeding

**CLI Command:**

The easiest way to seed your database is using the CLI command:

```bash
# Run seeds (requires seeds/index.js)
webspresso seed

# Setup seed files if they don't exist
webspresso seed --setup

# Use custom database config
webspresso seed --config ./custom-db-config.js

# Use different environment
webspresso seed --env production
```

The `webspresso seed` command:
- Automatically loads all models from `models/` directory
- Generates fake data based on model schemas
- Creates 10 records per model by default
- Uses smart field detection for appropriate fake data

**Manual Setup:**

Generate fake data for testing and development using `@faker-js/faker`:

```bash
npm install @faker-js/faker
```

**Basic Usage:**

```javascript
const { faker } = require('@faker-js/faker');
const db = createDatabase({ /* config */ });

const seeder = db.seeder(faker);

// Generate a single record
const user = await seeder.factory('User').create();

// Generate multiple records
const users = await seeder.factory('User').create(10);

// Generate without saving (for testing)
const userData = seeder.factory('User').make();
```

**Define Factories with Defaults and States:**

```javascript
seeder.defineFactory('User', {
  // Default values
  defaults: {
    status: 'pending',
  },
  
  // Custom generators
  generators: {
    username: (f) => f.internet.username().toLowerCase(),
  },
  
  // Named states for variations
  states: {
    admin: { role: 'admin', status: 'active' },
    verified: (f) => ({
      status: 'verified',
      verified_at: f.date.past().toISOString(),
    }),
  },
});

// Use states
const admin = await seeder.factory('User').state('admin').create();
const verified = await seeder.factory('User').state('verified').create();
```

**Smart Field Detection:**

The seeder automatically generates appropriate fake data based on column names:

| Field Name Pattern | Generated Data |
|-------------------|----------------|
| `email`, `*_email` | Valid email address |
| `name`, `first_name`, `last_name` | Person names |
| `username` | Username |
| `title` | Short sentence |
| `content`, `body`, `description` | Paragraphs |
| `slug` | URL-safe slug |
| `phone`, `tel` | Phone number |
| `address`, `city`, `country` | Location data |
| `price`, `amount`, `cost` | Decimal numbers |
| `*_url`, `avatar`, `image` | URLs |

**Override and Custom Generators:**

```javascript
const user = await seeder.factory('User')
  .override({ email: 'test@example.com' })
  .generators({
    code: (f) => `USR-${f.string.alphanumeric(8)}`,
  })
  .create();
```

**Batch Seeding:**

```javascript
// Seed multiple models at once
const results = await seeder.run([
  { model: 'Company', count: 5 },
  { model: 'User', count: 20, state: 'active' },
  { model: 'Post', count: 50 },
]);

// Access results
console.log(results.Company); // Array of 5 companies
console.log(results.User);    // Array of 20 users
```

**Cleanup:**

```javascript
// Truncate specific tables
await seeder.truncate('User');
await seeder.truncate(['User', 'Post']);

// Clear all registered model tables
await seeder.clearAll();
```

### Schema Explorer Plugin

A plugin that exposes ORM schema information via API endpoints. Useful for frontend code generation, documentation, or admin tools.

**Setup:**

```javascript
const { createApp, schemaExplorerPlugin } = require('webspresso');

const app = createApp({
  plugins: [
    schemaExplorerPlugin({
      path: '/_schema',           // Endpoint path (default: '/_schema')
      enabled: true,              // Force enable (default: auto based on NODE_ENV)
      exclude: ['Secret'],        // Exclude specific models
      includeColumns: true,       // Include column metadata
      includeRelations: true,     // Include relation metadata
      includeScopes: true,        // Include scope configuration
      authorize: (req) => {       // Custom authorization
        return req.headers['x-api-key'] === 'secret';
      },
    }),
  ],
});
```

**Endpoints:**

- `GET /_schema` - List all models
- `GET /_schema/:modelName` - Get single model details
- `GET /_schema/openapi` - Export in OpenAPI 3.0 schema format

**Example Response (`GET /_schema`):**

```json
{
  "meta": {
    "version": "1.0.0",
    "generatedAt": "2024-01-01T12:00:00.000Z",
    "modelCount": 2
  },
  "models": [
    {
      "name": "User",
      "table": "users",
      "primaryKey": "id",
      "columns": [
        { "name": "id", "type": "bigint", "primary": true, "autoIncrement": true },
        { "name": "email", "type": "string", "unique": true },
        { "name": "company_id", "type": "bigint", "references": "companies" }
      ],
      "relations": [
        { "name": "company", "type": "belongsTo", "relatedModel": "Company", "foreignKey": "company_id" }
      ],
      "scopes": { "softDelete": true, "timestamps": true, "tenant": null }
    }
  ]
}
```

**Plugin API (programmatic usage):**

```javascript
const plugin = schemaExplorerPlugin();

// Plugin API can be used by other plugins or in code
const models = plugin.api.getModels();       // All models
const user = plugin.api.getModel('User');    // Single model
const names = plugin.api.getModelNames();    // Model names
```

### REST resources plugin

Registers **REST-style CRUD** routes for ORM models (`GET` list, `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id`). Relations are eager-loaded only when the client passes **`?include=relation1,relation2`**; loading uses the ORM batch eager loader (no classic N+1 from relation queries). **Nested includes** (e.g. `posts.comments`) are **not** supported—only top-level relation names defined on the model.

**Model opt-in** via `defineModel({ ..., rest: { enabled: true, path: 'optional-segment', allowInclude: ['company'] } })`. If you pass **`models: ['User', 'Post']`** to the plugin, those names are exposed even when `rest.enabled` is false.

**Setup:**

```javascript
const { createApp, restResourcePlugin } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  db,
  plugins: [
    restResourcePlugin({
      path: '/api/rest',
      middleware: [], // optional Express handlers (e.g. auth) — `attachDbMiddleware` is applied after these
      models: null,   // optional whitelist of model names; when omitted, only `rest.enabled` models are exposed
      excludeModels: [],
      filter: null,   // optional (model) => boolean
    }),
  ],
});
```

List query parameters: `page`, `perPage`, `sort`, `order`, `include`, `trashed` (`only` / `include` when the model uses soft delete), plus **equality filters** on real columns (unknown keys are ignored).

### File upload plugin

Registers **POST** `multipart/form-data` (field name **`file`** by default) and stores the file via a pluggable provider. The framework ships with **`createLocalFileProvider({ destDir, publicBasePath })`** (writes to disk and returns a public URL path). Use **`mimeAllowlist`** / **`extensionAllowlist`** and **`maxBytes`** (default **10 MiB**) on the server; production apps should prefer an explicit MIME allowlist.

**Setup:**

```javascript
const { createApp, uploadPlugin, adminPanelPlugin } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  publicDir: './public',
  db,
  plugins: [
    uploadPlugin({
      path: '/api/upload',
      local: {
        destDir: './public/uploads',
        publicBasePath: '/uploads',
      },
      maxBytes: 10 * 1024 * 1024,
      mimeAllowlist: ['image/jpeg', 'image/png', 'application/pdf'],
      extensionAllowlist: ['jpg', 'jpeg', 'png', 'pdf'],
      middleware: [], // optional Express handlers (e.g. session auth)
      fieldName: 'file',
    }),
    adminPanelPlugin({
      db,
      // uploadUrl optional: defaults to app.get('webspresso.uploadPath') set by uploadPlugin
    }),
  ],
});
```

- **ORM:** `zdb.file({ maxLength: 2048, nullable: true })` — string column for the stored public URL or path; migrations use `table.string(..., maxLength)`.
- **Admin:** the panel reads **`settings.uploadUrl`** from the registry (set automatically when `uploadPlugin` is registered **before** `adminPanelPlugin`, or pass **`adminPanelPlugin({ uploadUrl: '/api/upload' })`**). File fields (`type: 'file'` or `customFields` type `file-upload`) POST to that URL with credentials.
- **Response:** `{ url, publicUrl, key? }` — clients typically persist **`url`** / **`publicUrl`** in the model.
- **Custom storage:** `uploadPlugin({ provider: { async put({ buffer, originalName, mimeType, size, req }) { return { publicUrl: '...' }; } } })`.

### Health check plugin

Exposes a lightweight **GET** endpoint for load balancers and orchestrators (Kubernetes, Docker healthcheck, etc.). **Enabled by default** in all environments; set `enabled: false` to turn it off.

**Setup:**

```javascript
const { createApp, healthCheckPlugin } = require('webspresso');

const app = createApp({
  plugins: [
    healthCheckPlugin({
      path: '/health',              // default
      verbose: true,                // timestamp, uptime, NODE_ENV, framework name/version
      authorize: (req) => true,     // optional — restrict who can read the endpoint
      checks: async ({ db }) => {
        if (db) await db.knex.raw('select 1');
        return { database: 'ok' };
      },
    }),
  ],
});
```

- **`checks`**: If this function throws, the handler responds with **503** and `{ status: 'unhealthy', error, ... }`. Return a plain object to merge into `checks` on success (e.g. dependency status).
- Use a **custom `path`** if your app already serves `GET /health` from `pages/`.

### Swagger / OpenAPI plugin

Serves **OpenAPI 3** for file-based `pages/api` routes and optional [Zod](https://zod.dev) `schema` exports, plus a **Swagger UI** page. Defaults to **development only** (same idea as the schema explorer).

**Setup:**

```javascript
const { createApp, swaggerPlugin } = require('webspresso');

const app = createApp({
  plugins: [
    swaggerPlugin({
      path: '/_swagger',           // UI: GET /_swagger, spec: GET /_swagger/openapi.json
      enabled: true,               // default: true in development, false in production
      title: 'My API',             // optional OpenAPI info.title
      serverUrl: 'https://api.example.com', // optional servers[0].url (else BASE_URL or localhost)
      includeOrmSchemas: false,    // merge ORM model schemas into components.schemas
      ormExclude: ['Secret'],      // when includeOrmSchemas is true
      authorize: (req) => true,  // optional gate for both UI and JSON
    }),
  ],
});
```

**Endpoints:**

- `GET /_swagger/openapi.json` — Full OpenAPI document (`paths` from API routes; request/response shapes from exported `schema({ z })` when present).
- `GET /_swagger` — Swagger UI (loads the JSON above; requires network access for CDN assets).

In production, keep the plugin disabled or protect it with `authorize` / your own middleware.

## Development

Native addons (**better-sqlite3**, **bcrypt**, **sharp**) are compiled for your current Node ABI. After switching Node major versions (e.g. nvm, fnm, Volta), run **`npm run rebuild:native`** or a clean install: `rm -rf node_modules && npm ci`. **chokidar** is not ABI-tied like those drivers; if file watching misbehaves, reinstall dependencies. The repo includes [`.nvmrc`](.nvmrc) (Node 20 LTS) as a known-good default for this project.

```bash
# Install dependencies
npm install

# If you changed Node version and see MODULE_VERSION or .node load errors:
npm run rebuild:native

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Micro-benchmarks (Vitest bench; CI: main push uploads benchmark-baseline artifact, PRs compare against it)
npm run bench
# Local baseline + compare: npm run bench:ci:local
```

## License

MIT
