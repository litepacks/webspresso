const path = require('path');
const { enrichRoutes, filterRoutes } = require('../../../core/studio/route-enrich');

/**
 * @param {object} ctx
 * @param {object} [query]
 */
function collectRoutes(ctx, query = {}) {
  const routes = ctx.routes || ctx.pluginManager?.routes || [];
  const customRoutes = ctx.pluginManager?.customRoutes || [];
  const pagesDir = ctx.options?.pagesDir || 'pages';
  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  const inspect = ctx.studioConfig?.inspectRoutes !== false && isDev;

  const fileRoutes = enrichRoutes(routes, { pagesDir, isDev: inspect });
  const pluginRoutes = customRoutes.map((r) => ({
    method: r.method,
    path: r.path,
    type: 'plugin',
    sourceFile: null,
    isDynamic: r.path.includes(':'),
    middlewareCount: r.handlers?.length ?? 1,
    hasValidation: false,
    authRequired: false,
    pluginOwned: true,
    lastModified: null,
  }));

  const all = [...fileRoutes, ...pluginRoutes];
  const filtered = filterRoutes(all, query);
  return { total: filtered.length, routes: filtered };
}

module.exports = { collectRoutes };
