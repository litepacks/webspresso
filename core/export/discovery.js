'use strict';

/**
 * Webspresso Static Site Route Discovery
 * Scans pages directory to discover static renderable page routes
 * and expands dynamic routes with generateStaticParams()
 * @module core/export/discovery
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_TEMPLATE_EXTS = new Set(['.njk', '.html']);

/**
 * Recursively scans directory for page files
 * @param {string} dir
 * @param {string} [baseDir=dir]
 * @returns {Array<{ fullPath: string, relPath: string, isDynamic: boolean, segments: string[] }>}
 */
function scanPagesForExport(dir, baseDir = dir) {
  const routes = [];
  if (!fs.existsSync(dir)) return routes;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    // Skip private files, hooks, error boundaries, layouts, and api folder
    if (name.startsWith('_') || name === 'locales' || name === 'api') continue;

    const fullPath = path.join(dir, name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      routes.push(...scanPagesForExport(fullPath, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(name);
      if (!SUPPORTED_TEMPLATE_EXTS.has(ext)) continue;

      const withoutExt = relPath.slice(0, -ext.length);
      const parts = withoutExt.split(path.sep);

      // Normalize index
      let routePath = '';
      if (parts.length === 1 && parts[0] === 'index') {
        routePath = '/';
      } else if (parts[parts.length - 1] === 'index') {
        routePath = '/' + parts.slice(0, -1).join('/');
      } else {
        routePath = '/' + parts.join('/');
      }

      // Check if dynamic e.g. [slug] or [id]
      const isDynamic = routePath.includes('[') && routePath.includes(']');
      const companionJs = fullPath.slice(0, -ext.length) + '.js';

      routes.push({
        fullPath,
        relPath,
        routePath,
        isDynamic,
        companionJs: fs.existsSync(companionJs) ? companionJs : null,
        ext,
      });
    }
  }

  return routes;
}

/**
 * Discovers all exportable routes for prerendering
 * Expands dynamic routes if companion loader exports generateStaticParams or staticPaths
 * @param {Object} options
 * @param {string} options.pagesDir - Path to pages directory
 * @param {Object} [options.db] - Database instance to pass to generateStaticParams
 * @param {Array<string>} [options.extraRoutes=[]] - Additional routes to prerender
 * @returns {Promise<Array<{ path: string, sourceFile: string, isDynamic: boolean, params?: Object }>>}
 */
async function discoverExportRoutes(options = {}) {
  const {
    pagesDir = path.join(process.cwd(), 'pages'),
    db = null,
    extraRoutes = [],
  } = options;

  const resolvedPagesDir = path.resolve(pagesDir);
  const discovered = scanPagesForExport(resolvedPagesDir, resolvedPagesDir);

  const finalRoutes = [];
  const visitedPaths = new Set();

  for (const item of discovered) {
    if (!item.isDynamic) {
      if (!visitedPaths.has(item.routePath)) {
        visitedPaths.add(item.routePath);
        finalRoutes.push({
          path: item.routePath,
          sourceFile: item.fullPath,
          isDynamic: false,
        });
      }
      continue;
    }

    // Dynamic route: check companion JS for generateStaticParams or staticPaths
    if (item.companionJs) {
      let mod;
      try {
        mod = require(item.companionJs);
      } catch (err) {
        console.warn(`[webspresso export] Could not load companion file "${item.companionJs}":`, err.message);
        continue;
      }

      const staticParamsFn =
        mod.generateStaticParams ||
        mod.staticPaths ||
        (mod.default && (mod.default.generateStaticParams || mod.default.staticPaths));

      if (typeof staticParamsFn === 'function') {
        try {
          const paramsList = await staticParamsFn({ db });
          if (Array.isArray(paramsList)) {
            for (const paramObj of paramsList) {
              let resolvedUrl = item.routePath;
              for (const [key, val] of Object.entries(paramObj || {})) {
                resolvedUrl = resolvedUrl.replace(new RegExp(`\\[${key}\\]`, 'g'), String(val));
              }

              if (!resolvedUrl.includes('[') && !visitedPaths.has(resolvedUrl)) {
                visitedPaths.add(resolvedUrl);
                finalRoutes.push({
                  path: resolvedUrl,
                  sourceFile: item.fullPath,
                  isDynamic: true,
                  params: paramObj,
                });
              }
            }
          }
        } catch (err) {
          console.warn(`[webspresso export] Error executing generateStaticParams for "${item.routePath}":`, err.message);
        }
      } else {
        // Dynamic route with no static params generator
        // Stays unrendered or handled client-side
      }
    }
  }

  // Include 404 page if present
  const notFoundCandidates = [
    path.join(resolvedPagesDir, '404.njk'),
    path.join(resolvedPagesDir, '404.html'),
  ];
  for (const nf of notFoundCandidates) {
    if (fs.existsSync(nf)) {
      if (!visitedPaths.has('/404')) {
        visitedPaths.add('/404');
        finalRoutes.push({
          path: '/404',
          sourceFile: nf,
          isDynamic: false,
          isNotFound: true,
        });
      }
      break;
    }
  }

  // Append manual extra routes
  for (const extra of extraRoutes) {
    if (typeof extra === 'string' && !visitedPaths.has(extra)) {
      visitedPaths.add(extra);
      finalRoutes.push({
        path: extra,
        sourceFile: null,
        isDynamic: false,
      });
    }
  }

  return finalRoutes;
}

module.exports = {
  scanPagesForExport,
  discoverExportRoutes,
};
