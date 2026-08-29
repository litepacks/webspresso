# Services Layer Guide

> **Goal:** Structure and execute reusable business logic with declarative Zod validation, role-based authorization, ambient transactions, and caching.

---

## 1. Defining a Service

Services live under `services/` and use `defineService()` to declare metadata, validation, security, and execution handlers:

```javascript
// services/user/create.js
const { defineService } = require('webspresso');

module.exports = defineService({
  // 1. Declarative Zod Validation
  schema({ z }) {
    return {
      email: z.string().email(),
      name: z.string().min(2),
      role: z.enum(['admin', 'editor', 'member']).default('member'),
    };
  },

  // 2. Declarative Access Control (Admin only)
  auth: ['admin'],

  // 3. Automatic ACID Transaction Propagation
  transaction: true,

  // 4. Execution Handler
  async handler(input, ctx) {
    const userRepo = ctx.db.getRepository('User');

    // Check if user already exists
    const existing = await userRepo.findOne({ email: input.email });
    if (existing) {
      throw new Error(`User with email ${input.email} already exists`);
    }

    const user = await userRepo.create({
      email: input.email,
      name: input.name,
      role: input.role,
    });

    return user;
  },
});
```

---

## 2. Invoking Services

Services can be called from anywhere in the application:

### In Express Routes
```javascript
app.post('/api/users', async (req, res) => {
  const user = await req.service('user.create', req.body);
  res.status(201).json({ success: true, user });
});
```

### In SSR `load()` Functions
```javascript
// pages/users/index.js
module.exports = {
  async load({ ctx }) {
    const users = await ctx.service('user.list', { page: 1, limit: 20 });
    return { users };
  },
};
```

### Service-to-Service Calls
Inside a service handler, access sibling services through `ctx.service()`:

```javascript
// services/order/checkout.js
module.exports = defineService({
  transaction: true,
  async handler(input, ctx) {
    // Both calls share the same ambient transaction automatically
    const user = await ctx.service('user.get-by-id', { id: input.userId });
    const order = await ctx.service('billing.create-invoice', { user, items: input.items });
    return order;
  },
});
```

---

## 3. Declarative Authorization Options

The `auth` option supports three patterns:

1. **Boolean**: `auth: true` — Requires `ctx.user` to be authenticated.
2. **Role List**: `auth: ['admin', 'manager']` — Enforces role matching against `user.role` or `user.roles`.
3. **Predicate Function**:
   ```javascript
   auth: (user, ctx) => {
     return user && (user.id === ctx.input.targetUserId || user.role === 'admin');
   }
   ```

---

## 4. Service-Level Caching

To avoid repeated database queries or costly computations, configure `cache`:

```javascript
module.exports = defineService({
  cache: {
    ttl: '10m', // 10 minutes
    key: (input) => `user-stats-${input.userId}`,
  },
  async handler(input, ctx) {
    const stats = await calculateComplexStats(input.userId);
    return stats;
  },
});
```

Invalidate cache programmatically when mutations occur:

```javascript
await ctx.service.invalidate('user.stats', { userId: 123 });
```
