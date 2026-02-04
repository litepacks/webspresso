---
sidebar_position: 1
---

# Dashboard Plugin

Development dashboard for monitoring routes, plugins, and configuration.

## Setup

```javascript
const { createApp } = require('webspresso');
const { dashboardPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    dashboardPlugin(),  // Available at /_webspresso in dev mode
  ],
});
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `path` | Custom dashboard path | `/_webspresso` |
| `enabled` | Force enable/disable | Auto based on NODE_ENV |

## Features

- **Route Monitor**: View all routes (SSR pages and API endpoints)
- **Plugin List**: See loaded plugins and their versions
- **Configuration**: View app configuration
- **Filter & Search**: Filter and search routes

## Access

The dashboard is only available in development mode by default:

- Development: `http://localhost:3000/_webspresso`
- Production: Disabled (for security)

## Custom Path

```javascript
dashboardPlugin({
  path: '/admin/dashboard',
  enabled: true, // Force enable in production
})
```

## Next Steps

- [Sitemap Plugin](/plugins/built-in/sitemap)
- [Analytics Plugin](/plugins/built-in/analytics)
