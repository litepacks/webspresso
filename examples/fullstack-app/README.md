# Webspresso Fullstack Example

A feature-complete blog built the Webspresso way. It doubles as the **benchmark target**:
everything under [`benchmarks/`](../../benchmarks) boots this app and measures it end to end.

## What it covers

| Area | Where |
| :--- | :--- |
| SSR pages + companion loaders, dynamic `[slug]` params, layouts, partials, custom 404 | `pages/*.njk`, `pages/*.js`, `views/` |
| File-based JSON API with Zod `query` / `params` / `body` schemas | `pages/api/**` |
| ORM models (`zdb`), `belongsTo` / `hasMany`, eager loading, timestamps, soft deletes, hidden fields, query cache | `models/` |
| Knex migrations + deterministic repository-based seeding | `migrations/`, `db/seed.js` |
| Services: validation, ACID `transaction: true`, memoization (`cache`), timeouts, composition | `services/` |
| Native JWT auth (`quickAuth`), `middleware: ['jwt']` guards | `app.js`, `pages/api/auth/login.post.js`, `pages/api/me.get.js` |
| Rate limiting (`rateLimit`) | `lib/limiters.js` |
| Background jobs (queue) and domain events (listeners) | `jobs/`, `listeners/` |
| Compression, payload limits, Early Hints, health probes (`/healthz`, `/readyz`), Prometheus `/metrics` | `app.js` |
| Plugins: `corsPlugin`, `redirectPlugin` (`/blog` → `/posts`) | `app.js` |

## Run it

```bash
node examples/fullstack-app/server.js
# → http://localhost:7332  (SQLite file: examples/fullstack-app/data.sqlite)
```

Demo account: `admin@example.com` / `secret-password`

```bash
TOKEN=$(curl -s localhost:7332/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"secret-password"}' | jq -r .accessToken)

curl -s localhost:7332/api/posts -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"Hello","body":"From curl","categoryId":1}'
```

## Routes

| Method | Path | Notes |
| :--- | :--- | :--- |
| GET | `/` | Stats + latest posts + categories (3 services in parallel) |
| GET | `/about` | Static template (no loader) |
| GET | `/posts?page=&category=` | Paginated listing |
| GET | `/posts/:slug` | Detail with author, category, comments |
| GET | `/api/posts`, `/api/posts/:slug`, `/api/categories`, `/api/stats` | JSON API |
| POST | `/api/auth/login` | Returns access + refresh tokens (rate limited) |
| GET | `/api/me` | JWT protected |
| POST | `/api/posts` | JWT + rate limit + Zod + transactional service |
| GET | `/healthz`, `/readyz`, `/metrics` | Platform endpoints |

## Benchmarks

```bash
npm run bench          # all suites against this app
npm run bench:ci:local # record baseline + compare
```

> [!NOTE]
> `lib/webspresso.js` points at the local framework source. In your own project use
> `require('webspresso')`, `require('webspresso/plugins')` and `require('webspresso/core/auth')`.

