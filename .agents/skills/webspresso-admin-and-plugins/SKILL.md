---
name: webspresso-admin-and-plugins
description: >-
  Extend the Mithril.js Admin Panel SPA and configure official plugins in Webspresso.
  Use when creating custom admin pages (component.js, page.json), custom field renderers,
  dashboard widgets, actions, or configuring plugins like fileManager, xlsx, csv, polar, realtime, csrf, cors, and basicAuth.
---

# Webspresso Admin Panel & Plugins Skill

The Admin Panel is a modular Mithril.js SPA mounted at `/_admin` powered by `adminPanelPlugin({ db })`.

---

## 1. Custom Admin Pages (`pagesDir` or `registerPageDir`)

Folder structure for auto-discovered admin pages:
```text
admin/pages/
└── system-stats/
    ├── page.json
    └── component.js
```

### `page.json`
```json
{
  "id": "system-stats",
  "label": "System Statistics",
  "icon": "activity",
  "order": 10,
  "layout": true,
  "permission": "admin"
}
```

### `component.js` (Clean Mithril Component)
```javascript
module.exports = {
  oninit(vnode) {
    vnode.state.stats = null;
    vnode.state.loading = true;
    m.request({ method: 'GET', url: '/_admin/api/custom/stats' }).then((res) => {
      vnode.state.stats = res;
      vnode.state.loading = false;
    });
  },
  view(vnode) {
    if (vnode.state.loading) return m('.p-6', 'Loading stats...');
    return m('.space-y-4', [
      m('h2.text-xl.font-bold', 'System Overview'),
      m('.grid.grid-cols-3.gap-4', [
        m('.card.p-4.border.rounded', [
          m('.text-sm.text-gray-500', 'Total Users'),
          m('.text-2xl.font-semibold', vnode.state.stats.usersCount),
        ]),
      ]),
    ]);
  },
};
```

---

## 2. Admin Panel Extension Points

```javascript
// Register custom widget in dashboard
registry.registerWidget('recent-signups', {
  label: 'Recent Signups',
  component: require('./widgets/recent-signups'),
  width: 'half', // 'full' | 'half' | 'third'
});

// Register single record action button
registry.registerAction('User', {
  name: 'impersonate',
  label: 'Impersonate',
  icon: 'user-check',
  handler: async (record) => { ... },
});

// Register custom field display/edit renderer
registry.registerFieldRenderer('color-picker', {
  display: (val) => m('.w-6.h-6.rounded', { style: { backgroundColor: val } }),
  edit: (val, onChange) => m('input[type=color]', { value: val, onchange: (e) => onChange(e.target.value) }),
});
```

---

## 3. Official Plugin Catalog & Usage

In `createApp({ plugins: [...] })`:

```javascript
const {
  adminPanelPlugin,
  fileManagerPlugin,
  xlsxPlugin,
  csvPlugin,
  basicAuthPlugin,
  corsPlugin,
  csrfPlugin,
  realtimePlugin,
  polarPlugin,
} = require('webspresso/plugins');

createApp({
  plugins: [
    adminPanelPlugin({ db }),
    fileManagerPlugin({ baseDir: './public/uploads', publicBasePath: '/uploads' }),
    xlsxPlugin(),
    csvPlugin(),
    basicAuthPlugin({ users: { admin: process.env.ADMIN_BASIC_AUTH_PASS }, routes: ['/metrics'] }),
    corsPlugin({ origin: ['https://example.com'], credentials: true }),
    csrfPlugin({ cookie: true }),
    realtimePlugin({ adapter: 'websocket' }),
    polarPlugin({ apiKey: process.env.POLAR_ACCESS_TOKEN }),
  ],
});
```
