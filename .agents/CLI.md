# Webspresso CLI Tooling & Commands Reference

The `webspresso` CLI utility (`bin/cli.js`) provides development commands for running local SSR servers, executing database migrations, analyzing project health, and generating favicons.

---

## 1. Development & Build Commands

```bash
# Start local development server with hot reloading
npx webspresso dev
# Flags:
#   --port, -p <number> (default: 3001)
#   --host <string> (default: localhost)

# Build production bundle / compile assets (Tailwind + esbuild with manifest.json)
npx webspresso build
# Flags:
#   --no-css    (skip CSS build)
#   --no-js     (skip JS bundle build)
#   --no-hash   (disable content hashing in filenames)
```

---

## 2. Project Health & Sanity Check (`doctor`)

Scans routing structure, model definitions, and dynamic sibling collisions:

```bash
npx webspresso doctor

# Strict mode: exits with status 1 if warnings are found
npx webspresso doctor --strict
```

Checks performed:
- Dynamic sibling collisions (e.g. `pages/[id].njk` vs `pages/[slug].njk`).
- Naming conventions and lowercase file-based route paths.
- Missing model schemas or invalid `zdb` column definitions.

---

## 3. Database Commands (`db:migrate`, `db:seed`)

```bash
# Run pending Knex database migrations
npx webspresso db:migrate

# Seed database records
npx webspresso db:seed

# Scaffold initial seed files
npx webspresso db:seed --setup
```

---

## 4. Favicon Generator (`favicon:generate`)

Generates multi-resolution browser favicons, `manifest.json`, and `favicons.njk` partial from a PNG logo:

```bash
npx webspresso favicon:generate logo.png

# Flags:
#   --theme-color <hex> (default: #ffffff)
#   --output-dir <path> (default: public)
#   --no-layout (do not modify layout.njk auto-include)
```

---

## 5. Polar Billing Migration (`polar:migrate`)

Generates an idempotent Knex migration adding Polar billing columns to the user table:

```bash
npx webspresso polar:migrate

# Flags:
#   -c, --config <path>   Database config file
#   -t, --table <name>    User table (default: users)
#   -o, --output <path>   Custom migration output path
```

Then run `npx webspresso db:migrate`. See [docs/guides/polar-production-checklist.md](../docs/guides/polar-production-checklist.md).

---

## 6. Interactive Service Runner (`service`, `service:run`)

Test and run services interactively without starting the HTTP server:

```bash
# Interactive selection & prompt mode
npx webspresso service

# Run specific service with JSON payload
npx webspresso service user.get -i '{"id": 42}'

# Run with key=value query string
npx webspresso service payment.refund -i 'transactionId=tx_123 amount=49.99'
```

---

## 7. AI Agent Guidelines Scaffolder (`agents:init`)

Scaffolds and synchronizes AI coding agent rules into any Webspresso project:

```bash
# Scaffold full guidelines bundle (.agents/, AGENTS.md, CLAUDE.md, .cursorrules)
npx webspresso agents:init

# Overwrite existing guidelines
npx webspresso agents:init --force
```

---

## 8. Tailwind CSS Setup & Migration (`add:tailwind`)

Add or upgrade Tailwind CSS in a project:

```bash
# Add Tailwind CSS v4 (Oxide engine, LightningCSS, zero-config)
npx webspresso add tailwind --v4

# Add Tailwind CSS v3 (legacy PostCSS engine)
npx webspresso add tailwind --v3

# Upgrade existing Tailwind v3 project to v4
npx webspresso add tailwind --upgrade
```

---

## 9. Client Bundler Setup (`add:esbuild`)

Add client-side JS/TS bundling with esbuild incremental watching:

```bash
# Scaffold esbuild client bundler setup
npx webspresso add esbuild
# or
npx webspresso add:esbuild
```

---

## 10. Data Retention & Storage Cleanup Commands

Keep databases and storage clean by pruning historical records and unreferenced files:

```bash
# Delete audit log entries older than N days (default: 90)
npx webspresso audit:prune --days 90

# Delete email delivery logs older than N days (default: 90)
npx webspresso email:prune --days 90

# Delete completed/failed background jobs older than N days (default: 30)
npx webspresso queue:prune --days 30

# Delete expired site analytics visits & JS errors older than N days
npx webspresso analytics:prune --days 90

# Scan and delete orphaned uploads not referenced by any database model
npx webspresso upload:prune

# Dry run mode (inspect orphaned files without deleting)
npx webspresso upload:prune --dry-run
```

---

## 11. Routes Introspection (`routes`)

List and inspect all compiled file-based and API routes in terminal:

