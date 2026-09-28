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


