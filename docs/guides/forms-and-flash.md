---
title: Forms & Flash Messages
description: AdonisJS and Django-inspired Form Builder, ModelForms, Flash Messages, and Old Input across redirects with automatic Zod error mapping.
---

# Forms & Flash Messages Guide

Webspresso provides a built-in form generation and flash state management system (`core/forms/`):
1. **Flash Messages & Old Input (`core/forms/flash.js`)**: Safely preserves validation errors, status messages, and submitted input across HTTP redirects via session or encrypted cookies.
2. **Form Builder & ModelForms (`core/forms/form-builder.js`)**: Generates accessible, customizable HTML input widgets directly from code or ORM models.

---

## 1. Flash Messages & Old Input

When a form submission fails validation, developers typically redirect back to the form page. Webspresso automatically preserves submitted inputs and validation error messages across the redirect.

### Controller / Action Example
```javascript
// pages/api/auth/register.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  async handler(req, res) {
    const { email, password, name } = req.body;

    // Validate inputs
    const result = userRegistrationSchema.safeParse(req.body);
    if (!result.success) {
      // 1. Preserve input values for req.old()
      // 2. Attach Zod validation errors to flash state
      // 3. Redirect back to registration form
      return res
        .withOldInput()
        .flash('errors', result.error)
        .redirect('/register');
    }

    await req.db.getRepository('User').create(result.data);

    // Flash success message
    return res
      .flash('success', 'Your account has been created! Please log in.')
      .redirect('/login');
  },
});
```

---

## 2. Reading Flash State in Nunjucks Templates

Access flash messages and old input values anywhere in your templates via `fsy`:

```nunjucks
{# views/register.njk #}
{% extends "layout.njk" %}

{% block content %}
<div class="max-w-md mx-auto p-6 bg-white rounded shadow">
  <h2>Create Account</h2>

  {# Success / Error Alerts #}
  {% if fsy.hasFlash('success') %}
    <div class="alert alert-success">{{ fsy.flash('success') }}</div>
  {% endif %}

  {% if fsy.hasFlash('error') %}
    <div class="alert alert-danger">{{ fsy.flash('error') }}</div>
  {% endif %}

  <form method="POST" action="/api/auth/register">
    {{ fsy.csrf() | safe }}

    <!-- Name Field -->
    <div class="form-group mb-3">
      <label for="name">Full Name</label>
      <input 
        type="text" 
        id="name" 
        name="name" 
        value="{{ fsy.old('name', '') }}" 
        class="form-control" 
        required 
      />
    </div>

    <!-- Email Field -->
    <div class="form-group mb-3">
      <label for="email">Email Address</label>
      <input 
        type="email" 
        id="email" 
        name="email" 
        value="{{ fsy.old('email', '') }}" 
        class="form-control" 
        required 
      />
    </div>

    <button type="submit" class="btn btn-primary">Register</button>
  </form>
</div>
{% endblock %}
```

---

## 3. Accessible Form Builder (`fsy.field`)

Instead of writing repetitive boilerplate HTML with labels, inputs, help text, and error indicators, use `fsy.field()`:

```nunjucks
{{ fsy.field('email', {
  label: 'Corporate Email',
  type: 'email',
  placeholder: 'name@company.com',
  required: true,
  helpText: 'We will never share your email with third parties.'
}) | safe }}
```

### Generated HTML
```html
<div class="form-group mb-3">
  <label for="field_email" class="form-label">Corporate Email <span class="text-danger">*</span></label>
  <input 
    type="email" 
    id="field_email" 
    name="email" 
    class="form-control" 
    placeholder="name@company.com" 
    value="" 
    required 
  />
  <div class="form-text text-muted">We will never share your email with third parties.</div>
</div>
```
When validation fails, `fsy.field()` automatically appends the `is-invalid` CSS class and renders the specific error message for that field beneath the input.

### Supported Field Types
- `text`, `email`, `password`, `number`, `tel`, `url`, `date`, `time`
- `textarea`: Supports `rows`, `cols`
- `select`: Supports `selectOptions: [{ label, value }]` or simple array `['Admin', 'User']`
- `checkbox`, `radio`
- `file`

---

## 4. Automatic ModelForms (`fsy.formFor`)

Generate a complete, validated HTML form from an ORM model definition in a single line (Django ModelForm-inspired):

```nunjucks
{# Render full form for Product model #}
<form method="POST" action="/products">
  {{ fsy.csrf() | safe }}
  {{ fsy.formFor('Product', {
    fields: ['title', 'price', 'description', 'category_id', 'is_active'],
    submitLabel: 'Save Product',
    submitClass: 'btn btn-primary mt-3'
  }) | safe }}
</form>
```

`fsy.formFor` automatically inspects:
- Column types from `zdb.*` (`zdb.string` → text input, `zdb.integer` → number input, `zdb.boolean` → checkbox, `zdb.text` → textarea).
- Required status and validation constraints (min/max).
- Pre-fills initial values when editing existing records: `fsy.formFor('Product', { record: product })`.
