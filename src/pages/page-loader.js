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
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 7331}`;
      const locale = detectLocale(req);
      const fsy = createHelpers({ req, res, baseUrl, locale });

      // i18n
      const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
      let t;
      if (!isDev && translatorCache) {
        const transKey = `${pagesDir}::::${locale}::${defaultLocale}`;
        t = translatorCache.get(transKey);
        if (!t) {
          const translations = loadI18n(pagesDir, '', locale, false);
          const fallbackTranslations = locale !== defaultLocale ? loadI18n(pagesDir, '', defaultLocale, false) : undefined;
          t = createTranslator(translations, {
            locale,
            fallbackTranslations,
            fallbackLocale: defaultLocale,
          });
          translatorCache.set(transKey, t);
        }
      } else {
        const translations = loadI18n(pagesDir, '', locale, isDev);
        const fallbackTranslations = locale !== defaultLocale ? loadI18n(pagesDir, '', defaultLocale, isDev) : undefined;
        t = createTranslator(translations, {
          locale,
          fallbackTranslations,
          fallbackLocale: defaultLocale,
        });
      }

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
        earlyHints: (links, cb) => sendEarlyHints(res, links, cb),
        fsy,
        locale,
        t,
        db,
      };

      // 3.5. Dispatch Early Hints (if configured or enabled) before load()
      const earlyHintsOpt = pageDef.earlyHints !== undefined
        ? pageDef.earlyHints
        : (descriptor.earlyHints !== undefined
            ? descriptor.earlyHints
            : (appOptions && (appOptions.earlyHints ?? appOptions.server?.earlyHints)));

      if (earlyHintsOpt && earlyHintsOpt !== false && !res.headersSent) {
        const auto = typeof earlyHintsOpt === 'object' ? (earlyHintsOpt.auto !== false) : Boolean(earlyHintsOpt);
        const linksToSend = [];

        // Explicit links from page definition or app earlyHints config
        if (Array.isArray(earlyHintsOpt)) {
          linksToSend.push(...earlyHintsOpt);
        } else if (typeof earlyHintsOpt === 'object' && earlyHintsOpt.links) {
          const customLinks = typeof earlyHintsOpt.links === 'function' ? earlyHintsOpt.links(req) : earlyHintsOpt.links;
          if (Array.isArray(customLinks)) linksToSend.push(...customLinks);
          else if (customLinks) linksToSend.push(customLinks);
        }

        // Auto-discover route CSS & JS assets via AssetManager
        if (auto) {
          const assetManager = fsy?.assetManager || getAssetManager();
          if (assetManager && typeof assetManager.getRouteAssetCandidates === 'function') {
            const candidates = assetManager.getRouteAssetCandidates(
              descriptor.source || descriptor.file,
              descriptor.path
            );
            if (Array.isArray(candidates)) {
              for (const cand of candidates) {
                if (typeof assetManager.hasPageCss === 'function' && assetManager.hasPageCss(cand)) {
                  linksToSend.push(assetManager.pageCssUrl(cand));
                  break;
                }
              }
              for (const cand of candidates) {
                if (typeof assetManager.hasPageJs === 'function' && assetManager.hasPageJs(cand)) {
                  linksToSend.push(assetManager.pageJsUrl(cand));
                  break;
                }
              }
            }
          }
        }

        if (linksToSend.length > 0) {
          sendEarlyHints(res, linksToSend);
        }
      }

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
        let pageHead = headData;
        let pageAssetsActive = false;
        const pageAssetsOpt = context.pageAssets || (appOptions && appOptions.pageAssets);
        if (pageAssetsOpt) {
          const pageAssetsResolved = resolvePageAssets(pageAssetsOpt);
          if (pageAssetsResolved.enabled) {
            const pageAssetBundle = applyPageAssetsToTemplateData(
              pageAssetsResolved,
              loadedData,
              {
                file: descriptor.source || descriptor.file,
                routePath: descriptor.path,
              },
              fsy?.assetManager || getAssetManager()
            );
            loadedData = pageAssetBundle.data;
            pageHead = {
              ...headData,
              stylesheets: [...(headData.stylesheets || []), ...(pageAssetBundle.pageHead?.stylesheets || [])],
              scripts: [...(headData.scripts || []), ...(pageAssetBundle.pageHead?.scripts || [])],
            };
            pageAssetsActive = true;
          }
        }

        const templateData = {
          ...loadedData,
          head: pageHead,
          pageHead,
          pageAssets: pageAssetsActive || Boolean(loadedData.pageAssets),
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
