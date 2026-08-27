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
