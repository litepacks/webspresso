# Cloudflare Workers + D1 todo demo

This example documents the external **Cloudflare D1** demo maintained separately from the framework repo.

## Repository

The reference implementation lives at:

**`/Users/ahmet/webspresso-cf-demo`**

(or clone from your fork if published)

## What it demonstrates

- `webspresso build --adapter cloudflare`
- D1 database binding (`env.DB`)
- Precompiled Nunjucks templates in the worker bundle
- Node-only plugins **not** used on Workers (admin-panel, upload, data-exchange)

## Quick start

```bash
cd /path/to/webspresso-cf-demo
npm install
cp .env.example .env   # if present
npm run dev            # or wrangler dev per project README
```

## Framework docs

- [Cloudflare Workers](../../doc/index.html#cloudflare-workers)
- [Production checklist](../../docs/production-checklist.md)

## Doctor

Run from the demo project root:

```bash
npx webspresso doctor
```

Edge projects may show warnings for Node-only plugins — that is expected when those plugins are not configured.
