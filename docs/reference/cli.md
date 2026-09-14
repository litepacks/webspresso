---
title: CLI Reference
description: All webspresso CLI commands — dev, db migrations, polar:migrate, doctor, admin setup, and tooling.
---

# Webspresso CLI Reference

> **Command:** `webspresso [command] [options]`  
> **Source of Truth:** `bin/webspresso.js` & `bin/commands/*.js`

---

## 1. Core Project Commands

### `webspresso new [project-name]`
Scaffolds a new Webspresso project.

| Option / Flag | Description |
| :--- | :--- |
| `[project-name]` | Target directory name (e.g. `my-app`). Omit for interactive mode. |
| `--install` | Automatically run `npm install` and compile Tailwind CSS. |
| `--no-tailwind` | Skip Tailwind CSS scaffolding. |
| `--database <driver>` | Pre-select database driver (`sqlite`, `postgres`, `mysql`). |

### `webspresso dev`
Starts the development server with live template and code reloading.

| Option / Flag | Description |
| :--- | :--- |
| `-p, --port <number>` | Override listening port (default `3000` or `process.env.PORT`). |
| `-H, --host <string>` | Bind host address (default `'localhost'`). |

### `webspresso start`
Starts the production server (`NODE_ENV=production`).

---

## 2. Database Commands

### `webspresso db:migrate`
Runs all pending Knex migrations in `migrations/`.

### `webspresso db:migrate:rollback`
Rolls back the latest batch of applied migrations.

### `webspresso db:migrate:make <name>`
Generates a new timestamped Knex migration file in `migrations/`.

### `webspresso db:seed`
Executes database seed files located in `seeds/`.

### `webspresso polar:migrate`
Generates an idempotent Knex migration adding Polar billing columns (`tier`, `polar_customer_id`, `polar_subscription_id`, `polar_status`, `polar_current_period_end`, `polar_cancel_at_period_end`) to the users table.

| Option / Flag | Description |
| :--- | :--- |
| `-c, --config <path>` | Path to database config file. |
| `-t, --table <name>` | User table name (default `users`). |
| `-o, --output <path>` | Custom output migration file path. |

Run `webspresso db:migrate` after generating the file. See [Polar Billing Guide](../guides/polar-billing.md).

---

## 3. Tooling & Operator Commands

### `webspresso doctor`
Audits the application for configuration errors, uppercase page collisions, and routing issues.

### `webspresso agents:init [--force]`
Scaffolds AI coding agent guidelines (`.agents/` topic guides, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`) into the current project.

### `webspresso favicon:generate <source.png>`
Generates all required favicon sizes, PWA `manifest.json`, and Nunjucks `<head>` partials from a single high-resolution PNG image.

### `webspresso admin:password`
Interactively updates an admin staff user's password with secure bcrypt hashing.
