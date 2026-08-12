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
      const { app, nunjucksEnv, options: appOptions } = ctx;
      // Add Nunjucks filters or global middleware
      nunjucksEnv.addFilter('customFilter', (str) => str.toUpperCase());
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

---

## 2. Core & Official Plugins Reference

### 2.1 `adminPanelPlugin` (`plugins/admin-panel`)
Mithril.js SPA Admin Panel mounted at `/_admin`.
- **Options**: `{ path: '/_admin', db, title: 'Webspresso Admin' }`
- **Features**: Auto CRUD screens for ORM models, user staff auth, custom page registration, widgets, field renderers.

### 2.2 `contentPlugin` (`plugins/content`)
Schema-driven headless CMS & inline content editing.
- **Options**: `{ db, adminPath: '/_admin', inlineEdit: true }`
- **Features**: Dynamic content types & entries, public API (`/api/content/:type/:slug`), visual inline editor widget.

### 2.3 `uploadPlugin` (`plugins/upload`)
Multipart file upload manager with local / cloud storage providers.
- **Options**: `{ path: '/api/upload', local: { destDir, publicBasePath }, maxBytes: 10000000, mimeAllowlist: ['image/png', 'image/jpeg'] }`
- **Features**: Single & multi-file uploads, file size & extension validation, storage drivers.

### 2.4 `corsPlugin` (`plugins/cors`)
Zero-dependency Cross-Origin Resource Sharing (CORS) handler.
- **Options**: `{ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], credentials: true, maxAge: 86400 }`
- **Features**: Native header management, preflight OPTIONS handling.

### 2.5 `csrfPlugin` (`plugins/csrf`)
Cross-Site Request Forgery token validation.
- **Options**: `{ mode: 'session', secret: 'csrf-secret', ignorePaths: ['/api/*'] }`

### 2.6 `redirectPlugin` (`plugins/redirect`)
HTTP 301–308 URL redirect manager.
- **Options**: `{ rules: [{ from: '/old-path', to: '/new-path', status: 301 }] }`

### 2.7 `rateLimitPlugin` (`plugins/rate-limit`)
Request rate limiting using express-rate-limit logic.
- **Options**: `{ windowMs: 15 * 60 * 1000, max: 100 }`

### 2.8 `siteAnalyticsPlugin` (`plugins/site-analytics`)
Self-hosted privacy-focused page view analytics and client error tracking.
- **Options**: `{ path: '/_analytics', db }`

### 2.9 `emailPlugin` (`plugins/email`)
Transactional email compiler (MJML) & Nodemailer transport integration.
- **Options**: `{ transport, from: 'noreply@example.com', templatesDir }`

### 2.10 `auditLogPlugin` (`plugins/audit-log`)
Admin mutation tracking and audit log audit history.
- **Options**: `{ db, retainDays: 90 }`

### 2.11 `ormCacheAdminPlugin` (`plugins/orm-cache-admin`)
ORM Cache inspection and invalidation dashboard.

### 2.12 `schemaExplorerPlugin` (`plugins/schema-explorer`)
Interactive JSON schema & OpenAPI route specification generator.

### 2.13 `swaggerPlugin` (`plugins/swagger`)
Interactive OpenAPI 3.0 Swagger UI documentation.
