---
title: Exceptions
description: Webspresso error hierarchy — HttpError, ValidationError, NotFoundError, and custom error handlers.
---

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

---

## 4. Error Tracing & Observability

Webspresso features rich error tracing designed to pinpoint the exact failure point in loaders, route handlers, or schema validation pipelines without exposing internal implementation details in production.

### 4.1 Request Correlation ID (`req.id`)

Every incoming HTTP request receives a unique correlation identifier:
- Reuses client-provided `X-Request-Id` (or `X-Correlation-Id`) if present.
- Otherwise generates a standard UUID v4 via native `crypto.randomUUID()`.
- Automatically sets the outgoing `X-Request-Id` HTTP header.

### 4.2 Development Trace Object (`err.trace`)

In non-production environments (`NODE_ENV !== 'production'`), errors caught by page/API loaders and the central error boundary contain structured diagnostic context:

```json
{
  "success": false,
  "error": "TypeError",
  "message": "Cannot read properties of undefined (reading 'title')",
  "trace": {
    "route": "/api/notes/42",
    "method": "GET",
    "source": "pages/api/notes/[id].get.js",
    "module": "notes",
    "phase": "handler",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  },
  "stack": "TypeError: Cannot read properties of undefined...\n    at handler (/src/api/notes/[id].get.js:12:35)..."
}
```

### 4.3 Loader Phase Tracking

The `phase` property isolates where the exception was triggered:
- `'schema'`: Zod schema compilation or payload validation.
- `'load'`: SSR page data loader execution (`load()`).
- `'handler'`: API endpoint or route handler execution.
- `'render'`: Template rendering and HTML compilation.

### 4.4 Visual Console Error Banners

In development mode, server errors print high-visibility boxed console banners with route, method, phase, and source file metadata for rapid terminal debugging:

```text
┌────────────────────────────────────────────────────────────┐
│ 💥 [ERROR] GET /api/notes/42 [Phase: handler]
│ 📁 Source: pages/api/notes/[id].get.js
│ 🆔 Request: 550e8400-e29b-41d4-a716-446655440000
│ ⚠️  TypeError: Cannot read properties of undefined (reading 'title')
└────────────────────────────────────────────────────────────┘
```
