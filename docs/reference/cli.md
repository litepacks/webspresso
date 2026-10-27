---
title: CLI Reference
description: Complete Webspresso CLI command reference — scaffolding, dev, build, migrations, cloud deploys, pruning, and generators.
---

# Webspresso CLI Reference

> **Command:** `webspresso [command] [options]` (or `npx webspresso ...`)  
> **Source of Truth:** `bin/webspresso.js` & `bin/commands/*.js`

---

## 1. Core Lifecycle Commands

### `webspresso new [project-name]`
Scaffolds a new Webspresso project.

| Option / Flag | Description |
| :--- | :--- |
| `[project-name]` | Target directory name (e.g. `my-app`). Omit for interactive mode. |
| `--install` | Automatically run `npm install` and compile Tailwind CSS. |
| `--no-tailwind` | Skip Tailwind CSS scaffolding. |
| `--database <driver>` | Pre-select database driver (`sqlite`, `postgres`, `mysql`, `none`). |

### `webspresso dev`
Starts the development server with live template and code reloading.

| Option / Flag | Description |
| :--- | :--- |
| `-p, --port <number>` | Override listening port (default `7331` or `process.env.PORT`). |
| `-H, --host <string>` | Bind host address (default `'localhost'`). |

### `webspresso build` (alias: `build:assets`)
Compiles production assets, generates Ahead-Of-Time (AOT) route manifests, and precompiles Nunjucks templates.

| Option / Flag | Description |
| :--- | :--- |
| `--no-css` | Skip Tailwind CSS compilation. |
| `--no-js` | Skip client JavaScript bundle compilation with esbuild. |
| `--no-routes` | Skip generating `.webspresso/routes.manifest.json`. |
| `--no-templates` | Skip precompiling Nunjucks templates into `.webspresso/templates.compiled.js`. |
| `--no-hash` | Disable content hashing in compiled asset filenames. |

### `webspresso start`
Starts the production server (`NODE_ENV=production`).

### `webspresso routes`
Prints the complete table of discovered SSR pages and API routes with HTTP methods, URL paths, and source files.

### `webspresso console`
Launches an interactive Node.js REPL preloaded with `app`, `db`, `models`, and `services`.

---

## 2. Database & ORM Commands

### `webspresso db:migrate`
Runs all pending Knex migrations in `migrations/`. Pass `--safe` to enable connection retries and auto-heal stale migration locks.

### `webspresso db:migrate:rollback`
Rolls back the latest batch of applied migrations.

### `webspresso db:migrate:make <name>`
Generates a new timestamped Knex migration file in `migrations/`.

### `webspresso db:status`
Displays applied and pending migrations with timestamps and batch numbers.

### `webspresso db:seed`
Executes database seed files located in `seeds/`.

### `webspresso db:studio`
Starts a lightweight local web interface to inspect database tables, rows, and relationships.

### `webspresso polar:migrate`
Generates an idempotent Knex migration adding Polar billing columns (`tier`, `polar_customer_id`, `polar_subscription_id`, `polar_status`, `polar_current_period_end`, `polar_cancel_at_period_end`) to the users table.

---

## 3. Cloud & Infrastructure Scaffolding (`add:*`)

### `webspresso add:docker`
Generates a production-ready, multi-stage `Dockerfile`, `.dockerignore`, `docker-compose.yml`, and npm scripts.

### `webspresso add:cloudrun`
Generates Google Cloud Run deployment manifests, artifact registry scripts, and pre-deploy Cloud Run Jobs.

### `webspresso add:aws`
Scaffolds AWS ECS Fargate task definitions, ECR deployment workflows, and Terraform/CDK starters.

### `webspresso add:cloudflare`
Configures Cloudflare Workers, Pages, or R2 bucket storage bindings.

### `webspresso add:ci`
Generates GitHub Actions workflows for automated testing (`vitest`), linting, and deployment preflight audits.

### `webspresso add:migration-job`
Generates dedicated zero-downtime database migration jobs for Cloud Run, ECS Fargate, or Kubernetes Helm pre-upgrade hooks.

### `webspresso add:tailwind`
Sets up Tailwind CSS with `tailwind.config.js` and compilation build scripts.

---

## 4. Production Audits & Cloud Operations

### `webspresso deploy:check` (alias: `check:deploy`)
Runs a comprehensive production preflight audit validating environment variables (`SESSION_SECRET`, `NODE_ENV`), cryptographic secret strength, `.gitignore` leakage prevention, container security (non-root user, health check), and pending database migrations.

| Option / Flag | Description |
| :--- | :--- |
| `-e, --env <env>` | Target environment to evaluate (default: `production`). |
| `--strict` | Fail with exit code 1 if any warnings are detected (ideal for CI/CD). |
| `--json` | Output results in JSON format for automated pipelines. |

### `webspresso secrets:pull`
Synchronizes remote secrets from Google Cloud Secret Manager or AWS Secrets Manager into a local `.env.production` file.

### `webspresso assets:sync`
Uploads compiled JS/CSS bundles to AWS S3, Google Cloud Storage, or Cloudflare R2 with immutable cache headers.

---

## 5. Automated Pruning & Housekeeping (`*:prune`)

| Command | Description |
| :--- | :--- |
| `webspresso upload:prune [--dry-run]` | Scans and deletes orphaned disk files no longer referenced by any database model. |
| `webspresso email:prune [--days 90]` | Purges transactional email delivery logs older than the specified retention window. |
| `webspresso analytics:prune [--days 90] [--error-days 30]` | Purges visitor page views and client error logs. |
| `webspresso queue:prune [--days 30]` | Purges completed and failed background jobs from the database queue table. |
| `webspresso audit:prune [--days 90]` | Purges admin mutation audit trail logs. |

---

## 6. Code Generators (`make:*`)

| Command | Description |
| :--- | :--- |
| `webspresso make:model <name>` | Generates a Knex ORM model definition with `defineModel` and `zdb` schema. |
| `webspresso make:service <name>` | Generates a business logic service in `services/` with `defineService`. |
| `webspresso make:job <name>` | Generates a background queue worker in `jobs/`. |
| `webspresso make:event <name>` | Generates an event listener in `listeners/`. |
| `webspresso make:mail <name>` | Generates an MJML email template and companion mailer service. |
| `webspresso make:policy <name>` | Generates an authorization policy guard in `policies/`. |
| `webspresso make:command <name>` | Generates a custom CLI subcommand in `bin/commands/`. |
| `webspresso make:factory <name>` | Generates a model mock data factory for unit and integration testing. |

---

## 7. Developer Tooling, OpenAPI, Types & MCP

### `webspresso doctor`
Audits the application for configuration errors, uppercase page collisions, and routing issues.

### `webspresso agents:init [--force]`
Scaffolds AI coding agent guidelines (`.agents/` topic guides, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`) into the current project.

### `webspresso openapi:generate`
Exports OpenAPI 3.0 JSON/YAML specification by introspecting discovered routes, `defineApi` schemas, and ORM models.

### `webspresso typegen`
Generates end-to-end TypeScript definitions (`api.d.ts`) inferred directly from your route schemas and models.

### `webspresso mcp`
Starts an MCP (Model Context Protocol) stdio server exposing models, services, and health probes to AI coding assistants.

### `webspresso favicon:generate <source.png>`
Generates all required favicon sizes, PWA `manifest.json`, and Nunjucks `<head>` partials from a single high-resolution PNG image.

### `webspresso admin:setup` / `webspresso admin:password`
Sets up the admin staff table and interactively creates or updates staff user credentials with secure bcrypt hashing.
