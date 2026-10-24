# Webspresso Ambient Request & Execution Context (`core/context`)

[← Back to AGENTS.md](AGENTS.md)

Webspresso features an enterprise-grade, zero-dependency **Ambient Request & Execution Context Engine** powered by Node.js `AsyncLocalStorage`. It enables composable hooks (`useContext`, `useDb`, `useAuth`, `useUser`, `useService`, `useLogger`, `useReq`, `useRes`, `useParams`, `useQuery`, `useBreaker`, `useTransaction`, `withContext`) across API handlers, SSR companion loaders, domain services, ORM models, and background workers without parameter threading or prop drilling.

---

## 🎯 Quick Reference: Composable Hooks Matrix

| Hook | Return Type | Description |
| :--- | :--- | :--- |
| `useContext()` | `RequestContextStore` | Returns the entire active context object; throws if called outside context. |
| `getContext()` | `RequestContextStore \| null` | Safe accessor returning active context or `null` without throwing. |
| `useDb()` | `Database \| null` | Accesses the active database/ORM instance or active transaction instance. |
| `useAuth()` / `useUser()` | `User \| null` | Accesses the authenticated user or principal object. |
| `useReq()` | `Request \| null` | Accesses the ambient HTTP request object (Express or Hono). |
| `useRes()` | `Response \| null` | Accesses the ambient HTTP response object. |
| `useParams()` | `Record<string, string>` | Accesses URL route parameters (e.g. `{ id: '123' }`). |
| `useQuery()` | `Record<string, any>` | Accesses URL query parameters (e.g. `{ filter: 'active' }`). |
| `useService(name, input, opts)` | `Promise<any>` | Dispatches a service call seamlessly using active ambient dependencies. |
| `useLogger()` | `Logger` | Accesses the ambient request/child logger or falls back to `console`. |
| `useQueue()` | `Queue \| null` | Accesses the ambient background job queue. |
| `useCache()` | `Cache \| null` | Accesses the ambient LRU cache engine. |
| `useBreaker(name, opts)` | `CircuitBreaker \| null` | Retrieves or creates a Circuit Breaker from registry or context. |
| `useTransaction(callback)` | `Promise<any>` | Initiates a managed transaction on `useDb()`, binding `txDb` to ambient hooks. |
| `withContext(overrides, fn)` | `any` | Executes `fn` with shallow-merged overrides on top of active context. |

---

## 1. Zero-Prop-Drilling in Domain Services

In complex applications, threading database connections or user objects across nested helper functions leads to tight coupling. With Webspresso hooks, helper utilities access ambient resources directly:

```javascript
// services/billing/refund.js
const { defineService, useDb, useAuth, useLogger, useService } = require('webspresso');

async function auditRefund(orderId, amount) {
  const logger = useLogger();
  const user = useAuth();
  logger.info('Processing refund audit', { orderId, user: user?.id });
  
  await useService('audit.log', {
    action: 'order.refund',
    actorId: user?.id,
    orderId,
    amount,
  });
}

module.exports = defineService({
  transaction: true,
  handler: async ({ orderId, amount }) => {
    const db = useDb(); // Inside transaction: true, useDb() automatically returns transactional db!
    const orderRepo = db.getRepository('Order');

    const order = await orderRepo.findById(orderId);
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    await orderRepo.update(order.id, { status: 'refunded' });
    await auditRefund(order.id, amount);

    return { success: true };
  },
});
```

---

## 2. Using Hooks in API Routes (`pages/api/...`)

```javascript
// pages/api/profile.get.js
const { defineApi, useDb, useUser, useQuery } = require('webspresso');

module.exports = defineApi({
  middleware: ['auth'],
  handler: async (req, res) => {
    const user = useUser();
    const query = useQuery();
    const db = useDb();

    const profile = await db.getRepository('UserProfile').findOne({ userId: user.id });
    return res.json({ profile, query });
  },
});
```

---

## 3. Using Hooks in SSR Page Loaders (`pages/...`)

```javascript
// pages/dashboard.js
const { definePage, useDb, useUser, useService } = require('webspresso');

module.exports = definePage({
  middleware: ['auth'],
  load: async () => {
    const user = useUser();
    const db = useDb();
    const metrics = await useService('dashboard.metrics', { userId: user.id });

    return {
      user,
      metrics,
    };
  },
});
```

---

## 4. Managed Transactions (`useTransaction`)

When performing multi-step transactional operations outside declarative `transaction: true` services:

```javascript
const { useTransaction, useDb } = require('webspresso');

const result = await useTransaction(async (trx) => {
  // Inside this block, useDb() automatically resolves to the transactional repository runner
  const db = useDb();
  await db.getRepository('Account').decrement('balance', 100);
  await db.getRepository('Ledger').create({ amount: 100, type: 'debit' });
  return { committed: true };
});
```

---

## 5. Background Jobs & CLI Commands Integration

When executing background jobs (`jobs/`) or CLI tasks, wrap executions with `runWithContext` or `withContext` to seed ambient dependencies:

```javascript
const { runWithContext, useDb, useService } = require('webspresso');

async function processWorkerJob(job, app) {
  return await runWithContext({
    db: app.db,
    queue: app.queue,
    logger: app.logger,
  }, async () => {
    // Hooks are fully operational inside background job execution!
    return await useService('emails.sendWelcome', job.data);
  });
}
```
