# Webspresso 0.2.x Studio checklist

## P0

- [x] `createApp({ studio })` config + validation
- [x] Studio disabled → 404
- [x] Development default enabled
- [x] Production requires `basic` auth when enabled
- [x] SSR shell at `/_webspresso`
- [x] Route, plugin, health inspectors
- [x] Internal JSON API
- [x] `dashboardPlugin` deprecation wrapper
- [x] `docs/studio.md`, `docs/studio-security.md`

## P1

- [x] Request timeline ring buffer
- [x] Env inspector (masked)
- [x] Cache inspector
- [x] OpenAPI + sitemap preview pages
- [x] `docs/debugging.md`

## P2

- [x] ORM inspector (models + tables)
- [x] Logs viewer (in-memory)
- [x] POST cache clear with production confirm
- [x] Unit + integration tests

## Pre-release

- [ ] Manual walkthrough all Studio pages
- [ ] Verify no CORS on `/_webspresso/api/*`
- [ ] Confirm `/_admin` unchanged
- [ ] `npm test` green
- [ ] Update `doc/index.html` Studio section
- [ ] CHANGELOG entry for 0.2.x
