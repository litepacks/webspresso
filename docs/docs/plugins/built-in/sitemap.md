---
sidebar_position: 2
---

# Sitemap Plugin

Automatically generates `/sitemap.xml` and `/robots.txt` from your routes.

## Setup

```javascript
const { createApp } = require('webspresso');
const { sitemapPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    sitemapPlugin({
      hostname: 'https://example.com',
      exclude: ['/admin/*', '/api/*'],
      i18n: true,
      locales: ['en', 'tr'],
    }),
  ],
});
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `hostname` | Base URL for sitemap | Required |
| `exclude` | Patterns to exclude | `[]` |
| `i18n` | Enable i18n support | `false` |
| `locales` | Supported locales | `[]` |

## Features

- **Automatic Generation**: Scans routes and generates sitemap
- **Excludes Dynamic Routes**: Automatically excludes dynamic routes and API endpoints
- **i18n Support**: Generates hreflang tags for multiple locales
- **Robots.txt**: Generates `/robots.txt` with sitemap reference

## Excluding Routes

Exclude routes using patterns:

```javascript
sitemapPlugin({
  hostname: 'https://example.com',
  exclude: [
    '/admin/*',      // Exclude admin routes
    '/api/*',        // Exclude API routes
    '/private/*',    // Exclude private routes
  ],
})
```

## i18n Support

Enable i18n for multiple locales:

```javascript
sitemapPlugin({
  hostname: 'https://example.com',
  i18n: true,
  locales: ['en', 'tr', 'fr'],
})
```

Generates hreflang tags:

```xml
<url>
  <loc>https://example.com/about</loc>
  <xhtml:link rel="alternate" hreflang="en" href="https://example.com/about"/>
  <xhtml:link rel="alternate" hreflang="tr" href="https://example.com/tr/about"/>
  <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/about"/>
</url>
```

## Access

- Sitemap: `https://example.com/sitemap.xml`
- Robots: `https://example.com/robots.txt`

## Next Steps

- [Analytics Plugin](/plugins/built-in/analytics)
- [Schema Explorer Plugin](/plugins/built-in/schema-explorer)
