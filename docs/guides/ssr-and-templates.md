---
title: SSR & Templates
description: Nunjucks layouts, load() data fetchers, fsy helpers, streaming, and page assets.
---

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

## 4. Cascading Nested Layouts (`_layout.njk` & `_layout.js`)

Webspresso supports automatic directory-based layout nesting (similar to Next.js App Router):

- **Folder Hierarchy**: Any folder under `pages/` can define a `_layout.njk` shell and optional `_layout.js` data loader.
- **Top-Down Execution**: Outer `_layout.js` loaders run first, followed by child loaders, and finally the page's own `load()` function.
- **Nesting Order**: Child page HTML is rendered first and placed into `{{ content | safe }}` of the innermost layout, propagating up to the root layout.
- **Opt-Out**: Set `layout: false` in page config, or declare `layout: false` in frontmatter or `{% extends ... %}`.

```html
<!-- pages/dashboard/_layout.njk -->
<div class="flex min-h-screen">
  <aside class="w-64 bg-slate-900 text-white p-6">
    <nav>{% include "views/partials/dashboard-nav.njk" %}</nav>
  </aside>
  <main class="flex-1 p-8">
    {{ content | safe }}
  </main>
</div>
```

---

## 5. Chunked SSR Streaming & Loading Skeletons (`_loading.njk`)

For large pages or slow database queries, stream HTML chunks to the browser immediately using native chunked transfer encoding (TTFB optimization):

```javascript
// pages/dashboard/report.js
module.exports = {
  async load({ db }) {
    return {
      stream: true,
      defer: {
        metrics: db.getRepository('Metric').query().where('active', true).find(),
      },
    };
  },
};
```

### Folder Loading Skeletons (`_loading.njk`)
When `_loading.njk` is placed in a directory, Webspresso automatically injects its rendered skeleton into empty streaming slot targets (`<div data-stream-target="metrics"></div>`) in the initial flushed shell:

```html
<!-- pages/dashboard/_loading.njk -->
<div class="animate-pulse space-y-4">
  <div class="h-6 bg-slate-200 dark:bg-slate-700 rounded w-1/3"></div>
  <div class="h-24 bg-slate-200 dark:bg-slate-700 rounded"></div>
</div>
```

---

## 6. Directory-Level Error Boundaries (`_error.njk` & `_error.js`)

Catch exceptions locally within a section of your application without crashing the whole page:

- **Isolated UI**: `_error.njk` renders **inside** the parent nested `_layout.njk` chain, keeping navigation and sidebars intact.
- **Companion Loader (`_error.js`)**: Export `load({ error, req, ctx })` to fetch custom error data.
- **Status Preservation**: Thrown HTTP exceptions (`NotFoundError`, `ForbiddenError`) automatically preserve their status codes (`404`, `403`).
- **Template Context**: Access `{{ error.message }}`, `{{ error.status }}`, `{{ route.routePath }}`, and `fsy` helpers.
