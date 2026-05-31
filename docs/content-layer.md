# Content Layer

Webspresso Content Layer adds build-free Markdown collections under `content/` with frontmatter, auto routes, SEO metadata, and sitemap integration.

## Enable

```js
const { createApp, sitemapPlugin } = require('webspresso');

createApp({
  pagesDir: 'pages',
  viewsDir: 'views',
  content: {
    enabled: true,
    dir: 'content',
    collections: {
      blog: {
        route: '/blog/:slug',
        indexRoute: '/blog',
        layout: 'blog-post',
      },
    },
  },
  plugins: [sitemapPlugin({ hostname: process.env.BASE_URL })],
});
```

Default: disabled in `NODE_ENV=test`. In development and production, pass `content: true` or `{ enabled: true }`.

## Directory layout

```
content/
  blog/
    hello-world.md
  docs/
    getting-started.md
```

Each first-level folder is a **collection**. Collections are auto-discovered when omitted from config.

## Server API

```js
const svc = app.pluginManager?.contentService;

await svc.collection('blog').all();
await svc.collection('blog').findBySlug('hello-world');
await svc.collection('blog').latest(10);
await svc.collection('blog').whereTag('nodejs');
await svc.get('blog', 'hello-world');
await svc.collections();
```

## Templates

Use layouts under `views/layouts/` or fallbacks in `views/content/`. See [content-routing.md](./content-routing.md).

## Related docs

- [content-frontmatter.md](./content-frontmatter.md)
- [content-routing.md](./content-routing.md)
- [content-seo.md](./content-seo.md)
- [content-cli.md](./content-cli.md)
