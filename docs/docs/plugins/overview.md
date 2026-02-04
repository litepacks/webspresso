---
sidebar_position: 1
---

# Plugin System

Webspresso has a built-in plugin system with version control and dependency management.

## Using Plugins

Plugins are registered when creating your app:

```javascript
const { createApp } = require('webspresso');
const { 
  dashboardPlugin, 
  sitemapPlugin, 
  analyticsPlugin 
} = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  viewsDir: './views',
  plugins: [
    dashboardPlugin(),  // Dev dashboard at /_webspresso
    sitemapPlugin({
      hostname: 'https://example.com',
      exclude: ['/admin/*', '/api/*'],
      i18n: true,
      locales: ['en', 'tr'],
    }),
    analyticsPlugin({
      google: {
        measurementId: 'G-XXXXXXXXXX',
        verificationCode: 'xxxxx',
      },
    }),
  ],
});
```

## Plugin Lifecycle

Plugins can hook into various lifecycle events:

1. **register(ctx)**: Called during plugin registration
2. **onRoutesReady(ctx)**: Called after all routes are mounted
3. **onReady(ctx)**: Called before server starts

## Plugin Context

Plugins receive a context object with:

```javascript
{
  app,              // Express app
  nunjucks,         // Nunjucks environment
  options,          // App options
  routes,           // Route metadata
  usePlugin,        // Access other plugins
  addHelper,        // Add template helper
  addFilter,        // Add Nunjucks filter
  addRoute,         // Add custom route
}
```

## Next Steps

- [Custom Plugins](/plugins/custom-plugins) - Create your own plugins
- [Built-in Plugins](/plugins/built-in/dashboard) - Use built-in plugins
