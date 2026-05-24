# Webspresso Build Compiler

Production build pipeline: route manifest, template bundling, adapter-based output.

## Commands

```bash
webspresso build --adapter node
webspresso build --adapter cloudflare
webspresso add deploy --provider docker|pm2|cloudflare
```

## Adapters

| Adapter | Output | Runtime |
|---------|--------|---------|
| `node` | `.webspresso/server/` | `app.listen()` |
| `cloudflare` | `.webspresso/worker/` | `export default { fetch }` |
| `bun` | `.webspresso/server/` | stub (extends node) |

## Plugin edge compatibility

| Plugin | Cloudflare |
|--------|------------|
| health-check, sitemap, redirect, rate-limit | Yes |
| admin-panel, upload, data-exchange | No (Node only) |

## D1 ORM

```js
createDatabase({ client: 'd1' }, { d1: env.DB })
```

CLI migrations (remote): `client: 'd1-remote'` in `webspresso.db.js`.

## Dual path

- **Dev:** runtime `mountPages()` + filesystem scan
- **Prod build:** `mountPagesFromManifest()` + embedded templates
