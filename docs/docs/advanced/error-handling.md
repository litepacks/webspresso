---
sidebar_position: 2
---

# Error Handling

Handle errors gracefully in your Webspresso application.

## Global Error Handler

Define global error handler in `pages/_hooks.js`:

```javascript
module.exports = {
  onError(ctx, err) {
    // Log error
    console.error('Error:', err);
    
    // Custom error pages
    if (err.status === 404) {
      ctx.res.status(404).render('errors/404.njk', {
        url: ctx.req.url,
      });
      return true; // Error handled
    }
    
    // Default error handling
    return false;
  },
};
```

## Custom Error Pages

Configure custom error pages in `createApp`:

```javascript
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  errorPages: {
    // Custom handler function
    notFound: (req, res) => {
      res.render('errors/404.njk', { url: req.url });
    },
    
    // Template path (rendered with Nunjucks)
    serverError: 'errors/500.njk',
  },
});
```

## Error Templates

### 404 Template

```njk
{# views/errors/404.njk #}
{% extends "layout.njk" %}

{% block content %}
<h1>404 - Page Not Found</h1>
<p>The page <code>{{ url }}</code> could not be found.</p>
<a href="/">Go Home</a>
{% endblock %}
```

Variables available:
- `url` - Requested URL
- `method` - HTTP method

### 500 Template

```njk
{# views/errors/500.njk #}
{% extends "layout.njk" %}

{% block content %}
<h1>500 - Server Error</h1>
{% if isDev %}
  <pre>{{ error.stack }}</pre>
{% else %}
  <p>Something went wrong. Please try again later.</p>
{% endif %}
{% endblock %}
```

Variables available:
- `error` - Error object
- `status` - HTTP status code
- `isDev` - Development mode flag

## Validation Errors

Handle Zod validation errors:

```javascript
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

## Route-Level Error Handling

Handle errors in route configs:

```javascript
// pages/api/users.post.js
module.exports = {
  async handler(req, res) {
    try {
      const user = await db.getRepository('User').create(req.input.body);
      res.status(201).json(user);
    } catch (err) {
      if (err.code === '23505') { // PostgreSQL unique violation
        res.status(409).json({ error: 'Email already exists' });
      } else {
        throw err; // Let global handler handle
      }
    }
  },
};
```

## Next Steps

- [Asset Management](/advanced/asset-management)
- [Deployment](/advanced/deployment)
