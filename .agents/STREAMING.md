# Webspresso SSR Streaming & Chunked Transfer Guide

Webspresso supports zero-dependency, native HTTP chunked response streaming (`Transfer-Encoding: chunked`) for Server-Side Rendered (SSR) Nunjucks templates.

---

## 1. Why SSR Streaming?

In traditional SSR, the server must wait for all database queries and API calls to complete before compiling the entire HTML string and sending it with `res.send(html)`.

With **SSR Streaming** (`res.renderStream`):
1. **Instant TTFB**: HTML `<head>`, stylesheets, layout, and loading skeletons are flushed to the client immediately (`res.flushHeaders()`).
2. **Early Resource Preloading**: Browsers begin downloading CSS, Google Fonts, and JavaScript while backend databases are still executing queries.
3. **Out-of-Order Slot Resolution**: As asynchronous promises resolve, HTML replacement chunks stream into open slots seamlessly.

---

## 2. Basic Route Streaming (`res.renderStream`)

```js
// In any Express route handler:
app.get('/dashboard', async (req, res) => {
  const user = await fetchUser(req);

  const deferredData = {
    analytics: fetchHeavyAnalytics(), // Promise<any>
    recentOrders: fetchOrders(),       // Promise<any>
  };

  await res.renderStream('dashboard.njk', { user }, {
    defer: deferredData,
  });
});
```

### In Nunjucks Template (`views/dashboard.njk`):
```html
{% extends "layout.njk" %}

{% block content %}
  <h1>Welcome, {{ user.name }}</h1>

  <!-- Slot target with fallback skeleton -->
  <div data-stream-target="analytics">
    <div class="skeleton-loader">Loading analytics...</div>
  </div>

  <div data-stream-target="recentOrders">
    <div class="skeleton-loader">Loading orders...</div>
  </div>
{% endblock %}
```

---

## 3. Page File Router Streaming (`pages/`)

In file-based page loaders (`pages/products/index.js` or `pages/dashboard.js`), simply return `defer` or `{ stream: true }`:

```js
// pages/products/index.js
export async function load({ req, db }) {
  const categories = await db.getRepository('Category').find();

  return {
    stream: true,
    categories,
    defer: {
      products: db.getRepository('Product').query().where('active', true).paginate({ limit: 50 }),
    },
  };
}
```

---

## 4. Folder-Based Loading Skeletons (`_loading.njk`)

Directory trees under `pages/` support automatic loading skeleton discovery and injection:

```
pages/
├── _loading.njk               # Root fallback skeleton
└── dashboard/
    ├── _loading.njk           # Dashboard-specific skeleton
    ├── _layout.njk            # Cascading layout (wraps streaming shell)
    ├── overview.njk
    └── overview.js            # Returns { stream: true, defer: { metrics: ... } }
```

### Automatic Slot Population
When `_loading.njk` exists in a folder hierarchy, any empty `<div data-stream-target="slotName"></div>` element is automatically populated with the rendered `_loading.njk` template inside the initial flushed HTML shell:

```html
<!-- pages/dashboard/overview.njk -->
<h1>Dashboard Overview</h1>

<!-- Automatically receives _loading.njk skeleton on initial flush! -->
<div data-stream-target="metrics"></div>
```

### Template Context Availability
The skeleton HTML is also directly accessible in the template context:
- `{{ loadingSkeleton | safe }}`
- `{{ loadingHtml | safe }}`

### Nested Layouts with Streaming
Cascading `_layout.njk` layouts automatically wrap the initial streaming shell chunk, preserving headers, navigation, and sidebars without extra configuration.
