---
sidebar_position: 4
---

# Schema Validation

Webspresso uses [Zod](https://zod.dev) for request validation. Define schemas in your route configs to automatically validate and parse incoming data.

## Basic Validation

Validate request body, query parameters, and route parameters:

```javascript
// pages/api/users.post.js
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      name: z.string().min(1).max(100),
      email: z.string().email(),
      age: z.number().int().min(0).max(120).optional(),
    }),
  }),
  
  async handler(req, res) {
    // Validated data available in req.input.body
    const { name, email, age } = req.input.body;
    
    // Original req.body remains untouched
    // req.input.body contains validated & parsed data
    
    res.json({ success: true });
  },
};
```

## Validation Targets

### Body Validation

For POST, PUT, PATCH requests:

```javascript
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      title: z.string(),
      content: z.string(),
    }),
  }),
  // ...
};
```

### Query Validation

For query string parameters:

```javascript
module.exports = {
  schema: ({ z }) => ({
    query: z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(10),
      search: z.string().optional(),
    }),
  }),
  // ...
};
```

### Params Validation

For route parameters:

```javascript
// pages/api/users/[id].get.js
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.string().uuid(), // or z.coerce.number()
    }),
  }),
  // ...
};
```

## Type Coercion

Use `z.coerce` to automatically convert types:

```javascript
module.exports = {
  schema: ({ z }) => ({
    query: z.object({
      page: z.coerce.number().default(1),      // "1" → 1
      limit: z.coerce.number().default(10),    // "10" → 10
      active: z.coerce.boolean().default(true), // "true" → true
    }),
  }),
  // ...
};
```

## Default Values

Provide defaults for optional fields:

```javascript
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      status: z.enum(['draft', 'published']).default('draft'),
      published_at: z.string().datetime().optional(),
    }),
  }),
  // ...
};
```

## Nested Objects

Validate nested structures:

```javascript
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      user: z.object({
        name: z.string(),
        email: z.string().email(),
        address: z.object({
          street: z.string(),
          city: z.string(),
          zip: z.string(),
        }).optional(),
      }),
    }),
  }),
  // ...
};
```

## Arrays

Validate arrays:

```javascript
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      tags: z.array(z.string()),
      items: z.array(z.object({
        id: z.number(),
        quantity: z.number(),
      })),
    }),
  }),
  // ...
};
```

## Custom Validation

Use Zod's refinement for custom validation:

```javascript
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      password: z.string().min(8),
      confirmPassword: z.string(),
    }).refine((data) => data.password === data.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"],
    }),
  }),
  // ...
};
```

## Error Handling

Invalid requests automatically throw `ZodError`:

```javascript
// Global error handler catches validation errors
// pages/_hooks.js
module.exports = {
  onError(ctx, err) {
    if (err.name === 'ZodError') {
      ctx.res.status(400).json({
        error: 'Validation failed',
        details: err.errors,
      });
      return true; // Handled
    }
  },
};
```

## Response Schema (Documentation)

Define response schema for documentation (not enforced):

```javascript
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      name: z.string(),
    }),
    response: z.object({
      id: z.number(),
      name: z.string(),
      created_at: z.string().datetime(),
    }),
  }),
  // ...
};
```

## Common Patterns

### Pagination

```javascript
module.exports = {
  schema: ({ z }) => ({
    query: z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(10),
    }),
  }),
  async handler(req, res) {
    const { page, limit } = req.input.query;
    // Use for pagination
  },
};
```

### Filtering

```javascript
module.exports = {
  schema: ({ z }) => ({
    query: z.object({
      status: z.enum(['active', 'inactive', 'pending']).optional(),
      minPrice: z.coerce.number().optional(),
      maxPrice: z.coerce.number().optional(),
    }),
  }),
  // ...
};
```

### UUID Validation

```javascript
// pages/api/users/[id].get.js
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.string().uuid(),
    }),
  }),
  // ...
};
```

## Next Steps

- [API routes](/routing/api-routes)
- [Error handling](/advanced/error-handling)
- [Zod documentation](https://zod.dev)
