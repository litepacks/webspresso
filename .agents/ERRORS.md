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
- **Production (`NODE_ENV === 'production'`)**: 500 errors are masked to `"Internal Server Error"`. `stack` and `cause` are never exposed to clients.
- **Development**: Returns `stack`, `cause`, and original error messages for immediate debugging.
