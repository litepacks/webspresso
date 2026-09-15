# Webspresso File-Based Routing & API Routes

[← Back to AGENTS.md](AGENTS.md)

Webspresso is a full-stack Node.js framework powered by **100% File-Based Routing** (similar to Next.js App Router / Nuxt 3).

---

## ⚠️ STRICT ANTI-PATTERNS (DO NOT DO THIS)

### ❌ BAD vs ✅ GOOD Code Comparison

```javascript
// ❌ WRONG (Express / Legacy reflex — NEVER DO THIS)
// File: src/routes/users.js
const express = require('express');
const router = express.Router();
router.get('/users', async (req, res) => {
  const users = await db('users').select('*'); // Raw query bypasses ORM!
  res.json(users);
});
module.exports = router;

// ✅ CORRECT (Webspresso 100% File-Based Routing)
// File: pages/api/users.get.js
'use strict';
module.exports = {
  schema: ({ z }) => ({
    query: z.object({ limit: z.coerce.number().optional().default(20) }),
  }),
  middleware: ['auth'], // optional
  handler: async (req, res) => {
    const users = await req.db.getRepository('User').find(req.input.query);
    return res.json({ success: true, data: users });
  },
};
```

1. **NEVER create a `routes/` or `src/routes/` folder.**
2. **NEVER use `express.Router()` or `require('express').Router()`.**
3. **NEVER call `app.get()`, `app.post()`, `app.put()`, or `app.delete()` for application endpoints.**
4. **NEVER use `createApp({ setupRoutes: (app) => ... })` to mount domain/application routes.**
5. **ALL application routes MUST live inside the `pages/` directory.**

---

## 1. Directory Structure & URL Mapping

All routes are automatically discovered and registered from the `pages/` directory:

| File Path | HTTP Method | URL Route | Description |
| :--- | :--- | :--- | :--- |
| `pages/index.njk` | `GET` | `/` | Home page (SSR Nunjucks) |
| `pages/about.njk` | `GET` | `/about` | Static SSR page |
| `pages/notes/[id].njk` | `GET` | `/notes/:id` | Dynamic SSR route with param |
| `pages/api/notes.get.js` | `GET` | `/api/notes` | List notes API endpoint |
| `pages/api/notes.post.js` | `POST` | `/api/notes` | Create note API endpoint |
| `pages/api/notes/[id].get.js` | `GET` | `/api/notes/:id` | Get single note API endpoint |
| `pages/api/notes/[id].put.js` | `PUT` | `/api/notes/:id` | Update note API endpoint |
| `pages/api/notes/[id].delete.js` | `DELETE` | `/api/notes/:id` | Delete note API endpoint |

### Method Extension Suffixes
API route filenames **MUST** declare their HTTP method before the `.js` extension:
- `.get.js`
- `.post.js`
- `.put.js`
- `.patch.js`
- `.delete.js`

If no method suffix is provided (e.g. `pages/api/notes.js`), it defaults to `GET`.

---

## 2. Standard API Route Contract

Every API route module exports an object with optional `schema`, optional `middleware`, and a `handler` function:

```javascript
// pages/api/notes.post.js
'use strict';

module.exports = {
  // 1. Declarative Input Validation (Zod)
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(1, 'Title is required').max(200),
      content: z.string().min(1, 'Content is required'),
      isPublic: z.boolean().optional().default(false),
    }),
  }),

  // 2. Named Middleware Guards (resolved from ctx.middlewares or global plugins)
  middleware: ['auth'], // e.g. 'auth', 'jwt', 'basicAuth', or inline (req, res, next) => ...

  // 3. Request Handler
  handler: async (req, res) => {
    // req.db: Injected database repository factory
    // req.service(): Injected service registry invocation helper
    // req.input.body: Type-safe, validated request payload
    // req.auth / req.session: Authenticated user session

    const noteRepo = req.db.getRepository('Note');
    const note = await noteRepo.create({
      ...req.input.body,
      userId: req.session?.user?.id || req.auth?.user?.id,
    });

    return res.status(201).json({
      success: true,
      data: note,
    });
  },
};
```

> [!IMPORTANT]
> **NEVER use raw Knex queries** like `req.db('notes')` in route handlers. **ALWAYS use repositories**: `req.db.getRepository('Note')`. This guarantees schema validation, lifecycle hooks, soft deletes, and query caching are respected.

---

## 3. Dynamic Route Parameters (`[param]`)

Dynamic path segments use square brackets:

