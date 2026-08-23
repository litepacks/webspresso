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
    },
  },
});
```

### Shutdown Modes:
- **`graceful` (Default)**: Rejects new connections, drains active in-flight requests, and closes idle/keep-alive connections.
- **`force`**: Immediately destroys all active and idle sockets (`forceClose`). Recommended for rapid development/watch server reloads to avoid port lock.

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
During shutdown, plugin disposers are executed sequentially in **reverse dependency order**.
