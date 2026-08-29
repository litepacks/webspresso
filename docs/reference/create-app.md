# `createApp(options)` API Reference

> **Module:** `webspresso`  
> **Signature:** `createApp(options: CreateAppOptions): CreateAppResult`  
> **TypeScript Definition:** [`index.d.ts`](../../index.d.ts#L25)

---

## 1. Parameters (`CreateAppOptions`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`pagesDir`** *(required)* | `string` | — | Absolute or relative path to the directory containing `.njk` page templates and `.js` route handlers. |
| **`viewsDir`** | `string` | `'views'` | Directory containing Nunjucks layouts and partials. |
| **`publicDir`** | `string \| false` | `'public'` | Directory for static asset serving. Set `false` to disable static serving. |
| **`db`** | `DatabaseInstance` | `null` | Knex database instance created via `createDatabase()`. |
| **`auth`** | `AuthManager` | `null` | Authentication manager created via `createAuth()`. |
| **`plugins`** | `Plugin[]` | `[]` | Array of Webspresso plugin instances (e.g. `adminPanelPlugin`, `corsPlugin`). |
| **`setupRoutes`** | `(app: Express) => void` | `null` | Callback hook to register custom Express routes before 404/500 handlers. |
| **`trustProxy`** | `boolean \| number \| string` | `undefined` | Express `trust proxy` setting (e.g. `1` for one reverse proxy hop). |
| **`pageAssets`** | `boolean \| PageAssetsOptions` | `false` | Automatic route-matching CSS and JS asset injection. |
| **`pageAssets.enabled`** | `boolean` | `false` | Enable automatic per-page asset resolution. |
| **`pageAssets.stylesheets`** | `boolean` | `true` | Auto-link `public/css/pages/<route>.css`. |
| **`pageAssets.scripts`** | `boolean` | `true` | Auto-link `public/js/pages/<route>.js`. |
| **`server.shutdown`** | `ShutdownOptions` | `{}` | Graceful shutdown and socket draining configuration. |
| **`server.shutdown.enabled`** | `boolean` | `true` | Enable SIGINT/SIGTERM lifecycle management. |
| **`server.shutdown.mode`** | `'graceful' \| 'force'` | `'graceful'` | Shutdown mode. `'graceful'` drains in-flight requests; `'force'` closes sockets immediately. |
| **`server.shutdown.timeout`** | `number` | `10000` | Milliseconds to wait before force closing remaining connections. |
| **`server.compression`** | `boolean` | `false` | Enable zero-dependency streaming zlib compression (Brotli, Gzip, Deflate). |
| **`assets`** | `AssetManagerOptions` | `{}` | Asset versioning, cache-busting, and CDN prefixing configuration. |
| **`assets.version`** | `string` | `undefined` | Query string version tag (e.g. `?v=1.2.3`). |
| **`assets.manifestPath`** | `string` | `undefined` | Absolute path to Vite/Webpack `.vite/manifest.json`. |
| **`assets.prefix`** | `string` | `''` | CDN URL prefix (e.g. `https://cdn.example.com`). |
| **`errorPages`** | `ErrorPagesOptions` | `{}` | Custom error and 404 template paths or handlers. |

---

## 2. Return Value (`CreateAppResult`)

`createApp()` returns an object containing initialized framework instances:

```typescript
interface CreateAppResult {
  app: WebspressoApplication;      // Configured Express 5 application instance
  nunjucksEnv: nunjucks.Environment; // Nunjucks environment instance
  pluginManager: PluginManager;   // Plugin manager registry
  authMiddleware: RequestHandler; // Session/Auth middleware
  shutdownManager: ShutdownManager; // Graceful shutdown manager
}
```

---

## 3. Properties on `app` (`WebspressoApplication`)

| Property / Method | Type | Description |
| :--- | :--- | :--- |
| **`app.serviceRegistry`** | `ServiceRegistry` | In-process business services registry. |
| **`app.close()`** | `() => Promise<void>` | Idempotent method to gracefully shut down the server and dispose all plugins. |
| **`app.setErrorHandler()`** | `(handler) => void` | Register a custom central error boundary handler. |
| **`app.locals.db`** | `DatabaseInstance` | Bound database instance. |
