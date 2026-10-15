/**
 * Webspresso Cascading Middleware & Nested Layout Engine
 * Provides folder-level _middleware.js inheritance and _layout.njk template nesting
 * @module src/routing/cascading
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveMiddlewares } = require('./middleware-resolver');
const { loadNjkRouteTemplate } = require('../njk-frontmatter');

const EMPTY_ARRAY = Object.freeze([]);

// Caches for production mode (key: directory path)
const middlewareFileCache = new Map();
const layoutFileCache = new Map();
const errorFileCache = new Map();
const loadingFileCache = new Map();

function shouldBypassCache(isDev) {
  return !!isDev;
}

/**
 * Returns ancestor directory segments from root down to file's directory.
 * E.g., 'dashboard/settings/profile.njk' -> ['', 'dashboard', 'dashboard/settings']
 *
 * @param {string} relativeFilePath
 * @returns {string[]}
 */
function getDirectoryChain(relativeFilePath) {
  const normalized = relativeFilePath.split(/[/\\]/).join('/');
  const dir = path.posix.dirname(normalized);

  if (dir === '.' || dir === '') {
    return [''];
  }

  const parts = dir.split('/');
  const chain = [''];
  let current = '';

  for (const part of parts) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    chain.push(current);
  }

  return chain;
}

/**
 * Check if a template content explicitly declares its own layout inheritance via `{% extends ... %}`
 *
 * @param {string} [templateBody]
 * @param {string} [fullPath]
 * @returns {boolean}
 */
function templateHasExtends(templateBody, fullPath) {
  if (typeof templateBody === 'string' && /\{%\s*extends\s+/.test(templateBody)) {
    return true;
  }
  if (fullPath && fs.existsSync(fullPath)) {
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      return /\{%\s*extends\s+/.test(content);
    } catch (_) {}
  }
  return false;
}

/**
 * Discover all existing _middleware.js files in directory chain (from root to target dir).
 *
 * @param {string} baseDir - Base pages directory
 * @param {string} relativeFilePath - Relative file path
 * @param {boolean} [isDev=false]
 * @returns {string[]} Absolute paths to existing _middleware.js files
 */
function findCascadingMiddlewareFiles(baseDir, relativeFilePath, isDev = false) {
  const chain = getDirectoryChain(relativeFilePath);
  const cacheKey = `${baseDir}::${chain.join('>')}`;

  if (!shouldBypassCache(isDev) && middlewareFileCache.has(cacheKey)) {
    return middlewareFileCache.get(cacheKey);
  }

  const existingFiles = [];
  for (const dirSegment of chain) {
    const middlewarePath = dirSegment === ''
      ? path.join(baseDir, '_middleware.js')
      : path.join(baseDir, ...dirSegment.split('/'), '_middleware.js');

    if (fs.existsSync(middlewarePath)) {
      existingFiles.push(middlewarePath);
    }
  }

  if (!shouldBypassCache(isDev)) {
    middlewareFileCache.set(cacheKey, existingFiles);
  }

  return existingFiles;
}

/**
 * Loads and resolves cascading middlewares for a given route file.
 *
 * @param {string} baseDir - Base directory (e.g. pagesDir)
 * @param {string} relativeFilePath - Relative file path
 * @param {Object} middlewareRegistry - Available named middlewares
 * @param {boolean} [isDev=false]
 * @returns {Function[]} Ordered list of resolved Express middleware functions
 */
function loadCascadingMiddlewares(baseDir, relativeFilePath, middlewareRegistry = {}, isDev = false) {
  const files = findCascadingMiddlewareFiles(baseDir, relativeFilePath, isDev);
  if (files.length === 0) return EMPTY_ARRAY;

  const resolved = [];

  for (const file of files) {
    try {
      if (isDev && require.cache[require.resolve(file)]) {
        delete require.cache[require.resolve(file)];
      }

      const mod = require(file);
      const candidate = mod?.default || mod;
      const raw = typeof candidate === 'function'
        ? candidate
        : (candidate?.middleware || mod?.middleware || candidate);

      if (!raw) continue;

      if (typeof raw === 'function') {
        resolved.push(raw);
      } else if (Array.isArray(raw)) {
        const chain = resolveMiddlewares(raw, middlewareRegistry);
        resolved.push(...chain);
      } else if (typeof raw === 'string') {
        const chain = resolveMiddlewares([raw], middlewareRegistry);
        resolved.push(...chain);
      }
    } catch (err) {
      console.error(`[webspresso] Failed to load middleware from "${file}":`, err.message);
    }
  }

  return resolved;
}

/**
 * Run a single Express middleware with support for async functions, early completion (res.finish/close),
 * and standard next()/next(err).
 *
 * @param {Function} mw
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<void>}
 */
function runMiddleware(mw, req, res) {
  if (res.headersSent) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;

    const onFinish = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      res.removeListener('finish', onFinish);
      res.removeListener('close', onFinish);
    };

    res.once('finish', onFinish);
    res.once('close', onFinish);

    try {
      const result = mw(req, res, (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve();
      });

      if (result && typeof result.then === 'function') {
        result.then(
          () => {
            if (!settled) {
              settled = true;
              cleanup();
              resolve();
            }
          },
          (err) => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(err);
            }
          }
        );
      }
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    }
  });
}

