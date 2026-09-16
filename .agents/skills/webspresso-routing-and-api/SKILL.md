---
name: webspresso-routing-and-api
description: >-
  Build and declare file-based API endpoints and SSR pages in Webspresso using defineApi, definePage,
  and defineModule. Use when writing route handlers, data loaders (load()), parameter brackets ([id]),
  Zod input validation, response streaming, and route middleware.
---

# Webspresso Routing & API Skill

Webspresso uses strictly file-based routing. Never use `express.Router()`, `app.get()`, or a `routes/` directory.

---

## 1. File-Based API Endpoints (`pages/api/...`)

All API routes live in `pages/api/` and use HTTP method extensions:
- `pages/api/notes.get.js` → `GET /api/notes`
- `pages/api/notes.post.js` → `POST /api/notes`
- `pages/api/notes/[id].get.js` → `GET /api/notes/:id`
- `pages/api/notes/[id].delete.js` → `DELETE /api/notes/:id`

### Standard `defineApi` Contract

```javascript
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(1, 'Title is required'),
      content: z.string().optional(),
    }),
    params: z.object({
      id: z.string().optional(),
    }),
    query: z.object({
      filter: z.string().optional(),
    }),
  }),
  middleware: ['auth'], // optional named middleware string or array of middlewares
  handler: async (req, res, ctx) => {
    // 1. Validated input is automatically available in req.input
    const { title, content } = req.input.body;

    // 2. Repositories and Services are injected
    const note = await req.db.getRepository('Note').create({ title, content });

    // 3. Return response
    return res.status(201).json(note);
  },
});
```

---

## 2. SSR HTML Pages & Data Loaders (`pages/...`)

- **Template**: `pages/products/[id].njk`
- **Companion Loader**: `pages/products/[id].js`

### Companion Loader (`definePage`)

```javascript
const { definePage } = require('webspresso');

module.exports = definePage({
  middleware: ['auth'], // optional
  head: {
    title: 'Product Details',
  },
  load: async ({ req, res, db, ctx }) => {
    const product = await db.getRepository('Product').findById(req.params.id);
    if (!product) {
      throw new ctx.errors.NotFoundError('Product not found');
    }
    return { product, title: product.name };
  },
});
```

### Template (`.njk`)

```nunjucks
{% extends "layout.njk" %}

{% block content %}
<div class="product-page">
  <h1>{{ product.name }}</h1>
  <p class="price">{{ fsy.formatCurrency(product.price) }}</p>
  <p>{{ product.description }}</p>
</div>
{% endblock %}
```

---

## 3. Modular Domain Architecture (`defineModule`)

Encapsulate feature domains inside `src/modules/` or `modules/`:

```javascript
const { defineModule } = require('webspresso');

module.exports = defineModule({
  name: 'billing',
  pages: './pages',     // auto-discovers pages under /billing/*
  api: './api',         // auto-discovers API under /api/billing/*
  services: './services', // auto-discovers services under 'billing.*'
  middlewares: {
    paidOnly: (req, res, next) => { ... },
  },
});
```
