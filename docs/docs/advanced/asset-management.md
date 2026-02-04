---
sidebar_position: 3
---

# Asset Management

Manage static assets with versioning and manifest support.

## Configuration

Configure asset handling in `createApp`:

```javascript
const { createApp } = require('webspresso');
const path = require('path');

const { app } = createApp({
  pagesDir: './pages',
  publicDir: './public',
  assets: {
    // Option 1: Simple versioning (cache busting)
    version: '1.2.3',  // or process.env.APP_VERSION
    
    // Option 2: Manifest file (Vite, Webpack, etc.)
    manifestPath: path.join(__dirname, 'public/.vite/manifest.json'),
    
    // URL prefix for assets
    prefix: '/static',
  },
});
```

## Simple Versioning

Add version query string to assets:

```javascript
assets: {
  version: '1.2.3',
}
```

Generates URLs like:
- `/css/style.css?v=1.2.3`
- `/js/app.js?v=1.2.3`

## Manifest Support

Use with Vite or Webpack manifest:

```javascript
assets: {
  manifestPath: path.join(__dirname, 'public/.vite/manifest.json'),
}
```

### Vite Manifest Format

```json
{
  "css/style.css": { "file": "assets/style-abc123.css" },
  "js/app.js": { "file": "assets/app-xyz789.js" }
}
```

### Webpack Manifest Format

```json
{
  "/css/style.css": "/dist/style.abc123.css",
  "/js/app.js": "/dist/app.xyz789.js"
}
```

## Template Helpers

Use asset helpers in templates:

```njk
{# Using fsy helpers (auto-resolved) #}
<link rel="stylesheet" href="{{ fsy.asset('/css/style.css') }}">

{# Or generate full HTML tags #}
{{ fsy.css('/css/style.css') | safe }}
{{ fsy.js('/js/app.js', { defer: true, type: 'module' }) | safe }}
{{ fsy.img('/images/logo.png', 'Site Logo', { class: 'logo', loading: 'lazy' }) | safe }}
```

## Asset Helpers

### `fsy.asset(path)`

Returns versioned/manifest-resolved URL:

```njk
{{ fsy.asset('/css/style.css') }}
```

### `fsy.css(href, attrs)`

Generates `<link>` tag:

```njk
{{ fsy.css('/css/style.css') | safe }}
{{ fsy.css('/css/print.css', { media: 'print' }) | safe }}
```

### `fsy.js(src, attrs)`

Generates `<script>` tag:

```njk
{{ fsy.js('/js/app.js') | safe }}
{{ fsy.js('/js/app.js', { defer: true, type: 'module' }) | safe }}
```

### `fsy.img(src, alt, attrs)`

Generates `<img>` tag:

```njk
{{ fsy.img('/images/logo.png', 'Logo', { class: 'logo', loading: 'lazy' }) | safe }}
```

## Examples

### With Vite

```javascript
// Build with Vite
// Generates public/.vite/manifest.json

const { app } = createApp({
  assets: {
    manifestPath: path.join(__dirname, 'public/.vite/manifest.json'),
  },
});
```

```njk
{# In templates #}
{{ fsy.css('/css/style.css') | safe }}
{{ fsy.js('/js/app.js', { type: 'module' }) | safe }}
```

### With Version

```javascript
const { app } = createApp({
  assets: {
    version: process.env.APP_VERSION || '1.0.0',
  },
});
```

```njk
<link rel="stylesheet" href="{{ fsy.asset('/css/style.css') }}">
```

## Next Steps

- [Deployment](/advanced/deployment)
