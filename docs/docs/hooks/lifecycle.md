---
sidebar_position: 1
---

# Lifecycle Hooks

Lifecycle hooks allow you to intercept and modify the request/response cycle at various stages.

## Global Hooks

Create `pages/_hooks.js` to define global hooks:

```javascript
module.exports = {
  // Called at the start of every request
  onRequest(ctx) {
    // ctx.req, ctx.res, ctx.app, ctx.nunjucks
    console.log('Request:', ctx.req.method, ctx.req.url);
  },
  
  // Called before route load() function
  beforeLoad(ctx) {
    // Modify context before data loading
  },
  
  // Called after route load() function
  afterLoad(ctx) {
    // Modify loaded data
    if (ctx.data) {
      ctx.data.timestamp = new Date().toISOString();
    }
  },
  
  // Called before template render
  beforeRender(ctx) {
    // Modify data before rendering
  },
  
  // Called after template render
  afterRender(ctx) {
    // Modify rendered HTML
    // ctx.html contains the rendered HTML
  },
  
  // Called on errors
  onError(ctx, err) {
    // Handle errors
    console.error('Error:', err);
    
    // Return true if error is handled
    // Return false/undefined to use default error handling
    return false;
  },
};
```

## Route-Level Hooks

Define hooks in route config files:

```javascript
// pages/blog/index.js
module.exports = {
  async load(req, ctx) {
    return { posts: await fetchPosts() };
  },
  
  hooks: {
    // Called before load()
    beforeLoad: async (ctx) => {
      // Check authentication, etc.
      if (!ctx.req.session?.user) {
        return ctx.res.redirect('/login');
      }
    },
    
    // Called after load()
    afterLoad: async (ctx) => {
      // Modify loaded data
      ctx.data.posts = ctx.data.posts.map(post => ({
        ...post,
        excerpt: post.content.substring(0, 100),
      }));
    },
    
    // Called before render
    beforeRender: async (ctx) => {
      // Add additional data
      ctx.data.meta = {
        title: 'Blog',
        description: 'Latest posts',
      };
    },
    
    // Called after render
    afterRender: async (ctx) => {
      // Modify HTML
      // ctx.html contains rendered HTML
    },
  },
};
```

## Hook Execution Order

Hooks execute in this order:

1. Global `onRequest`
2. Route `onRequest` (if defined)
3. Route `beforeMiddleware`
4. Route middleware
5. Route `afterMiddleware`
6. Route `beforeLoad`
7. Route `load()`
8. Route `afterLoad`
9. Global `afterLoad`
10. Route `beforeRender`
11. Global `beforeRender`
12. Nunjucks render
13. Route `afterRender`
14. Global `afterRender`

## Hook Context

Hooks receive a context object with:

```javascript
{
  req,           // Express request
  res,            // Express response
  app,            // Express app
  nunjucks,      // Nunjucks environment
  data,           // Loaded data (after load())
  html,          // Rendered HTML (after render)
  route,         // Route metadata
  t,              // Translation function
  // ... other context
}
```

## Common Use Cases

### Authentication Check

```javascript
// pages/_hooks.js
module.exports = {
  beforeLoad(ctx) {
    // Check authentication for protected routes
    if (ctx.route.protected && !ctx.req.session?.user) {
      ctx.res.redirect('/login');
      return false; // Stop execution
    }
  },
};
```

### Add Global Data

```javascript
// pages/_hooks.js
module.exports = {
  afterLoad(ctx) {
    // Add user data to all pages
    if (ctx.req.session?.user) {
      ctx.data.user = ctx.req.session.user;
    }
    
    // Add CSRF token
    ctx.data.csrfToken = ctx.req.csrfToken?.();
  },
};
```

### Modify HTML

```javascript
// pages/_hooks.js
module.exports = {
  afterRender(ctx) {
    // Inject analytics script
    if (ctx.html) {
      ctx.html = ctx.html.replace(
        '</body>',
        '<script src="/analytics.js"></script></body>'
      );
    }
  },
};
```

### Error Handling

```javascript
// pages/_hooks.js
module.exports = {
  onError(ctx, err) {
    // Log errors
    console.error('Error:', err);
    
    // Custom error pages
    if (err.status === 404) {
      ctx.res.status(404).render('errors/404.njk', {
        url: ctx.req.url,
      });
      return true; // Error handled
    }
    
    // Let default handler handle other errors
    return false;
  },
};
```

## Next Steps

- [Middleware](/hooks/middleware)
- [Error handling](/advanced/error-handling)
