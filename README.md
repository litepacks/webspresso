# Webspresso

[![npm version](https://img.shields.io/npm/v/webspresso.svg?style=flat-square)](https://www.npmjs.com/package/webspresso)
[![vulnerabilities](https://npmx.dev/api/registry/badge/vulnerabilities/webspresso?style=shieldsio)](https://npmx.dev/package/webspresso)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

A batteries-included, full-stack Node.js framework combining Next.js/Nuxt-style file-based routing, server-rendered Nunjucks streaming, a Knex-based ORM with ambient transactions, built-in native dual authentication, background queues, and a customizable Mithril.js SPA Admin Panel.

---

## ⚡ Quick Start

Create a new Webspresso project in seconds:

```bash
# Scaffold a new application interactively
npx webspresso new my-app --install

# Start development server with live reload
cd my-app
npm run dev
```

Open **`http://localhost:7331`** in your browser.

---

## 🌟 Core Capabilities

| Layer | Capabilities |
| :--- | :--- |
| **Routing & SSR** | 100% file-based routing (`pages/`), method suffixes (`.get.js`, `.post.js`), nested layouts (`_layout.njk`), directory-level error boundaries (`_error.njk`), loading skeletons (`_loading.njk`), and out-of-order chunked response streaming (`res.renderStream`). |
| **Performance & Cold Start** | Single-pass unified route discovery, dev mode JIT on-demand route evaluation, production AOT route manifest (`webspresso build`), AOT Nunjucks template precompilation (zero AST parsing at runtime), and on-demand lazy plugin mounting. |
| **Database & ORM** | Built-in Knex ORM with `defineModel`, `zdb` schema builder, Repository pattern (`db.getRepository('Model')`), relations (`belongsTo`, `hasMany`), cascade soft-delete & restore, and ambient transactions via `AsyncLocalStorage`. |
| **Dual Auth & Sessions** | Stateful cookies for SSR + stateless HS256 JWT rotation for APIs, magic links, active device management & remote session revocation, CSRF protection, and built-in native auth. |
| **Services & Queues** | File-based auto-discovery in `services/` with declarative Zod validation, role-based access guards, and ACID transaction propagation. Background worker queues in `jobs/`. |
| **Admin Panel SPA** | Integrated Mithril.js single-page admin panel mounted at `/_admin` with auto-layout wrapping, CRUD views, custom dashboard widgets, and custom field renderers. Supports on-demand lazy mounting (`adminPanelPlugin({ lazy: true })`). |
| **Plugin Ecosystem** | 20+ official plugins: Polar.sh billing, Webhooks dispatcher with HMAC signatures, Realtime (WebSocket/SSE), Site Analytics, API Keys, File Manager, CSV/Excel generation, On-demand Lazy Plugins (`lazyPlugin`), and more. |
| **DevOps & Production** | Built-in streaming zlib compression (`brotli`/`gzip`), socket connection draining & graceful shutdown, `webspresso deploy:check` production readiness auditor, and Docker scaffolding. |

---

## 🛠️ Code at a Glance

### 1. File-Based Page Route (`pages/notes.njk` + `pages/notes.js`)

Companion `.js` loaders fetch data server-side before template rendering:

```html
<!-- pages/notes.njk -->
{% extends "views/layout.njk" %}

{% block content %}
<div class="max-w-3xl mx-auto py-8">
  <h1 class="text-2xl font-bold mb-4">My Notes</h1>
  <ul class="space-y-2">
    {% for note in notes %}
      <li class="p-4 bg-white rounded border shadow-sm">{{ note.title }}</li>
    {% else %}
      <p class="text-slate-500">No notes yet.</p>
    {% endfor %}
  </ul>
</div>
{% endblock %}
```

```javascript
// pages/notes.js
module.exports = {
  async load({ req, db }) {
    const notes = await db.getRepository('Note').find({
      userId: req.user?.id,
    });
    return { notes };
  },
};
```

### 2. Method-Suffixed API Route (`pages/api/notes.post.js`)

Export `{ schema, middleware, handler }` or `defineApi()` with declarative Zod validation:

```javascript
// pages/api/notes.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(1, 'Title is required').max(200),
      content: z.string().min(1),
    }),
  }),
  middleware: ['auth'], // Built-in session or JWT guard
  async handler(req, res) {
    // req.input.body is validated and typed
    const note = await req.db.getRepository('Note').create({
      ...req.input.body,
      userId: req.user.id,
    });
    return res.status(201).json(note);
  },
});
```

### 3. ORM Model Definition (`models/Note.js`)

Define models with `defineModel` and the expressive `zdb` schema builder:

```javascript
// models/Note.js
const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: 'Note',
  table: 'notes',
  timestamps: true, // auto-injects createdAt & updatedAt into schema & scopes
  softDelete: true, // auto-injects deletedAt & enables soft-delete scope
  schema: {
    id: zdb.id(),
    title: zdb.string(200),
    content: zdb.text(),
    userId: zdb.integer(),
  },
  relations: {
    user: { type: 'belongsTo', model: 'User', foreignKey: 'userId' },
  },
});
```

### 4. Application Server (`server.js`)

```javascript
const path = require('path');
const { createApp, createDatabase } = require('webspresso');

const db = createDatabase(require('./webspresso.db'));

const { app } = createApp({
  db,
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  server: {
    compression: true,
    shutdown: { enabled: true, timeout: 10000 },
  },
});

const PORT = process.env.PORT || 7331;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
```

---

## ⚡ High-Performance Architecture (Cold Start & AOT)

Webspresso is designed for blazing-fast cold starts and minimal resource consumption in both development and production:

1. **Unified Single-Pass Route Discovery (`discoverAppRoutes`)**: Traverses the filesystem only once at startup, building the `RouteTable` and companion loaders in a single pass (saving 30-40% mount time).
2. **Dev-Mode On-Demand (JIT) Route Evaluation**: In development, API routes and SSR companion `.js` configs are resolved on-demand when first requested. The dev server boots in **<100ms** regardless of project size.
3. **Production AOT Route Manifest (`webspresso build`)**: The build step generates `.webspresso/routes.manifest.json`. In production, the server mounts pre-indexed routes with **zero filesystem directory scans**.
4. **Nunjucks Template Precompilation (AOT / Zero-AST Parse)**: `webspresso build` precompiles `.njk` templates into JavaScript render functions (`.webspresso/templates.compiled.js`). Eliminates runtime disk I/O and template parsing overhead for ultra-low TTFB.
5. **On-Demand Lazy Plugins (`lazyPlugin`)**: Heavy plugins (e.g. `adminPanelPlugin({ lazy: true })`, `fileManagerPlugin({ lazy: true })`) defer initialization, session setup, and route mounting until first access to their URL prefix or service invocation.

---

## 🧰 Essential CLI Commands

```bash
# Development & Builds
npx webspresso dev                 # Start dev server with watch & JIT live reload
npx webspresso build               # Compile production assets, AOT route manifest & precompiled templates
npx webspresso start               # Run production server with zero-FS discovery

# Database & Migrations
npx webspresso db:migrate          # Run pending database migrations
npx webspresso db:rollback         # Roll back latest migration batch
npx webspresso db:status           # Inspect migration status
npx webspresso seed                # Run seed files

# Code Generation
npx webspresso page <path>         # Scaffold a new SSR page + loader
npx webspresso api <path>          # Scaffold a new method-suffixed API route
npx webspresso make:model <name>   # Generate a new ORM model
npx webspresso make:job <name>     # Generate a background queue job

# DevOps & Production Readiness
npx webspresso doctor              # Run project health & configuration check
npx webspresso deploy:check        # Pre-flight production readiness inspection
npx webspresso add:docker          # Scaffold Dockerfile & docker-compose.yml
npx webspresso add:tailwind        # Configure TailwindCSS integration
```

---

## 📚 Documentation

Detailed topic guides are available in the repository:

- **[Installation & First App](docs/getting-started/installation.md)** — Node.js requirements, setup, and first steps.
- **[File-Based Routing & API Routes](.agents/ROUTING.md)** — Routing conventions, parameters, and cascading layouts.
- **[SSR Streaming & Chunked Transfer](.agents/STREAMING.md)** — Out-of-order slots, `_loading.njk` skeletons, and TTFB optimization.
- **[Database & ORM Guide](.agents/ORM.md)** — Repositories, relations, soft deletes, and ambient transactions.
- **[Dual Authentication System](.agents/AUTH.md)** — Sessions, JWT rotation, magic links, and device management.
- **[Plugin Ecosystem Reference](.agents/PLUGINS.md)** — Polar billing, webhooks, analytics, realtime, and more.
- **[Admin Panel Customization](.agents/ADMIN.md)** — Extending the Mithril.js SPA admin panel.
- **[Full TypeScript Reference](index.d.ts)** — Canonical framework types and signatures.

---

## 🤖 For AI Coding Assistants

If you are an autonomous coding agent working in a Webspresso codebase:
- Read **[`AGENTS.md`](AGENTS.md)** for mandatory architectural rules, zero-regression policies, and code contracts.
- Check **[`llms.txt`](llms.txt)** for a machine-readable directory map of all documentation.

---

## 📄 License

MIT © [Webspresso Contributors](LICENSE)
