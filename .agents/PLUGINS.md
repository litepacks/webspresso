# Webspresso Plugin Ecosystem Guide

Webspresso applications are extended through a modular plugin architecture. Plugins hook into framework lifecycle events (`register(ctx)`, `onRoutesReady(ctx)`), mount Express routes, register Nunjucks template helpers, and supply Content-Security-Policy (CSP) headers.

---

## 1. Plugin Lifecycle & Anatomy

A Webspresso plugin is an object or factory function returning a plugin contract:

```js
export function myCustomPlugin(options = {}) {
  return {
    name: 'my-custom-plugin',
    version: '1.0.0',
    dependencies: [], // Optional dependent plugins
    csp: {
      scriptSrc: ["'self'", 'https://cdn.example.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },

    // 1. Register phase (before route mounting)
    register(ctx) {
      const { app, nunjucksEnv, options: appOptions, middlewares } = ctx;
      // Add Nunjucks filters or global middleware
      nunjucksEnv.addFilter('customFilter', (str) => str.toUpperCase());

      // Register named middleware for file routes: export const config = { middleware: ['myCustom'] }
      if (middlewares) {
        middlewares.myCustom = (routeOptions = {}) => (req, res, next) => {
          // Middleware logic...
          next();
        };
      }
    },

    // 2. On routes ready phase (after file-based routes mounted)
    onRoutesReady(ctx) {
      const { app, routes, db } = ctx;
      // Mount plugin-level Express routes
      app.get('/_my-plugin/status', (req, res) => res.json({ status: 'ok' }));
    },
  };
}
```

### 1.1 Named Middleware Registration via Plugins
Plugins can register route middlewares in `ctx.middlewares`:
- **Factory Registration**: `ctx.middlewares.basicAuth = (routeOpts) => createBasicAuthMiddleware(routeOpts)`
- **File Route Consumption**:
  ```js
  // pages/admin-only.njk or pages/api/secret.js
  export const config = {
    middleware: [
      'basicAuth', // Uses plugin defaults
      // or with options:
      ['basicAuth', { realm: 'Internal Area', users: { boss: 'secret' } }]
    ]
  };
  ```

---

## 2. Core & Official Plugins Reference

### 2.1 `basicAuthPlugin` (`plugins/basic-auth`)
Zero-dependency HTTP Basic Authentication (RFC 7617) plugin with timing-safe equality checks (`crypto.timingSafeEqual`).
- **Options**:
  - `global`: Boolean, whether to protect the entire application.
  - `users`: Key-value map `{ username: 'password' }`.
  - `verify`: Async/sync custom verification function `(username, password, req) => boolean | userObject`.
  - `realm`: String for `WWW-Authenticate` header (default `'Restricted Area'`).
  - `challenge`: Boolean (default `true`), whether to send 401 challenge header.
  - `routes`: Array of route prefixes to protect when in global mode.
  - `skipPaths` / `skip`: Exclusion paths or predicate `(req) => boolean`.
  - `unauthorizedResponse`: Custom handler `(req, res) => ...` or message string/JSON.
  - `onAuthenticated`: Callback hook `(req, user) => ...`.
- **Named Middleware**: Registers `ctx.middlewares.basicAuth` for route files.

### 2.2 `adminPanelPlugin` (`plugins/admin-panel`)
Mithril.js SPA Admin Panel mounted at `/_admin`.
- **Options**: `{ path: '/_admin', db, title: 'Webspresso Admin' }`
- **Features**: Auto CRUD screens for ORM models, user staff auth, custom page registration, widgets, field renderers.

### 2.3 `contentPlugin` (`plugins/content`)
Schema-driven headless CMS & inline content editing.
- **Options**: `{ db, adminPath: '/_admin', inlineEdit: true }`
- **Features**: Dynamic content types & entries, public API (`/api/content/:type/:slug`), visual inline editor widget.

### 2.4 `uploadPlugin` (`plugins/upload`)
Multipart file upload manager with local / cloud storage providers.
- **Options**: `{ path: '/api/upload', local: { destDir, publicBasePath }, maxBytes: 10000000, mimeAllowlist: ['image/png', 'image/jpeg'] }`
- **Features**: Single & multi-file uploads, file size & extension validation, storage drivers.

### 2.5 `corsPlugin` (`plugins/cors`)
Zero-dependency Cross-Origin Resource Sharing (CORS) handler.
- **Options**: `{ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], credentials: true, maxAge: 86400 }`
- **Features**: Native header management, preflight OPTIONS handling.

