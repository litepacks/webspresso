---
title: Admin Panel
description: Customize the Mithril.js admin SPA with modules, field renderers, widgets, and custom pages.
---

# Admin Panel Customization Guide

> **Goal:** Extend Webspresso's Mithril.js Admin Panel SPA with custom pages, widgets, custom field renderers, and actions.

---

## 1. Enabling the Admin Panel

Register `adminPanelPlugin` in your `server.js`:

```javascript
const { createApp, createDatabase, adminPanelPlugin } = require('webspresso');

const db = createDatabase(require('./webspresso.db'));

const { app } = createApp({
  db,
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  plugins: [
    adminPanelPlugin({
      db,
      path: '/_admin', // Mount path
      title: 'Company Admin Portal',
      auth: {
        sessionSecret: process.env.ADMIN_SESSION_SECRET,
      },
    }),
  ],
});
```

Access the panel at **`http://localhost:7331/_admin`**.

---

## 2. Registering Custom Admin Pages

To add custom dashboard tools or reports, use `adminApi.registerPage`:

```javascript
// plugins/custom-analytics.js
module.exports = {
  name: 'custom-analytics',
  register(ctx) {
    const adminApi = ctx.getPluginAPI('admin');
    if (!adminApi) return;

    adminApi.registerPage('analytics', {
      title: 'Live Analytics',
      icon: 'chart-bar',
      category: 'Reports',
      // Clean standalone Mithril component
      componentFile: path.join(__dirname, 'admin-pages/analytics.js'),
      // Automatically wraps in Admin Layout & Breadcrumb container
      layout: true,
    });
  },
};
```

### Authoring the Mithril Component

Create the component in a clean standalone `.js` file:

```javascript
// plugins/custom-analytics/admin-pages/analytics.js
/* global m */
export default {
  oninit(vnode) {
    vnode.state.metrics = null;
    m.request({ method: 'GET', url: '/_admin/api/analytics/summary' })
      .then((data) => {
        vnode.state.metrics = data;
      });
  },

  view(vnode) {
    const { metrics } = vnode.state;
    if (!metrics) return m('div.p-8.text-slate-400', 'Loading metrics...');

    return m('div.space-y-6', [
      m('h2.text-2xl.font-bold', 'Realtime System Traffic'),
      m('div.grid.grid-cols-3.gap-4', [
        m('div.p-4.bg-white.dark:bg-slate-800.rounded.shadow', [
          m('div.text-sm.text-slate-500', 'Active Users'),
          m('div.text-3xl.font-bold', metrics.activeUsers),
        ]),
        m('div.p-4.bg-white.dark:bg-slate-800.rounded.shadow', [
          m('div.text-sm.text-slate-500', 'Requests / min'),
          m('div.text-3xl.font-bold', metrics.rpm),
        ]),
      ]),
    ]);
  },
};
```

---

## 3. Registering Dashboard Widgets

Add custom KPI cards or charts to the admin home dashboard:

```javascript
adminApi.registerWidget('server-health', {
  title: 'Server Health',
  component: {
    view: () => m('div.p-4.bg-emerald-50.rounded', 'All systems operational (100% uptime)'),
  },
  order: 1,
});
```

---

## 4. Custom Field Renderers

Register custom display and editor components for specific field types:

```javascript
adminApi.registerFieldRenderer('color-picker', {
  display: (val) => m('span.inline-block.w-4.h-4.rounded-full', { style: { backgroundColor: val } }),
  edit: (val, onChange) => m('input[type=color]', {
    value: val,
    oninput: (e) => onChange(e.target.value),
  }),
});
```

---

## 5. Media Library & File Manager

Webspresso comes with a fully-featured Media Library powered by `fileManagerPlugin({ baseDir: './public/uploads' })`:

- **Admin Route:** Available at `/_admin#!/files` with Grid and List views.
- **Image Editing:** Built-in HTML5 Canvas crop presets (1:1, 16:9, 4:3), 90° rotate, flip, resize, and WebP export.
- **Code & Text Editing:** In-browser modal editor with line numbers and JSON formatting.
- **Bulk Operations:** Multi-select files and download them as a native zero-dependency PKWARE ZIP archive.
- **Storage Quota:** Live storage meter with 6-category size breakdown and warning badges.
- **Asset Picker:** Integrates with `zdb.file({ admin: { picker: true } })` so staff can choose existing files directly in model forms.

👉 *For full details and visual previews, see the [File Manager & Media Library Guide](/guides/file-manager).*

