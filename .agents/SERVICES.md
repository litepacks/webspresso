# Webspresso Services Layer (`services/`, `src/services/`)

The **Services Layer** is a lightweight, framework-agnostic architectural abstraction designed to encapsulate business logic, multi-step domain mutations, and data queries away from HTTP controllers and page loaders into isolated, reusable, testable functions.

---

## 1. Directory Structure & Auto-Discovery

Services are located in the `services/` directory at the project root. Files automatically map to dot-separated service names and camelCase aliases.

```
services/
├── user/
│   ├── get.js                 → 'user.get'
│   ├── create.js              → 'user.create'
│   └── reset-password.js      → 'user.reset-password' & 'user.resetPassword'
├── order-items/
│   └── get-by-id.js           → 'order-items.get-by-id' & 'orderItems.getById'
└── billing/
    └── invoice/
        └── generate.js        → 'billing.invoice.generate' & 'billing.invoice.generate'
```

### Discovery Mechanics
- **Cross-Platform Path Normalization**: Works seamlessly on Windows (`\`) and Unix (`/`).
- **Kebab & Snake to camelCase Aliases**: Files named with dashes or underscores automatically register both their raw dot-name and camelCase alias (e.g. `order-items/calculate_tax.js` is callable as both `'order-items.calculate_tax'` and `'orderItems.calculateTax'`).
- **File Extensions**: Discovers `.js` and `.cjs` files. Ignores files starting with `_` or `.` (e.g., `_helpers.js`).

---

## 2. Service Definition Contract

A service file exports a `handler` function and optional configuration properties:

```javascript
// services/user/create.js
const { z } = require('zod');

module.exports = {
  // Optional input validation schema (Zod)
  schema: z.object({
    email: z.string().email(),
    name: z.string().min(2),
    role: z.enum(['user', 'admin']).default('user'),
  }),

  // Optional authentication & role requirements
  auth: 'admin', // or true, ['admin', 'manager'], or (user, ctx) => boolean

  // Optional timeout in milliseconds (throws ServiceTimeoutError if exceeded)
  timeout: 5000,

  // Optional automatic ACID transaction wrapper
  transaction: true,

  // Optional response memoization / caching
  cache: {
    ttl: 60000, // TTL in milliseconds
    key: (input) => `user:create:${input.email}`, // Custom key generator (defaults to SHA-256 of input)
  },

  // Service handler
  async handler(input, ctx) {
    const { email, name, role } = input;
    const { db, trx } = ctx;

    const user = await db.getRepository('User').create(
      { email, name, role },
      { trx } // Reuses the automatic service transaction
    );

    return user;
  },
};
```

---

## 3. Invocation & Composition (`ctx.service()`)

### 3.1 From SSR Page Loaders
```javascript
// pages/users/[id].js
module.exports = {
  async load({ req, res, ctx }) {
    const user = await ctx.service('user.get', { id: req.params.id });
    return { user };
  },
};
```

### 3.2 From Express API Handlers
```javascript
// pages/api/users.js
module.exports = async function (req, res) {
  const newUser = await req.service('user.create', req.body);
  res.status(201).json({ data: newUser });
};
```

### 3.3 Nested Service Composition
Services can invoke other services via `ctx.service()`. The child service automatically inherits `ctx.db`, `ctx.auth`, `ctx.user`, `ctx.session`, and active transaction (`ctx.trx`):

```javascript
// services/order/checkout.js
module.exports = {
  transaction: true,
  async handler({ orderId, items }, ctx) {
    // 1. Process payment
    await ctx.service('payment.charge', { orderId });

    // 2. Deduct inventory (runs inside the exact same database transaction!)
    await ctx.service('inventory.deduct', { items });

    // 3. Send confirmation email (async)
    await ctx.service('email.sendOrderConfirmation', { orderId });

    return { status: 'completed' };
  },
};
```

---

## 4. Advanced Execution Features

### 4.1 Authentication & RBAC (`auth`)
- `auth: true` — Requires `ctx.user` or `ctx.auth.user` to be present. Throws `UnauthorizedError` (HTTP 401) if unauthenticated.
- `auth: 'admin'` — Checks `user.role === 'admin'` or `user.roles.includes('admin')`. Throws `ForbiddenError` (HTTP 403) if unauthorized.
- `auth: ['admin', 'manager']` — Allows any of the specified roles.
- `auth: (user, ctx) => boolean` — Custom predicate function for dynamic authorization rules.
- `skipAuth: true` — Option passed in `ctx.service('service.name', input, { skipAuth: true })` to allow internal background crons or system tasks to bypass auth checks.

### 4.2 ACID Transactions (`transaction: true`)
- Wraps the service execution inside Knex transaction `db.knex.transaction()`.
- Exposes `ctx.trx` to the handler and repositories.
- Automatically commits when handler returns.
- Automatically rolls back on thrown errors or rejection.
- Child service calls automatically reuse the parent `ctx.trx` without spawning nested transactions.

### 4.3 Execution Timeout (`timeout: ms`)
- Protects against hanging database queries, unresponsive 3rd-party APIs, or deadlocks.
- Cleans up timers upon completion.
- Rejects with `ServiceTimeoutError` with descriptive duration message.

### 4.4 In-Memory Memoization & Cache (`cache: { ttl, key }`)
- Prevents redundant computation or queries within TTL window.
- Generates deterministic SHA-256 cache keys from sorted JSON input representations.
- Supports custom `key(input)` serializer functions.
- Provides `services.clearCache(serviceName)` and `services.clearAllCaches()`.

---

## 5. Programmatic & Standalone Usage (CLI / Cron / Tests)

```javascript
const { createServiceRegistry } = require('webspresso/services');

// Initialize registry directly
const services = createServiceRegistry({
  servicesDir: path.join(__dirname, 'services'),
  db,
  context: { config: appConfig },
});

// Discover all services
await services.discover();

// Execute service directly
const result = await services.call('order.getById', { id: 123 });
```

---

## 6. Built-in `auth.*` Services

When a database connection (`options.db`) is configured, Webspresso automatically registers production-ready, standardized authentication services into `serviceRegistry` (unless custom implementations are provided in `services/auth/`):

| Service Name | Description | Schema / Input | Guard / ACID |
|---|---|---|---|
| `auth.login` | Authenticates user credentials, sets session cookie and returns user data | `{ email, password, remember? }` | Validates hash, sets `req.session.user` |
| `auth.register` | Validates and hashes password, prevents duplicate emails, creates user record | `{ email, password, name?, role? }` | `transaction: true` |
| `auth.request-password-reset` | Generates secure password reset token (user enumeration resistant) | `{ email, ttlMs? }` | Returns `{ sent: true }` safely |
| `auth.reset-password` | Consumes token, validates TTL, updates password hash | `{ token, password }` | `transaction: true` |
| `auth.change-password` | Verifies current password and updates with new password | `{ currentPassword, newPassword }` | `auth: true`, `transaction: true` |
| `auth.verify-email` | Consumes verification token and updates `email_verified_at` | `{ token }` | `transaction: true` |

### Customizing Built-in Auth Services
```javascript
const { createAuthServices } = require('webspresso/services');

// Customize model name or column mappings
const customAuth = createAuthServices({
  userModel: 'Account',
  fields: {
    email: 'email_address',
    password: 'password_hash',
    emailVerifiedAt: 'verified_at',
  },
});
```

---

## 7. Built-in `mail.*` Services

When `emailPlugin` is loaded, Webspresso automatically registers standardized transactional email services into `serviceRegistry`:

| Service Name | Description | Schema / Input | Features |
|---|---|---|---|
| `mail.send` | Sends HTML/plain/MJML transactional email via Nodemailer | `{ to, subject, html?, text?, mjml?, template?, data?, attachments? }` | DB send logging, MJML compilation |
| `mail.send-templated` | Sends pre-registered MJML template with payload variables | `{ template, to, subject, data?, from?, replyTo? }` | Template caching & variable interpolation |
| `mail.preview` | Compiles and previews MJML/template without sending | `{ template?, mjml?, data? }` | In-memory HTML & text preview rendering |
| `mail.query-logs` | Queries email send logs and delivery status | `{ limit?, offset?, status?, to?, template? }` | `auth: 'admin'` |

### Customizing or Standalone Mail Services
```javascript
const { createMailServices } = require('webspresso/services');

// Initialize standalone mail services
const mail = createMailServices({
  emailService,
  registry: templateRegistry,
  db: appDb,
  tableName: 'email_logs',
});
```

---

## 8. Built-in `media.*` Services

When `uploadPlugin` is loaded, Webspresso automatically registers standardized file upload and media handling services into `serviceRegistry`:

| Service Name | Description | Schema / Input | Features |
|---|---|---|---|
| `media.upload` | Saves Buffer, Base64 data URL, or local file to storage | `{ buffer?, base64?, filePath?, originalName?, mimeType?, destDir?, publicBasePath? }` | Safe filename generation, MIME extraction, storage provider abstraction |
| `media.delete` | Safely removes stored file from disk/provider | `{ key, destDir? }` | Strict path traversal protection (`..` prevention) |
| `media.info` | Retrieves file existence, size, and modified timestamp | `{ key, destDir? }` | Fast filesystem stat inspection |

### Customizing or Standalone Media Services
```javascript
const { createMediaServices } = require('webspresso/services');

// Initialize standalone media services
const media = createMediaServices({
  destDir: '/path/to/custom/uploads',
  publicBasePath: '/static/uploads',
});
```

---

## 9. Built-in `system.*` Services

Webspresso automatically registers core system diagnostics, maintenance, and cache invalidation services into `serviceRegistry`:

| Service Name | Description | Schema / Input | Guard / Features |
|---|---|---|---|
| `system.health` | Live DB ping, latency measurement, memory footprint (`rss`, `heap`), uptime | `{ detailed? }` | Zero downtime monitoring & load balancer health checks |
| `system.cleanup` | Purges expired auth tokens and old audit logs | `{ olderThanDays?, purgeAuthTokens?, purgeAuditLogs? }` | `auth: 'admin'`, cron/worker ready |
| `system.cache-flush` | Flushes ORM query cache and service memoization | `{ scope?: 'all'\|'orm'\|'services', model? }` | `auth: 'admin'` |
| `system.info` | Runtime diagnostics: Node version, platform, registered models, plugins & services | `{}` | `auth: 'admin'` |

### Customizing or Standalone System Services
```javascript
const { createSystemServices } = require('webspresso/services');

// Initialize standalone system services
const system = createSystemServices({
  db,
  serviceRegistry,
  pluginManager,
});
```

---

## 10. Built-in `exchange.*` Services

When `dataExchangePlugin` is loaded, Webspresso automatically registers spreadsheet export and import services into `serviceRegistry`:

| Service Name | Description | Schema / Input | Guard / Features |
|---|---|---|---|
| `exchange.export` | Exports ORM model records to Excel (.xlsx) buffer | `{ model, ids?, where?, limit? }` | `auth: 'admin'`, frozen header rows, clean output sanitization |
| `exchange.import` | Imports CSV or XLSX spreadsheets into database models | `{ model, buffer?, base64?, csvText?, mode?: 'insert'\|'upsert', upsertKey? }` | `auth: 'admin'`, `transaction: true` (atomic batch rollback), column type coercion |

### Customizing or Standalone Exchange Services
```javascript
const { createExchangeServices } = require('webspresso/services');

// Initialize standalone exchange services
const exchange = createExchangeServices({ db });
```
