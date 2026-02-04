---
sidebar_position: 3
---

# Template Helpers

Webspresso provides a comprehensive set of template helpers via the `fsy` object, inspired by Laravel's helpers.

## URL Helpers

### `fsy.url(path, query)`

Generate URLs with query parameters:

```njk
{{ fsy.url('/products', { page: 2, sort: 'price' }) }}
{# Output: /products?page=2&sort=price #}
```

### `fsy.fullUrl(path)`

Generate absolute URLs:

```njk
{{ fsy.fullUrl('/about') }}
{# Output: https://example.com/about #}
```

### `fsy.route(pattern, params)`

Generate URLs from route patterns:

```njk
{{ fsy.route('/blog/:slug', { slug: 'my-post' }) }}
{# Output: /blog/my-post #}

{{ fsy.route('/users/:id/posts/:postId', { id: 1, postId: 5 }) }}
{# Output: /users/1/posts/5 #}
```

## Request Helpers

### `fsy.q(key, default)`

Get query parameter with default:

```njk
{{ fsy.q('page', 1) }}
{{ fsy.q('search', '') }}
```

### `fsy.param(key)`

Get route parameter:

```njk
{# For route /users/:id #}
{{ fsy.param('id') }}
```

### `fsy.hdr(name)`

Get request header:

```njk
{{ fsy.hdr('User-Agent') }}
```

## Utility Helpers

### `fsy.slugify(text)`

Convert text to URL-friendly slug:

```njk
{{ fsy.slugify('Hello World') }}
{# Output: hello-world #}
```

### `fsy.truncate(text, length)`

Truncate text:

```njk
{{ fsy.truncate(longText, 100) }}
```

### `fsy.prettyBytes(bytes)`

Format bytes:

```njk
{{ fsy.prettyBytes(1024) }}
{# Output: 1 KB #}
```

### `fsy.prettyMs(ms)`

Format milliseconds:

```njk
{{ fsy.prettyMs(5000) }}
{# Output: 5s #}
```

## Date/Time Helpers

All date helpers use [dayjs](https://day.js.org/).

### `fsy.dateFormat(date, format)`

Format date:

```njk
{{ fsy.dateFormat(post.created_at, 'YYYY-MM-DD HH:mm') }}
```

### `fsy.dateFromNow(date)`

Relative time:

```njk
{{ fsy.dateFromNow(post.created_at) }}
{# Output: "2 hours ago" #}
```

### `fsy.dateAgo(date)`

Alias for `dateFromNow`:

```njk
{{ fsy.dateAgo(post.created_at) }}
```

### `fsy.dateUntil(date)`

Time until date:

```njk
{{ fsy.dateUntil(event.date) }}
{# Output: "in 2 days" #}
```

### `fsy.date(date)`

Get dayjs object for full API:

```njk
{{ fsy.date(post.created_at).format('MMMM D, YYYY') }}
{% if fsy.dateIsBefore(post.created_at, fsy.date()) %}Published{% endif %}
{{ fsy.dateDiff(post.created_at, fsy.date(), 'day') }} days ago
{{ fsy.dateAdd(post.created_at, 7, 'day').format('YYYY-MM-DD') }}
{{ fsy.dateStartOf(post.created_at, 'month').format('YYYY-MM-DD') }}
```

## Environment Helpers

### `fsy.isDev()`

Check if in development mode:

```njk
{% if fsy.isDev() %}
  <script src="/js/dev-tools.js"></script>
{% endif %}
```

## SEO Helpers

### `fsy.canonical()`

Generate canonical URL:

```njk
<link rel="canonical" href="{{ fsy.canonical() }}">
```

### `fsy.jsonld(schema)`

Generate JSON-LD structured data:

```njk
{{ fsy.jsonld({
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": post.title
}) | safe }}
```

## Asset Helpers

### `fsy.asset(path)`

Get versioned asset URL:

```njk
<link rel="stylesheet" href="{{ fsy.asset('/css/style.css') }}">
```

### `fsy.css(href, attrs)`

Generate CSS link tag:

```njk
{{ fsy.css('/css/style.css') | safe }}
{{ fsy.css('/css/custom.css', { media: 'print' }) | safe }}
```

### `fsy.js(src, attrs)`

Generate script tag:

```njk
{{ fsy.js('/js/app.js') | safe }}
{{ fsy.js('/js/app.js', { defer: true, type: 'module' }) | safe }}
```

### `fsy.img(src, alt, attrs)`

Generate image tag:

```njk
{{ fsy.img('/images/logo.png', 'Logo', { class: 'logo', loading: 'lazy' }) | safe }}
```

## Translation Helper

### `t(key)`

Get translation:

```njk
{{ t('nav.home') }}
{{ t('blog.title') }}
```

## Examples

### Pagination Links

```njk
{% for page in range(1, totalPages + 1) %}
  <a href="{{ fsy.url('/products', { page: page }) }}">
    {{ page }}
  </a>
{% endfor %}
```

### Breadcrumbs

```njk
<nav>
  <a href="/">Home</a> >
  <a href="/blog">Blog</a> >
  <span>{{ post.title }}</span>
</nav>
```

### Date Display

```njk
<article>
  <h1>{{ post.title }}</h1>
  <time datetime="{{ post.created_at }}">
    {{ fsy.dateFormat(post.created_at, 'MMMM D, YYYY') }}
  </time>
  <p>Published {{ fsy.dateFromNow(post.created_at) }}</p>
</article>
```

## Next Steps

- [i18n](/templates/i18n)
- [Asset management](/advanced/asset-management)
