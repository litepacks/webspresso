# Mithril.js Admin Panel Customization & Extension Guide

Webspresso includes a customizable, zero-build Mithril.js Single Page Application (SPA) Admin Panel (`plugins/admin-panel`). It provides automatic CRUD interfaces for ORM models and supports extension points for custom pages, widgets, custom field renderers, actions, and client-side component injections.

---

## 1. Architecture & Session Isolation

The Admin Panel operates as a self-contained Mithril.js SPA mounted at `/_admin`.

- **Isolated Auth Session**: Admin staff authentication uses a dedicated session key (`req.session.adminUser`), isolated from public site user sessions (`req.user`).
- **Auth Endpoints**:
  - `POST /_admin/api/auth/setup` — Initial staff account setup (disabled once first admin exists).
  - `POST /_admin/api/auth/login` — Staff authentication.
  - `POST /_admin/api/auth/logout` — Terminate admin session.
  - `GET /_admin/api/auth/me` — Current authenticated staff user details.
  - `GET /_admin/api/auth/check` — Check if admin setup is required.

---

## 2. Model Admin Metadata (`defineModel`)

Configure model behavior in the Admin Panel using the `admin` property when calling `defineModel`:

```js
import { defineModel, zdb } from 'webspresso';

export default defineModel({
  name: 'Product',
  table: 'products',
  schema: zdb.schema({
    id: zdb.id(),
    name: zdb.string(),
    slug: zdb.string(),
    price: zdb.number(),
    status: zdb.string({ default: 'active' }),
  }),
  admin: {
    enabled: true,           // Expose in Admin navigation
    label: 'Products',       // Display label
    icon: '📦',             // Navigation icon
    displayField: 'name',    // Field used for title/representation
    searchFields: ['name', 'slug'], // Fields searched by table search input
    filterable: ['status'],  // Column filters enabled in table header
    defaultSort: { column: 'id', order: 'desc' },
    sortableColumns: ['name', 'price'], // Optional whitelist of sortable columns
    sortable: true,          // Set false to disable table sorting completely
    readOnly: false,         // Disable create/edit/delete actions
  },
});
```

### 3-State Table Column Sorting
Table column headers support interactive 3-state cycling:
1. `Unsorted` (default, `↕` icon)
2. `ASC` (1st click, `▲` icon)
3. `DESC` (2nd click, `▼` icon)
4. `Unsorted` (3rd click, reverts to default primary key order)

Column sortability can be configured per-column:
- `zdb.string({ sortable: true })` / `zdb.text({ sortable: false })`
- `zdb.string().config({ sortable: false })`

---

## 3. Admin REST API (`/_admin/api/*`)

The Admin SPA communicates with the backend via JSON REST endpoints:

- `GET /_admin/api/models` — List all models exposed to admin with schemas & metadata.
- `GET /_admin/api/models/:modelName/records` — List paginated records (query params: `page`, `limit`, `search`, `filter`, `sort`).
- `GET /_admin/api/models/:modelName/records/:id` — Retrieve single record details.
- `POST /_admin/api/models/:modelName/records` — Create new record.
- `PUT /_admin/api/models/:modelName/records/:id` — Update existing record.
- `DELETE /_admin/api/models/:modelName/records/:id` — Delete record (soft or hard delete).
- `POST /_admin/api/models/:modelName/records/:id/restore` — Restore soft-deleted record.

---

## 4. Custom Pages (`registerModule` / `registerPageDir`)

Custom Admin pages support:
1. **Clean Mithril.js Component Files** (`componentFile` / `component`)
2. **Native Custom HTML Pages** (`html` / `htmlFile`) — e.g. EUIX Engine, Vue, Alpine apps rendered directly in the DOM with full Tailwind CSS styling.
3. **External URL Pages** (`url` / `iframeUrl`) — Embedded in clean `<iframe>` containers.

```js
const { registry } = adminPanelPlugin({ db });

// Example 1: Mithril Component
registry.registerModule('analytics-report', {
  label: 'Analytics Report',
  icon: '📊',
  category: 'Reports',
  componentFile: path.join(__dirname, 'admin-pages/analytics/component.js'),
  layout: true, // Auto-wrap inside Admin layout header & sidebar (set false for full-screen view)
});

// Example 2: EUIX Engine / Native HTML Page
registry.registerModule('euix-module', {
  id: 'euix-module',
  scripts: ['https://unpkg.com/euixjs@latest/dist/EUIXEngine.umd.js'],
  pages: [
    {
      id: 'euix-counter',
      title: 'EUIX Counter',
      path: '/euix-counter',
      htmlFile: path.join(__dirname, 'admin-pages/euix-counter.html') // Rendered directly into DOM with Tailwind & scripts
    }
  ],
  menu: [
    { id: 'euix-counter', label: 'EUIX Counter', path: '/euix-counter', icon: 'zap' }
  ]
});
```

