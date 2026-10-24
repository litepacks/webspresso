# Webspresso Graceful Shutdown & Lifecycle Management Guide

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## 1. Overview & Architecture

Webspresso includes a framework-level lifecycle coordinator (`ShutdownManager`) and HTTP adapter (`NodeHttpAdapter`) designed to cleanly drain active requests, close keep-alive sockets, and execute reverse-order disposer functions during server termination (`SIGINT`, `SIGTERM`, or `app.close()`).

---

## 2. Configuration & Modes

Configured via `createApp({ server: { shutdown } })` or `shutdown`:

```js
const { app } = createApp({
  pagesDir: './pages',
  server: {
    shutdown: {
      enabled: true,         // Default: true
      mode: 'graceful',      // 'graceful' | 'force'
      timeout: 10_000,       // Max time in ms to wait for active requests (Default: 10000)
      signals: ['SIGINT', 'SIGTERM'],
      parallel: false,       // Set true to execute async disposers & hooks concurrently (Default: false)
      parallelDisposers: false, // Fine-grained control over plugin disposers
      parallelHooks: false,     // Fine-grained control over app.onShutdown hooks
    },
  },
});
```

### Shutdown Modes:
- **`graceful` (Default)**: Rejects new connections, drains active in-flight requests, and closes idle/keep-alive connections.
- **`force`**: Immediately destroys all active and idle sockets (`forceClose`). Recommended for rapid development/watch server reloads to avoid port lock.

### Concurrency & Performance:
- **Synchronous Fast-Path**: Synchronous disposers and shutdown hooks execute immediately without creating timers or `Promise.race` wrappers, eliminating microtask delays and timer allocations during exit.
- **Parallel Mode (`parallel: true`)**: When enabled, asynchronous plugin disposers and hooks are initiated in reverse registration order and awaited concurrently via `Promise.allSettled`, drastically reducing shutdown latency for apps with multiple independent resources (DB, Redis, SQS, WebSockets).

---

## 3. Application Lifecycle Hooks

```js
// Register cleanup hook
app.onShutdown(async () => {
  await db.destroy();
  await redis.quit();
});

// Manual close (does not call process.exit())
await app.close('Maintenance');
```

---

## 4. Plugin Disposer Lifecycle

Plugins can return a disposer function from `register(ctx)` or implement `shutdown()` / `dispose()` methods:

```js
const customPlugin = {
  name: 'my-worker',
  register(ctx) {
    const worker = startWorker();
    return async () => {
      await worker.stop();
    };
  },
};
```
During shutdown, plugin disposers are executed in **reverse dependency order** (`reverseDisposers`). When `parallel` is enabled, their initiation order is strictly preserved while awaiting resolution concurrently.
