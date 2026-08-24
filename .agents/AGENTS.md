# Webspresso Project Guidelines & Rules

Webspresso is a lightweight, zero-dependency-sprawl Express SSR framework featuring file-based routing, an intuitive Knex-based ORM, a modular plugin ecosystem, zero-dependency Dual Authentication (Session + JWT), Graceful Shutdown & Force Close, HTTP Response Compression, Centralized Framework Exceptions, and a customizable Mithril.js SPA Admin Panel.

---

## Agent Guidebook Index

This `.agents/` customization root is organized into modular topic guides:

1. **[Architecture & Structure](.agents/ARCHITECTURE.md)** — File-based routing (`pages/`), Asset Management & Versioning (`AssetManager`, `fsy.asset`), ORM models & `zdb` schemas (`core/orm`), Mithril.js Admin Panel SPA (`plugins/admin-panel`), and Plugin Ecosystem.
2. **[Exceptions & Error Handling](.agents/ERRORS.md)** — Django-inspired framework exception hierarchy (`WebspressoError`, `HttpError`, `ValidationError`, `SecurityError`, `RequestAbortedError`), central error boundary, `app.setErrorHandler()`, and production error masking.
3. **[Graceful Shutdown & Lifecycle](.agents/SHUTDOWN.md)** — `ShutdownManager`, `NodeHttpAdapter`, connection draining, force close mode, and reverse-order plugin disposer cleanup.
4. **[HTTP Response Compression](.agents/COMPRESSION.md)** — Native streaming zlib compression (`server.compression`), Brotli/Gzip/Deflate negotiation, threshold handling, and `res.compress(false)` route opt-out.
5. **[Dual Authentication System](.agents/AUTH.md)** — Stateful Session + Cookie & Stateless HS256 JWT + Refresh Token Rotation, `req.auth` helpers, and `middleware: ['jwt']` guard integrations.
6. **[ORM & Database Layer](.agents/ORM.md)** — Model definitions with `defineModel`, `zdb` schemas, Repositories API, Query Caching, Relations, Soft Delete, Scopes & Migrations.
7. **[Plugin Ecosystem Guide](.agents/PLUGINS.md)** — Lifecycle hooks (`register`, `onRoutesReady`), CSP headers, and detailed reference for all 15 built-in official plugins (including `realtimePlugin` and `basicAuthPlugin`).
8. **[Realtime Layer & Adapters](.agents/REALTIME.md)** — Framework-agnostic realtime layer (`core/realtime`), generic WebSocket, SSE, and Socket.IO adapters, subscription identity, backoff reconnect, and auth lifecycle.
9. **[Email Plugin Guide](.agents/EMAIL.md)** — MJML template compilation, Nodemailer transport, DB delivery logs, Auth Email bridge, and Admin UI.
10. **[Admin Panel Customization](.agents/ADMIN.md)** — Extending Mithril.js Admin Panel SPA (Custom pages `component.js`, custom field renderers, widgets, single & bulk actions).
11. **[CLI Tooling & Commands](.agents/CLI.md)** — `webspresso dev`, `build`, `doctor`, `db:migrate`, `db:seed`, `favicon:generate`, `add:tailwind`, `skill`.
12. **[Development & Testing Workflow](.agents/WORKFLOW.md)** — CLI commands, Vitest unit/integration testing, Playwright E2E tests, TypeScript type checking, and zero regression policy.
13. **[Coding Standards & Conventions](.agents/CONVENTIONS.md)** — Zero external dependencies policy, strict function signature & schema verification, clean component separation, and log traceback inspection rules.

---

## Essential Rules Summary

- **Zero External Dependencies**: Core framework functions (Auth, JWT, CORS, Routing, Errors, Compression, Shutdown, Nunjucks helpers) must rely strictly on native Node.js modules (`crypto`, `path`, `fs`, `events`, `zlib`, `async_hooks`).
- **Zero Regression Policy**: Always run Vitest tests (`npm test` or `npx vitest run`) before declaring any task complete.
- **Strict Verification**: Inspect authoritative source files for function signatures and schema definitions before writing consuming code.
- **Log & Traceback Inspection**: Base all bug fixes strictly on exact runtime error log tracebacks and empirical test output.