```javascript
// pages/api/notes/[id].get.js
'use strict';

module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.string().min(1),
    }),
  }),

  handler: async (req, res) => {
    const { id } = req.params;
    const note = await req.db.getRepository('Note').findById(id);

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    return res.json({ success: true, data: note });
  },
};
```

---

## 4. SSR Page Routes (`load()` Loader)

For server-rendered Nunjucks HTML pages, use `.njk` templates and companion `.js` loader files (or inline `async function load` in a `.js` file):

```javascript
// pages/notes/[id].js (Companion data loader for pages/notes/[id].njk)
'use strict';

module.exports = {
  // Runs server-side before rendering the template
  async load({ req, res, db, ctx }) {
    const note = await db.getRepository('Note').findById(req.params.id);
    if (!note) {
      return { status: 404, notFound: true };
    }

    return {
      note,
      title: note.title,
    };
  },
};
```

---

## 5. Module & File-Based Discovery (`src/pages`, `src/api`, `modules/{name}`)

Webspresso supports clean, domain-driven module discovery alongside root-level pages and APIs:

```txt
src/
  pages/                -> Global UI pages (definePage or Nunjucks)
    index.js            -> GET /
    about.js            -> GET /about
    docs/[...path].js   -> GET /docs/*path

  api/                  -> Global API endpoints (defineApi)
    health.get.js       -> GET /api/health
    users/[id].patch.js -> PATCH /api/users/:id

  modules/              -> Feature-driven modules
    auth/
      auth.module.js    -> defineModule({ name: 'auth', ... })
      pages/
        login.js        -> GET /auth/login
        register.js     -> GET /auth/register
      api/
        login.post.js   -> POST /api/auth/login
        me.get.js       -> GET /api/auth/me
      services/
        login.js        -> ctx.service('auth.login', input)
      middleware/
        auth-guard.js   -> module-local named middleware 'authGuard'
```

### 5.1 `definePage()` Contract
```javascript
const { definePage } = require('webspresso');

module.exports = definePage({
  middleware: ['authGuard'], // module or global middleware
  load: async (ctx) => {
    // ctx: { req, res, params, query, service, db, redirect, fsy, locale, t }
    if (!ctx.req.user) {
      return ctx.redirect('/auth/login', 302);
    }
    const profile = await ctx.service('user.profile', { id: ctx.req.user.id });
    return { profile };
  },
  head: (data) => ({
    title: `${data.profile.name}'s Profile`,
  }),
  render: (data, ctx) => `
    <main>
      <h1>${data.profile.name}</h1>
      <p>Email: ${data.profile.email}</p>
    </main>
  `,
});
```

### 5.2 `defineApi()` Contract
```javascript
const { defineApi, z } = require('webspresso');

module.exports = defineApi({
  description: 'Authenticate user and return session',
  tags: ['Auth'],
  middleware: ['rateLimit'],
  schema: {
    body: z.object({
      email: z.string().email(),
      password: z.string().min(8),
    }),
  },
  handler: async (req, res, ctx) => {
    // req.input.body contains validated payload
    const result = await ctx.service('auth.login', req.input.body);
    return res.json(result);
  },
});
```

### 5.3 `defineModule()` Contract
```javascript
const { defineModule } = require('webspresso');

module.exports = defineModule({
  name: 'auth',
  version: '1.0.0',
  pages: { prefix: '/auth' },       // default: /auth
  api: { prefix: '/api/auth' },     // default: /api/auth
  middlewares: {
    authGuard: (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      next();
    },
  },
});
```

### 5.4 Route Introspection (`app.routes.list()`)
Compiled routes are accessible at runtime for tooling, CLI inspection, and documentation:
```javascript
const routeList = app.routes.list();
// [
//   { method: 'GET', path: '/', type: 'page', source: 'src/pages/index.js' },
//   { method: 'POST', path: '/api/auth/login', type: 'api', module: 'auth', description: 'Authenticate user' }
// ]
```

---

## 6. Summary Checklist for Agents

When a user asks to add or modify endpoints:
1. Identify the URL and method (e.g. `POST /api/auth/register` or `POST /auth/login`).
2. Create in `pages/api/...`, `src/api/...`, or `modules/{module}/api/...` with HTTP method extension (`.post.js`).
3. Use `defineApi()` or `{ schema, middleware, handler }`.
4. Use `req.db.getRepository(...)` or `ctx.service(...)`.
5. **NEVER touch `routes/` or create manual Express router files.**
