/**
 * Cloudflare Workers createApp from build manifest (edge-safe runtime)
 * @module core/build/runtime/create-app-from-manifest
 */

const { createWorkerApp } = require('./create-worker-app');

/**
 * @param {object} options
 * @param {import('../types').WebspressoManifest} options.manifest
 * @param {Record<string, unknown>} options.handlers
 * @param {object} [options.bindings] - Cloudflare env bindings
 * @param {Record<string, unknown>} [options.precompiledTemplates]
 */
function createAppFromManifest(options) {
  const {
    manifest,
    handlers,
    bindings,
    db,
    precompiledTemplates,
    modulePaths,
    dbRuntime,
    ...appOptions
  } = options;

  if (!manifest || !handlers) {
    throw new Error('createAppFromManifest requires manifest and handlers');
  }

  return createWorkerApp({
    ...appOptions,
    manifest,
    handlers,
    bindings,
    precompiledTemplates,
    modulePaths,
    dbRuntime,
    db: db ?? appOptions.db ?? null,
  });
}

module.exports = { createAppFromManifest };
