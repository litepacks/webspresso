---
name: webspresso-framework
description: >-
  Core workflow and guide for Webspresso, a lightweight, zero-dependency-sprawl full-stack
  Node.js SSR and API framework. Use when scaffolding, architecting, building, or debugging
  Webspresso applications, configuring plugins, dual auth, response compression, graceful shutdown,
  and error boundaries.
---

# Webspresso Framework Master Guide

Webspresso is a lightweight, zero-dependency-sprawl full-stack Node.js SSR & API framework featuring Next.js/Nuxt-style file-based routing, an intuitive Knex-based ORM, a modular plugin ecosystem, and a customizable Mithril.js SPA Admin Panel.

## 🛡️ 4-Step Mandatory Agent Workflow Protocol

1. **Discover & Triage**: Identify relevant topic guides (`.agents/`) and inspect existing files in `pages/api/`, `models/`, `services/`.
2. **Contract Adherence**: Export `{ schema, middleware, handler }` for APIs, `defineModel` for ORM, `defineService` for services.
3. **Zero External Dependencies**: Core functionality relies strictly on native Node.js modules (`crypto`, `path`, `fs`, `zlib`, `events`). NEVER install ad-hoc packages for JWT, passport, express-session, or custom routers.
4. **Targeted Verification**: Run specific Vitest unit tests (`npx vitest run tests/...`) to ensure zero regressions.

---

## ⚖️ Golden Rules & Anti-Patterns

| Category | ❌ NEVER DO THIS (Anti-Pattern) | ✅ ALWAYS DO THIS (Webspresso Way) |
| :--- | :--- | :--- |
| **Routing** | `routes/index.js`, `express.Router()`, `app.get('/api/users')` | `pages/api/users.get.js` exporting `{ schema, handler }` |
| **Database** | `db('users').where({ id }).select()` (Raw Knex) | `db.getRepository('User').findById(id)` |
| **Business Logic** | `controllers/UserController.js` | `services/user/get.js` → `ctx.service('user.get', input)` |
| **Auth** | `npm i jsonwebtoken passport express-session` | Built-in `req.auth`, `core/auth`, `middleware: ['jwt']` |
| **SSR Rendering**| `res.render('profile.njk', data)` inside handlers | Companion loader `pages/profile.js` exporting `async function load()` |
| **Exceptions** | `res.status(404).json({ error: 'Not found' })` | `throw new NotFoundError('User not found')` |
| **Background** | `setTimeout(...)`, `npm i bullmq` | `jobs/user/welcome.js` → `req.queue.dispatch('user.welcome', data)` |

---

## 🚀 CLI Commands

```bash
webspresso dev              # Start dev server with hot reload
webspresso start            # Start production server
webspresso doctor           # Run system sanity checks
webspresso db:migrate       # Run pending Knex migrations
webspresso db:seed          # Run database seeders
webspresso add:tailwind     # Add Tailwind CSS v4 (Oxide engine, zero-config)
webspresso agents:init      # Scaffold AI Agent rules and skills
```

---

## 🎨 Tailwind CSS v4 Integration

Webspresso natively supports **Tailwind CSS v4** (Oxide engine, LightningCSS, zero-config CSS-first architecture).

### Setup & Commands
```bash
# Add Tailwind CSS v4 (recommended, zero-config CSS-first)
npx webspresso add tailwind --v4

# Or upgrade an existing Tailwind v3 project to v4
npx webspresso add tailwind --upgrade
```

### Architecture & Conventions
- **CSS-First Directives**: `src/input.css` uses modern v4 `@import`:
  ```css
  @import "tailwindcss";
  ```
- **Zero Configuration**: No `tailwind.config.js`, `postcss.config.js`, or `autoprefixer` required.
- **Compiled Output**: Compiles into `public/css/style.css` via `@tailwindcss/cli`.
- **Scripts in `package.json`**:
  - `"build:css"`: `@tailwindcss/cli -i ./src/input.css -o ./public/css/style.css --minify`
  - `"watch:css"`: `@tailwindcss/cli -i ./src/input.css -o ./public/css/style.css --watch`
  - `"dev"`: Automatically runs CSS watcher alongside the server: `npm run watch:css & node --watch server.js`
- **Template Integration**: Link stylesheet in Nunjucks layouts (`views/layout.njk`):
  ```nunjucks
  <link rel="stylesheet" href="{{ fsy.asset('/css/style.css') }}">
  ```

---

## 🏗️ Core Architecture Overview

- **`pages/` & `pages/api/`**: File-based SSR templates (`.njk`), companion data loaders (`.js`), and method-suffixed API endpoints (`.get.js`, `.post.js`).
- **`services/`**: Auto-discovered domain services mapping to dot-separated names (`'user.create'`), with declarative validation, RBAC, timeouts, and transaction propagation.
- **Ambient Context & Composable Hooks (`core/context`)**: Zero-dependency `AsyncLocalStorage` hooks (`useContext`, `useDb`, `useAuth`, `useUser`, `useService`, `useLogger`, `useReq`, `useRes`, `useParams`, `useQuery`, `useTransaction`, `useBreaker`, `withContext`) eliminating prop drilling across services, loaders, and background jobs.
- **`models/`**: Schema-driven ORM models with `zdb` definitions, repositories, relations, scopes, and query cache.
- **`plugins/`**: Modular extension ecosystem (Admin Panel, Media Library, Polar Billing, CSV/XLSX, Realtime, CSRF, CORS, Basic Auth).
- **`views/`**: Nunjucks layouts, partials, and `fsy` template helpers.
