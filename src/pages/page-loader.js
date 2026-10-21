'use strict';

/**
 * Webspresso Page Loader
 * Handles execution of definePage() lifecycle and renders page output
 * @module src/pages/page-loader
 */

const fs = require('fs');
const path = require('path');
const { createHelpers, getAssetManager } = require('../helpers');
const {
  loadI18n,
  createTranslator,
  detectLocale,
  resolveMiddlewares,
  translatorCache,
  resolvePageAssets,
  applyPageAssetsToTemplateData,
} = require('../file-router');
const { sendEarlyHints } = require('../../core/early-hints');
const { executePagePipeline, enrichRouteError } = require('../../core/http');

const EMPTY_ARRAY = Object.freeze([]);

/**
 * Resolves named and functional middlewares with module-level precedence
 * @param {Array<string|Function>} middlewareList
 * @param {Object} [globalMiddlewares={}]
 * @param {Object} [moduleMiddlewares={}]
 * @returns {Array<Function>}
 */
function resolveMiddlewaresWithModule(middlewareList, globalMiddlewares = {}, moduleMiddlewares = {}) {
  const combined = Object.assign({}, globalMiddlewares, moduleMiddlewares);
  return resolveMiddlewares(middlewareList, combined);
}

/**
 * Creates an Express route handler for a discovered Page descriptor
 * @param {Object} descriptor - Route descriptor
 * @param {Object} context - Server execution context
 * @returns {Function} Express request handler
 */
function createPageHandler(descriptor, context) {
  const {
    nunjucks,
    middlewares = {},
    serviceRegistry = null,
    db = null,
    options: appOptions = {},
  } = context;

  const isDev = context.isDev !== undefined ? context.isDev : (appOptions.isDev !== undefined ? appOptions.isDev : (process.env.NODE_ENV === 'development' && process.env.NODE_ENV !== 'test'));
  const pagesDir = path.dirname(descriptor.file);
  const njkCandidate = descriptor.file.endsWith('.njk')
    ? descriptor.file
    : descriptor.file.replace(/\.js$/, '.njk');
  
  let hasNjkTemplate = !isDev ? fs.existsSync(njkCandidate) : null;
  let cachedMiddlewares = null;
  let cachedPageDef = null;

  return async (req, res, next) => {
    try {
      // 1. Load page definition (with hot reload in dev)
      if (isDev && descriptor.file.endsWith('.js')) {
        try {
          const resolvedPath = require.resolve(descriptor.file);
          if (require.cache[resolvedPath]) {
            delete require.cache[resolvedPath];
            cachedMiddlewares = null;
            cachedPageDef = null;
          }
        } catch {}
      }

      let pageDef = cachedPageDef;
      if (!pageDef) {
        let pageModule = {};
        if (descriptor.file.endsWith('.js')) {
          try {
            pageModule = require(descriptor.file);
          } catch (loadErr) {
            return next(loadErr);
          }
        }

        pageDef = typeof pageModule === 'function' ? { load: pageModule } : pageModule.default || pageModule;
        if (!isDev) {
          cachedPageDef = pageDef;
        }
      }

      // 2. Resolve middlewares (module-local first, cached across requests)
      if (!cachedMiddlewares) {
        const moduleMiddlewares = descriptor.moduleConfig?.middlewares || {};
        const combinedRegistry = Object.assign({}, middlewares, moduleMiddlewares);
        cachedMiddlewares = resolveMiddlewares(pageDef.middleware, combinedRegistry);
      }

      // 3. Execute framework-agnostic Page pipeline
      await executePagePipeline({
        descriptor,
        context,
        pageDef,
        middlewares: cachedMiddlewares,
        req,
        res,
        nunjucks,
        njkCandidate,
        hasNjkTemplate,
      });
    } catch (err) {
      enrichRouteError(err, descriptor, req);
      return next(err);
    }
  };
}

module.exports = {
  createPageHandler,
  resolveMiddlewaresWithModule,
};
