/**
 * createApp from build manifest (dual-path with runtime file-router)
 * @module core/build/runtime/create-app-from-manifest
 */

const { createApp } = require('../../../src/server');
const { mountPagesFromManifest } = require('./mount-manifest');

/**
 * @param {object} options - createApp options plus manifest + handlers
 * @param {import('../types').WebspressoManifest} options.manifest
 * @param {Record<string, unknown>} options.handlers
 * @param {object} [options.bindings] - Cloudflare env bindings
 */
function createAppFromManifest(options) {
  const { manifest, handlers, bindings, db, ...appOptions } = options;

  if (!manifest || !handlers) {
    throw new Error('createAppFromManifest requires manifest and handlers');
  }

  let resolvedDb = db;
  if (!resolvedDb && bindings && bindings.DB) {
    try {
      const { createDatabase } = require('../../orm');
      resolvedDb = createDatabase({ client: 'd1' }, { d1: bindings.DB, skipModelScan: true });
    } catch (err) {
      console.warn('[webspresso] D1 binding present but database init failed:', err.message);
    }
  }

  return createApp({
    ...appOptions,
    db: resolvedDb ?? appOptions.db,
    _manifestMode: true,
    _manifest: manifest,
    _handlers: handlers,
    _bindings: bindings,
  });
}

module.exports = { createAppFromManifest };
