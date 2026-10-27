# HTTP 103 Early Hints & Critical Asset Preloading

Webspresso features built-in support for **HTTP 103 Early Hints** (RFC 8288 / RFC 8297).
Early Hints allow Webspresso to send informational HTTP headers (containing CSS, JavaScript, and font preload instructions) to the client **before** server-side rendering (`load()`, database queries, external API calls) finishes, allowing the browser to download critical page assets in parallel.

---

## 🚀 How It Works

1. The client sends an HTTP request (`GET /products/123`).
2. Webspresso resolves the matching route and its companion CSS/JS asset candidates via `AssetManager`.
3. If Early Hints are enabled, Webspresso immediately writes an `HTTP/1.1 103 Early Hints` response with `Link: </css/products.css>; rel=preload; as=style, </js/products.js>; rel=preload; as=script`.
4. While the browser starts downloading stylesheets and scripts, Webspresso runs the page's async `load()` function and Nunjucks rendering.
5. Once the HTML is ready, Webspresso returns `HTTP/1.1 200 OK` with the final document.
6. The browser can immediately render without waiting for secondary asset network round-trips (reducing TTFB, FCP and LCP).

---

## 🛠️ Configuration

### Global Configuration (`createApp`)

Enable automatic route asset preloading globally:

```javascript
const { createApp } = require('webspresso');

const app = createApp({
  earlyHints: true, // Automatically preloads route CSS & JS
  // Or with custom default links:
  // earlyHints: {
  //   auto: true,
  //   links: ['/css/global.css', '/fonts/inter.woff2'],
  // }
});
```

### Route / Page Configuration (`definePage`)

Configure Early Hints per-page inside your page module:

```javascript
const { definePage } = require('webspresso');

module.exports = definePage({
  // Preload route assets automatically
  earlyHints: true,

  // Or specify exact links:
  // earlyHints: [
  //   '/css/special.css',
  //   { url: '/fonts/inter.woff2', as: 'font', crossOrigin: 'anonymous' }
  // ],

  load: async (ctx) => {
    // You can also dispatch hints manually during load:
    ctx.earlyHints(['/extra-chunk.js']);

    const product = await ctx.db.getRepository('Product').findById(ctx.params.id);
    return { product };
  },
});
```

### In Route Handlers and API Middleware

`res.earlyHints(links, [callback])` is attached to `res` on every request:

```javascript
app.get('/dashboard', (req, res) => {
  // Send 103 Early Hints
  res.earlyHints([
    '/css/dashboard.css',
    '/js/charts.js',
  ]);

  // Run async queries...
  setTimeout(() => {
    res.send('<h1>Dashboard</h1>');
  }, 200);
});
```

---

## 📋 Link Options & Deduction

Webspresso automatically deduces `as` and `crossorigin` attributes based on URL file extensions:

| Extension | Inferred `as` | Browser CORS Requirement |
| :--- | :--- | :--- |
| `.css` | `style` | - |
| `.js`, `.mjs`, `.cjs` | `script` | - |
| `.woff2`, `.woff`, `.ttf` | `font` | Auto-adds `crossorigin` |
| `.png`, `.jpg`, `.webp`, `.svg` | `image` | - |
| `.json` | `fetch` | - |

You can also pass full descriptor objects:

```javascript
res.earlyHints([
  {
    url: '/fonts/inter.woff2',
    as: 'font',
    crossOrigin: 'anonymous',
    fetchPriority: 'high',
  },
  {
    url: 'https://cdn.example.com',
    rel: 'preconnect',
  },
]);
```

---

## 🛡️ Resilience & Fallbacks

- If the client or proxy does not support HTTP 103, or if running in an environment without `res.writeEarlyHints` (HTTP/1.0, test mocks), `sendEarlyHints` returns `false` safely without throwing.
- Calling `earlyHints` after response headers have been sent (`res.headersSent === true`) is a safe no-op.
