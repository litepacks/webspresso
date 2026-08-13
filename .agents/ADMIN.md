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

Custom Admin pages are defined as clean, standalone Mithril.js component files (`component.js`):

```js
const { registry } = adminPanelPlugin({ db });

registry.registerModule('analytics-report', {
  label: 'Analytics Report',
  icon: '📊',
  category: 'Reports',
  componentFile: path.join(__dirname, 'admin-pages/analytics/component.js'),
  layout: true, // Auto-wrap inside Admin layout header & sidebar (set false for full-screen view)
});
```

### Automatic Directory Discovery (`registerPageDir`)
Directories containing page folders with `page.json` and `component.js` are auto-discovered:

```text
admin-pages/
└── analytics/
    ├── page.json    # { "id": "analytics", "label": "Analytics", "icon": "📊", "layout": true }
    └── component.js # clean Mithril component (export default { view() { return m('div', 'Content'); } })
```

```js
registry.registerPageDir(path.join(__dirname, 'admin-pages'));
```

---

## 5. Custom Field Renderers (`registerFieldRenderer`)

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

## 6. Dashboard Widgets (`registerWidget`)

Register dashboard widgets for the Admin overview screen:

```js
registry.registerWidget('recent-orders', {
  title: 'Recent Orders',
  width: 'half', // 'full' | 'half' | 'third'
  componentFile: path.join(__dirname, 'widgets/recent-orders.js'),
});
```

---

## 7. Single Record & Bulk Table Actions

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

## 8. Client Components & Custom Client Script Injections

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
