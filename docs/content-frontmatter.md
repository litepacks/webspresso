# Content frontmatter

Markdown files support YAML frontmatter between `---` delimiters.

```markdown
---
title: "Hello World"
description: "First post"
slug: "hello-world"
date: "2026-05-31"
updatedAt: "2026-06-01"
tags: ["webspresso", "nodejs"]
draft: false
image: "/og/hello.png"
canonical: "https://example.com/blog/hello-world"
robots: "index, follow"
author: "Ada"
sitemap: true
---

# Hello World

Body in Markdown.
```

## Slug resolution

1. `slug` in frontmatter
2. Filename without `.md`
3. Slugified `title`

## Draft

`draft: true` hides the item in production routes and lists (unless `includeDrafts` is used). Drafts are never added to the sitemap. In development, drafts are visible by default.

## Parsed fields

Each indexed item exposes: `title`, `description`, `date`, `tags`, `body`, `html`, `excerpt`, `path`, `url`, and SEO fields merged into `meta` / `seo` in templates.
