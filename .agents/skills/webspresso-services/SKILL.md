---
name: webspresso-services
description: >-
  Encapsulate business logic, validations, transactions, and authorizations in Webspresso services.
  Use when writing service files (services/domain/action.js), defining schemas (defineService),
  configuring transaction: true, calling ctx.service() or req.service(), and adding RBAC guards.
---

# Webspresso Services Layer Skill

⚠️ **CRITICAL ANTI-PATTERN:** Never create a `controllers/` folder or controller classes. Encapsulate multi-step business logic in `services/` and invoke via `ctx.service()` or `req.service()`.

---

## 1. File-Based Auto-Discovery (`services/`)

Files in `services/` map directly to dot-separated service names:
- `services/user/create.js` → `'user.create'`
- `services/order/checkout.js` → `'order.checkout'`
- `services/billing/process-refund.js` → `'billing.process-refund'` (and `'billing.processRefund'`)

---

## 2. Defining Services (`defineService`)

```javascript
const { defineService } = require('webspresso');

module.exports = defineService({
  schema: ({ z }) => z.object({
    userId: z.number().int().positive(),
    amount: z.number().positive(),
    reason: z.string().min(3),
  }),

  // Optional Declarative Auth / Role Guard
  auth: ['admin', 'manager'], // or boolean true, or (ctx, input) => boolean

  // Automatic ACID Transaction Propagation
  transaction: true,

  // Optional Service Result Cache
  cache: {
    ttl: 300, // seconds
    key: (input) => `refund:${input.userId}:${input.amount}`,
  },

  // Execution Handler
  handler: async (input, ctx) => {
    // ctx.db, ctx.service, ctx.user, ctx.logger are automatically injected
    const userRepo = ctx.db.getRepository('User');
    const accountRepo = ctx.db.getRepository('Account');

    const user = await userRepo.findById(input.userId);
    if (!user) {
      throw new ctx.errors.NotFoundError('User not found');
    }

    const account = await accountRepo.findOne({ userId: user.id });
    const updatedAccount = await accountRepo.update(account.id, {
      balance: account.balance + input.amount,
    });

    // Nested service call shares the same ambient transaction automatically
    await ctx.service('audit.log', {
      action: 'refund.processed',
      userId: user.id,
      amount: input.amount,
    });

    return {
      success: true,
      balance: updatedAccount.balance,
    };
  },
});
```

---

## 3. Invoking Services

From SSR Companion Loaders:
```javascript
module.exports = definePage({
  load: async ({ ctx }) => {
    const data = await ctx.service('order.summary', { userId: ctx.user.id });
    return { data };
  },
});
```

From API Route Handlers:
```javascript
module.exports = defineApi({
  handler: async (req, res) => {
    const result = await req.service('order.checkout', req.input.body);
    return res.status(200).json(result);
  },
});
```