```bash
# List all application routes in a colorized table
npx webspresso routes

# Filter to only API endpoints
npx webspresso routes --api

# Filter to only SSR page routes
npx webspresso routes --pages

# Output routes as machine-readable JSON
npx webspresso routes --json
```

---

## 12. Dev Server DX & Query Profiler

When starting in development mode (`isDev: true` / `process.env.NODE_ENV !== 'production'`), Webspresso automatically:

- **Displays Startup Banner**: ASCII box with Node/Framework version, Local & Admin URLs, Database dialect, and counts of routes, models, services, and plugins.
- **Request Profiler & Logger**: Color-coded HTTP requests with status, response duration, and database metrics:
  ```text
  [GET 200] /api/notes — 14.2ms | 2 DB queries (2.8ms)
  ```
- **N+1 Query Detection**: Flags queries executing repeatedly against the same table within a single request:
  ```text
  ⚠️  [webspresso:n+1] Potential N+1 query pattern detected on table 'users' (5 queries, 6.4ms). Consider eager loading with repo.query().include('users') or batching.
  ```
- **Configuration (`dev` options in `createApp`)**:
  ```javascript
  createApp({
    dev: {
      banner: true,        // show startup banner (default: true in dev)
      routeTable: true,    // show route table in banner (default: true)
      profiler: true,      // enable request & DB profiler (default: true)
      nPlusOne: true,      // detect N+1 queries (default: true)
      nPlusOneThreshold: 4,// query count threshold for warning (default: 4)
      slowQueryMs: 50,     // flag queries slower than N ms (default: 50)
      verbose: false,      // log individual SQL statements
    }
  });
  ```

---

## 13. Scaffolding & Code Generation (`make:*` Commands)

Quickly generate boilerplate adhering strictly to Webspresso contracts:

```bash
# 1. Scaffold an ORM Model in models/<Name>.js with parsed zdb fields and Knex migration
npx webspresso make:model Post --fields title:string,content:text,published:boolean,views:integer --migration
# Flags:
#   --fields <list>   (title:string,content:text,views:integer,price:number,published:boolean,authorId:id)
#   --table <name>    (custom table name; defaults to pluralized lowercase)
#   --migration, -m   (auto-generate timestamped Knex migration in migrations/)
#   --soft-deletes    (include deletedAt column and default scope)

# 2. Scaffold API Endpoints in pages/api/
# Single endpoint with Zod validation and handler:
npx webspresso make:api notes/export --method POST --auth

# Full REST CRUD Suite (list, create, detail, update, delete) in pages/api/posts:
npx webspresso make:api posts --crud --model Post

# 3. Scaffold an SSR Page in pages/
npx webspresso make:page blog/[slug]
# Generates pages/blog/[slug].njk template + companion loader pages/blog/[slug].js

# 4. Scaffold a Service in services/<domain>/<action>.js
npx webspresso make:service order.process --transaction --auth admin

# 5. Scaffold a Background Queue Worker in jobs/<name>.js
npx webspresso make:job send-welcome-email --queue default --retries 3
```

---

## 14. OpenAPI & API Documentation Export (`openapi` / `api:docs`)

Generate and export standard OpenAPI 3.0 JSON specification from file-based API routes and Zod schemas:

```bash
# Print OpenAPI 3.0 specification to stdout
npx webspresso openapi

# Export directly to a JSON file
npx webspresso openapi --out openapi.json

# Export with custom title, version, and server URL
npx webspresso api:docs --out public/openapi.json --title "My API" --api-version "2.0.0" --server "https://api.myapp.com"

# Include ORM model schemas in components.schemas
npx webspresso openapi --out openapi.json --include-orm
```

---

## 15. TypeScript Definitions & IDE Auto-Complete Generator (`typegen` / `types`)

Scan ORM models, business services, and routes to automatically generate typed TypeScript declaration files (`.webspresso/types.d.ts` and `webspresso-env.d.ts`) with module augmentation:

```bash
# Generate TypeScript definitions
npx webspresso typegen

# Aliases
npx webspresso types
npx webspresso generate:types

# Watch mode (automatically regenerates on model/service/page edits)
npx webspresso typegen --watch

# Custom output destination
npx webspresso typegen --out types/webspresso.d.ts --no-env-file
```

### Generated Capabilities & IDE DX:
- **Typed Models (`db.getRepository('Model')`)**: Auto-completes model names and infers entity column types from Zod schemas.
- **Typed Services (`req.service('name', input)`)**: Auto-completes registered service names and enforces validated input payloads.
- **Typed Route Table (`AppRoute`, `AppRoutePath`)**: Union types for all discovered SSR and API routes.






