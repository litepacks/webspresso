# 0.3.x Content Layer — Checklist

## P0

- [x] `content/` directory standard and auto collection discovery
- [x] Markdown + frontmatter parser (`marked`, shared `frontmatter-block`)
- [x] `ContentIndex` + `createContentService` API
- [x] `createApp({ content })` + `contentPlugin`
- [x] Auto routes + layout resolution
- [x] SEO `meta` / `seo` merge
- [x] Sitemap `addUrl` integration
- [x] Unit tests (parse, index, routes, sitemap, nunjucks)
- [x] Docs: content-layer, frontmatter, routing, seo (CLI stub)

## P1

- [x] Draft mode (prod vs dev)
- [x] Zod validation + `failOnInvalid`
- [x] Nunjucks `content` global + helpers
- [x] CLI: list, validate, build-index, new
- [x] Dev chokidar watch + build `manifest.contentIndex`
- [x] `index.d.ts` ContentOptions

## P2

- [x] `content.search()`
- [x] `tagsRoute` + tag template
- [x] `content.related()`
- [x] Studio read-only `/content` preview
- [x] Plugin `api.registerCollection()`
