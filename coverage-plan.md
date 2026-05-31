# Test coverage plan (0.1.x)

**Policy for 0.1.x:** Keep Vitest thresholds at **90%** (lines, statements, branches, functions). Do not raise thresholds until 1.0 prep; reduce excludes gradually.

Config: [`vitest.config.mjs`](vitest.config.mjs)

## Current setup

| Item | Value |
|------|--------|
| Unit/integration | `tests/**/*.test.js` (CLI isolated project) |
| E2E | Playwright (~109 tests) |
| Coverage provider | v8 |
| Include | `src/**`, `utils/**`, `core/**`, `plugins/**` |

## Exclude table (intentional)

| Path pattern | Rationale |
|--------------|-----------|
| `plugins/admin-panel/client/**` | Mithril SPA; E2E/admin tests |
| `plugins/admin-panel/index.js`, `api.js`, modules | Integration via admin-panel tests |
| `core/orm/query-builder.js`, `repository.js` | Covered by `tests/integration/orm/*` |
| `src/server.js`, `plugin-manager.js`, `http/*` | Branch-heavy runtime; dedicated unit tests |
| `core/build/runtime/create-worker-app.js` | Manual/CF integration |
| `core/build/runtime/mount-manifest.js` | `tests/unit/build/mount-manifest*.test.js` |
| `plugins/data-exchange/*` (partial) | Integration `data-exchange.test.js` |
| `plugins/email/*` (partial) | Unit `email-plugin.test.js`; integration gap below |
| `src/client-runtime/bootstrap-*.js` | Browser bundles |

## Coverage gaps (prioritized)

| Area | Priority | Proposed test |
|------|----------|----------------|
| `bin/commands/doctor.js` (extended checks) | P1 | `tests/unit/doctor.test.js` |
| Email plugin send/log path | P2 | `tests/integration/email-plugin-smoke.test.js` |
| `bin/commands/email-prune.js` | P2 | CLI or unit |
| `adapters/*` | P2 | Adapter-specific smoke |
| `bin/utils/cli-errors.js` | P3 | Trivial unit |
| Example apps | P2 | CI job: `cd examples/blog && npx webspresso doctor` |

## Recommended new tests

1. **`tests/unit/doctor.test.js`** — mock fs/env; assert ✓/✗/⚠ for secrets, lockfile, webspresso dep
2. **`tests/integration/email-plugin-smoke.test.js`** — in-memory transport or stub; template render + log row
3. **Examples smoke** (optional CI job in `.github/workflows/ci.yml`)

## 1.0 roadmap (threshold unchanged until then)

- Shrink exclude list for `plugins/email` and `bin/commands/*`
- Target 92%+ with fewer excludes after integration smokes land
- Document any permanent excludes with one-line rationale in this file

## Running coverage locally

```bash
npm run test:coverage
```

Open `coverage/index.html` for HTML report.
