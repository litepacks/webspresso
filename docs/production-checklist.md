# Production checklist

Use this before shipping a Webspresso app. Assumes Node deployment unless noted for Cloudflare Workers.

## Security

- [ ] Enable **`helmet`** or **`secureHeaders`** via `createApp` options or middleware
- [ ] Configure **CSP** for your assets; if using **client runtime** (Alpine/swup), allow `script-src 'self'` for `/__webspresso/client-runtime/` (see [doc — client runtime](../doc/index.html#client-runtime))
- [ ] Set strong **`SESSION_SECRET`** / **`AUTH_SESSION_SECRET`** (32+ random characters); never commit `.env`
- [ ] Use **`rateLimitPlugin`** on public APIs where appropriate
- [ ] Run with **`NODE_ENV=production`**
- [ ] Disable or protect dev-only routes (`/_webspresso` dashboard in development)

## Authentication

- [ ] **`quickAuth`** or **`createAuth`** with production cookie settings (`secure`, `sameSite`)
- [ ] **`requireVerified`** for sensitive routes if email verification is enabled
- [ ] Admin panel uses a **separate session** from site auth (default admin-panel behavior)
- [ ] Rotate secrets after any leak

## Database

- [ ] All migrations applied: `npx webspresso db:migrate`
- [ ] `npx webspresso doctor --db --strict` passes
- [ ] Backup strategy for your DB (SQLite file copy, managed PG snapshots, etc.)
- [ ] Schedule **`webspresso audit:prune`** / **`webspresso email:prune`** if those plugins are enabled

## Build & deploy

- [ ] Run **`webspresso build --adapter node`** (or `cloudflare` / `bun`) and validate output under `.webspresso/`
- [ ] Serve static files from `public/` (or CDN)
- [ ] Set **`BASE_URL`** to your public origin
- [ ] Cloudflare: D1 bindings, Wrangler secrets, **Node-only plugins** (admin-panel, upload, data-exchange) not on Workers — see [Cloudflare docs](../doc/index.html#cloudflare-workers) and [examples/cloudflare-todo](../examples/cloudflare-todo/)

## Observability

- [ ] **`healthCheckPlugin`** or custom health route for load balancers
- [ ] **`siteAnalyticsPlugin`** or external analytics configured
- [ ] Error pages (`views/errors/`) tested for 404/500

## Pre-launch smoke

```bash
npx webspresso doctor --db --strict
npm test   # your app tests
curl -f https://your-domain/health   # or your health path
```

- [ ] Home page, one API route, admin login (if used)
- [ ] Email plugin: SMTP env vars set (`SMTP_*`, `MAIL_FROM`) or disable `authEmails` in production until configured

## References

- [Getting started](getting-started.md)
- [Version upgrades](migrations/README.md)
- [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md)
