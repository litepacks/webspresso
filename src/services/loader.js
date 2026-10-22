/**
 * Webspresso Services Module Loader
 * Handles synchronous CommonJS and asynchronous native dynamic import (ESM)
 * with robust export normalization and dev-mode cache busting.
 * @module src/services/loader
 */

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Execute native dynamic import() via Function constructor to prevent
 * compilers/bundlers from down-leveling import() into require().
 * @param {string} specifier - Module URL string
 * @returns {Promise<any>}
 */
function nativeImport(specifier) {
  return new Function('specifier', 'return import(specifier);')(specifier);
}

/**
 * Load a module synchronously via CommonJS require
 * @param {string} filePath - Absolute file path
 * @param {Object} [options]
 * @param {boolean} [options.isDev=false] - Invalidate require.cache if true
 * @returns {any} Exported module
 */
function loadModuleSync(filePath, options = {}) {
  const resolved = require.resolve(filePath);
  if (options.isDev) {
    try {
      delete require.cache[resolved];
    } catch (_) {}
  }
  return require(resolved);
}

/**
 * Load a module asynchronously supporting both CommonJS and native ES Modules (ESM)
 * @param {string} filePath - Absolute file path
 * @param {Object} [options]
 * @param {boolean} [options.isDev=false] - Cache busting via timestamp query param
 * @returns {Promise<any>} Exported module
 */
async function loadModuleAsync(filePath, options = {}) {
  const isDev = Boolean(options.isDev);
  const ext = path.extname(filePath);

  // If not explicitly .mjs, try synchronous CommonJS require first for maximum speed
  if (ext !== '.mjs') {
    try {
      return loadModuleSync(filePath, { isDev });
    } catch (err) {
      // If Node.js throws ERR_REQUIRE_ESM, fall through to native dynamic import
      if (err.code !== 'ERR_REQUIRE_ESM' && !err.message?.includes('ERR_REQUIRE_ESM')) {
        throw err;
      }
    }
  }

  // Load via native dynamic import() with file URL
  let specifier = pathToFileURL(path.resolve(filePath)).href;
  if (isDev) {
    specifier += `?t=${Date.now()}`;
  }

  return nativeImport(specifier);
}

/**
 * Normalize and extract service definition from various module export conventions:
 * 1. module.exports = defineService({ handler })
 * 2. module.exports = async function() {}
 * 3. export default defineService({ handler })
 * 4. export default async function() {}
 * 5. export const handler = async function() {}
 * 6. export const service = defineService({ handler })
 *
 * @param {any} mod - Loaded module
 * @returns {any} Extracted service definition or handler
 */
function extractModuleExport(mod) {
  if (mod === null || mod === undefined) {
    return mod;
  }

  // TypeScript / Babel transpiled default
  if (mod.__esModule && mod.default !== undefined) {
    return mod.default;
  }

  // Native ESM default export
  if (mod.default !== undefined) {
    const d = mod.default;
    if (typeof d === 'function' || (typeof d === 'object' && d !== null && typeof d.handler === 'function')) {
      return d;
    }
  }

  // Named export: export const handler = ...
  if (typeof mod.handler === 'function') {
    return mod;
  }

  // Named export: export const service = defineService(...)
  if (mod.service && typeof mod.service === 'object' && typeof mod.service.handler === 'function') {
    return mod.service;
  }

  return mod.default !== undefined ? mod.default : mod;
}

module.exports = {
  nativeImport,
  loadModuleSync,
  loadModuleAsync,
  extractModuleExport,
};
