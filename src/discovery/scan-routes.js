'use strict';

/**
 * Webspresso Route Discovery Scanner
 * Scans pages, api, and module directories to produce raw route descriptors
 * @module src/discovery/scan-routes
 */

const fs = require('fs');
const path = require('path');
const { parseFileRoute, isPrivateOrIgnored } = require('./file-route-parser');
const { discoverModuleDetails } = require('../modules/module-discovery');

const SUPPORTED_EXTENSIONS = new Set(['.js', '.njk']);

/**
 * Safely scans a directory recursively for route files
 * @param {string} dirPath - Absolute directory path
 * @param {string} [baseDir=dirPath] - Base directory for computing relative paths
 * @returns {Array<{ absolutePath: string, relativePath: string }>}
 */
function scanDirSafely(dirPath, baseDir = dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;
      if (isPrivateOrIgnored(name)) continue;

      const fullPath = path.join(dirPath, name);
      const relPath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        results.push(...scanDirSafely(fullPath, baseDir));
      } else if (entry.isFile()) {
        const ext = path.extname(name);
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push({
            absolutePath: fullPath,
            relativePath: relPath,
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[webspresso] Failed to scan directory ${dirPath}:`, err.message);
  }

  return results;
}

/**
 * Scans configured pages, api, and module directories
 * @param {Object} options
 * @param {string} [options.rootDir=process.cwd()] - Project root directory
 * @param {boolean|Object} [options.pages] - Pages configuration
 * @param {boolean|Object} [options.api] - API configuration
 * @param {boolean|Object} [options.modules] - Modules configuration
 * @returns {Array<Object>} Discovered route descriptors
 */
function scanRoutes(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const descriptors = [];

  // Helper to resolve directory paths
  function resolveDirCandidate(candidates) {
    for (const cand of candidates) {
      const p = path.isAbsolute(cand) ? cand : path.join(rootDir, cand);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  // 1. Scan Global Pages
  const pagesOpt = options.pages;
  if (pagesOpt !== false) {
    const explicitPagesDir = typeof pagesOpt === 'object' && pagesOpt.dir ? pagesOpt.dir : null;
    const pagesPrefix = typeof pagesOpt === 'object' && pagesOpt.prefix ? pagesOpt.prefix : '';
    const pagesDir = explicitPagesDir
      ? (path.isAbsolute(explicitPagesDir) ? explicitPagesDir : path.join(rootDir, explicitPagesDir))
      : resolveDirCandidate(['src/pages', 'pages']);

    if (pagesDir && fs.existsSync(pagesDir)) {
      const files = scanDirSafely(pagesDir);
      const filesSet = new Set(files.map((f) => f.absolutePath));

      for (const { absolutePath, relativePath } of files) {
        // Skip .njk templates (handled by classic Nunjucks mountPages)
        if (relativePath.endsWith('.njk')) {
          continue;
        }

        // Skip non-js files
        if (!relativePath.endsWith('.js')) {
          continue;
        }

        // Skip api directory inside pages (handled by classic mountPages or explicit api scan)
        const isUnderApi = relativePath.startsWith('api' + path.sep) || relativePath.startsWith('api/');
        if (isUnderApi) {
          continue;
        }

        // If a companion .njk file exists, this .js is a data loader for mountPages, not a standalone definePage route
        const companionNjk = absolutePath.replace(/\.js$/, '.njk');
        if (filesSet.has(companionNjk)) {
          continue;
        }

        // Parse as standalone page route
        const parsed = parseFileRoute(relativePath, {
          type: 'page',
          prefix: pagesPrefix,
        });
        if (parsed.isValid) {
          descriptors.push({
            type: 'page',
            method: parsed.method,
            path: parsed.path,
            file: absolutePath,
            source: path.relative(rootDir, absolutePath),
            module: null,
          });
        }
      }
    }
  }

  // 2. Scan Global API (e.g. src/api or api)
  const apiOpt = options.api;
  if (apiOpt !== false) {
    const explicitApiDir = typeof apiOpt === 'object' && apiOpt.dir ? apiOpt.dir : null;
    const apiPrefix = typeof apiOpt === 'object' && apiOpt.prefix ? apiOpt.prefix : '/api';
    const apiDir = explicitApiDir
      ? (path.isAbsolute(explicitApiDir) ? explicitApiDir : path.join(rootDir, explicitApiDir))
      : resolveDirCandidate(['src/api', 'api']);

    if (apiDir && fs.existsSync(apiDir)) {
      const files = scanDirSafely(apiDir);
      for (const { absolutePath, relativePath } of files) {
        const parsed = parseFileRoute(relativePath, {
          type: 'api',
          prefix: apiPrefix,
        });
        if (parsed.isValid) {
          descriptors.push({
            type: 'api',
            method: parsed.method,
            path: parsed.path,
            file: absolutePath,
            source: path.relative(rootDir, absolutePath),
            module: null,
          });
        }
      }
    }
  }

  // 3. Scan Modules (e.g. src/modules or modules)
  const modulesOpt = options.modules;
  if (modulesOpt !== false) {
    const explicitModulesDir = typeof modulesOpt === 'object' && modulesOpt.dir ? modulesOpt.dir : null;
    const modulesDir = explicitModulesDir
      ? (path.isAbsolute(explicitModulesDir) ? explicitModulesDir : path.join(rootDir, explicitModulesDir))
      : resolveDirCandidate(['src/modules', 'modules']);

    if (modulesDir && fs.existsSync(modulesDir)) {
      const entries = fs.readdirSync(modulesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || isPrivateOrIgnored(entry.name)) continue;

        const moduleName = entry.name;
        const modulePath = path.join(modulesDir, moduleName);

        const details = discoverModuleDetails(modulePath, moduleName);
        const moduleConfig = Object.assign({}, details.config, {
          middlewares: details.middlewares,
          services: details.services,
        });

        // Module Pages
        const modPagesConfig = moduleConfig?.pages;
        if (modPagesConfig !== false) {
          const modPagesDirName = typeof modPagesConfig === 'object' && modPagesConfig.dir ? modPagesConfig.dir : 'pages';
          const modPagesPrefix = typeof modPagesConfig === 'object' && modPagesConfig.prefix !== undefined
            ? modPagesConfig.prefix
            : `/${moduleName}`;
          const modPagesDir = path.isAbsolute(modPagesDirName)
            ? modPagesDirName
            : path.join(modulePath, modPagesDirName);

          if (fs.existsSync(modPagesDir)) {
            const files = scanDirSafely(modPagesDir);
            const modFilesSet = new Set(files.map((f) => f.absolutePath));

            for (const { absolutePath, relativePath } of files) {
              if (!relativePath.endsWith('.js')) continue;
              if (modFilesSet.has(absolutePath.replace(/\.js$/, '.njk'))) continue;

              const parsed = parseFileRoute(relativePath, {
                type: 'page',
                prefix: modPagesPrefix,
              });
              if (parsed.isValid) {
                descriptors.push({
                  type: 'page',
                  method: parsed.method,
                  path: parsed.path,
                  file: absolutePath,
                  source: path.relative(rootDir, absolutePath),
                  module: moduleName,
                  moduleConfig,
                });
              }
            }
          }
        }

        // Module API
        const modApiConfig = moduleConfig?.api;
        if (modApiConfig !== false) {
          const modApiDirName = typeof modApiConfig === 'object' && modApiConfig.dir ? modApiConfig.dir : 'api';
          const modApiPrefix = typeof modApiConfig === 'object' && modApiConfig.prefix !== undefined
            ? modApiConfig.prefix
            : `/api/${moduleName}`;
          const modApiDir = path.isAbsolute(modApiDirName)
            ? modApiDirName
            : path.join(modulePath, modApiDirName);

          if (fs.existsSync(modApiDir)) {
            const files = scanDirSafely(modApiDir);
            for (const { absolutePath, relativePath } of files) {
              const parsed = parseFileRoute(relativePath, {
                type: 'api',
                prefix: modApiPrefix,
              });
              if (parsed.isValid) {
                descriptors.push({
                  type: 'api',
                  method: parsed.method,
                  path: parsed.path,
                  file: absolutePath,
                  source: path.relative(rootDir, absolutePath),
                  module: moduleName,
                  moduleConfig,
                });
              }
            }
          }
        }
      }
    }
  }

  return descriptors;
}

module.exports = {
  scanRoutes,
  scanDirSafely,
};
