# Exceptions & Error Handling API Reference

> **Module:** `webspresso/core/errors` (also exported at package root as `errors`)  
> **Source of Truth:** `core/errors/index.js`

---

## 1. Exception Hierarchy

All framework exceptions inherit from the base `WebspressoError`:

```text
WebspressoError (base class)
├── HttpError
│   ├── RouteNotFoundError (404)
│   ├── RequestAbortedError (499)
│   ├── TimeoutError (504)
│   └── QueryComplexityError (400)
├── ValidationError (422 / 400)
├── SecurityError (403 / 401)
├── ConfigurationError (500)
└── PluginError (500)
```

---

## 2. Exception Classes Matrix

| Exception Class | Default HTTP Status | Default Message / Behavior |
| :--- | :--- | :--- |
| **`WebspressoError`** | `500` | Base framework error class with structured payload serialization (`toJSON()`). |
| **`HttpError`** | Custom | General HTTP error accepting custom status code (e.g. `new HttpError(402, 'Payment Required')`). |
| **`ValidationError`** | `422` | Thrown when Zod schema or service parameter validation fails. Contains structured `fields` map. |
| **`SecurityError`** | `403` | Thrown when service `auth` check, CSRF validation, or RBAC policy guard fails. |
| **`RouteNotFoundError`**| `404` | Thrown when no file-based route matches the incoming URL path. |
| **`RequestAbortedError`**| `499` | Thrown when the client closes the TCP connection before server response completion. |
| **`ConfigurationError`**| `500` | Thrown during startup if invalid options are passed to `createApp()` or `defineModel()`. |
| **`PluginError`** | `500` | Thrown when a plugin lifecycle hook fails during registration or route binding. |

---

## 3. Registering Custom Error Boundary

Override default error responses using `app.setErrorHandler`:

```javascript
app.setErrorHandler((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  const isDev = process.env.NODE_ENV !== 'production';

  if (req.accepts('html')) {
    return res.status(status).render('views/500.njk', {
      error: isDev ? err : { message: 'An unexpected error occurred' },
    });
  }

  res.status(status).json({
    success: false,
    error: err.name || 'InternalServerError',
    message: isDev ? err.message : 'Internal Server Error',
    ...(err.fields ? { fields: err.fields } : {}),
  });
});
```
