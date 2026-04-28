/**
 * Optional Vite scaffold — NOT used by npm install or CI.
 *
 * Typical use: concatenate `parts/*.js` according to manifest.parts.json using a
 * small plugin or a pre-build shell script that writes `dist/admin-spa.iife.js`, then
 * point your experiment at that asset. Replacing inlined HTML `<script>...</script>`
 * requires changes in index.js generateAdminPanelHtml().
 *
 * @example npm install vite --prefix plugins/admin-panel/client --no-save
 */

// import { defineConfig } from 'vite';
//
// export default defineConfig({
//   root: import.meta.dirname,
//   build: {
//     outDir: 'dist',
//     emptyOutDir: true,
//     rollupOptions: {},
//     lib: { entry: 'parts-placeholder.js', name: '_', formats: ['iife'] },
//   },
// });
