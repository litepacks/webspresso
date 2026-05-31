/**
 * Enrich file-router metadata with handler inspection (dev-safe).
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_PREFIXES = ['/_admin', '/_webspresso', '/_swagger', '/api-docs'];

/**
 * @param {string} routePath
 * @returns {boolean}
 */
function isPluginOwnedPath(routePath) {
  const p = String(routePath || '');
  return PLUGIN_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'));
}

/**
 * @param {unknown} middleware
 * @returns {boolean}
 */
function middlewareRequiresAuth(middleware) {
  if (!middleware) return false;
  const list = Array.isArray(middleware) ? middleware : [middleware];
  for (const item of list) {
    if (item === 'auth') return true;
    if (typeof item === 'string' && item.includes('auth')) return true;
    if (Array.isArray(item) && item[0] === 'auth') return true;
  }
  return false;
}

/**
 * @param {string} fullPath
 * @param {boolean} isDev
 * @returns {object|null}
 */
function inspectApiHandler(fullPath, isDev) {
  if (!fullPath || !isDev) return null;
  try {
    if (require.cache[require.resolve(fullPath)]) {
      delete require.cache[require.resolve(fullPath)];
    }
    const mod = require(fullPath);
    const handler = typeof mod === 'function' ? mod : mod.default || mod.handler;
    return {
      middlewareCount: Array.isArray(mod.middleware) ? mod.middleware.length : 0,
      hasValidation: !!(mod.schema || mod.bodySchema || mod.querySchema || mod.paramsSchema),
      authRequired: middlewareRequiresAuth(mod.middleware),
    };
  } catch {
    return null;
  }
}

/**
 * @param {object} route
 * @param {object} opts
 * @param {string} [opts.pagesDir]
 * @param {boolean} [opts.isDev]
 * @returns {object}
 */
function enrichRoute(route, opts = {}) {
  const { pagesDir, isDev = false } = opts;
  const pattern = route.pattern || route.routePath || '/';
  const type = route.type === 'api' ? 'api' : route.type === 'ssr' ? 'page' : route.type || 'page';
  const method = (route.method || 'get').toLowerCase();

  let sourceFile = route.file || null;
  let fullPath = null;
  if (sourceFile && pagesDir) {
    fullPath = path.isAbsolute(sourceFile)
      ? sourceFile
      : path.join(process.cwd(), pagesDir, sourceFile.replace(/^pages\//, ''));
    if (!fs.existsSync(fullPath) && sourceFile.startsWith('pages/')) {
      fullPath = path.join(process.cwd(), sourceFile);
    }
  }

  let lastModified = null;
  if (isDev && fullPath && fs.existsSync(fullPath)) {
    try {
      lastModified = fs.statSync(fullPath).mtime.toISOString();
    } catch {
      /* ignore */
    }
  }

  const inspection = type === 'api' && fullPath ? inspectApiHandler(fullPath, isDev) : null;

  return {
    method,
    path: pattern,
    type,
    sourceFile,
    isDynamic: !!route.isDynamic,
    middlewareCount: inspection?.middlewareCount ?? 0,
    hasValidation: inspection?.hasValidation ?? false,
    authRequired: inspection?.authRequired ?? false,
    pluginOwned: isPluginOwnedPath(pattern),
    lastModified,
  };
}

/**
 * @param {object[]} routes
 * @param {object} opts
 * @returns {object[]}
 */
function enrichRoutes(routes, opts = {}) {
  return (routes || []).map((r) => enrichRoute(r, opts));
}

/**
 * @param {object[]} routes
 * @param {object} [query]
 * @returns {object[]}
 */
function filterRoutes(routes, query = {}) {
  let list = routes;
  if (query.method) {
    const m = String(query.method).toLowerCase();
    list = list.filter((r) => r.method === m);
  }
  if (query.type) {
    const t = String(query.type).toLowerCase();
    list = list.filter((r) => r.type === t || (t === 'page' && r.type === 'ssr'));
  }
  if (query.auth === '1' || query.auth === 'true') {
    list = list.filter((r) => r.authRequired);
  }
  if (query.plugin === '1' || query.plugin === 'true') {
    list = list.filter((r) => r.pluginOwned);
  }
  if (query.plugin === '0' || query.plugin === 'false') {
    list = list.filter((r) => !r.pluginOwned);
  }
  return list;
}

module.exports = {
  enrichRoute,
  enrichRoutes,
  filterRoutes,
  isPluginOwnedPath,
};
