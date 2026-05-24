/**
 * Phase 1 — Discover routes from pages/
 * @module core/build/phases/01-discover
 */

const path = require('path');
const fs = require('fs');
const {
  scanDirectory,
  filePathToRoute,
  extractMethodFromFilename,
  compareRouteRegistrationOrder,
  routeRegistrationMeta,
} = require('../../../src/file-router');
const { hashFile } = require('../graph/hash');

/**
 * @param {import('../index').BuildContextInternal} ctx
 */
function discoverRoutes(ctx) {
  const pagesDir = path.resolve(ctx.cwd, ctx.config.pagesDir || 'pages');
  if (!fs.existsSync(pagesDir)) {
    return { routes: [], pagesDir };
  }

  const files = scanDirectory(pagesDir);
  /** @type {object[]} */
  const routes = [];

  for (const file of files) {
    const ext = path.extname(file);
    const normalized = file.split(path.sep).join('/');
    const isApi = normalized.startsWith('api/');

    if (isApi && ext === '.js') {
      const { method, baseName } = extractMethodFromFilename(path.basename(file));
      const dirPart = path.dirname(file);
      const routePath =
        dirPart === '.'
          ? `/${baseName}`
          : `/${dirPart}/${baseName}`.split(path.sep).join('/');
      const pattern = filePathToRoute(routePath, '');
      routes.push({
        type: 'api',
        method,
        pattern,
        sourceFile: normalized,
        absPath: path.join(pagesDir, file),
      });
    } else if (ext === '.njk') {
      const pattern = filePathToRoute(file, '.njk');
      const configRel = file.replace(/\.njk$/, '.js');
      routes.push({
        type: 'ssr',
        method: 'GET',
        pattern,
        sourceFile: normalized,
        configFile: configRel,
        absPath: path.join(pagesDir, file),
        configAbsPath: path.join(pagesDir, configRel),
      });
    }
  }

  routes.sort((a, b) => compareRouteRegistrationOrder({ routePath: a.pattern }, { routePath: b.pattern }));

  const withMeta = routes.map((r, registrationIndex) => {
    const meta = routeRegistrationMeta(r.pattern);
    const id = `${r.type}:${r.method.toUpperCase()}:${r.pattern}`;
    const fileHash = hashFile(r.absPath);
    ctx.graph.addNode(`file:${r.sourceFile}`, r.type === 'api' ? 'api-route' : 'ssr-page', fileHash);
    if (r.configFile) {
      ctx.graph.addEdge(`file:${r.configFile}`, `file:${r.sourceFile}`, 'companion');
      if (fs.existsSync(r.configAbsPath)) {
        ctx.graph.addNode(`file:${r.configFile}`, 'ssr-config', hashFile(r.configAbsPath));
      }
    }
    return {
      ...r,
      id,
      tier: meta.tier,
      registrationIndex,
    };
  });

  return { routes: withMeta, pagesDir };
}

module.exports = { discoverRoutes };
