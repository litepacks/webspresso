# Webspresso Documentation

Welcome to the official Webspresso documentation. Webspresso is a lightweight, zero-dependency-sprawl Express SSR framework featuring file-based routing, Nunjucks templating, an intuitive Knex-based ORM with ambient transactions, a modular plugin ecosystem, and a customizable Mithril.js SPA Admin Panel.

---

## Documentation Pillars

```text
docs/
├── getting-started/       # "Get Started Fast" (0 -> 1 Walkthroughs)
├── guides/                # "How do I do X?" (Task & Problem Oriented)
├── concepts/              # "How does it work and why?" (Mental Models & Deep Dives)
├── reference/             # "What is the exact API contract?" (Unbiased Spec & Options)
└── examples/              # "Tested, Runnable Projects"
```

---

## 🚀 Getting Started

Start here if you are new to Webspresso or building a new application:

- **[Installation](getting-started/installation.md)** — Node.js requirements, package manager setup, and CLI installation.
- **[First Application](getting-started/first-app.md)** — Scaffold your first project, create pages, write an API route, and start the dev server.
- **[Project Structure](getting-started/project-structure.md)** — Anatomy of a Webspresso application (`pages/`, `views/`, `services/`, `models/`, `config/`).
- **[Deployment](getting-started/deployment.md)** — Production configuration, environment variables, process management, and graceful shutdown.

---

## 📖 Task Guides ("How do I...?")

Task-focused guides for solving specific engineering problems:

- **[File-Based Routing](guides/routing.md)** — Static routes, dynamic parameters (`[id]`), catch-all (`[...slug]`), and per-page assets.
- **[SSR & Templates](guides/ssr-and-templates.md)** — Server-side data loading (`load()`), Nunjucks layouts, `fsy` template helpers, and chunked streaming.
- **[Services Layer](guides/services.md)** — Defining services, Zod validation, declarative auth guards, and ambient ACID transactions.
- **[Database & ORM](guides/database-and-orm.md)** — Defining models (`defineModel`), `zdb` schema builder, repositories API, and Knex migrations.
- **[Dual Authentication](guides/authentication.md)** — Session-based auth cookies for SSR, stateless JWT & refresh token rotation for APIs.
- **API Endpoints** — HTTP method files (`.get.js`, `.post.js`), `req.input` validation, and JSON responses (see [File-Based Routing](guides/routing.md)).
- **[Admin Panel SPA](guides/admin-panel.md)** — Registering admin modules, custom Mithril.js components (`component.js`), field renderers, and widgets.
- **Plugin Ecosystem** — Using official plugins, custom plugin lifecycle hooks (`register`, `onRoutesReady`), and inter-plugin APIs.
- **Realtime Layer** — WebSocket, SSE, and Socket.IO adapters, subscriptions, and Redis Pub/Sub.
- **File Uploads** — Multipart upload handling, storage providers, and file validation.
- **Email System** — MJML template compilation, Nodemailer transport, and delivery tracking.

---

## 🧠 Concepts & Architecture ("How does it work and why?")

Deep dives into the mental models, runtime pipeline, and architectural decisions:

- **[System Architecture](concepts/architecture.md)** — Layered architecture, component boundaries, and design principles.
- **[Request Lifecycle](concepts/request-lifecycle.md)** — End-to-end flow from incoming HTTP socket to template render and response stream.
- **[Service Execution Pipeline](concepts/service-execution-pipeline.md)** — Sanitization, Zod compilation, auth guards, transaction propagation, caching, and execution.
- **[Ambient Transaction Propagation](concepts/transaction-propagation.md)** — How `AsyncLocalStorage` binds Knex transactions across nested services and repositories.
- **Plugin Lifecycle** — Registration order, route readiness, dependency resolution, and graceful teardown.
- **Error Boundary & Exceptions** — Django-inspired exception hierarchy, error masking in production, and custom error boundaries (see [Exceptions Catalog](reference/exceptions.md)).
- **Graceful Shutdown & Draining** — Connection tracking, keep-alive draining, HTTP 503 handling, and reverse-order plugin disposers.
- **Asset Pipeline & Versioning** — Cache-busting, manifest resolution, per-page bundles, and CDN prefixing.

---

## 📚 API Reference ("What is the exact contract?")

Unbiased, complete specification of public APIs verified against TypeScript declarations:

- **[`createApp()` Configuration](reference/create-app.md)** — Complete `CreateAppOptions` parameter reference.
- **[CLI Reference](reference/cli.md)** — All `webspresso` CLI commands, flags, and interactive workflows.
- **Request & Response** — Properties and helpers attached to `req` and `res` (`req.context`, `req.service`, `req.auth`, `res.renderStream`).
- **[Service Definition Spec](reference/service-definition.md)** — `defineService` options, `ServiceDefinition` schema, and `ServiceContext`.
- **[Model & Repository Spec](reference/model-definition.md)** — `defineModel` options, `zdb` column builder types, and `Repository` query methods.
- **Built-in Plugins Reference** — Configuration options for all 15 official plugins.
- **Template Helpers Reference** — Complete catalog of `fsy.*` Nunjucks helper functions.
- **[Exceptions Catalog](reference/exceptions.md)** — Error classes, status codes, and payload formats.

---

## 🧪 Examples & Starter Kits

Runnable, tested example projects demonstrating real-world patterns:

- **`examples/basic-ssr`** — Minimal Nunjucks SSR + SQLite setup.
- **`examples/rest-and-services`** — REST API endpoints, Zod schema validation, and services layer.
- **`examples/auth-session-jwt`** — Dual authentication setup with session cookies and stateless JWTs.
- **`examples/admin-custom-pages`** — Admin Panel SPA with custom Mithril.js components and dashboard widgets.

---

## 🤖 For AI Coding Agents

If you are an autonomous coding assistant or LLM working on a Webspresso project:
- Read [AGENTS.md](https://github.com/litepacks/webspresso/blob/current/AGENTS.md) for project-level architectural rules and zero regression policies.
- Check [llms.txt](https://github.com/litepacks/webspresso/blob/current/llms.txt) for a machine-readable sitemap of this documentation.

