---
sidebar_position: 4
---

# webspresso api

Add a new API endpoint interactively.

## Usage

```bash
webspresso api
```

## Interactive Prompts

The command will ask you:

1. **API route path**: Enter the route path (e.g., `/api/users` or `/api/users/[id]`)
2. **HTTP method**: Select method (GET, POST, PUT, PATCH, DELETE)

## Examples

### Simple GET Endpoint

```bash
$ webspresso api
? API route path: /api/health
? HTTP method: GET
```

Creates: `pages/api/health.get.js`

### POST Endpoint with Validation

```bash
$ webspresso api
? API route path: /api/users
? HTTP method: POST
```

Creates: `pages/api/users.post.js`

### Dynamic Route

```bash
$ webspresso api
? API route path: /api/users/[id]
? HTTP method: GET
```

Creates: `pages/api/users/[id].get.js`

## Generated Files

### Basic Handler

```javascript
// pages/api/health.get.js
module.exports = async function handler(req, res) {
  res.json({ status: 'ok' });
};
```

### With Schema Validation

```javascript
// pages/api/users.post.js
module.exports = {
  schema: ({ z }) => ({
    body: z.object({
      name: z.string().min(1),
      email: z.string().email(),
    }),
  }),

  async handler(req, res) {
    const { name, email } = req.input.body;
    // Validated data available in req.input
    res.json({ success: true, name, email });
  },
};
```

### Dynamic Route with Params

```javascript
// pages/api/users/[id].get.js
module.exports = {
  schema: ({ z }) => ({
    params: z.object({
      id: z.string().uuid(),
    }),
  }),

  async handler(req, res) {
    const { id } = req.input.params;
    // Fetch user by id
    res.json({ id });
  },
};
```

## Next Steps

- [Learn about API routes](/routing/api-routes)
- [Schema validation](/routing/schema-validation)
- [Add pages](/cli/page)
