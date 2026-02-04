---
sidebar_position: 1
---

# Nunjucks Templates

Webspresso uses [Nunjucks](https://mozilla.github.io/nunjucks/) as its templating engine. Nunjucks is a powerful, flexible templating language inspired by Jinja2.

## Basic Syntax

### Variables

```njk
<h1>{{ title }}</h1>
<p>{{ user.name }}</p>
```

### Filters

```njk
{{ name | upper }}
{{ content | truncate(100) }}
```

### Tags

```njk
{% if user %}
  <p>Welcome, {{ user.name }}!</p>
{% endif %}

{% for item in items %}
  <li>{{ item.name }}</li>
{% endfor %}
```

## Template Inheritance

Extend a base layout:

```njk
{# pages/about/index.njk #}
{% extends "layout.njk" %}

{% block content %}
<h1>About Us</h1>
<p>Content here...</p>
{% endblock %}
```

Base layout:

```njk
{# views/layout.njk #}
<!DOCTYPE html>
<html>
<head>
  <title>{% block title %}My Site{% endblock %}</title>
</head>
<body>
  {% block content %}{% endblock %}
</body>
</html>
```

## Includes

Include partial templates:

```njk
{% include "partials/header.njk" %}
{% include "partials/footer.njk" %}
```

## Template Variables

Webspresso automatically provides these variables:

- `t(key)` - Translation function
- `fsy` - Template helpers object
- `req` - Express request object
- `res` - Express response object
- Data from `load()` function in route config

## Example

```njk
{# pages/blog/index.njk #}
{% extends "layout.njk" %}

{% block title %}{{ t('blog.title') }}{% endblock %}

{% block content %}
<h1>{{ t('blog.title') }}</h1>

{% for post in posts %}
  <article>
    <h2><a href="{{ fsy.route('/blog/:slug', { slug: post.slug }) }}">
      {{ post.title }}
    </a></h2>
    <p>{{ post.excerpt }}</p>
    <time>{{ fsy.dateFormat(post.created_at, 'YYYY-MM-DD') }}</time>
  </article>
{% endfor %}
{% endblock %}
```

## Next Steps

- [Layouts](/templates/layouts)
- [Template helpers](/templates/helpers)
- [i18n](/templates/i18n)
