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
