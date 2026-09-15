---
title: File-Based Routing
description: Static routes, dynamic parameters, catch-all patterns, API method files, and route middleware.
---

# File-Based Routing Guide

> **Goal:** Learn how Webspresso maps templates and files in `pages/` to clean HTTP URLs with dynamic parameters, catch-all wildcards, middleware, and per-page asset bundles.

---

## 1. Basic Route Mapping

Any `.njk` file in the `pages/` directory automatically maps to a public URL route:

| File Path | HTTP Method | Resolved URL | Notes |
| :--- | :--- | :--- | :--- |
| `pages/index.njk` | `GET` | `/` | Root homepage |
| `pages/about.njk` | `GET` | `/about` | Direct page |
| `pages/contact/index.njk` | `GET` | `/contact` | Directory index |
| `pages/blog/post.njk` | `GET` | `/blog/post` | Nested route |

---

## 2. Dynamic Parameters (`[param]`)

To capture variable segments in URLs, wrap the parameter name in square brackets:

- **`pages/products/[id].njk`** → `/products/:id`
- **`pages/users/[userId]/posts/[postId].njk`** → `/users/:userId/posts/:postId`

In your template or server loader, access the parameter via `req.params`:

```javascript
// pages/products/[id].js
module.exports = {
  async load({ req, db }) {
    const { id } = req.params;
    const productRepo = db.getRepository('Product');
    const product = await productRepo.findById(id);

    return { product };
  },
};
```

---

## 3. Catch-All Wildcards (`[...rest]`)

To match multiple arbitrary path segments (e.g. for a wiki or docs section), prefix the parameter name with `...`:

- **`pages/docs/[...slug].njk`** → `/docs/*`

Access all remaining segments via `req.params.slug` or `req.params[0]`:

```javascript
// pages/docs/[...slug].js
module.exports = {
  async load({ req }) {
    const slugPath = req.params.slug; // e.g. "getting-started/installation"
    return { slugPath };
  },
};
```

---

## 4. Route Precedence & Ordering

Webspresso registers routes in 4 deterministic priority tiers to prevent dynamic parameter collisions:

1. **Static Literal Paths**: `/users/new` always matches before `/users/:id`.
2. **Deep Dynamic Paths**: `/users/:id/settings` matches before `/users/:id`.
3. **Shallow Dynamic Paths**: `/users/:id` matches before `/*`.
4. **Catch-All Wildcards**: `/*` matches only when no other route matches.

---

## 5. Page-Level Middleware

You can attach Express middlewares to specific routes using a companion `page.json` or exporting `middleware` in the route's `.js` file:

```javascript
// pages/dashboard/index.js
const { requireAuth } = require('../../middlewares/auth');

module.exports = {
  middleware: [requireAuth],

  async load({ req }) {
    return { user: req.user };
  },
};
```

---

## 6. Per-Page Asset Bundles (`pageAssets`)

Enable automatic stylesheet and script injection matching page names by configuring `pageAssets`:

```javascript
// server.js
const { app } = createApp({
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  pageAssets: {
    enabled: true,
    stylesheets: true, // Auto-links public/css/pages/<route>.css
    scripts: true,     // Auto-links public/js/pages/<route>.js
  },
});
```

When a user visits `/products/123`, the layout automatically includes `/css/pages/products/[id].css` if the file exists.

---

## 7. File-Based API Routes & HTTP Method Suffixes

API routes placed inside `pages/api/` or `src/api/` map to endpoints according to their filename suffix:

| File Path | HTTP Method | Endpoint |
| :--- | :--- | :--- |
| `pages/api/health.get.js` | `GET` | `/api/health` |
| `pages/api/users.post.js` | `POST` | `/api/users` |
| `pages/api/users/[id].get.js` | `GET` | `/api/users/:id` |
| `pages/api/users/[id].patch.js` | `PATCH` | `/api/users/:id` |
| `pages/api/users/[id].delete.js` | `DELETE` | `/api/users/:id` |

### Using `defineApi()`

`defineApi` provides declarative Zod request schema validation, OpenAPI metadata, middleware chaining, and automatic JSON serialization:

```javascript
// src/api/users/[id].patch.js
const { defineApi, z } = require('webspresso');

module.exports = defineApi({
  description: 'Update user profile',
  tags: ['Users'],
  middleware: ['auth'],
  schema: {
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      name: z.string().optional(),
      bio: z.string().max(500).optional(),
    }),
  },
  handler: async (req, res, ctx) => {
    const updated = await req.db.getRepository('User').update(req.params.id, req.input.body);
    return updated; // Automatically serialized as JSON (HTTP 200)
  },
});
```

---

## 8. Pure JS & Standalone Pages (`definePage()`)

In addition to Nunjucks templates, Webspresso supports pure JavaScript pages with complete lifecycle support:

```javascript
// src/pages/about.js
const { definePage } = require('webspresso');

module.exports = definePage({
  async load(ctx) {
    // ctx provides { req, res, params, query, service, db, redirect, error, fsy, locale, t }
    return { company: 'Webspresso Inc.' };
  },
  head(data) {
    return { title: `About - ${data.company}` };
  },
  render(data) {
    return `<h1>About ${data.company}</h1><p>Modern Node.js Full-Stack Framework.</p>`;
  },
});
```

---

## 9. Feature Modules (`src/modules/` or `modules/`)

Organize large applications into isolated, domain-driven modules without writing manual routing glue:

```txt
src/modules/
  auth/
    auth.module.js      # defineModule({ name: 'auth', ... })
    pages/
      login.js          # GET /auth/login
      register.js       # GET /auth/register
    api/
      login.post.js     # POST /api/auth/login
      logout.post.js    # POST /api/auth/logout
      me.get.js         # GET /api/auth/me
    services/
      login.js          # Auto-registered as 'auth.login'
    middleware/
      auth-guard.js     # Auto-registered as 'authGuard'
```

### Module Definition (`auth.module.js`)

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

---

## 10. Route Table & Runtime Introspection

All discovered and explicit routes are compiled into an immutable `RouteTable` accessible on the application instance:

```javascript
const routes = app.routes.list();
console.table(routes);
```

