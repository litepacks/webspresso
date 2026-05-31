# Release checklist (0.1.x → 1.0)

Use before tagging a release or publishing to npm.

## Documentation

- [ ] [`docs-audit.md`](docs-audit.md) critical items resolved
- [ ] [`docs/getting-started.md`](docs/getting-started.md) walkthrough verified (15 min)
- [ ] [`docs/production-checklist.md`](docs/production-checklist.md) current
- [ ] [`docs/migrations/`](docs/migrations/) matches [`CHANGELOG.md`](CHANGELOG.md)
- [ ] Stale links removed (`examples/alpine-swup-demo`, etc.)
- [ ] [`doc/index.html`](doc/index.html) nav includes email, audit-log, site-analytics
- [ ] Admin screenshots: `npm run docs:admin-screenshots` (or doc notes placeholders)

## Examples

- [ ] `examples/blog` — README + `webspresso doctor`
- [ ] `examples/admin-panel` — README + doctor
- [ ] `examples/saas-dashboard`, `examples/landing-page` (P2)
- [ ] `examples/cloudflare-todo` README points to CF demo

## Code & CLI

- [ ] `webspresso doctor --db --strict` actionable on sample project
- [ ] `webspresso new --template` presets documented
- [ ] No misleading CLI flags in help
- [ ] `grep -r deprecated` reviewed for public API

## Tests & CI

- [ ] `npm test` green
- [ ] `npm run test:coverage` meets 90% thresholds
- [ ] `npm run test:e2e` green (if release touches UI)
- [ ] [`coverage-plan.md`](coverage-plan.md) gaps tracked

## Package

- [ ] Version bumped in `package.json`
- [ ] `CHANGELOG.md` entry complete
- [ ] `files` field in `package.json` includes new docs/templates/examples if shipped
- [ ] `npm pack --dry-run` shows expected contents

## Post-release

- [ ] GitHub release notes
- [ ] npm publish (if applicable)
- [ ] Update skill [`REFERENCE-framework.md`](.cursor/skills/webspresso-usage/REFERENCE-framework.md) if API surface changed
