# Webspresso CLI Tooling & Commands Reference

The `webspresso` CLI utility (`bin/cli.js`) provides development commands for running local SSR servers, executing database migrations, analyzing project health, generating favicons, and scaffolding agent skills.

---

## 1. Development & Build Commands

```bash
# Start local development server with hot reloading
npx webspresso dev
# Flags:
#   --port, -p <number> (default: 3001)
#   --host <string> (default: localhost)

# Build production bundle / verify assets
npx webspresso build
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

## 5. Agent Skill Scaffolding (`skill`)

Scaffolds a localized `.agents/skills` entry:

```bash
npx webspresso skill --preset webspresso
```
