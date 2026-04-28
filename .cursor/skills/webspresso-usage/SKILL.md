---
name: webspresso-usage
description: >-
  Webspresso: SSR file routes (createApp), ORM, auth, plugins, CLI; plus optional in-process
  kernel (kernel.createApp: event bus, flows, view resolver). Read REFERENCE-framework.md for
  pages/api/ORM/auth; REFERENCE-kernel.md for kernel. Use in this repo or Webspresso apps.
---

# Webspresso — agent skill (overview)

There are **three** files in this folder; open the reference that matches the task.

## Which file should I read?

| Need | File | Notes |
|------|------|-------|
| `pages/`, `views/`, API, `load()`, hooks, i18n, `fsy` | [`REFERENCE-framework.md`](./REFERENCE-framework.md) | SSR **`createApp`** — the main framework. |
| `createApp({ db })`, `ctx.db`, `defineModel`, migrations | [`REFERENCE-framework.md`](./REFERENCE-framework.md) § ORM | Knex ORM in `core/orm`. |
| `createAuth`, `quickAuth`, `middleware: ['auth']` | [`REFERENCE-framework.md`](./REFERENCE-framework.md) § Auth | **`webspresso/core/auth`**. |
| Admin, sitemap, upload, redirect, data-exchange plugins | [`REFERENCE-framework.md`](./REFERENCE-framework.md) § Plugins | Framework plugin API (`createApp({ plugins })`). |
| Greenfield project, `webspresso new`, `dev`, `db:migrate`, `doctor` | [`REFERENCE-framework.md`](./REFERENCE-framework.md) § CLI | Full command table there. |
| Event bus, `kernel.createApp`, `defineFlow`, `definePlugin`, simulated `BaseRepository`, namespaced minimal views | [`REFERENCE-kernel.md`](./REFERENCE-kernel.md) | **Not** SSR **`createApp`** — [`doc/index.html#application-kernel`](../../../doc/index.html#application-kernel). |
| Long-form narrative, all options | [`README.md`](../../../README.md), [`doc/index.html`](../../../doc/index.html) | Single-page HTML docs. |

## CLI cheat sheet

| Command | Purpose |
|---------|---------|
| `webspresso new [name]` or `webspresso new .` | Scaffold a new app (Tailwind, i18n, optional DB). |
| `webspresso new . --yes` | Non-interactive scaffold (CI / agents). |
| `webspresso new . --yes -i` | Scaffold + install deps / CSS build. |
| `webspresso dev` | Dev server (watch). |
| `webspresso db:migrate` / `db:rollback` / `db:status` | ORM migrations. |
| `webspresso doctor` | Environment / project sanity checks. |
| `webspresso skill --preset webspresso` | Copies this skill bundle under `.cursor/skills/webspresso-usage/` (`SKILL.md` + `REFERENCE-*.md`). |

## When to use this skill

- **`REFERENCE-framework.md`:** Routes, APIs, ORM, auth, plugins, i18n, hooks, client runtime (Alpine/swup), `setupRoutes`, 404 ordering.
- **`REFERENCE-kernel.md`:** `kernel`, domain events, `dispatch` / `publish`, `registerFlow`, `definePlugin` inside the kernel.

They are independent: most apps only need SSR **`createApp`**; the kernel is optional.
