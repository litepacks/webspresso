# Content routing

## Auto routes

For each published item, a GET route is registered from the collection `route` pattern (default `/:collection/:slug`).

| Config | Example |
|--------|---------|
| `route` | `/blog/:slug` → `/blog/hello-world` |
| `indexRoute` | `/blog` → collection list template |
| `tagsRoute` | `/blog/tags/:tag` → tag listing template |

## Layout resolution

1. `views/layouts/{layout}.njk` from collection config
2. `views/content/{collection}-post.njk` or `-page.njk`
3. `views/content/post.njk`, `page.njk`, `default.njk`

List pages use `list.njk` or `{collection}-index.njk`. Tag pages use `content/tag.njk`.

## Template context

```njk
<h1>{{ content.title }}</h1>
<div>{{ content.html | safe }}</div>

<meta>{{ seo.title }}</meta>
```

Index routes receive `items` (array) and `collection` name.

## Conflict with `pages/`

Content routes are registered in `onRoutesReady`, **before** dynamic file routes from `pages/`. If you define the same path in `pages/` (e.g. `pages/blog/[slug].njk`), the **page route wins**. Use either content auto routes or file routes for a given URL, not both.