### 2.6 `csrfPlugin` (`plugins/csrf`)
Cross-Site Request Forgery token validation.
- **Options**: `{ mode: 'session', secret: 'csrf-secret', ignorePaths: ['/api/*'] }`

### 2.7 `redirectPlugin` (`plugins/redirect`)
HTTP 301–308 URL redirect manager.
- **Options**: `{ rules: [{ from: '/old-path', to: '/new-path', status: 301 }] }`

### 2.8 `rateLimitPlugin` (`plugins/rate-limit`)
Request rate limiting using express-rate-limit logic.
- **Options**: `{ windowMs: 15 * 60 * 1000, max: 100 }`

### 2.9 `siteAnalyticsPlugin` (`plugins/site-analytics`)
Self-hosted privacy-focused page view analytics and client error tracking.
- **Options**: `{ path: '/_analytics', db }`

### 2.10 `emailPlugin` (`plugins/email`)
Transactional email compiler (MJML) & Nodemailer transport integration.
- **Options**: `{ transport, from: 'noreply@example.com', templatesDir }`

### 2.11 `auditLogPlugin` (`plugins/audit-log`)
Admin mutation tracking and audit log audit history.
- **Options**: `{ db, retainDays: 90 }`

### 2.12 `ormCacheAdminPlugin` (`plugins/orm-cache-admin`)
ORM Cache inspection and invalidation dashboard.

### 2.13 `schemaExplorerPlugin` (`plugins/schema-explorer`)
Interactive JSON schema & OpenAPI route specification generator.

### 2.14 `swaggerPlugin` (`plugins/swagger`)
Interactive OpenAPI 3.0 Swagger UI documentation.

### 2.15 `realtimePlugin` (`plugins/realtime`, `core/realtime`)
Framework-agnostic, plugin-based, and adapter-driven Realtime layer supporting WebSocket, SSE, and Socket.IO transports with zero SSR execution hazards.

- **Architecture**:
  - `core/realtime`: Connection lifecycle, subscription registry (`identifier::params` composite keys), auth strategies, exponential backoff reconnect with jitter, and capability assertions.
  - `core/realtime/adapters`: `websocket`, `sse`, `socketIo`.
  - `plugins/realtime`: Webspresso app integration and shutdown lifecycle management.

- **Examples**:

#### 1. Basic (WebSocket + Cookie Auth)
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

#### 2. Token Auth & Refresh
```js
const { realtime, websocket } = require('webspresso');

const client = realtime({
  adapter: websocket({ url: 'wss://api.example.com/realtime' }),
  auth: {
    strategy: 'token',
    getToken: async () => localStorage.getItem('token'),
    refreshToken: async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      const { token } = await res.json();
      localStorage.setItem('token', token);
      return token;
    },
    onUnauthorized: (err) => {
      window.location.href = '/login';
    },
  },
});
```

#### 3. Subscriptions & Messages
```js
const sub = app.realtime.subscribe('project:123', { role: 'editor' }, {
  connected() {
    console.log('Subscribed to project:123');
  },
  disconnected() {
    console.log('Temporarily disconnected');
  },
  received(data) {
    console.log('New update received:', data);
  },
  rejected(err) {
    console.error('Subscription denied:', err);
  },
});
```

#### 4. Perform Action & Send Data
```js
// Send raw data
sub.send({ text: 'Hello team!' });

// Perform named RPC action
sub.perform('user_typing', { userId: 42, isTyping: true });
```

#### 5. Cleanup & Unsubscribe
```js
// Unsubscribe single topic
sub.unsubscribe();

// Destroy entire realtime client and teardown socket connections
app.realtime.destroy();
```

#### 6. Reauthenticate Workflow
```js
// Trigger token refresh, disconnect, reconnect, and automatic subscription restore
await app.realtime.reauthenticate();
```

#### 7. Custom Adapter Implementation
```js
const myCustomAdapter = {
  capabilities: { send: true, perform: true, multiplexing: true },
  async connect({ auth, client }) {
    // initialize connection with auth
  },
  disconnect() {
    // teardown
  },
  isConnected() {
    return true;
  },
  subscribe(identifier, params, callbacks) {
    // subscribe to remote channel and invoke callbacks.received(data)
    return {
      send: (data) => { /* ... */ },
      perform: (action, data) => { /* ... */ },
      unsubscribe: () => { /* ... */ },
    };
  },
};
```
