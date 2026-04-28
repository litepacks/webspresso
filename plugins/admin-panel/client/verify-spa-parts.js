#!/usr/bin/env node
/**
 * Sanity check: manifest + parts load and look like the admin SPA bundle.
 * Run from repo root: node plugins/admin-panel/client/verify-spa-parts.js
 */

'use strict';

const path = require('path');
const { buildComponentsBody } = require(path.join(__dirname, 'load-parts.js'));

const body = buildComponentsBody();
const checks = [
  ['has api helper', () => body.includes('const api =')],
  ['has Mithril globals', () => body.includes('window.__ADMIN_COMPONENTS__')],
  ['has reasonable size', () => body.length > 50_000],
];

let failed = false;
for (const [label, ok] of checks) {
  if (!ok()) {
    console.error('FAIL:', label);
    failed = true;
  }
}
if (failed) {
  process.exit(1);
}
console.log(
  `OK admin SPA bundle (${checks.length} checks), length=${body.length} bytes.`,
);
process.exit(0);