### Automatic Directory Discovery (`registerPageDir`)
Directories containing page folders with `page.json` and `component.js` (or `index.html`) are auto-discovered:

```text
admin-pages/
├── analytics/
│   ├── page.json    # { "id": "analytics", "label": "Analytics", "icon": "📊", "layout": true }
│   └── component.js # clean Mithril component (export default { view() { return m('div', 'Content'); } })
└── custom-tool/
    ├── page.json    # { "id": "custom-tool", "label": "Custom Tool", "icon": "⚡" }
    └── index.html   # Native HTML file
```

```js
registry.registerPageDir(path.join(__dirname, 'admin-pages'));
```

---

## 5. Page & Plugin Title Management

Admin Panel supports configurable base titles, title templates, and dynamic SPA page titles:

### Plugin Configuration
```js
adminPanelPlugin({
  db,
  title: 'Acme Admin',           // Base title in <title> and header (default: 'Admin Panel')
  titleTemplate: '%s | %b',      // Format template: %s = page title, %b = base title (default: '%s | %b')
});
```

### Module & Page Title Configuration
When registering modules and custom pages, titles are automatically propagated to navigation and browser document title:
```js
adminApi.registerModule({
  id: 'reports',
  title: 'Reports & Analytics',   // Module fallback title
  pages: [
    {
      id: 'monthly-report',
      title: 'Monthly Report',    // Document title -> "Monthly Report | Acme Admin"
      path: '/reports/monthly',
      component: ...,
    },
    {
      id: 'live-dashboard',
      documentTitle: 'Live Monitor (Fullscreen)', // Raw document.title override
      path: '/reports/live',
      layout: false,
      component: ...,
    }
  ]
});
```

### Dynamic Client-Side Title Helper (`setAdminPageTitle`)
From any Mithril component or client script:
```js
// Dynamic title formatted with template (e.g. "Sales Overview | Acme Admin")
window.setAdminPageTitle('Sales Overview');

// Custom template override
window.setAdminPageTitle('Sales Overview', { template: '%s — %b' });

// Raw document title without template
window.setAdminPageTitle('Sales Overview', { raw: true });
```

---

## 6. Custom Field Renderers (`registerFieldRenderer`)

Register custom display and edit renderers for specific column types:

```js
registry.registerFieldRenderer('color-picker', {
  // 1. Table & detail view display
  display: (value) => m('span.color-badge', { style: { backgroundColor: value } }, value),
  
  // 2. Form input editor
  edit: (value, onChange, fieldConfig) => m('input[type=color]', {
    value: value || '#000000',
    oninput: (e) => onChange(e.target.value),
  }),
});
```

---

## 7. Dashboard Widgets (`registerWidget`)

Register dashboard widgets for the Admin overview screen:

```js
registry.registerWidget('recent-orders', {
  title: 'Recent Orders',
  width: 'half', // 'full' | 'half' | 'third'
  componentFile: path.join(__dirname, 'widgets/recent-orders.js'),
});
```

### Built-in Dashboard Widgets
- **`model-stats`**: Model overview cards displaying record counts, column counts, and last update timestamps.
- **`database-storage`**: Database Storage & Health monitor showing:
  - Database engine (SQLite, PostgreSQL, MySQL) & active file sizes
  - Total tables and total record counts across the schema
  - Storage health status badge with high-volume alerts for unpruned logs
  - Top tables by row count with visual progress percentage bars
  - Direct navigation links to model CRUD screens
- **`quick-actions`**: Fast shortcuts to create new records across enabled models.
- **`recent-activity`**: Timeline of recent administrative mutations (creates, updates, deletes) powered by `audit_logs` / `admin_activity_logs` with direct links to record changes.

---

## 8. Single Record & Bulk Table Actions

Add custom action buttons to model table views:

```js
// Single record button action
registry.registerAction('Product', {
  id: 'duplicate',
  label: 'Duplicate',
  icon: '📋',
  handler: async (record, { request, reload }) => {
    await request.post(`/api/products/${record.id}/duplicate`);
    reload();
  },
});

// Record action with navigation redirect (e.g. audit-timeline)
registry.registerAction('Product', {
  id: 'view-history',
  label: 'History',
  icon: 'clock',
  handler: async (record, model) => {
    return { redirect: `/_admin/audit-log?model=${model.name}&recordId=${record.id}` };
  },
});

// Bulk multi-select table action
registry.registerBulkAction('Product', {
  id: 'bulk-archive',
  label: 'Archive Selected',
  icon: '📦',
  handler: async (selectedIds, { request, reload }) => {
    await request.post('/api/products/bulk-archive', { ids: selectedIds });
    reload();
  },
});
```

