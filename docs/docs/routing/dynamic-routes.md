---
sidebar_position: 2
---

# Dynamic Routes

Dynamic routes allow you to create pages that match multiple URLs using parameters.

## Single Parameter

Use `[param]` for a single dynamic segment:

```njk
{# pages/users/[id].njk #}
{% extends "layout.njk" %}

{% block content %}
<h1>User Profile</h1>
<p>User ID: {{ fsy.param('id') }}</p>
{% endblock %}
```

This matches:
- `/users/1`
- `/users/123`
- `/users/abc`

## Multiple Parameters

Chain multiple parameters:

```njk
{# pages/blog/[year]/[month]/[slug].njk #}
{% extends "layout.njk" %}

{% block content %}
<h1>{{ fsy.param('slug') }}</h1>
<p>Published: {{ fsy.param('year') }}/{{ fsy.param('month') }}</p>
{% endblock %}
```

This matches:
- `/blog/2024/01/my-post`
- `/blog/2023/12/another-post`

## Accessing Parameters

### In Templates

Use the `fsy.param()` helper:

```njk
{{ fsy.param('id') }}
{{ fsy.param('slug') }}
```

### In Route Config

Access via `req.params`:

```javascript
// pages/users/[id].js
module.exports = {
  async load(req, ctx) {
    const userId = req.params.id;
    const user = await db.getRepository('User').findById(userId);
    
    if (!user) {
      return ctx.notFound();
    }
    
    return { user };
  },
};
```

### In API Routes

Same as route config:

```javascript
// pages/api/users/[id].get.js
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.string().uuid(),
    }),
  }),
  
  async handler(req, res) {
    const { id } = req.input.params; // Validated UUID
    const user = await db.getRepository('User').findById(id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  },
};
```

## Parameter Validation

Validate parameters using schema validation:

```javascript
// pages/users/[id].js
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number().int().positive(),
    }),
  }),
  
  async load(req, ctx) {
    const { id } = req.input.params; // Validated number
    // ...
  },
};
```

## Common Patterns

### Slug-Based Routes

```javascript
// pages/blog/[slug].js
module.exports = {
  async load(req, ctx) {
    const slug = req.params.slug;
    const post = await db.getRepository('Post')
      .query()
      .where('slug', slug)
      .first();
    
    if (!post) {
      return ctx.notFound();
    }
    
    return { post };
  },
};
```

### ID-Based Routes

```javascript
// pages/products/[id].js
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number(),
    }),
  }),
  
  async load(req, ctx) {
    const { id } = req.input.params;
    const product = await db.getRepository('Product')
      .findById(id, { with: ['category', 'reviews'] });
    
    if (!product) {
      return ctx.notFound();
    }
    
    return { product };
  },
};
```

## Next Steps

- [Catch-all routes](/routing/file-based-routing#catch-all-routes)
- [API routes](/routing/api-routes)
- [Schema validation](/routing/schema-validation)
