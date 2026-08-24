# Webspresso Realtime Layer & Adapters Guide

[← Back to AGENTS.md](.agents/AGENTS.md)

Webspresso features a framework-agnostic, plugin-based, adapter-driven Realtime layer (`core/realtime`) designed for universal browser execution with zero SSR hazards.

---

## 1. Architectural Overview

```text
Webspresso App / Client
   │
   ├── AuthManager (Token / Cookie / Custom / None)
   ├── SubscriptionRegistry (identifier::params composite identity)
   ├── ReconnectManager (exponential backoff + jitter)
   │
   └── Realtime Core
           │
           ├── Generic WebSocket Adapter (`core/realtime/adapters/websocket`)
           ├── SSE Adapter (`core/realtime/adapters/sse`)
           └── Socket.IO Adapter (`core/realtime/adapters/socket-io`)
```

### Core Tenets:
1. **Zero SSR Network Hazards**: Server-side rendering execution never attempts socket connections or touches browser globals.
2. **Unified Subscription Model**: All realtime technologies share identical public subscription interfaces (`subscribe`, `send`, `perform`, `unsubscribe`).
3. **Deterministic Subscription Registry**: Subscriptions with identical identifiers and query parameters share channel instances without duplication.
4. **Secret Sanitization**: Auth tokens and credentials are automatically stripped from error logs (`token=***`).

---

## 2. Core API Reference

### 2.1 Factory Functions (`core/realtime`, `plugins/realtime`)
```js
const { createRealtime, realtime, realtimePlugin } = require('webspresso');
// Or via plugins
const { realtimePlugin, websocket, sse, socketIo } = require('webspresso/plugins');
```

- `createRealtime(options)`: Creates a standalone `RealtimeClient`.
- `realtime(options)`: Universal helper returning `RealtimeClient` with `.plugin` property attached.
- `realtimePlugin(options)`: Webspresso plugin mounting `app.realtime` and handling shutdown disposers.

### 2.2 Options Configuration
| Option | Type | Default | Description |
|---|---|---|---|
| `adapter` | `RealtimeAdapter` | **Required** | Transport adapter (`websocket()`, `sse()`, `socketIo()`). |
| `auth` | `Object` \| `false` | `false` | Strategy config: `{ strategy: 'token'|'cookie'|'custom' }`. |
| `autoConnect` | `boolean` | `true` | Automatically connect when browser environment is ready. |
| `reconnect` | `Object` | `{ enabled: true }` | Backoff settings (`baseDelay`, `maxDelay`, `factor`, `jitter`). |
| `isBrowser` | `boolean` | `null` | Force browser mode (testing override). |

---

## 3. Adapters

### 3.1 Generic WebSocket Adapter (`websocket`)
```js
const { websocket } = require('webspresso');

const adapter = websocket({
  url: 'wss://api.example.com/realtime', // string or async (ctx) => url
  authTransport: 'query', // 'query' | 'header' | 'protocol' | 'message'
  queryParamName: 'token',
  messages: {
    subscribe: ({ identifier, params }) => ({ type: 'subscribe', identifier, params }),
    send: ({ identifier, data }) => ({ type: 'message', identifier, data }),
    perform: ({ identifier, action, data }) => ({ type: 'perform', identifier, action, data }),
  },
});
```

### 3.2 Server-Sent Events (SSE) Adapter (`sse`)
```js
const { sse } = require('webspresso');

const adapter = sse({
  url: '/api/realtime/events',
  queryParamName: 'token',
});
```
*Note: SSE adapter is unidirectional and read-only. Calling `sub.send()` or `sub.perform()` will throw a clear `UNSUPPORTED_CAPABILITY` error.*

### 3.3 Socket.IO Adapter (`socketIo`)
```js
const { socketIo } = require('webspresso');

const adapter = socketIo({
  url: 'https://socket.example.com',
  path: '/socket.io',
  socketOptions: { transports: ['websocket'] },
});
```

---

## 4. Usage Recipes

### 4.1 Webspresso Plugin Integration
```js
const { createApp } = require('webspresso');
const { realtimePlugin, websocket } = require('webspresso/plugins');

const { app } = createApp({
  plugins: [
    realtimePlugin({
      adapter: websocket({ url: '/realtime' }),
      auth: { strategy: 'cookie' },
      autoConnect: true,
    }),
  ],
});
```

### 4.2 Token Authentication & Automatic Refresh
```js
const { realtime, websocket } = require('webspresso');

const client = realtime({
  adapter: websocket({ url: 'wss://api.example.com/realtime' }),
  auth: {
    strategy: 'token',
    getToken: async () => localStorage.getItem('jwt_token'),
    refreshToken: async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      const { token } = await res.json();
      localStorage.setItem('jwt_token', token);
      return token;
    },
    onUnauthorized: (err) => {
      window.location.href = '/login';
    },
  },
});
```

### 4.3 Subscriptions & Remote Actions
```js
// Subscribe to channel
const sub = app.realtime.subscribe('project:123', { role: 'editor' }, {
  connected() {
    console.log('Connected to project:123 channel');
  },
  disconnected() {
    console.log('Temporarily disconnected');
  },
  received(data) {
    console.log('New event:', data);
  },
  rejected(error) {
    console.error('Subscription rejected:', error);
  },
});

// Send raw message
sub.send({ text: 'Hello!' });

// Perform named action (RPC)
sub.perform('cursor_move', { x: 120, y: 340 });

// Unsubscribe
sub.unsubscribe();
```

### 4.4 Re-authentication Workflow
```js
// Refresh credentials and restore all active subscriptions seamlessly
await app.realtime.reauthenticate();
```
