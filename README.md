# Webspresso

[![npm version](https://img.shields.io/npm/v/webspresso.svg?style=flat-square)](https://www.npmjs.com/package/webspresso)
[![vulnerabilities](https://npmx.dev/api/registry/badge/vulnerabilities/webspresso?style=shieldsio)](https://npmx.dev/package/webspresso)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

A lightweight, zero-dependency-sprawl Express SSR framework featuring file-based routing, server-side Nunjucks rendering, an intuitive Knex-based ORM with ambient `AsyncLocalStorage` transactions, dual authentication (Session + JWT), zero-dependency streaming compression, graceful shutdown, and a customizable Mithril.js SPA Admin Panel.

---

## ⚡ Quick Start (3 Minutes)

Scaffold a new project with interactive database and styling setup:

```bash
# Create a new project interactively
npx webspresso new my-app --install

# Navigate and start development server
cd my-app
npm run dev
```

Open **`http://localhost:3000`** in your browser.

---

## ✨ Why Webspresso?

- **Zero-Dependency Sprawl**: Core framework features (Dual Auth, JWT signing, Error handling, Streaming Compression, Graceful Shutdown, Template Helpers) rely strictly on native Node.js standard modules (`crypto`, `path`, `fs`, `events`, `zlib`, `async_hooks`) without bloated dependency trees.
- **File-Based Routing**: Templates in `pages/` automatically become public URL routes with support for dynamic params (`[id]`) and catch-all wildcards (`[...slug]`).
- **Server Data Prefetching (`load()`)**: Page routes export `async function load({ req, res, db, ctx })` to fetch data server-side before template compilation.
- **Services Layer**: File-based auto-discovery in `services/` with declarative Zod validation, role/predicate authorization guards, and memoization.
- **Ambient Transactions**: Knex database transactions automatically bind to `AsyncLocalStorage` (`core/orm/transaction.js`). Scoped repositories seamlessly participate in active transactions without manual `trx` passing.
- **Mithril.js Admin Panel SPA**: Built-in, isolated single-page admin panel mounted at `/_admin` with auto-layout wrapping for custom pages, widgets, and field renderers.
- **TypeScript First-Class Support**: Shipped with complete [`index.d.ts`](index.d.ts) type definitions for IDE autocompletion and type checking.

---

## 🛠️ Minimal Example

### 1. Server Entry Point (`server.js`)
```javascript
const path = require('path');
require('./config/load-env');
const { createApp, createDatabase } = require('webspresso');

const db = createDatabase(require('./webspresso.db'));

const { app } = createApp({
  db,
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  server: {
    shutdown: { enabled: true, timeout: 10000 },
    compression: true,
  },
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
```

### 2. Server-Rendered Page (`pages/index.njk` + `pages/index.js`)
```html
<!-- pages/index.njk -->
{% extends "views/layout.njk" %}

{% block content %}
<div class="max-w-4xl mx-auto py-12 px-4">
  <h1 class="text-3xl font-bold mb-4">{{ title }}</h1>
  <p class="text-slate-600">Welcome, {{ user.name or "Guest" }}!</p>
</div>
{% endblock %}
```

```javascript
// pages/index.js
module.exports = {
  async load({ req, ctx }) {
    return {
      title: 'Home Page',
      user: req.user || null,
    };
  },
};
```

### 3. Validated JSON API Endpoint (`pages/api/greet.post.js`)
```javascript
module.exports = {
  schema({ z }) {
    return {
      body: z.object({
        name: z.string().min(2),
      }),
    };
  },

  async handler(req, res) {
    // req.input is typed and validated by Zod
    const result = await req.service('user.greet', req.input.body);
    res.json(result);
  },
};
```

---

## 📚 Documentation

The complete Webspresso documentation is organized into 5 focused pillars:

### 🚀 Getting Started
- **[Installation Guide](docs/getting-started/installation.md)** — Node.js 20 LTS prerequisites, CLI setup, and TypeScript.
- **[Creating Your First App](docs/getting-started/first-app.md)** — Step-by-step walkthrough building an SSR page, API endpoint, and service.
- **[Project Structure](docs/getting-started/project-structure.md)** — Anatomy of `pages/`, `views/`, `services/`, `models/`, and `config/`.
- **[Deployment & Production](docs/getting-started/deployment.md)** — Production configuration, Docker, PM2, and Nginx.

### 📖 Task Guides ("How do I...?")
- **[File-Based Routing](docs/guides/routing.md)** — Static routes, dynamic params (`[id]`), and catch-all wildcards.
- **[SSR & Templates](docs/guides/ssr-and-templates.md)** — Nunjucks layouts, `load()` loaders, `fsy` helper catalog, and chunked streaming.
- **[Services Layer](docs/guides/services.md)** — Defining services, Zod validation, auth role guards, and ACID transactions.
- **[Database & ORM](docs/guides/database-and-orm.md)** — Model definitions (`defineModel`), `zdb` schema builder, and Knex migrations.
- **[Dual Authentication](docs/guides/authentication.md)** — Stateful Session cookies for SSR and stateless JWT rotation for REST APIs.
- **[Admin Panel Customization](docs/guides/admin-panel.md)** — Custom Mithril.js SPA pages, KPI widgets, and custom field renderers.

### 🧠 Concepts & Architecture ("How does it work and why?")
- **[System Architecture](docs/concepts/architecture.md)** — Layered architecture, subsystem boundaries, and design principles.
- **[Request Lifecycle](docs/concepts/request-lifecycle.md)** — End-to-end trace from TCP socket to template render and response stream.
- **[Service Execution Pipeline](docs/concepts/service-execution-pipeline.md)** — Sanitization, Zod validation, auth guards, ambient transactions, and caching.
- **[Ambient Transaction Propagation](docs/concepts/transaction-propagation.md)** — How `AsyncLocalStorage` manages ACID database transactions across nested services.

### 📚 API Reference ("What is the exact contract?")
- **[`createApp()` Configuration](docs/reference/create-app.md)** — Full `CreateAppOptions` parameter reference.
- **[CLI Reference](docs/reference/cli.md)** — Complete `webspresso` CLI command manual.
- **[Service Definition Spec](docs/reference/service-definition.md)** — `defineService` options and `ServiceContext` properties.
- **[Model Definition Spec](docs/reference/model-definition.md)** — `defineModel` options, `zdb` column types, and `Repository` query methods.
- **[Exceptions Catalog](docs/reference/exceptions.md)** — Built-in framework exception classes and HTTP status codes.

---

## 🤖 For AI Coding Agents

If you are an autonomous coding assistant or LLM working on a Webspresso codebase:
- Read **[`AGENTS.md`](AGENTS.md)** for authoritative architectural guidelines, zero-regression policies, and critical signatures.
- Consult **[`llms.txt`](llms.txt)** for a machine-readable sitemap of all documentation resources.

---

## 📄 License

MIT © [Webspresso Contributors](LICENSE)
