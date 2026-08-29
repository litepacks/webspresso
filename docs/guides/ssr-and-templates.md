# SSR & Templating Guide

> **Goal:** Master server-side rendering, data prefetching via `load()`, Nunjucks template layouts, `fsy` helper catalog, and chunked streaming responses.

---

## 1. Nunjucks Layouts & Block Inheritance

Layout shells live in `views/layout.njk` and use Nunjucks block inheritance:

```html
<!-- views/layout.njk -->
<!DOCTYPE html>
<html lang="{{ locale }}">
<head>
  <meta charset="utf-8">
  <title>{{ meta.title or "Webspresso App" }}</title>
  <meta name="description" content="{{ meta.description }}">
  <link rel="stylesheet" href="{{ fsy.asset('/css/style.css') }}">
  {% block head %}{% endblock %}
</head>
<body class="bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
  {% include "views/partials/nav.njk" %}
  
  <main>
    {% block content %}{% endblock %}
  </main>
  
  {% include "views/partials/footer.njk" %}
</body>
</html>
```

Page templates extend the layout:

```html
<!-- pages/about.njk -->
{% extends "views/layout.njk" %}

{% block content %}
<div class="max-w-3xl mx-auto py-12">
  <h1 class="text-3xl font-bold mb-4">{{ t('about.title') }}</h1>
  <p>{{ t('about.description') }}</p>
</div>
{% endblock %}
```

---

## 2. Server-Side Data Loaders (`load()`)

To fetch data from the database or external APIs before rendering, create a companion `.js` file exporting `load()`:

```javascript
// pages/products/index.js
module.exports = {
  async load({ req, res, db, ctx }) {
    const productRepo = db.getRepository('Product');
    const page = parseInt(req.query.page || '1', 10);
    
    const paginated = await productRepo.paginate({
      page,
      limit: 12,
      where: { active: true },
      orderBy: { field: 'createdAt', direction: 'desc' },
    });

    return {
      products: paginated.data,
      pagination: paginated.pagination,
      meta: {
        title: 'Browse Catalog — Our Store',
        description: 'Explore our latest inventory of products.',
      },
    };
  },
};
```

All properties returned from `load()` become directly available in the `.njk` template context.

---

## 3. Template Helpers (`fsy`)

Webspresso injects a comprehensive suite of template helpers into every render context under the `fsy` object:

### Asset & Versioning Helpers
- `{{ fsy.asset('/css/app.css') }}` — Resolves cache-busted or CDN-prefixed URL (`/css/app.css?v=1.0.4`).
- `{{ fsy.css('/css/app.css') }}` — Emits `<link rel="stylesheet" href="...">`.
- `{{ fsy.js('/js/app.js') }}` — Emits `<script src="..." defer></script>`.
- `{{ fsy.img('/images/logo.png', { alt: 'Logo', class: 'h-8' }) }}` — Emits responsive `<img>` tag.

### Security & Forms
- `{{ fsy.csrfToken() }}` — Outputs raw CSRF token string.
- `{{ fsy.csrfField() | safe }}` — Emits hidden `<input type="hidden" name="_csrf" value="...">`.
- `{{ fsy.old('email', 'default@example.com') }}` — Repopulates form field value from failed submissions.

### Routing & URL Utilities
- `{{ fsy.route('user.profile', { id: 123 }) }}` — Generates absolute or relative URL.
- `{{ fsy.isActive('/products') }}` — Returns `'active'` if the current request matches the path.

---

## 4. Chunked SSR Streaming (`res.renderStream`)

For large pages or slow database queries, stream HTML chunks to the browser immediately using native chunked transfer encoding (TTFB optimization):

```javascript
// pages/dashboard/report.js
module.exports = {
  async handler(req, res) {
    // Starts streaming the <head> and layout immediately while awaiting slow metrics
    res.renderStream('pages/dashboard/report.njk', {
      user: req.user,
      metricsPromise: req.service('analytics.get-yearly-report', { year: 2026 }),
    });
  },
};
```
