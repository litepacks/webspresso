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
