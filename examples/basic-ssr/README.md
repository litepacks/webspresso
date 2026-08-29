# Webspresso Basic SSR Example

A minimal server-side rendered application demonstrating:
- File-based Nunjucks routing (`pages/index.njk`)
- Server-side data fetching via `load()` (`pages/index.js`)
- JSON API endpoint (`pages/api/health.get.js`)
- Static asset serving (`public/css/style.css`)
- Layout block inheritance (`views/layout.njk`)

## Running Locally

```bash
# Start server
node server.js
```

Open **`http://localhost:3000`** in your browser.
