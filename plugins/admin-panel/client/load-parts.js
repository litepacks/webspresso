/**
 * Concatenate browser SPA snippets for the admin panel (Mithril inline bundle).
 * @module plugins/admin-panel/client/load-parts
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = './manifest.parts.json';

/**
 * Absolute path to this folder (client/).
 */
function clientDir() {
  return path.join(__dirname);
}

function partsDir() {
  return path.join(__dirname, 'parts');
}

/**
 * @returns {string[]} ordered part filenames from manifest.parts.json
 */
function getManifestFilenames() {
  const fp = path.join(clientDir(), 'manifest.parts.json');
  /** @type {string[]} */
  const list = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('admin-panel client/manifest.parts.json must be a non-empty array');
  }
  return list;
}

/**
 * Full SPA script body injected before app routes (no outer wrapper).
 * @returns {string}
 */
function buildComponentsBody() {
  const sharedLib = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'is-rich-text-empty.js'),
    'utf8',
  );
  const dir = partsDir();
  const body = getManifestFilenames()
    .map((filename) => {
      const p = path.join(dir, filename);
      if (!fs.existsSync(p)) {
        throw new Error(`Missing admin SPA part: ${filename} (${p})`);
      }
      return fs.readFileSync(p, 'utf8');
    })
    .join('\n');
  return `${sharedLib}\n${body}`;
}

module.exports = {
  buildComponentsBody,
  getManifestFilenames,
  partsDir,
};