/**
 * Run a chain of middlewares sequentially. Halts early if response is sent.
 *
 * @param {Function[]} chain
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function runMiddlewareChain(chain, req, res) {
  if (!chain || chain.length === 0) return;
  for (const mw of chain) {
    if (res.headersSent) return;
    await runMiddleware(mw, req, res);
    if (res.headersSent) return;
  }
}

/**
 * Discover all existing _layout.njk files in directory chain (from root to target dir).
 *
 * @param {string} baseDir - Base pages directory
 * @param {string} relativeFilePath - Relative file path
 * @param {boolean} [isDev=false]
 * @returns {Array<{ layoutRelPath: string, fullPath: string, configPath: string|null }>}
 */
function findCascadingLayouts(baseDir, relativeFilePath, isDev = false) {
  const chain = getDirectoryChain(relativeFilePath);
  const cacheKey = `${baseDir}::${chain.join('>')}`;

  if (!shouldBypassCache(isDev) && layoutFileCache.has(cacheKey)) {
    return layoutFileCache.get(cacheKey);
  }

  const layouts = [];

  for (const dirSegment of chain) {
    const layoutNjkName = '_layout.njk';
    const layoutJsName = '_layout.js';

    const layoutRelPath = dirSegment === ''
      ? layoutNjkName
      : `${dirSegment}/${layoutNjkName}`;

    const fullPath = dirSegment === ''
      ? path.join(baseDir, layoutNjkName)
      : path.join(baseDir, ...dirSegment.split('/'), layoutNjkName);

    const fullJsPath = dirSegment === ''
      ? path.join(baseDir, layoutJsName)
      : path.join(baseDir, ...dirSegment.split('/'), layoutJsName);

    if (fs.existsSync(fullPath)) {
      layouts.push({
        layoutRelPath: layoutRelPath.split(path.sep).join('/'),
        fullPath,
        configPath: fs.existsSync(fullJsPath) ? fullJsPath : null,
      });
    }
  }

  if (!shouldBypassCache(isDev)) {
    layoutFileCache.set(cacheKey, layouts);
  }

  return layouts;
}

/**
 * Executes load() functions from companion _layout.js files in top-down order (outermost first).
 *
 * @param {Array<{ configPath: string|null }>} layouts
 * @param {import('http').IncomingMessage} req
 * @param {Object} ctx - Route execution context
 * @param {boolean} [isDev=false]
 * @returns {Promise<void>}
 */
async function executeCascadingLayoutLoads(layouts, req, ctx, isDev = false) {
  for (const layout of layouts) {
    if (!layout.configPath) continue;

    try {
      if (isDev && require.cache[require.resolve(layout.configPath)]) {
        delete require.cache[require.resolve(layout.configPath)];
      }

      const mod = require(layout.configPath);
      const candidate = mod?.default || mod;
      const loadFn = typeof candidate === 'function' ? candidate : candidate?.load;

      if (typeof loadFn === 'function') {
        const loadedData = await loadFn(req, ctx);
        if (loadedData && typeof loadedData === 'object' && !Array.isArray(loadedData)) {
          ctx.data = Object.assign({}, ctx.data, loadedData);
        }
      }
    } catch (err) {
      console.error(`[webspresso] Error in layout loader "${layout.configPath}":`, err.message);
    }
  }
}

/**
 * Wraps page HTML with discovered nested layouts (from innermost to outermost).
 *
 * @param {Object} nunjucksEnv - Nunjucks environment instance
 * @param {Array<{ layoutRelPath: string, fullPath: string }>} layouts - Discovered layouts from outermost to innermost
 * @param {string} pageHtml - Rendered child HTML
 * @param {Object} renderContext - Full template render context
 * @param {boolean} [isDev=false]
 * @returns {string} Fully wrapped HTML
 */
function applyCascadingLayouts(nunjucksEnv, layouts, pageHtml, renderContext, isDev = false) {
  if (!layouts || layouts.length === 0) {
    return pageHtml;
  }

  let currentHtml = pageHtml;

  // Wrap from innermost layout up to outermost (reverse of chain)
  const reversedLayouts = [...layouts].reverse();

  for (const layout of reversedLayouts) {
    try {
      const layoutContext = Object.assign({}, renderContext, {
        content: currentHtml,
      });

      const njkTpl = loadNjkRouteTemplate(layout.fullPath, isDev);
      if (njkTpl.dataPatch && Object.keys(njkTpl.dataPatch).length > 0) {
        Object.assign(layoutContext, njkTpl.dataPatch);
      }

      if (njkTpl.useStringRender && njkTpl.templateBody != null) {
        currentHtml = nunjucksEnv.renderString(njkTpl.templateBody, layoutContext, { path: layout.fullPath });
      } else {
        currentHtml = nunjucksEnv.render(layout.layoutRelPath, layoutContext);
      }
    } catch (err) {
      console.error(`[webspresso] Failed rendering layout "${layout.layoutRelPath}":`, err.message);
      throw err;
    }
  }

  return currentHtml;
}

