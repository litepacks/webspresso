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
    fileManagerPlugin({
      baseDir: './public/uploads',
      publicBasePath: '/uploads',
      maxUploadBytes: 25 * 1024 * 1024,
      maxTotalStorageBytes: 1024 * 1024 * 1024, // 1 GB quota
      storageBreakdown: true,
    }),
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

---

## 4. File Manager & Media Library (`fileManagerPlugin`)

The File Manager mounts at `/_admin#!/files` and integrates into model forms via `zdb.file({ admin: { picker: true } })`.

### Core Features
- **In-Browser Image Editor:** HTML5 Canvas crop presets (`1:1`, `16:9`, `4:3`, `Free`), rotate 90°, flip, resize, and WebP export.
- **Code & Text Editor:** Syntax-aware modal editor with line numbers gutter and one-click JSON formatting/validation.
- **Drag-and-Drop Dropzone:** Backdrop-blur overlay on drag-over, real-time XHR upload progress bar, and cancellation support.
- **Batch Operations & Native ZIP:** Checkbox multi-selection, bulk move/delete, and native zero-dependency PKWARE ZIP archive download.
- **Keyboard Shortcuts:** Arrow keys navigation, `Space` Quick Look preview, `Enter`, `Cmd+A`, `X`, `R`, `E`, and `?` cheatsheet modal.
- **Storage Quota Visualizer:** 15-second TTL cached disk usage with multi-tier warning badges and 6-category breakdown (Images, Docs, Code, Media, Archives, Other).

### Programmatic Services
```javascript
// Get storage quota and breakdown
const stats = await ctx.service('fileManager.getStorageStats', { refresh: false });

// Generate native PKWARE ZIP archive on-the-fly
const zipBuffer = await ctx.service('fileManager.createZip', { paths: ['images/banner.png', 'docs/spec.pdf'] });

// Batch operations
await ctx.service('fileManager.batchMove', { paths: ['temp/a.txt', 'temp/b.txt'], targetDir: 'archive' });
await ctx.service('fileManager.batchDelete', { paths: ['temp/old.log'] });
```

