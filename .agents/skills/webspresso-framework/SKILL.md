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
webspresso agents:init      # Scaffold AI Agent rules and skills
```

---

## 🏗️ Core Architecture Overview

- **`pages/` & `pages/api/`**: File-based SSR templates (`.njk`), companion data loaders (`.js`), and method-suffixed API endpoints (`.get.js`, `.post.js`).
- **`services/`**: Auto-discovered domain services mapping to dot-separated names (`'user.create'`).
- **`models/`**: Schema-driven ORM models with `zdb` definitions, repositories, relations, scopes, and query cache.
- **`plugins/`**: Modular extension ecosystem (Admin Panel, Media Library, Polar Billing, CSV/XLSX, Realtime, CSRF, CORS, Basic Auth).
- **`views/`**: Nunjucks layouts, partials, and `fsy` template helpers.