/**
 * Discover the nearest _error.njk error boundary template in the directory hierarchy
 * (from the file's directory segment climbing up to the root pages directory).
 *
 * @param {string} baseDir - Base pages directory
 * @param {string} relativeFilePath - Relative file path (e.g. 'dashboard/billing/invoices.njk')
 * @param {boolean} [isDev=false]
 * @returns {{ dirSegment: string, errorRelPath: string, fullPath: string, configPath: string|null }|null}
 */
function findNearestErrorBoundary(baseDir, relativeFilePath, isDev = false) {
  const chain = getDirectoryChain(relativeFilePath);
  const cacheKey = `${baseDir}::${chain.join('>')}`;

  if (!shouldBypassCache(isDev) && errorFileCache.has(cacheKey)) {
    return errorFileCache.get(cacheKey);
  }

  const reversedChain = [...chain].reverse();

  for (const dirSegment of reversedChain) {
    const errorNjkName = '_error.njk';
    const errorJsName = '_error.js';

    const errorRelPath = dirSegment === ''
      ? errorNjkName
      : `${dirSegment}/${errorNjkName}`;

    const fullPath = dirSegment === ''
      ? path.join(baseDir, errorNjkName)
      : path.join(baseDir, ...dirSegment.split('/'), errorNjkName);

    const fullJsPath = dirSegment === ''
      ? path.join(baseDir, errorJsName)
      : path.join(baseDir, ...dirSegment.split('/'), errorJsName);

    if (fs.existsSync(fullPath)) {
      const result = {
        dirSegment,
        errorRelPath: errorRelPath.split(path.sep).join('/'),
        fullPath,
        configPath: fs.existsSync(fullJsPath) ? fullJsPath : null,
      };

      if (!shouldBypassCache(isDev)) {
        errorFileCache.set(cacheKey, result);
      }
      return result;
    }
  }

  if (!shouldBypassCache(isDev)) {
    errorFileCache.set(cacheKey, null);
  }
  return null;
}

/**
 * Discover the nearest _loading.njk loading/skeleton template in the directory hierarchy
 * (from the file's directory segment climbing up to the root pages directory).
 *
 * @param {string} baseDir - Base pages directory
 * @param {string} relativeFilePath - Relative file path (e.g. 'dashboard/billing/invoices.njk')
 * @param {boolean} [isDev=false]
 * @returns {{ dirSegment: string, loadingRelPath: string, fullPath: string }|null}
 */
function findNearestLoadingTemplate(baseDir, relativeFilePath, isDev = false) {
  const chain = getDirectoryChain(relativeFilePath);
  const cacheKey = `${baseDir}::${chain.join('>')}`;

  if (!shouldBypassCache(isDev) && loadingFileCache.has(cacheKey)) {
    return loadingFileCache.get(cacheKey);
  }

  const reversedChain = [...chain].reverse();

  for (const dirSegment of reversedChain) {
    const loadingNjkName = '_loading.njk';

    const loadingRelPath = dirSegment === ''
      ? loadingNjkName
      : `${dirSegment}/${loadingNjkName}`;

    const fullPath = dirSegment === ''
      ? path.join(baseDir, loadingNjkName)
      : path.join(baseDir, ...dirSegment.split('/'), loadingNjkName);

    if (fs.existsSync(fullPath)) {
      const result = {
        dirSegment,
        loadingRelPath: loadingRelPath.split(path.sep).join('/'),
        fullPath,
      };

      if (!shouldBypassCache(isDev)) {
        loadingFileCache.set(cacheKey, result);
      }
      return result;
    }
  }

  if (!shouldBypassCache(isDev)) {
    loadingFileCache.set(cacheKey, null);
  }
  return null;
}

function clearCascadingCaches() {
  middlewareFileCache.clear();
  layoutFileCache.clear();
  errorFileCache.clear();
  loadingFileCache.clear();
}

module.exports = {
  getDirectoryChain,
  templateHasExtends,
  findCascadingMiddlewareFiles,
  loadCascadingMiddlewares,
  runMiddleware,
  runMiddlewareChain,
  findCascadingLayouts,
  executeCascadingLayoutLoads,
  applyCascadingLayouts,
  findNearestErrorBoundary,
  findNearestLoadingTemplate,
  clearCascadingCaches,
};
