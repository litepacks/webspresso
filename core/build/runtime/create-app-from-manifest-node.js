/**
 * Node createApp from build manifest (uses full server.js)
 * @module core/build/runtime/create-app-from-manifest-node
 */

/**
 * @param {object} options
 */
function createAppFromManifest(options) {
  const { manifest, handlers, bindings, db, ...appOptions } = options;

  if (!manifest || !handlers) {
    throw new Error('createAppFromManifest requires manifest and handlers');
  }

  const { createApp } = require('../../../src/server');
  return createApp({
    ...appOptions,
    db: db ?? appOptions.db ?? null,
    _manifestMode: true,
    _manifest: manifest,
    _handlers: handlers,
    _bindings: bindings,
  });
}

module.exports = { createAppFromManifest };
