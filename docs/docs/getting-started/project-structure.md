---
sidebar_position: 3
---

# Project Structure

Understanding the Webspresso project structure helps you organize your application effectively.

## Standard Structure

```
my-app/
├── pages/                  # File-based routes
│   ├── locales/            # Global i18n translations
│   │   ├── en.json
│   │   └── tr.json
│   ├── _hooks.js           # Global lifecycle hooks
│   ├── index.njk           # Home page (GET /)
│   ├── about/
│   │   ├── index.njk       # About page (GET /about)
│   │   ├── index.js        # Route config (optional)
│   │   └── locales/        # Route-specific translations
│   ├── tools/
│   │   ├── index.njk       # Tools list (GET /tools)
│   │   ├── index.js        # Route config with load()
│   │   ├── [slug].njk      # Dynamic tool page (GET /tools/:slug)
│   │   └── [slug].js       # Route config for dynamic page
│   └── api/
│       ├── health.get.js   # GET /api/health
│       └── echo.post.js    # POST /api/echo
├── views/
│   └── layout.njk          # Base layout template
├── public/                 # Static files (CSS, images, etc.)
├── models/                 # ORM models (if using database)
├── migrations/             # Database migrations
├── seeds/                  # Database seeders
├── webspresso.db.js        # Database configuration
├── server.js               # Application entry point
└── package.json
```

## Directory Details

### `pages/`

The `pages/` directory is where all your routes live. Files here automatically become routes:

- **`.njk` files**: SSR pages rendered with Nunjucks
- **`.js` files**: Route configuration (optional, for data loading, middleware, etc.)
- **`api/` subdirectory**: API endpoints (files with method suffixes like `.get.js`, `.post.js`)

### `views/`

Layout templates and shared components. The default layout is `layout.njk`.

### `public/`

Static assets served directly by Express. Place CSS, JavaScript, images, and other static files here.

### `models/`

ORM model definitions. Models are automatically loaded when you create a database instance.

### `migrations/`

Database migration files. Created with `webspresso db:make`.

### `seeds/`

Database seed files for generating test data.

## Route Configuration Files

You can add a `.js` file alongside any `.njk` file to configure the route:

```javascript
// pages/tools/index.js
module.exports = {
  // Middleware for this route
  middleware: [(req, res, next) => next()],
  
  // Load data for SSR
  async load(req, ctx) {
    return { tools: await fetchTools() };
  },
  
  // Override meta tags
  meta(req, ctx) {
    return {
      title: 'Tools',
      description: 'Developer tools'
    };
  },
};
```

## Global Hooks

Create `pages/_hooks.js` to define global lifecycle hooks:

```javascript
module.exports = {
  onRequest(ctx) {},
  beforeLoad(ctx) {},
  afterLoad(ctx) {},
  beforeRender(ctx) {},
  afterRender(ctx) {},
  onError(ctx, err) {},
};
```

## i18n Structure

Translations are organized hierarchically:

- **Global**: `pages/locales/{locale}.json`
- **Route-specific**: `pages/{route}/locales/{locale}.json`

Route-specific translations override global ones.

## Next Steps

- [Learn about routing](/routing/file-based-routing)
- [Set up templates and layouts](/templates/nunjucks)
- [Configure database](/database/overview)
