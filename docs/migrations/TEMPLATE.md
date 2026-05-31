# Migration guide template

Use this file as a starting point for future version guides (`docs/migrations/X.Y.Z.md`).

---

# Upgrading to X.Y.Z

**Release date:** YYYY-MM-DD  
**Semver:** major | minor | patch

## Summary

One paragraph describing the release theme.

## Breaking changes

| Area | Before | After | Migration |
|------|--------|-------|-----------|
| | | | |

## New features

- Feature A — link to doc section
- Feature B

## Deprecations

- `oldApi()` — use `newApi()` instead; removed in X+1

## Upgrade steps

```bash
npm install webspresso@X.Y.Z
npx webspresso doctor --db
npx webspresso db:migrate
```

## Plugin-specific notes

### admin-panel

### email

### Cloudflare Workers

## Verification

- [ ] `npm test` green
- [ ] `webspresso doctor --strict`
- [ ] Smoke: home, API, admin (if applicable)
