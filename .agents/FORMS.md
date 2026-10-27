# Webspresso Form Builder & Flash Messages Guide

Webspresso provides a built-in form generation and flash state management system (`core/forms/`):
- **Flash Messages & Old Input (`core/forms/flash.js`)**: Preserves validation errors and submitted input values across HTTP redirects via session or encrypted cookie.
- **Accessible Form Builder & ModelForms (`core/forms/form-builder.js`)**: Generates accessible HTML input controls directly from code or ORM models.

---

## 1. Flash & Old Input Lifecycle

In SSR applications, form submissions typically POST to an API/action route. On validation failure, the controller redirects back with previous input and errors:

```javascript
// pages/api/posts/create.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  async handler(req, res) {
    const result = postSchema.safeParse(req.body);

    if (!result.success) {
      // withOldInput() stores req.body for req.old()
      // flash('errors', ...) flattens Zod error issues into { fieldName: string[] }
      return res
        .withOldInput()
        .flash('errors', result.error)
        .redirect('/posts/new');
    }

    const post = await req.db.getRepository('Post').create(result.data);
    return res
      .flash('success', 'Post published successfully!')
      .redirect(`/posts/${post.id}`);
  },
});
```

---

## 2. Template Helpers (`fsy`)

In Nunjucks templates (`.njk`):

### Reading Flash State
- `fsy.flash(key)`: Returns flash message value (or all flash data if key omitted).
- `fsy.hasFlash(key)`: Returns boolean indicating whether flash key exists.
- `fsy.old(name, fallback = '')`: Retrieves previous submitted value for field name.
- `fsy.csrf()`: Renders `<input type="hidden" name="_csrf" value="...">`.

```nunjucks
{% if fsy.hasFlash('success') %}
  <div class="alert alert-success">{{ fsy.flash('success') }}</div>
{% endif %}

<input type="email" name="email" value="{{ fsy.old('email') }}">
```

---

## 3. Accessible Form Fields (`fsy.field`)

`fsy.field(name, options)` generates a full form-group wrapper, label, input control, and automatic error indicator:

```nunjucks
{{ fsy.field('email', {
  label: 'Email Address',
  type: 'email',
  placeholder: 'you@example.com',
  required: true,
  helpText: 'We will send your verification link here.'
}) | safe }}
```

### Automatic Validation Styling
When a validation error exists for `email`, `fsy.field()` automatically:
1. Adds `is-invalid` to the input element's CSS class list.
2. Renders `<div class="invalid-feedback">Error message</div>` beneath the control.

---

## 4. ModelForms (`fsy.formFor`)

Generate a full HTML form from an ORM model:

```nunjucks
<form method="POST" action="/api/users">
  {{ fsy.csrf() | safe }}
  {{ fsy.formFor('User', {
    fields: ['name', 'email', 'bio', 'role'],
    submitLabel: 'Create User'
  }) | safe }}
</form>
```
Pass an existing record to pre-populate inputs when editing:
```nunjucks
{{ fsy.formFor('User', { record: user, submitLabel: 'Update Profile' }) | safe }}
```
