# Content SEO and sitemap

## Meta / seo in templates

Content routes set `meta` and `seo` (same object) from frontmatter:

- `title`, `description`, `image`, `canonical`, `robots`, `indexable`, `author`, `tags`

Use in layouts:

```njk
<title>{{ seo.title }}</title>
<meta name="description" content="{{ seo.description }}">
<link rel="canonical" href="{{ seo.canonical }}">
```

## Sitemap plugin

When `sitemapPlugin` is loaded, published items with `sitemap: true` (collection default) are passed to `sitemap.api.addUrl()`:

- Drafts excluded
- `updatedAt` or `date` → `lastmod`
- Relative `canonical` overrides path when set

Collection `indexRoute` is also added when sitemap is enabled.

## Validation

Optional Zod `schema` per collection; see `content:validate` CLI and `failOnInvalid` in config.
