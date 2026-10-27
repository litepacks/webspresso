---
title: Developer Tools & Workflows
description: Comprehensive guide to Webspresso's built-in developer productivity tools — DB Studio, Interactive REPL Console, and Static Site Export (SSG).
---

# Developer Tools & Productivity Guide

Webspresso ships with three integrated developer tools designed to speed up debugging, database management, and deployment:

1. **Webspresso DB Studio**: A zero-dependency visual database browser, row editor, and SQL console in your browser (Prisma/Drizzle Studio-inspired).
2. **Interactive REPL Console**: An interactive terminal environment with preloaded models, services, queues, and database connections (Rails Console / Laravel Tinker-inspired).
3. **Static Site Exporter (SSG)**: Prerenders your server-rendered pages and dynamic models into high-performance static HTML for zero-cost hosting.

---

## 1. Webspresso DB Studio

Launch an interactive GUI to inspect, filter, edit, and query your database directly from your browser:

```bash
# Launch Studio on default port 4567 and automatically open browser
npx webspresso studio

# Or using the full command
npx webspresso db:studio --port 8080 --env staging
```

### Key Features
- **Visual Table Browser**: Inspect all database tables, foreign keys, indexes, and column types.
- **Interactive Data Grid**: Paginate, search, sort, insert, inline-edit, and delete records with full transactional safety.
- **Live SQL Query Runner**: Execute raw SQL queries against your database with query execution metrics and tabular results.
- **Dialect Agnostic**: Seamlessly supports SQLite, PostgreSQL, and MySQL.

### CLI Options
| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port to listen on | `4567` |
| `-H, --host <host>` | Host to bind to | `127.0.0.1` |
| `-e, --env <env>` | Database environment from config | `development` |
| `-c, --config <path>` | Custom path to database configuration | `auto` |
| `--no-open` | Start server without auto-opening the browser | `false` |

---

## 2. Interactive REPL Console (`webspresso console`)

Start a full-featured Node.js REPL pre-loaded with your entire application context:

```bash
# Start interactive console
npx webspresso console

# Shorthand alias
npx webspresso c
```

### Pre-loaded Global Environment
When the console boots, it automatically injects:
- **`db`**: Active Knex database instance with connection pooling.
- **Models**: All defined ORM models (e.g. `User`, `Post`, `Order`) bound to their repositories.
- **`service`**: Framework ServiceRegistry for invoking domain business logic.
- **`queue`**: Background queue manager.
- **`flags`**: Feature flag manager.

### Interactive Usage Examples
```javascript
// Querying models
const users = await User.find({ status: 'active' });
console.log(users);

// Creating test records
const newPost = await Post.create({
  title: 'Hello from Console',
  author_id: 1,
});

// Invoking a domain service
const result = await service('order.calculate-tax', { amount: 150 });

// Running raw SQL queries
const raw = await db.raw('SELECT count(*) as total FROM users');
```

### One-Shot Script Evaluation (`--eval`)
Execute JavaScript statements in your application context without opening an interactive session (ideal for CI/CD, migration verification, and cron scripts):

```bash
npx webspresso console -e "await User.query().where('active', false).delete()"
```

---

## 3. Static Site Export (`webspresso export`)

Prerender your SSR pages into static HTML files for zero-cost hosting on Cloudflare Pages, GitHub Pages, Vercel, Netlify, or Amazon S3:

```bash
# Prerender all pages to dist/
npx webspresso export

# Export with custom domain for sitemap.xml generation
npx webspresso export --out build --base-url https://example.com --sitemap
```

### How It Works
1. Scans `pages/` for all static and companion-loaded SSR routes (`.njk` and `.js`).
2. Evaluates loaders and renders HTML responses into `dist/[route]/index.html`.
3. Recursively copies static assets from `public/` (CSS, JS, images, fonts) into the output directory.
4. Generates a production `sitemap.xml` including all prerendered pages.

### CLI Options
| Flag | Description | Default |
|------|-------------|---------|
| `-o, --out <dir>` | Output directory for static files | `dist` |
| `-b, --base-url <url>`| Base URL used for canonical links & sitemap.xml | `undefined` |
| `--clean` / `--no-clean` | Clean output directory before build | `true` |
| `--no-clean-urls` | Generate `path.html` instead of `path/index.html` | `false` |
| `--sitemap` | Generate `sitemap.xml` for all prerendered routes | `false` |
| `--concurrency <n>` | Concurrent rendering workers | `5` |
| `--no-assets` | Skip copying `public/` static assets | `false` |
