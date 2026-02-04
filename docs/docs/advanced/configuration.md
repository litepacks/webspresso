---
sidebar_position: 1
---

# Configuration

Configure Webspresso to suit your application needs.

## createApp Options

```javascript
const { createApp } = require('webspresso');

const { app } = createApp({
  // Required
  pagesDir: './pages',
  
  // Optional
  viewsDir: './views',
  publicDir: './public',
  logging: true,
  helmet: true,
  middlewares: {},
  plugins: [],
  errorPages: {},
  assets: {},
});
```

## Options Reference

### pagesDir

Path to pages directory (required):

```javascript
pagesDir: './pages',
```

### viewsDir

Path to views/layouts directory:

```javascript
viewsDir: './views',
```

### publicDir

Path to public/static directory:

```javascript
publicDir: './public',
```

### logging

Enable request logging:

```javascript
logging: true, // Default: true in development
```

### helmet

Helmet security configuration:

```javascript
// Use defaults
helmet: true,

// Disable
helmet: false,

// Custom configuration
helmet: {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
},
```

### middlewares

Named middleware registry:

```javascript
middlewares: {
  auth: (req, res, next) => {
    if (!req.session?.user) {
      return res.redirect('/login');
    }
    next();
  },
  rateLimit: require('express-rate-limit')({
    windowMs: 60000,
    max: 100,
  }),
},
```

### plugins

Array of plugins:

```javascript
plugins: [
  dashboardPlugin(),
  sitemapPlugin({ hostname: 'https://example.com' }),
],
```

### errorPages

Custom error page handlers:

```javascript
errorPages: {
  // Custom handler function
  notFound: (req, res) => {
    res.render('errors/404.njk', { url: req.url });
  },
  
  // Template path
  serverError: 'errors/500.njk',
},
```

### assets

Asset management configuration:

```javascript
assets: {
  // Simple versioning
  version: '1.2.3',
  
  // Manifest file (Vite, Webpack, etc.)
  manifestPath: path.join(__dirname, 'public/.vite/manifest.json'),
  
  // URL prefix
  prefix: '/static',
},
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `DEFAULT_LOCALE` | `en` | Default locale |
| `SUPPORTED_LOCALES` | `en` | Comma-separated locales |
| `BASE_URL` | `http://localhost:3000` | Base URL for canonical URLs |
| `DATABASE_URL` | - | Database connection string |

## Next Steps

- [Error Handling](/advanced/error-handling)
- [Asset Management](/advanced/asset-management)
