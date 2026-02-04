---
sidebar_position: 2
---

# Middleware

Middleware functions execute before route handlers, allowing you to modify requests and responses.

## Route Middleware

Add middleware to route configs:

```javascript
// pages/admin/index.js
module.exports = {
  middleware: [
    // Authentication middleware
    (req, res, next) => {
      if (!req.session?.user) {
        return res.redirect('/login');
      }
      next();
    },
    
    // Authorization middleware
    (req, res, next) => {
      if (req.session.user.role !== 'admin') {
        return res.status(403).send('Forbidden');
      }
      next();
    },
  ],
  
  async load(req, ctx) {
    return { adminData: await fetchAdminData() };
  },
};
```

## Named Middleware

Register middleware globally and reference by name:

```javascript
// server.js
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  middlewares: {
    auth: (req, res, next) => {
      if (!req.session?.user) {
        return res.redirect('/login');
      }
      next();
    },
    
    admin: (req, res, next) => {
      if (req.session?.user?.role !== 'admin') {
        return res.status(403).send('Forbidden');
      }
      next();
    },
    
    rateLimit: require('express-rate-limit')({
      windowMs: 60000,
      max: 100,
    }),
  },
});
```

Use in routes:

```javascript
// pages/admin/index.js
module.exports = {
  middleware: ['auth', 'admin'],
  // ...
};
```

```javascript
// pages/api/data.get.js
module.exports = {
  middleware: ['auth', 'rateLimit'],
  async handler(req, res) {
    res.json({ data: 'protected' });
  },
};
```

## Middleware Execution Order

Middleware executes in this order:

1. Global `onRequest` hook
2. Route `onRequest` hook
3. Route `beforeMiddleware` hook
4. Route middleware (in order)
5. Route `afterMiddleware` hook
6. Route `load()` or `handler()`

## Common Middleware Patterns

### Authentication

```javascript
// server.js
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: './pages',
  middlewares: {
    auth: (req, res, next) => {
      if (!req.session?.user) {
        return res.redirect('/login');
      }
      next();
    },
    
    guest: (req, res, next) => {
      if (req.session?.user) {
        return res.redirect('/dashboard');
      }
      next();
    },
  },
});
```

### Authorization

```javascript
// server.js
middlewares: {
  admin: (req, res, next) => {
    if (req.session?.user?.role !== 'admin') {
      return res.status(403).send('Forbidden');
    }
    next();
  },
  
  moderator: (req, res, next) => {
    const role = req.session?.user?.role;
    if (!['admin', 'moderator'].includes(role)) {
      return res.status(403).send('Forbidden');
    }
    next();
  },
},
```

### Rate Limiting

```javascript
// server.js
const rateLimit = require('express-rate-limit');

middlewares: {
  apiLimit: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  }),
  
  strictLimit: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,
  }),
},
```

### CORS

```javascript
// server.js
const cors = require('cors');

middlewares: {
  cors: cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  }),
},
```

### Request Logging

```javascript
// server.js
middlewares: {
  logger: (req, res, next) => {
    console.log(`${req.method} ${req.url}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    next();
  },
},
```

## API Route Middleware

Use middleware in API routes:

```javascript
// pages/api/protected.get.js
module.exports = {
  middleware: ['auth', 'rateLimit'],
  
  async handler(req, res) {
    res.json({ 
      user: req.session.user,
      data: 'protected',
    });
  },
};
```

## Conditional Middleware

Apply middleware conditionally:

```javascript
// pages/blog/index.js
module.exports = {
  middleware: [
    // Only apply in production
    ...(process.env.NODE_ENV === 'production' 
      ? [require('helmet')()] 
      : []
    ),
  ],
  // ...
};
```

## Error Handling in Middleware

Handle errors in middleware:

```javascript
// server.js
middlewares: {
  asyncHandler: (fn) => {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  },
  
  auth: async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const user = await verifyToken(token);
      req.user = user;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
},
```

## Next Steps

- [Lifecycle hooks](/hooks/lifecycle)
- [Error handling](/advanced/error-handling)
