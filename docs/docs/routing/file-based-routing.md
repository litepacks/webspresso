---
sidebar_position: 1
---

# File-Based Routing

Webspresso uses file-based routing where the file structure in `pages/` automatically maps to routes.

## Basic Pages

Create `.njk` files in the `pages/` directory to create routes:

| File Path | Route |
|-----------|-------|
| `pages/index.njk` | `/` |
| `pages/about/index.njk` | `/about` |
| `pages/contact.njk` | `/contact` |
| `pages/blog/index.njk` | `/blog` |

## Dynamic Routes

Use square brackets for dynamic route parameters:

| File Path | Route | Example |
|-----------|-------|---------|
| `pages/tools/[slug].njk` | `/tools/:slug` | `/tools/vscode` |
| `pages/users/[id].njk` | `/users/:id` | `/users/123` |
| `pages/blog/[year]/[month]/[slug].njk` | `/blog/:year/:month/:slug` | `/blog/2024/01/my-post` |

### Accessing Route Parameters

Access parameters in templates using the `fsy.param()` helper:

```njk
{# pages/tools/[slug].njk #}
<h1>Tool: {{ fsy.param('slug') }}</h1>
```

Or in route config files:

```javascript
// pages/tools/[slug].js
module.exports = {
  async load(req, ctx) {
    const slug = req.params.slug;
    const tool = await getToolBySlug(slug);
    return { tool };
  },
};
```

## Catch-All Routes

Use `[...rest]` for catch-all routes:

| File Path | Route | Matches |
|-----------|-------|---------|
| `pages/docs/[...rest].njk` | `/docs/*` | `/docs/getting-started`, `/docs/api/reference` |

Access the catch-all parameter:

```njk
{# pages/docs/[...rest].njk #}
<p>Path: {{ fsy.param('rest') }}</p>
```

## Route Configuration

Add a `.js` file alongside your `.njk` file to configure the route:

```javascript
// pages/tools/index.js
module.exports = {
  // Middleware for this route
  middleware: [
    (req, res, next) => {
      // Your middleware
      next();
    },
  ],
  
  // Load data for SSR
  async load(req, ctx) {
    return {
      tools: await fetchTools(),
      page: req.query.page || 1,
    };
  },
  
  // Override meta tags
  meta(req, ctx) {
    return {
      title: 'Tools',
      description: 'Developer tools collection',
    };
  },
  
  // Route-level hooks
  hooks: {
    beforeLoad: async (ctx) => {
      // Called before load()
    },
    afterLoad: async (ctx) => {
      // Called after load()
    },
    beforeRender: async (ctx) => {
      // Called before template render
    },
    afterRender: async (ctx) => {
      // Called after template render
    },
  },
};
```

## Route Priority

Routes are sorted automatically:

1. **Static routes** (e.g., `/about`)
2. **Dynamic routes** (e.g., `/tools/:slug`)
3. **Catch-all routes** (e.g., `/docs/*`)

This ensures specific routes are matched before dynamic ones.

## Next Steps

- [Dynamic routes](/routing/dynamic-routes)
- [API routes](/routing/api-routes)
- [Schema validation](/routing/schema-validation)
