# Webspresso Project Guidelines & Rules

Webspresso is a lightweight, zero-dependency-sprawl Express SSR framework featuring file-based routing, an intuitive Knex-based ORM, a modular plugin ecosystem, zero-dependency Dual Authentication (Session + JWT), and a customizable Mithril.js SPA Admin Panel.

---

## Agent Guidebook Index

This `.agents/` customization root is organized into modular topic guides:

1. **[Architecture & Structure](.agents/ARCHITECTURE.md)** — File-based routing (`pages/`), Asset Management & Versioning (`AssetManager`, `fsy.asset`), Custom Error & 404 Pages (`errorPages`), ORM models & `zdb` schemas (`core/orm`), Mithril.js Admin Panel SPA (`plugins/admin-panel`), and Plugin Ecosystem.
2. **[Dual Authentication System](.agents/AUTH.md)** — Stateful Session + Cookie & Stateless HS256 JWT + Refresh Token Rotation, `req.auth` helpers, and `middleware: ['jwt']` guard integrations.
3. **[ORM & Database Layer](.agents/ORM.md)** — Model definitions with `defineModel`, `zdb` schemas, Repositories API, Query Caching, Relations, Soft Delete, Scopes & Migrations.
4. **[Plugin Ecosystem Guide](.agents/PLUGINS.md)** — Lifecycle hooks (`register`, `onRoutesReady`), CSP headers, and detailed reference for all 13 built-in official plugins.
5. **[Email Plugin Guide](.agents/EMAIL.md)** — MJML template compilation, Nodemailer transport, DB delivery logs, Auth Email bridge, and Admin UI.
6. **[Admin Panel Customization](.agents/ADMIN.md)** — Extending Mithril.js Admin Panel SPA (Custom pages `component.js`, custom field renderers, widgets, single & bulk actions).
7. **[CLI Tooling & Commands](.agents/CLI.md)** — `webspresso dev`, `build`, `doctor`, `db:migrate`, `db:seed`, `favicon:generate`, `add:tailwind`, `skill`.
8. **[Development & Testing Workflow](.agents/WORKFLOW.md)** — CLI commands, Vitest unit/integration testing, Playwright E2E tests, TypeScript type checking, and zero regression policy.
9. **[Coding Standards & Conventions](.agents/CONVENTIONS.md)** — Zero external dependencies policy, strict function signature & schema verification, clean component separation, and log traceback inspection rules.

---

## Essential Rules Summary

- **Zero External Dependencies**: Core framework functions (Auth, JWT, CORS, Routing, Nunjucks helpers) must rely strictly on native Node.js modules (`crypto`, `path`, `fs`, `events`, `async_hooks`).
- **Zero Regression Policy**: Always run Vitest tests (`npm test` or `npx vitest run`) before declaring any task complete.
- **Strict Verification**: Inspect authoritative source files for function signatures and schema definitions before writing consuming code.
- **Log & Traceback Inspection**: Base all bug fixes strictly on exact runtime error log tracebacks and empirical test output.
