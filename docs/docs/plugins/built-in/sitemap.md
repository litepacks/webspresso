---
sidebar_position: 2
---

# Sitemap Plugin

Automatically generates `/sitemap.xml` and `/robots.txt` from your routes with support for dynamic database content.

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
| `hostname` | Base URL for sitemap | `process.env.BASE_URL` |
| `exclude` | Patterns to exclude | `['/api/*']` |
| `changefreq` | Default change frequency | `'weekly'` |
| `priority` | Default priority (0.0 - 1.0) | `0.8` |
| `i18n` | Enable i18n support | `false` |
| `locales` | Supported locales | `['en']` |
| `robots` | Generate robots.txt | `true` |
| `robotsDisallow` | Paths to disallow in robots.txt | `[]` |
| `dynamicSources` | Dynamic URL sources from database | `[]` |
| `db` | Database instance for dynamic queries | `null` |
| `cacheMaxAge` | Cache duration in milliseconds | `300000` (5 min) |

## Features

- **Automatic Generation**: Scans routes and generates sitemap
- **Dynamic Database Content**: Generate URLs from database records
- **Excludes Dynamic Routes**: Automatically excludes dynamic routes and API endpoints
- **i18n Support**: Generates hreflang tags for multiple locales
- **Robots.txt**: Generates `/robots.txt` with sitemap reference
- **Caching**: Configurable cache for improved performance

## Dynamic Sources (Database Content)

Generate sitemap URLs from database records using `dynamicSources`:

```javascript
const db = require('./db'); // Your database instance

sitemapPlugin({
  hostname: 'https://example.com',
  db, // Pass the database instance
  dynamicSources: [
    {
      model: 'Post',                    // Model name
      urlPattern: '/blog/:slug',        // URL pattern with placeholders
      lastmodField: 'updated_at',       // Field for lastmod date
      changefreq: 'daily',              // Override change frequency
      priority: 0.9,                    // Override priority
      filter: (record) => record.published === true, // Filter records
    },
    {
      model: 'Product',
      urlPattern: '/products/:id',
      fields: { id: 'product_id' },     // Field mapping
      priority: 0.8,
    },
  ],
})
```

### URL Pattern Placeholders

Supports both `:param` and `[param]` style placeholders:

```javascript
// :param style (Express-like)
{ urlPattern: '/blog/:slug' }           // -> /blog/my-post

// [param] style (Next.js-like)
{ urlPattern: '/blog/[slug]' }          // -> /blog/my-post

// Multiple placeholders
{ urlPattern: '/:category/:slug' }      // -> /tech/my-post
```

### Custom Query Function

For complex queries, use a custom query function instead of a model:

```javascript
sitemapPlugin({
  hostname: 'https://example.com',
  dynamicSources: [
    {
      // Custom query function - receives db instance
      query: async (db) => {
        const repo = db.getRepository('Post');
        return repo.query()
          .where('published', true)
          .where('status', 'active')
          .orderBy('created_at', 'DESC')
          .list();
      },
      urlPattern: '/blog/:slug',
      lastmodField: 'updated_at',
    },
    {
      // Query without database (static data)
      query: async () => [
        { slug: 'terms-of-service' },
        { slug: 'privacy-policy' },
      ],
      urlPattern: '/legal/:slug',
      changefreq: 'monthly',
      priority: 0.3,
    },
  ],
})
```

### Transform Records

Transform records before URL generation:

```javascript
{
  model: 'Post',
  urlPattern: '/blog/:slug',
  transform: (record) => ({
    ...record,
    // Generate slug from title if not present
    slug: record.slug || record.title.toLowerCase().replace(/\s+/g, '-'),
  }),
}
```

### Filter Records

Filter which records appear in sitemap:

```javascript
{
  model: 'Post',
  urlPattern: '/blog/:slug',
  filter: (record) => {
    // Only published and non-draft posts
    return record.published && record.status !== 'draft';
  },
}
```

### Field Mapping

Map URL placeholders to different field names:

```javascript
{
  model: 'Product',
  urlPattern: '/products/:id/:slug',
  fields: {
    id: 'product_id',      // :id maps to record.product_id
    slug: 'url_slug',      // :slug maps to record.url_slug
  },
}
```

## Excluding Routes

