# Webspresso documentation audit (0.1.x)

Audit date: 2026-05-28. Scope: README, `doc/index.html`, skills, CHANGELOG, CLI help, examples references.

## Executive summary

| Area | Status | Priority |
|------|--------|----------|
| Canonical quick start | Missing dedicated `docs/getting-started.md` | P0 — **addressed in milestone** |
| Broken assets | `doc/images/admin/*.png` missing | P0 |
| Stale links | `examples/alpine-swup-demo/` referenced but absent | P0 |
| Triplicate content | README + doc + REFERENCE overlap | P1 |
| Version guides | No `docs/migrations/` tree | P1 — **addressed** |
| Production guide | No single checklist doc | P1 — **addressed** |

---

## 1. Missing pages

| Topic | README | doc/index.html | docs/ | Notes |
|-------|--------|----------------|-------|-------|
| 15-minute quick start | Partial (`#quick-start`) | Partial | `docs/getting-started.md` | Milestone deliverable |
| Production checklist | Scattered | `#deployment` | `docs/production-checklist.md` | Milestone deliverable |
| Version upgrades | CHANGELOG only | `#migration-hono` | `docs/migrations/` | Milestone deliverable |
| Email plugin deep dive | Yes | `#plugins-email` | — | Recent; doc table OK |
| Swagger / OpenAPI | Yes | Table only | — | README authoritative |
| ORM cache admin | Yes | Brief | — | |
| Data exchange | Yes (long) | `#plugins-data-exchange` | — | |
| Bun adapter | Minimal | — | — | Build README only |
| Client runtime (Alpine/swup) | Yes | `#client-runtime` | — | Demo path stale |

---

## 2. Broken or stale links

### Internal (doc/index.html)

- **Admin screenshots:** `./images/admin/dashboard.png`, `audit-log.png`, `site-analytics.png`, etc. — directory `doc/images/` does not exist. Regenerate: `npm run docs:admin-screenshots` (requires Playwright + doc fixture server).
- **Nav gaps:** Sections exist but are not in top nav: `#plugins-email`, `#plugins-audit-log`, `#plugins-site-analytics`, `#auth-email-notifications`, `#admin-user-management`.

### External / repo paths

| Reference | Locations | Actual state |
|-----------|-----------|--------------|
| `examples/alpine-swup-demo/` | README L34, L561; doc L406 | **Does not exist** — remove or add `examples/client-runtime-demo/` |
| `examples/blog/`, etc. | Planned | Milestone adds under `examples/` |

### GitHub README anchors

- doc links to `README.md#data-exchange-plugin-dataexchangeplugin` — verify anchor on publish (GitHub slug rules).

---

## 3. Missing or weak code examples

| Feature | Gap |
|---------|-----|
| End-to-end first app | No single file with route + API + model + migration + admin in sequence |
| `createApp({ auth })` + admin `userManagement` | Split across README and doc |
| Cloudflare Workers | doc `#cloudflare-workers` OK; needs link to `examples/cloudflare-todo` |
| `emailPlugin` + `authEmails` | doc section added; no standalone example app |
| `webspresso build` | doc + core/build README; few copy-paste snippets in getting-started |
| Plugin `ctx.usePlugin('email')` | README email section; not in doc quick start |

---

## 4. Unclear setup steps

| Issue | Recommendation |
|-------|----------------|
| Peer deps (`better-sqlite3`, `bcrypt`) | State explicitly in getting-started step 1 |
| `SESSION_SECRET` length (32+ chars) | doctor + getting-started + auth section |
| `webspresso new --template` | Flag documented but unused — implement presets or remove from help |
| DB config file name | `webspresso.db.js` vs `knexfile.js` — doctor explains |
| Admin first run | `admin:setup` vs migration order — getting-started ordered list |
| `npm run docs:admin-screenshots` | Document in RELEASE_CHECKLIST only |

---

## 5. Duplicate content (consolidation targets)

| Topic | Copies | Canonical target (proposed) |
|-------|--------|----------------------------|
| Quick start | README, doc, REFERENCE §2–3 | `docs/getting-started.md` |
| CLI command list | README, doc `#cli`, SKILL.md | doc `#cli` + SKILL cheat sheet |
| createApp options | README, doc `#create-app`, REFERENCE | doc `#create-app` (summary) + README (full) |
| Auth | README, doc `#authentication`, REFERENCE | doc `#authentication` |
| Plugins table | README, doc table, REFERENCE table | doc table + README per-plugin sections |
| Deployment | README, doc `#deployment`, templates/deploy | doc + `docs/production-checklist.md` |

**Policy:** Do not delete README content in 0.1.x; add pointers (“Start here: [docs/getting-started.md](docs/getting-started.md)”).

---

## 6. Outdated or drifting content

| Item | Status |
|------|--------|
| Hono migration | Current |
| Express removal / compat API | Documented in `#migration-hono` |
| `emailPlugin` / build `emailTemplates` | Added to doc; verify README plugin list |
| Package version `0.1.0-alpha.0` | Matches CHANGELOG |
| `webspresso new` `--template full` | **Misleading** — not implemented |
| Kernel vs SSR `createApp` | doc warns — OK |

---

## 7. Action checklist (milestone mapping)

- [x] Create `docs/getting-started.md`
- [x] Create `docs/production-checklist.md`
- [x] Create `docs/migrations/`
- [x] Create `coverage-plan.md`
- [x] Create `RELEASE_CHECKLIST.md`
- [x] Fix stale `examples/alpine-swup-demo` references
- [x] Add `examples/*` sample projects
- [ ] Regenerate `doc/images/admin/*.png` (optional CI/manual; note in RELEASE_CHECKLIST)
- [x] Extend `webspresso doctor`
- [x] CLI error hints (`bin/utils/cli-errors.js`)
- [x] CLI `--template` presets

---

## 8. Maintainer notes

- **Single source of truth for onboarding:** `docs/getting-started.md`
- **Single source for release:** `RELEASE_CHECKLIST.md` + `CHANGELOG.md`
- Re-run this audit before 1.0.0 release.
