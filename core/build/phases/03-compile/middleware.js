/**
 * Middleware registry resolution for manifest
 * @module core/build/phases/03-compile/middleware
 */

/**
 * @param {object[]} routes
 * @returns {Record<string, object>}
 */
function buildMiddlewareManifest(routes) {
  /** @type {Record<string, object>} */
  const middleware = {};
  /** @type {Set<string>} */
  const seen = new Set();

  for (const route of routes) {
    const list = route.middleware || [];
    for (const mw of list) {
      if (typeof mw === 'string') {
        if (!seen.has(mw)) {
          seen.add(mw);
          middleware[mw] = { kind: 'named', registryKey: mw, factory: false };
        }
      } else if (Array.isArray(mw) && typeof mw[0] === 'string') {
        const name = mw[0];
        if (!seen.has(name)) {
          seen.add(name);
          middleware[name] = {
            kind: 'named-factory',
            registryKey: name,
            factory: true,
            defaultOptions: mw[1] || {},
          };
        }
      }
    }
  }

  return middleware;
}

module.exports = { buildMiddlewareManifest };
