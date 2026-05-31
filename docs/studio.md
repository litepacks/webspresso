# Webspresso Studio

Studio is the **developer visibility panel** at `/_webspresso`. It surfaces routes, plugins, health, ORM, cache, OpenAPI, sitemap, environment variables, and request timeline data — without replacing the production admin panel at `/_admin`.

## Enable

### Automatic (recommended)

In **development**, Studio is enabled by default:

```javascript
const { createApp } = require('webspresso');

createApp({
  pagesDir: './pages',
  viewsDir: './views',
});
// Open http://localhost:3000/_webspresso
```

### Explicit config

```javascript
createApp({
  pagesDir: './pages',
  viewsDir: './views',
  studio: {
    enabled: true,
    path: '/_webspresso',
    auth: 'dev-only',
    exposeEnv: false,
    requestTimeline: { enabled: true, maxEntries: 100 },
  },
});
```

### Disable

```javascript
createApp({
  pagesDir: './pages',
  studio: false,
});
```

## Pages

| Path | Purpose |
|------|---------|
| `/_webspresso` | Overview |
| `/_webspresso/routes` | Route inspector |
| `/_webspresso/plugins` | Plugin inspector |
| `/_webspresso/orm` | Models and tables |
| `/_webspresso/cache` | ORM cache stats |
| `/_webspresso/health` | Health dashboard |
| `/_webspresso/openapi` | OpenAPI coverage + links |
| `/_webspresso/sitemap` | Sitemap preview |
| `/_webspresso/env` | Environment inspector |
| `/_webspresso/logs` | In-memory logs |

## Internal API (unstable)

Same-origin JSON endpoints under `/_webspresso/api/*`:

- `GET /api/routes`
- `GET /api/plugins`
- `GET /api/health`
- `GET /api/orm`
- `GET /api/cache`
- `GET /api/env`
- `GET /api/requests`

These are **not** part of the public framework API.

## Production

Studio is **off by default** in production. To enable:

```javascript
studio: {
  enabled: true,
  auth: 'basic',
  basicAuth: { user: process.env.STUDIO_USER, pass: process.env.STUDIO_PASS },
}
```

See [studio-security.md](studio-security.md).

## dashboardPlugin deprecation

`dashboardPlugin()` still works but delegates to Studio and logs a deprecation warning. Prefer `createApp({ studio: true })`.
