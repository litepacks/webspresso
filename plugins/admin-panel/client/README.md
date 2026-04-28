# Admin panel client (Mithril SPA)

The embedded admin SPA is **browser-side JavaScript** assembled from plain snippet files (`parts/*.js`) and inlined in `generateAdminPanelHtml()` in [`../index.js`](../index.js). It is **not** compiled by default so the framework install stays simple.

## Layout

| Path | Purpose |
|------|---------|
| [`manifest.parts.json`](./manifest.parts.json) | **Order matters**: concatenated top-to-bottom. |
| [`parts/*.js`](./parts/) | Raw script chunks (same content that used to live in a single `components.js` template). |
| [`load-parts.js`](./load-parts.js) | Node loader: reads manifest → single string consumed by [`../components.js`](../components.js). |
| [`../app.js`](../app.js) | Routes + bootstrap (still appended **after** the components blob in HTML). |

Naming roughly follows DOM flow: filters → pagination → fields → CRUD screens.

## Editing workflow

1. Change or add chunks under **`parts/`**.
2. If you **add/remove/reorder** files, update **`manifest.parts.json`** accordingly.
3. Sanity check:

```bash
node plugins/admin-panel/client/verify-spa-parts.js
```

Unit tests cover manifest vs disk in **`tests/unit/admin-panel/spa-parts.test.js`**.

## Optional tooling (local only)

The Webspresso **core** package does **not** depend on Vite/esbuild/Rollup. If you want a bundler locally (analysis, splitting, compression experiments):

```bash
cd plugins/admin-panel/client
npm install --no-save vite@5
```

Use a small rollup/esbuild concat script targeting `manifest.parts.json`, **or** keep editing snippets by hand — the shipped plugin always uses **`load-parts.js`** unless you deliberately replace `components.js` to read a generated file.

`vite.config.example.mjs` (if present) is an illustrative stub; it is **not** run by CI or `webspresso` installs.
