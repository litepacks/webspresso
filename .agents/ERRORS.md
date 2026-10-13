# Webspresso Framework Exceptions & Error Handling Guide

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## ⚠️ STRICT RULE: Throw Semantic Errors (NO Generic `new Error()` or Manual `res.status`)

- **NEVER** return manual error payloads like `return res.status(404).json(...)` inside services or loaders.
- **NEVER** throw a generic `throw new Error('Not found')` for business or client-facing issues. In production, unmapped `Error` instances are automatically masked as `500 Internal Server Error` with stack traces hidden!
- **ALWAYS** throw semantic framework exceptions:
  - `throw new NotFoundError('Item not found')` → returns HTTP 404
  - `throw new ValidationError('Invalid data', { fields: { ... } })` → returns HTTP 422
  - `throw new UnauthorizedError('Please log in')` → returns HTTP 401
  - `throw new ForbiddenError('Access denied')` → returns HTTP 403
  - `throw new BadRequestError('Invalid query')` → returns HTTP 400

---

## 1. Overview & Exception Hierarchy

Webspresso features a centralized, lightweight, zero-dependency exception hierarchy inspired by Django's failure domain separation. Thrown synchronous and asynchronous exceptions are automatically caught by the global error boundary, normalized, and formatted as standardized JSON responses for API routes or styled HTML pages for web clients.

```text
WebspressoError (base class with cause, code, details)
├── ConfigurationError (bootstrap & config errors)
├── PluginError (plugin lifecycle & dependency errors)
├── ValidationError (validation failures with fields, 422 default)
├── SecurityError (suspicious requests, CSRF/cookie tampering, 400 default)
├── RequestError
│   └── RequestAbortedError (client socket disconnection, 499 default)
├── RouterError
│   ├── RouteNotFoundError (404 URL resolution error)
│   └── RouteGenerationError (named route generation error)
└── HttpError (base for HTTP-mapped exceptions)
    ├── BadRequestError (400)
    ├── UnauthorizedError (401)
    ├── ForbiddenError (403)
    ├── NotFoundError (404)
    ├── MethodNotAllowedError (405)
    ├── ConflictError (409)
    ├── PayloadTooLargeError (413)
    ├── UnsupportedMediaTypeError (415)
    ├── UnprocessableEntityError (422)
    └── TooManyRequestsError (429)
```

---

## 2. Public Imports & Subpath

```js
import {
  WebspressoError,
  HttpError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  UnprocessableEntityError,
  TooManyRequestsError,
  ValidationError,
  ConfigurationError,
  PluginError,
  SecurityError,
  RequestAbortedError,
  RouteNotFoundError,
  RouteGenerationError,
} from 'webspresso';

// Or via subpath:
import { NotFoundError, ValidationError } from 'webspresso/errors';
```

---

## 3. Usage Examples

### 3.1 HTTP Exceptions in API Handlers
```js
// pages/api/users/[id].get.js
import { NotFoundError } from 'webspresso';

module.exports = async function handler(req, res) {
  const user = await req.db.getRepository('User').findById(req.params.id);
  if (!user) {
    throw new NotFoundError('User not found', {
      code: 'USER_NOT_FOUND',
    });
  }
  res.json({ user });
};
```

### 3.2 Structured Validation Errors (422)
```js
import { ValidationError } from 'webspresso';

throw new ValidationError('Validation failed', {
  code: 'INVALID_INPUT',
  fields: {
    email: ['Invalid email address'],
    age: ['Must be at least 18'],
  },
});
```

### 3.3 Custom Error Classes
```js
import { HttpError } from 'webspresso';

export class PaymentRequiredError extends HttpError {
  constructor(message = 'Payment Required', options = {}) {
    super(402, message, {
      code: options.code || 'PAYMENT_REQUIRED',
      expose: true,
      ...options,
    });
  }
}
```

### 3.4 Custom Error Handler (`app.setErrorHandler`)
```js
const { app } = createApp({ pagesDir: './pages' });

app.setErrorHandler(async (err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(422).json({
      success: false,
      errors: err.fields,
    });
  }
  // Re-throwing or returning unhandled delegates to Webspresso default handler
});
```

---

