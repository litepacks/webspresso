# Webspresso Events & Signals Architecture

[← Back to AGENTS.md](.agents/AGENTS.md)

Webspresso provides an enterprise, zero-dependency **Decoupled Event & Signals System** (`core/events`), combining **AdonisJS Events** (wildcard matching, async parallel/serial/waterfall dispatch, queue bridging, and listener auto-discovery) with **Django Signals** (declarative `Signal` channels, sender filtering, and ORM model signals).

---

## 1. Overview & Key Capabilities

- **Zero External Dependencies**: Built entirely with native Node.js standard modules (`events`, `path`, `fs`).
- **Synchronous & Asynchronous Emission**:
  - `events.emit(name, data)`: Fast sync/fire-and-forget dispatch.
  - `await events.emitAsync(name, data)`: Parallel concurrent execution (`Promise.allSettled`).
  - `await events.emitSerial(name, data)`: Sequential execution in priority order.
  - `await events.emitWaterfall(name, initialData)`: Sequential pipeline where output of listener $N$ feeds listener $N+1$.
- **Wildcard & Pattern Matching**:
  - `events.on('order.*', (data, meta) => ...)`
  - `events.on('system.**', (data, meta) => ...)`
  - `events.onAny((eventName, data, meta) => ...)`
- **Django-Style Signals & Sender Filtering**:
  - `const orderPlaced = defineSignal('order_placed')`
  - `orderPlaced.connect(receiver, { sender: 'Checkout' })`
  - `orderPlaced.send({ orderId: 101 }, { sender: 'Checkout' })`
- **Background Queue Bridging**:
  - `events.listenAndQueue('user.created', 'send-welcome-email', { delay: 1000 })`
  - Automatically bridges emitted events directly to Webspresso's job queue (`core/queue`).
- **ORM Model Signals Auto-Bridge**:
  - Automatically translates `ModelEvents` (`User.afterCreate`, `*.afterDelete`) to application events (`model:created`, `user:created`, `model:deleted`) with `sender: ctx.model`.
- **Automatic Request & Context Decoration**:
  - Injected onto `req.events` on every Express request.
  - Available inside `req.context.events` for services: `ctx.events.emit('order.created', order)`.
  - Accessible on `app.events` and plugin contexts.
- **Graceful Shutdown Integration**:
  - Cleaned up automatically on graceful shutdown via `ShutdownManager.onShutdown()`.

---

## 2. Using Events in API Routes & Services

### 2.1 Emitting Events in File-Based Routes (`pages/api/...`)

```javascript
// pages/api/orders.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      total: z.number().positive(),
      items: z.array(z.string()),
    }),
  }),
  async handler(req, res) {
    const order = await req.db.getRepository('Order').create(req.input.body);

    // Synchronous fire-and-forget or awaited async parallel
    req.events.emit('order.created', order, { sender: 'Order' });
    // or: await req.events.emitAsync('order.created', order);

    return res.status(201).json(order);
  },
});
```

### 2.2 Emitting Events inside Services (`services/...`)

```javascript
// services/order/checkout.js
const { defineService } = require('webspresso');

module.exports = defineService({
  transaction: true,
  async handle(input, ctx) {
    const order = await ctx.db.getRepository('Order').create(input);

    // ctx.events is automatically available
    ctx.events.emit('order.checkout.completed', { orderId: order.id, user: ctx.req?.user });

    return order;
  },
});
```

---

## 3. Registering Listeners

### 3.1 Programmatic Subscriptions

```javascript
const { events } = require('webspresso');

// 1. Basic Listener
const unsub = events.on('order.created', (order, meta) => {
  console.log(`Order ${order.id} received at ${meta.timestamp}`);
});

// 2. Wildcard Listener
events.on('order.*', (data, meta) => {
  console.log(`Order event ${meta.event} occurred`);
});

// 3. One-time Listener
events.once('app.ready', () => {
  console.log('Application initialized');
});

// 4. Priority Ordering (higher runs first)
events.on('user.login', auditLogin, { priority: 100 });
events.on('user.login', notifyFriends, { priority: 0 });
```

### 3.2 File-Based Discovery (`listeners/` directory)

Webspresso auto-discovers listeners in the `listeners/` root directory:

```javascript
// listeners/send-welcome-email.js
const { defineListener } = require('webspresso');

module.exports = defineListener('user.created', async (user, meta) => {
  console.log(`Sending welcome email to ${user.email}`);
});
```

Or multiple listeners in a single file:

```javascript
// listeners/audit-events.js
module.exports = [
  {
    event: 'order.*',
    priority: 50,
    handle: async (data, meta) => {
      console.log(`Audit: ${meta.event}`, data);
    },
  },
];
```

---

## 4. Django-Style Signals

For decoupled domain events with strict sender boundaries:

```javascript
const { defineSignal } = require('webspresso');

// Define signal
const invoicePaid = defineSignal('invoice_paid');

// Connect receiver with sender filter
invoicePaid.connect(
  (invoice) => {
    console.log(`Invoice ${invoice.id} processed for subscription`);
  },
  { sender: 'Subscription' }
);

// Trigger signal
invoicePaid.send({ id: 'INV-100' }, { sender: 'Subscription' });
```

---

## 5. Background Queue Bridging (`listenAndQueue`)

Connect application events directly to background jobs without manual boilerplate:

```javascript
// In plugin or server setup:
app.events.listenAndQueue('order.created', 'send-order-confirmation', {
  delay: 2000,
  attempts: 3,
});
```
When `order.created` is emitted, Webspresso automatically calls `req.queue.dispatch('send-order-confirmation', order, options)`.
