---
sidebar_position: 3
---

# API Routes

Create API endpoints by adding `.js` files to the `pages/api/` directory with HTTP method suffixes.

## Basic API Handler

Create a simple GET endpoint:

```javascript
// pages/api/health.get.js
module.exports = async function handler(req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
};
```

This creates a `GET /api/health` endpoint.

## HTTP Methods

Use method suffixes in the filename:

| File Path | Route | Method |
|-----------|-------|--------|
| `pages/api/health.get.js` | `GET /api/health` | GET |
| `pages/api/users.post.js` | `POST /api/users` | POST |
| `pages/api/users/[id].put.js` | `PUT /api/users/:id` | PUT |
| `pages/api/users/[id].patch.js` | `PATCH /api/users/:id` | PATCH |
| `pages/api/users/[id].delete.js` | `DELETE /api/users/:id` | DELETE |

## Handler Function

The simplest form is a function:

```javascript
// pages/api/echo.post.js
module.exports = async function handler(req, res) {
  res.json({ 
    method: req.method,
    body: req.body,
    query: req.query,
  });
};
```

## Handler Object

For more control, export an object:

```javascript
// pages/api/users.post.js
module.exports = {
  // Schema validation
  schema: ({ z }) => ({
    body: z.object({
      name: z.string().min(1),
      email: z.string().email(),
    }),
  }),
  
  // Middleware
  middleware: [
    (req, res, next) => {
      // Custom middleware
      next();
    },
  ],
  
  // Handler function
  async handler(req, res) {
    const { name, email } = req.input.body; // Validated data
    
    const user = await db.getRepository('User').create({
      name,
      email,
    });
    
    res.status(201).json(user);
  },
};
```

## Schema Validation

Validate request data using Zod schemas:

```javascript
// pages/api/posts.post.js
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(3).max(100),
      content: z.string().min(10),
      tags: z.array(z.string()).optional(),
      published: z.boolean().default(false),
    }),
    query: z.object({
      draft: z.coerce.boolean().default(false),
    }),
  }),
  
  async handler(req, res) {
    const { title, content, tags, published } = req.input.body;
    const { draft } = req.input.query;
    
    // Validated & parsed data available in req.input
    // Original req.body, req.query remain untouched
    
    const post = await db.getRepository('Post').create({
      title,
      content,
      tags: tags || [],
      published: draft ? false : published,
    });
    
    res.status(201).json(post);
  },
};
```

## Schema Options

| Key | Description |
|-----|-------------|
| `body` | Validates `req.body` (POST/PUT/PATCH) |
| `params` | Validates route parameters (e.g., `:id`) |
| `query` | Validates query string parameters |
| `response` | Response schema (for documentation, not enforced) |

## Dynamic API Routes

Create dynamic API routes just like pages:

```javascript
// pages/api/users/[id].get.js
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.string().uuid(),
    }),
    query: z.object({
      fields: z.string().optional(),
    }),
  }),
  
  async handler(req, res) {
    const { id } = req.input.params; // Validated UUID
    const { fields } = req.input.query;
    
    const user = await db.getRepository('User').findById(id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  },
};
```

## Error Handling

Invalid requests automatically throw `ZodError`:

```javascript
// pages/api/users.post.js
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      email: z.string().email(),
    }),
  }),
  
  async handler(req, res) {
    // If validation fails, ZodError is thrown
    // Can be caught by global error handler
    const { email } = req.input.body;
    // ...
  },
};
```

## Response Helpers

Use Express response methods:

```javascript
// pages/api/users.post.js
module.exports = {
  async handler(req, res) {
    // JSON response
    res.json({ success: true });
    
    // Status code
    res.status(201).json({ id: 1 });
    
    // Error response
    res.status(400).json({ error: 'Invalid input' });
    
    // Redirect
    res.redirect('/users');
  },
};
```

## Common Patterns

### CRUD Operations

```javascript
// GET /api/users
// pages/api/users.get.js
module.exports = {
  async handler(req, res) {
    const users = await db.getRepository('User').findAll();
    res.json(users);
  },
};

// POST /api/users
// pages/api/users.post.js
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      name: z.string(),
      email: z.string().email(),
    }),
  }),
  async handler(req, res) {
    const user = await db.getRepository('User').create(req.input.body);
    res.status(201).json(user);
  },
};

// GET /api/users/:id
// pages/api/users/[id].get.js
module.exports = {
  async handler(req, res) {
    const user = await db.getRepository('User').findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  },
};

// PUT /api/users/:id
// pages/api/users/[id].put.js
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      name: z.string().optional(),
      email: z.string().email().optional(),
    }),
  }),
  async handler(req, res) {
    const user = await db.getRepository('User')
      .update(req.params.id, req.input.body);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  },
};

// DELETE /api/users/:id
// pages/api/users/[id].delete.js
module.exports = {
  async handler(req, res) {
    await db.getRepository('User').delete(req.params.id);
    res.status(204).send();
  },
};
```

## Next Steps

- [Schema validation](/routing/schema-validation)
- [Middleware](/hooks/middleware)
- [Error handling](/advanced/error-handling)