Exclude routes using glob patterns:

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
  <xhtml:link rel="alternate" hreflang="en" href="https://example.com/about?lang=en"/>
  <xhtml:link rel="alternate" hreflang="tr" href="https://example.com/about?lang=tr"/>
  <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/about?lang=fr"/>
</url>
```

### Disable i18n for Specific Sources

```javascript
{
  model: 'LegalPage',
  urlPattern: '/legal/:slug',
  i18n: false,  // No hreflang tags for these URLs
}
```

## Plugin API

The sitemap plugin exposes an API for dynamic URL management:

```javascript
const sitemap = sitemapPlugin({ hostname: 'https://example.com' });

// Add a URL manually
sitemap.api.addUrl('/custom-page', {
  priority: 0.9,
  changefreq: 'daily',
  lastmod: '2024-03-15',
});

// Add an exclusion pattern
sitemap.api.exclude('/temporary/*');

// Add a dynamic source at runtime
sitemap.api.addDynamicSource({
  query: async () => fetchExternalUrls(),
  urlPattern: '/external/:id',
});

// Invalidate cache (useful after database changes)
sitemap.api.invalidateCache();

// Get all manually added URLs
const urls = sitemap.api.getUrls();

// Get all dynamic sources
const sources = sitemap.api.getDynamicSources();
```

### Using API from Other Plugins

```javascript
function myPlugin(options) {
  return {
    name: 'my-plugin',
    onRoutesReady(ctx) {
      // Access sitemap plugin API
      const sitemapApi = ctx.plugins.sitemap?.api;
      
      if (sitemapApi) {
        // Add URLs from your plugin
        sitemapApi.addUrl('/my-plugin/page');
        
        // Add dynamic source
        sitemapApi.addDynamicSource({
          query: async (db) => db.getRepository('MyModel').findAll(),
          urlPattern: '/my-plugin/:slug',
        });
      }
    },
  };
}
```

## Caching

The sitemap is cached for performance. Configure cache duration:

```javascript
sitemapPlugin({
  hostname: 'https://example.com',
  cacheMaxAge: 10 * 60 * 1000, // 10 minutes
})
```

Invalidate cache after database changes:

```javascript
// After creating/updating/deleting records
await postRepository.create({ title: 'New Post', slug: 'new-post' });
sitemapApi.invalidateCache();
```

## Access

- Sitemap: `https://example.com/sitemap.xml`
- Robots: `https://example.com/robots.txt`

## Complete Example

```javascript
const { createApp } = require('webspresso');
const { sitemapPlugin } = require('webspresso/plugins');
const db = require('./db');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    sitemapPlugin({
      hostname: 'https://example.com',
      
      // Exclusions
      exclude: ['/admin/*', '/api/*', '/draft/*'],
      
      // i18n
      i18n: true,
      locales: ['en', 'tr', 'de'],
      
      // Defaults
      changefreq: 'weekly',
      priority: 0.8,
      
      // Robots.txt
      robots: true,
      robotsDisallow: ['/admin/', '/api/', '/search'],
      
      // Database
      db,
      cacheMaxAge: 5 * 60 * 1000, // 5 minutes
      
      // Dynamic sources
      dynamicSources: [
        // Blog posts
        {
          model: 'Post',
          urlPattern: '/blog/:slug',
          lastmodField: 'updated_at',
          changefreq: 'daily',
          priority: 0.9,
          filter: (p) => p.published,
        },
        
        // Products with custom query
        {
          query: async (db) => {
            return db.getRepository('Product')
              .query()
              .where('active', true)
              .where('stock', '>', 0)
              .list();
          },
          urlPattern: '/products/:slug',
          lastmodField: 'updated_at',
          priority: 0.8,
        },
        
        // Categories
        {
          model: 'Category',
          urlPattern: '/category/:slug',
          changefreq: 'weekly',
          priority: 0.7,
        },
        
        // Static pages (no DB)
        {
          query: async () => [
            { slug: 'terms' },
            { slug: 'privacy' },
            { slug: 'contact' },
          ],
          urlPattern: '/page/:slug',
          changefreq: 'monthly',
          priority: 0.5,
          i18n: false, // No translations
        },
      ],
    }),
  ],
});
```

## Next Steps

- [Analytics Plugin](/plugins/built-in/analytics)
- [Schema Explorer Plugin](/plugins/built-in/schema-explorer)
