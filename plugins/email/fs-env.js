/**
 * Optional Node.js filesystem helpers — no top-level fs import (edge/worker safe)
 * @module plugins/email/fs-env
 */

let fsModule = null;
let fsChecked = false;

/**
 * @returns {typeof import('fs')|null}
 */
function getFs() {
  if (fsChecked) return fsModule;
  fsChecked = true;
  try {
    fsModule = require('fs');
  } catch {
    fsModule = null;
  }
  return fsModule;
}

/**
 * @returns {boolean}
 */
function isFilesystemAvailable() {
  return getFs() != null;
}

/**
 * @param {string} str
 * @returns {boolean}
 */
function isInlineMarkup(str) {
  const trimmed = String(str).trim();
  return trimmed.startsWith('<mjml')
    || trimmed.startsWith('<html')
    || trimmed.startsWith('<!DOCTYPE')
    || trimmed.startsWith('<!doctype');
}

/**
 * @param {string} str
 * @returns {boolean}
 */
function looksLikeFilePath(str) {
  if (isInlineMarkup(str)) return false;
  const s = String(str);
  return s.startsWith('./')
    || s.startsWith('../')
    || s.startsWith('/')
    || s.startsWith('~')
    || /\.(mjml|html|htm|txt)$/i.test(s);
}

/**
 * @param {string} filePath
 * @returns {string|null}
 */
function readFileUtf8(filePath) {
  const fs = getFs();
  if (!fs) return null;

  const path = require('path');
  const resolved = path.resolve(filePath);

  try {
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @param {string} dir
 * @returns {string[]|null} null when fs unavailable
 */
function listMjmlBasenamesInDir(dir) {
  const fs = getFs();
  if (!fs) return null;

  const path = require('path');
  const resolved = path.resolve(dir);

  try {
    if (!fs.existsSync(resolved)) return [];
    return fs.readdirSync(resolved).filter((f) => f.endsWith('.mjml'));
  } catch {
    return [];
  }
}

module.exports = {
  getFs,
  isFilesystemAvailable,
  isInlineMarkup,
  looksLikeFilePath,
  readFileUtf8,
  listMjmlBasenamesInDir,
};
