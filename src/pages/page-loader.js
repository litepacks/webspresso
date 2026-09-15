'use strict';

/**
 * Webspresso Page Loader
 * Handles execution of definePage() lifecycle and renders page output
 * @module src/pages/page-loader
 */

const fs = require('fs');
const path = require('path');
const { createHelpers } = require('../helpers');
const { loadI18n, createTranslator, detectLocale, resolveMiddlewares } = require('../file-router');

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

  const isDev = process.env.NODE_ENV === 'development';
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

      // Run middlewares in sequence
      for (const mw of cachedMiddlewares) {
        if (typeof mw !== 'function') continue;
        await new Promise((resolve, reject) => {
          try {
            mw(req, res, (err) => {
              if (err) reject(err);
              else resolve();
            });
          } catch (syncErr) {
            reject(syncErr);
          }
        });
        if (res.headersSent) return;
      }

      // 3. Build Page Context
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const locale = detectLocale(req);
      const fsy = createHelpers({ req, res, baseUrl, locale });

      // i18n
      const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
      const translations = loadI18n(pagesDir, '', locale, isDev);
      const fallbackTranslations = locale !== defaultLocale ? loadI18n(pagesDir, '', defaultLocale, isDev) : undefined;
      const t = createTranslator(translations, {
        locale,
        fallbackTranslations,
        fallbackLocale: defaultLocale,
      });

      const pageCtx = {
        req,
        res,
        params: req.params || {},
        query: req.query || {},
        service: (name, input, opts) =>
          serviceRegistry ? serviceRegistry.call(name, input, { req, res, db }, opts) : null,
        module: descriptor.module || null,
        config: appOptions,
        logger: console,
        redirect: (url, status = 302) => {
          res.redirect(status, url);
          return { __redirected: true };
        },
        error: (status = 500, message = 'Page Error') => {
          const err = new Error(message);
          err.status = status;
          throw err;
        },
        fsy,
        locale,
        t,
        db,
      };

      // 4. Run load() lifecycle
      let loadedData = {};
      if (typeof pageDef.load === 'function') {
        loadedData = (await pageDef.load(pageCtx)) || {};
        if (loadedData.__redirected || res.headersSent) {
          return;
        }
      }

      // 5. Run head() lifecycle
      let headData = {};
      if (typeof pageDef.head === 'function') {
        headData = (await pageDef.head(loadedData, pageCtx)) || {};
      }

      // 6. Check for companion Nunjucks template (cached in production)
      const templateExists = hasNjkTemplate !== null ? hasNjkTemplate : fs.existsSync(njkCandidate);

      if (templateExists && nunjucks) {
        const templateData = {
          ...loadedData,
          head: headData,
          pageHead: headData,
          fsy,
          locale,
          t,
          params: req.params,
          query: req.query,
        };
        return nunjucks.render(njkCandidate, templateData, (err, html) => {
          if (err) return next(err);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(html);
        });
      }

      // 7. Render via definePage render() method
      if (typeof pageDef.render === 'function') {
        const html = await pageDef.render(loadedData, pageCtx);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }

      // 8. Fallback: if json or data
      if (typeof loadedData === 'object' && loadedData !== null) {
        return res.json(loadedData);
      }

      return res.send(String(loadedData));
    } catch (err) {
      if (err && typeof err === 'object') {
        if (!err.route) err.route = descriptor.path;
        if (!err.method) err.method = descriptor.method ? descriptor.method.toUpperCase() : (req.method || 'GET');
        if (!err.source) err.source = descriptor.source || descriptor.file;
        if (!err.file) err.file = descriptor.file;
        if (!err.module) err.module = descriptor.module || null;
        if (!err.phase) err.phase = 'page';
        if (!err.requestId) err.requestId = req.id || (req.headers && req.headers['x-request-id']) || null;
      }
      return next(err);
    }
  };
}

module.exports = {
  createPageHandler,
  resolveMiddlewaresWithModule,
};