---

## 9. Client Components & Custom Client Script Injections

Inject custom client-side JavaScript / Mithril components into the Admin SPA runtime:

```js
registry.registerClientComponent('custom-banner', `
  window.AdminRegistry.registerWidget('custom-banner', {
    title: 'Custom Banner',
    view: function() {
      return m('.banner', 'Welcome to Custom Admin!');
    }
  });
`);
```

---

## 10. Offline & Zero-CDN Architecture

The Admin Panel is 100% self-contained and operates completely offline without external CDN dependencies (`unpkg.com`, `cdn.jsdelivr.net`, or `cdn.tailwindcss.com`):
- **Vendored Static Assets (`plugins/admin-panel/vendor/`)**:
  - `mithril.min.js` — Client SPA runtime (~28 KB).
  - `tailwind.min.js` — Client utility compiler & style runtime (~412 KB).
  - `quill.min.js` & `quill.snow.min.css` — Rich-text WYSIWYG editor.
- **Local Asset Serving**: Served locally at `GET /_admin/vendor/:file` with proper MIME types, path traversal protections, and `Cache-Control: public, max-age=86400` caching.
- **Hardened CSP**: Works in air-gapped / intranet environments with strict `'self'` Content Security Policy without leaking third-party network requests.

---

## 11. Toast Notifications, Modal Confirmations & Session Expiry UX

The Admin SPA includes a built-in reactive notification and modal system that replaces intrusive browser `alert()` and `confirm()` dialogs.

### Toast Notifications (`window.notify`)
Display auto-dismissing, animated toasts in the top-right corner with pause-on-hover:

```js
// Available on window.notify or as global helpers: notifySuccess, notifyError, notifyWarning, notifyInfo
notify.success('Record created successfully');
notify.error('Failed to save record: Validation error');
notify.warning('Please review unsaved changes');
notify.info('Export started in the background');

// Custom duration (TTL in milliseconds, default 4000ms):
notify.success('Saved!', 2000);
```

### Confirmation Modal (`window.confirmModal` / `confirmAction`)
Display an accessible, styled modal dialog returning a Promise resolving to `true` or `false`:

```js
// Destructive confirmation (danger: true highlights the confirm button in red)
const confirmed = await confirmAction({
  title: 'Delete User',
  message: 'Are you sure you want to permanently delete this user?',
  confirmText: 'Delete',
  cancelText: 'Cancel',
  danger: true,
});

if (confirmed) {
  await api.delete(`/users/${id}`);
  notify.success('User deleted');
}
```

### Session Expiration & Intended Return-To Redirection
When an authenticated staff user's session expires or an API call returns `401 Unauthorized`:
1. `redirectToLogin('expired')` captures the active route and redirects to `/_admin/#!/login?returnTo=<route>&reason=expired`.
2. The login screen displays an informational notice banner: *"Your session has expired. Please sign in again."*
3. After authenticating successfully, the user is automatically redirected to their intended route.
4. **Open-Redirect Hardening**: All return destinations are strictly validated by `isSafeIntendedRoute(path)` to disallow protocol-relative URLs (`//evil.com`), foreign protocols (`http:`, `javascript:`), or backslashes.

---

## 12. Admin Login Brute-Force Protection & Rate Limiting

The Admin Panel includes built-in in-memory rate limiting to defend staff login endpoints against credential stuffing and brute-force password guessing.

### Configuration (`adminPanelPlugin`)

```js
import { createApp, adminPanelPlugin } from 'webspresso';

const app = createApp({
  plugins: [
    adminPanelPlugin({
      db,
      // Configure or disable login rate limiting:
      loginRateLimit: {
        enabled: true,                  // Default: true
        maxAttempts: 5,                 // Max failed attempts before blocking (default: 5)
        windowMs: 15 * 60 * 1000,       // Tracking window (default: 15 minutes)
        blockDurationMs: 15 * 60 * 1000 // Temporary block duration (default: 15 minutes)
      },
    }),
  ],
});
```

To disable rate limiting (e.g. in test or internal automated environments):
```js
adminPanelPlugin({ db, loginRateLimit: false });
```

### Protection Mechanics
- **IP Tracking**: Tracks failed attempts keyed by client IP (`req.ip` or upstream trusted proxy headers).
- **Automatic Block**: After `maxAttempts` failed logins within `windowMs`, returns HTTP 429 Too Many Requests with a `Retry-After: <seconds>` response header and JSON error payload.
- **Success Reset**: A single successful login clears the failed attempt counter for that IP.
- **Programmatic Reset**: Cleared automatically upon server restart or via `plugin.api.resetLoginAttempts(ip)`.


