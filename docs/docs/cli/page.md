---
sidebar_position: 3
---

# webspresso page

Add a new page to your project interactively.

## Usage

```bash
webspresso page
```

## Interactive Prompts

The command will ask you:

1. **Route path**: Enter the route path (e.g., `/about` or `/blog/post`)
2. **Route config**: Whether to add a route config file (`.js`)
3. **Locale files**: Whether to add locale files for i18n

## Examples

### Simple Page

```bash
$ webspresso page
? Route path: /about
? Add route config file? (Y/n) n
? Add locale files? (Y/n) n
```

Creates: `pages/about/index.njk`

### Page with Data Loading

```bash
$ webspresso page
? Route path: /products
? Add route config file? (Y/n) y
? Add locale files? (Y/n) y
```

Creates:
- `pages/products/index.njk`
- `pages/products/index.js` (with `load()` function)
- `pages/products/locales/en.json`
- `pages/products/locales/tr.json`

### Dynamic Route

```bash
$ webspresso page
? Route path: /blog/[slug]
? Add route config file? (Y/n) y
? Add locale files? (Y/n) n
```

Creates:
- `pages/blog/[slug].njk`
- `pages/blog/[slug].js`

## Generated Files

### Template File (`.njk`)

```njk
{% extends "layout.njk" %}

{% block content %}
<h1>Page Title</h1>
<p>Page content goes here.</p>
{% endblock %}
```

### Route Config (`.js`)

```javascript
module.exports = {
  async load(req, ctx) {
    // Load data for SSR
    return {
      // Your data here
    };
  },
};
```

### Locale Files

```json
{
  "title": "Page Title",
  "description": "Page description"
}
```

## Next Steps

- [Learn about routing](/routing/file-based-routing)
- [Add API endpoints](/cli/api)
- [Configure route data loading](/routing/file-based-routing#route-configuration)
