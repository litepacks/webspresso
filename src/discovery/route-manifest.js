'use strict';

/**
 * Webspresso - Ahead-Of-Time (AOT) Route Manifest
 * Generates and loads portable, pre-compiled route manifests to eliminate filesystem
 * scanning and speed up cold starts in production and containerized environments.
 * @module src/discovery/route-manifest
 */

const fs = require('fs');
const path = require('path');
const { scanRoutes } = require('./scan-routes');
const { isApiRouteFile } = require('./file-route-parser');
const { filePathToRoute, extractMethodFromFilename } = require('../file-router');

const DEFAULT_MANIFEST_REL_PATH = path.join('.webspresso', 'routes.manifest.json');

/**
 * Generates an Ahead-Of-Time (AOT) route manifest and writes it to disk.
 *
 * @param {Object} [options={}]
 * @param {string} [options.rootDir=process.cwd()] - Project root directory
 * @param {string|Object} [options.pages] - Pages directory configuration or path
 * @param {string|Object} [options.api] - API directory configuration or path
 * @param {string|Object} [options.modules] - Modules directory configuration or path
 * @param {string} [options.outDir] - Directory where manifest will be saved
 * @param {string} [options.outFile] - Custom output file path for the manifest
 * @param {boolean} [options.silent=false] - Suppress console output
 * @returns {{ manifest: Object, manifestPath: string, routeCount: number, scannedFilesCount: number }}
 */
function generateRouteManifest(options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  const pagesDir = options.pagesDir
    ? path.resolve(options.pagesDir)
    : (typeof options.pages === 'string' ? path.resolve(options.pages) : path.join(rootDir, 'pages'));

  const descriptors = scanRoutes({
    rootDir,
    pages: options.pages !== undefined ? options.pages : (fs.existsSync(pagesDir) ? { dir: path.relative(rootDir, pagesDir) || 'pages' } : true),
    api: options.api,
    modules: options.modules,
  });

  const routes = [];
  const routeKeySet = new Set();

  // 1. Discovered routes from scanRoutes (src/pages, src/api, modules/*)
  for (const d of descriptors) {
    const method = (d.method || 'GET').toUpperCase();
    const key = `${method}:${d.path}`;
    routeKeySet.add(key);
    routes.push({
      type: d.type,
      method,
      path: d.path,
      source: d.source || (d.file ? path.relative(rootDir, d.file).split(path.sep).join('/') : ''),
      module: d.module || null,
      moduleConfig: d.moduleConfig ? { name: d.moduleConfig.name } : null,
      target: 'discovered',
    });
  }

  // 2. File-based routes from pagesDir (pages/api/**/*.js and pages/**/*.njk)
  const pagesRel = path.relative(rootDir, pagesDir).split(path.sep).join('/') || 'pages';
  const scannedPagesFiles = descriptors.scannedPagesFiles || [];

  for (const relFile of scannedPagesFiles) {
    const ext = path.extname(relFile);
    if (isApiRouteFile(relFile) && ext === '.js') {
      const { method: rawMethod, baseName } = extractMethodFromFilename(path.basename(relFile));
      const method = (rawMethod || 'get').toUpperCase();
      const dirPart = path.dirname(relFile);
      const rawRoutePath = dirPart === '.'
        ? `/${baseName}`
        : `/${dirPart}/${baseName}`.split(path.sep).join('/');
      const routePath = filePathToRoute(rawRoutePath, '');
      const key = `${method}:${routePath}`;
      if (!routeKeySet.has(key)) {
        routeKeySet.add(key);
        routes.push({
          type: 'api',
          method,
          path: routePath,
          source: path.join(pagesRel, relFile).split(path.sep).join('/'),
          module: null,
          moduleConfig: null,
          target: 'pages',
        });
      }
    } else if (ext === '.njk') {
      const routePath = filePathToRoute(relFile, '.njk');
      const key = `GET:${routePath}`;
      if (!routeKeySet.has(key)) {
        routeKeySet.add(key);
        routes.push({
          type: 'page',
          method: 'GET',
          path: routePath,
          source: path.join(pagesRel, relFile).split(path.sep).join('/'),
          module: null,
          moduleConfig: null,
          target: 'pages',
        });
      }
    }
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    pagesDirRel: pagesRel,
    scannedPagesFiles,
    routes,
  };

  const outFile = options.outFile
    ? path.resolve(options.outFile)
    : (options.outDir
        ? path.join(path.resolve(options.outDir), 'routes.manifest.json')
        : path.join(rootDir, DEFAULT_MANIFEST_REL_PATH));

  const outDir = path.dirname(outFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    manifest,
    manifestPath: outFile,
    routeCount: routes.length,
    scannedFilesCount: scannedPagesFiles.length,
  };
}

/**
 * Loads an existing AOT route manifest from disk and reconstructs runtime descriptors.
 *
 * @param {Object} [options={}]
 * @param {string} [options.rootDir=process.cwd()] - Project root directory
 * @param {string} [options.manifestPath] - Explicit path to the manifest file
 * @returns {{ manifest: Object, descriptors: Array<Object> }|null}
 */
function loadRouteManifest(options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  const manifestPath = options.manifestPath
    ? path.resolve(options.manifestPath)
    : path.join(rootDir, DEFAULT_MANIFEST_REL_PATH);

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    if (!manifest || !Array.isArray(manifest.routes)) {
      return null;
    }

    const descriptors = [];
    for (const r of manifest.routes) {
      if (r.target === 'discovered') {
        const absFile = path.resolve(rootDir, r.source);
        descriptors.push({
          type: r.type,
          method: r.method,
          path: r.path,
          file: absFile,
          source: r.source,
          module: r.module || undefined,
          moduleConfig: r.moduleConfig || undefined,
        });
      }
    }

    const pagesDirRel = manifest.pagesDirRel || 'pages';
    descriptors.scannedPagesDir = path.resolve(rootDir, pagesDirRel);
    descriptors.scannedPagesFiles = Array.isArray(manifest.scannedPagesFiles) ? manifest.scannedPagesFiles : [];

    return {
      manifest,
      descriptors,
    };
  } catch (err) {
    return null;
  }
}

module.exports = {
  DEFAULT_MANIFEST_REL_PATH,
  generateRouteManifest,
  loadRouteManifest,
};
