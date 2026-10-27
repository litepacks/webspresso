---
name: webspresso-internal-dev
description: >-
  Strict internal development standards, architectural invariants, schema rules, dependency boundaries,
  and documentation-code synchronization protocols for contributors and AI agents working on the Webspresso
  framework core and plugins.
---

# Webspresso Internal Development Strict Standards & Invariants

This guide defines the mandatory rules and architectural invariants that MUST be followed when modifying, extending, or maintaining the Webspresso framework core, ORM, plugins, CLI, and documentation.

---

## 🛡️ The 9 Strict Development Invariants

### 1. Dual Schema Compiler Contract
- **Rule**: `core/validation/compiler.js` MUST support BOTH functional schemas and plain object schemas across all validation surfaces (`defineApi`, file-based routes, `defineService`).
  ```javascript
  // Style A: Functional schema with injected helpers
  schema: ({ z }) => ({
    body: z.object({ title: z.string().min(1) }),
    params: z.object({ id: z.string() }),
  })

  // Style B: Plain object schema
  schema: {
    body: z.object({ title: z.string().min(1) }),
    params: z.object({ id: z.string() }),
  }
  ```
- **Invariant**: Never break either style when extending validation, compiler transforms, or OpenAPI schema generation.

### 2. ORM Column Helpers Numeric Shorthand
- **Rule**: All `zdb.*` column schema helpers in `core/orm/schema-helpers.js` that accept a length, size, or count MUST accept a numeric shorthand:
  ```javascript
  zdb.string(200)      // Equivalent to zdb.string({ max: 200 })
  zdb.file(2048)       // Equivalent to zdb.file({ max: 2048 })
  zdb.nanoid(21)       // Equivalent to zdb.nanoid({ length: 21 })
  ```
- **Invariant**: When adding new schema primitives or wrappers, always support `helper(number)` in addition to `helper(optionsObject)`.

### 3. Dependency Boundary & Peer Dependencies Protocol
- **Rule**: Webspresso is a lightweight, zero-dependency-sprawl framework.
  - Browser/client-runtime libraries (e.g. `@swup/*`, `alpinejs`, `swup`) or optional third-party integrations MUST NEVER be declared as mandatory production `dependencies` in `package.json`.
  - Place optional integration packages in `peerDependencies` with `peerDependenciesMeta: { [packageName]: { optional: true } }` (and in `devDependencies` for local tests).
  - Client runtime loaders (`src/client-runtime/mount.js`) and plugins MUST include defensive runtime guards (e.g. `try { require(...) } catch {}`) that fail gracefully with clear installation instructions if the peer dependency is missing.

### 4. Zero Phantom / Stale Docs Protocol
- **Rule**: Documentation, guides, and tutorials MUST NEVER instruct users to `npm install` packages that are already built into Webspresso:
  - ❌ NEVER tell users to install: `express`, `knex`, `nunjucks`, `zod`, `express-session`, `connect-sqlite3`, `jsonwebtoken`, `passport`, `cors`, `helmet`.
  - ✅ ALWAYS demonstrate using Webspresso's native APIs (`createApp`, `req.auth`, `req.db`, `defineApi`, `defineModel`).
  - Every code snippet in `docs/` and `README.md` must be valid, runnable Webspresso code.

### 5. Plugin Catalog Parity & Strict Typing (All 34 Plugins)
- **Rule**: Whenever a plugin is added, modified, or extended:
  1. **Export**: Must be exported from `plugins/index.js` using a lazy getter (`get myPlugin() { return require('./my-plugin'); }`).
  2. **TypeScript**: Must have an explicit, strongly-typed options interface (e.g. `MyPluginOptions`) in `index.d.ts`. NEVER leave options as a vague `Record<string, unknown>`.
  3. **Agents Index**: Must be cataloged with options and usage in `.agents/PLUGINS.md`.
  4. **Public Docs**: Must be listed in the official catalog table in `docs/reference/plugins.md`.

### 6. CLI Command Parity (All 55 Commands)
- **Rule**: Every CLI command added to `bin/commands/` or `bin/webspresso.js` MUST be documented simultaneously in:
  - `docs/reference/cli.md` (categorized: Core, Scaffolding, Database, Cloud & Production, Secret Management, Maintenance, Agent Rules).
  - `.agents/CLI.md`.
- **Invariant**: Running `webspresso --help` and consulting docs must yield identical command sets and option flags.

### 7. AOT & SSR Performance Transparency
- **Rule**: Any build-time or ahead-of-time optimization (e.g. `webspresso build` generating `.webspresso/routes.manifest.json` and `.webspresso/templates.compiled.js`) must be clearly explained in `docs/guides/ssr-and-templates.md` and architecture documentation so developers know how production builds differ from development JIT mode.

### 8. Security Plugin Ergonomics (CSRF & Auth)
- **Rule**: Security plugins must support standard industry modes without breaking developer experience:
  - `csrfPlugin` MUST support both `mode: 'cookie'` and `mode: 'session'`.
  - Must accept both top-level secrets (`secret: '...'`) and nested objects (`cookie: { secret: '...' }`).
  - Auth mechanisms must always provide constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks.

### 9. 3-Step Verification Discipline
- **Rule**: Before declaring any framework change complete:
  1. **TypeScript Type Check**: `npm run check:types` (`tsc --project tests/ts-smoke/tsconfig.json`) — MUST pass with 0 errors.
  2. **Fast Unit Tests**: `npm run test:fast` — MUST pass 100% (zero regressions).
  3. **Targeted Tests**: Run relevant specific vitest tests (e.g. `npx vitest run tests/unit/compile-schema.test.js`).
