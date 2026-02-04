---
sidebar_position: 2
---

# Layouts

Layouts provide a consistent structure across your pages. Webspresso uses Nunjucks template inheritance for layouts.

## Base Layout

Create a base layout in `views/layout.njk`:

```njk
<!DOCTYPE html>
<html lang="{{ locale || 'en' }}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{% block title %}My Site{% endblock %}</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <header>
    {% include "partials/nav.njk" %}
  </header>
  
  <main>
    {% block content %}{% endblock %}
  </main>
  
  <footer>
    {% include "partials/footer.njk" %}
  </footer>
</body>
</html>
```

## Using Layouts

Extend the layout in your pages:

```njk
{# pages/about/index.njk #}
{% extends "layout.njk" %}

{% block title %}About Us{% endblock %}

{% block content %}
<h1>About Us</h1>
<p>Content here...</p>
{% endblock %}
```

## Multiple Layouts

Create different layouts for different sections:

```njk
{# views/admin-layout.njk #}
<!DOCTYPE html>
<html>
<head>
  <title>Admin - {% block title %}{% endblock %}</title>
</head>
<body>
  <nav>Admin Navigation</nav>
  {% block content %}{% endblock %}
</body>
</html>
```

Use in admin pages:

```njk
{# pages/admin/index.njk #}
{% extends "admin-layout.njk" %}

{% block content %}
<h1>Admin Dashboard</h1>
{% endblock %}
```

## Layout Blocks

Define blocks that can be overridden:

```njk
{# views/layout.njk #}
<head>
  {% block head %}
    <title>{% block title %}Default Title{% endblock %}</title>
  {% endblock %}
  
  {% block styles %}
    <link rel="stylesheet" href="/css/main.css">
  {% endblock %}
</head>

<body>
  {% block header %}
    <header>Default Header</header>
  {% endblock %}
  
  {% block content %}{% endblock %}
  
  {% block footer %}
    <footer>Default Footer</footer>
  {% endblock %}
  
  {% block scripts %}
    <script src="/js/main.js"></script>
  {% endblock %}
</body>
```

Override in pages:

```njk
{% extends "layout.njk" %}

{% block title %}Custom Title{% endblock %}

{% block styles %}
  {{ super() }}
  <link rel="stylesheet" href="/css/custom.css">
{% endblock %}

{% block content %}
<h1>Page Content</h1>
{% endblock %}
```

## Partial Templates

Create reusable partials:

```njk
{# views/partials/nav.njk #}
<nav>
  <a href="/">Home</a>
  <a href="/about">About</a>
  <a href="/contact">Contact</a>
</nav>
```

Include in layouts:

```njk
{% include "partials/nav.njk" %}
```

## Passing Data to Partials

```njk
{# views/partials/user-card.njk #}
<div class="user-card">
  <h3>{{ user.name }}</h3>
  <p>{{ user.email }}</p>
</div>
```

Use with data:

```njk
{% include "partials/user-card.njk" with { user: currentUser } %}
```

## Next Steps

- [Template helpers](/templates/helpers)
- [i18n](/templates/i18n)