## 4. Response Contract & Production Masking

### Default JSON Contract:
```json
{
  "status": 404,
  "error": "Not Found",
  "message": "User not found",
  "code": "USER_NOT_FOUND"
}
```

### Development vs Production:
- **Production (`NODE_ENV === 'production'`)**: 500 errors are masked to `"Internal Server Error"`. `stack`, `cause`, and internal file paths are never exposed to clients.
- **Development**: Returns `stack`, `cause`, and a structured `trace` object identifying the exact route, module, source file, and execution phase.

---

## 5. Route Tracing & Request ID Observability

Webspresso automatically correlates every request and enriches thrown errors with route-level execution metadata:

### 5.1 Request Correlation ID (`req.id` / `X-Request-Id`)
Every incoming request is assigned a unique UUID (`req.id`) available on `req.id` and returned in the `X-Request-Id` response header:
```javascript
// Access in services, loaders, or logs:
const reqId = req.id; // e.g. "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
```

### 5.2 Context-Enriched Trace Object (Development Mode)
When an exception occurs during request execution in `definePage`, `defineApi`, or a feature module, the development JSON payload contains an explicit `trace` object:

```json
{
  "status": 500,
  "error": "Internal Server Error",
  "message": "Database query failed",
  "trace": {
    "route": "/api/auth/me",
    "method": "GET",
    "source": "src/modules/auth/api/me.get.js",
    "module": "auth",
    "phase": "handler",
    "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  },
  "stack": "Error: Database query failed\n    at ...",
  "cause": null
}
```

### 5.3 Visual Console Error Banners
In server logs, 500 errors are automatically highlighted with visual banners pinpointing the root cause:
```txt
[webspresso] 🚨 Error at GET /api/auth/me [module: auth] (reqId: 9b1deb4d-3b7d-...)
  Source: src/modules/auth/api/me.get.js
  Phase:  handler
```

---

## 6. Directory-Level Error Boundaries (`_error.njk` & `_error.js`)

In addition to API JSON errors and the top-level 500 error page, Webspresso provides **Directory-Level Error Boundaries** for SSR pages (similar to Next.js `error.js` or Nuxt `error.vue`):

```
pages/
├── _layout.njk                # Root site layout
├── _error.njk                 # Global site error fallback
└── dashboard/
    ├── _layout.njk            # Dashboard layout (sidebar, header)
    ├── _error.njk             # Dashboard-scoped error boundary
    ├── _error.js              # Optional companion loader
    ├── billing/
    │   └── invoices.njk       # If load() fails here...
    └── settings.njk
```

### 6.1 Isolated Error Containment
When an unhandled error is thrown in a page route's `load()`, template rendering, or lifecycle hooks:
1. Webspresso searches up the directory hierarchy (innermost leaf to root `pages/`) for the nearest `_error.njk`.
2. The error boundary is rendered **inside** the ancestor cascading layouts (`_layout.njk`), ensuring that headers, sidebars, and navigation remain visible while displaying the isolated error state.
3. The HTTP response status is preserved from `error.status || error.statusCode || 500` (e.g. throwing `NotFoundError` sets HTTP 404).

### 6.2 Companion Loader (`_error.js`)
An optional companion `_error.js` can prefetch support data, report errors to monitoring services, or enrich the context:

```javascript
// pages/dashboard/_error.js
module.exports = {
  load: async ({ error, req, res, ctx, db }) => {
    return {
      supportEmail: 'support@example.com',
      incidentId: req.id,
    };
  },
};
```

### 6.3 Template Context Variables
Inside `_error.njk`, the following variables are injected:
- `error`: `{ message, status, statusCode, code, name, details, fields, stack }` (stack is only exposed when `isDev === true`).
- `route`: `{ routePath, file }`.
- `req`: `{ path, query, params, method, url }`.
- `fsy`: Template helper suite.
- Plus any data returned by companion `_error.js` loader.

### 6.4 Layout Opt-Out
To render a full-page custom error view without the parent layout, set `layout: false` in `_error.js` or frontmatter:
```yaml
---
layout: false
---
<div class="standalone-error-screen">
  <h1>{{ error.status }} - {{ error.message }}</h1>
</div>
```

