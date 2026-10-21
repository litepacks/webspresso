'use strict';

/**
 * Webspresso HTTP Pipeline Layer
 * Framework-agnostic execution pipelines for API endpoints and SSR routes
 * @module core/http/pipeline
 */

const path = require('path');
const { ZodError } = require('zod');
const { translateValidationIssues, getTranslatorForRequest } = require('../../src/api/validation-i18n');

/**
 * Runs a sequence of middleware functions
 * Supports Express-style (req, res, next)
 * @param {Function[]} middlewares
 * @param {Object} req
 * @param {Object} res
 */
async function runMiddlewares(middlewares, req, res) {
  if (!Array.isArray(middlewares)) return;

  for (const mw of middlewares) {
    if (typeof mw !== 'function') continue;
    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      const prevEnd = res?.end;
      if (res && typeof res.end === 'function') {
        res.end = function (...args) {
          const ret = prevEnd.apply(this, args);
          done();
          return ret;
        };
      }

      try {
        mw(req, res, (err) => {
          done(err);
        });
      } catch (syncErr) {
        done(syncErr);
      }
    });
    if (res && res.headersSent) return;
  }
}

/**
 * Decorates an error with route execution metadata
 * @param {Error} err
 * @param {Object} descriptor
 * @param {Object} req
 * @returns {Error}
 */
function enrichRouteError(err, descriptor, req) {
  if (err && typeof err === 'object') {
    if (!err.route) err.route = descriptor.path;
    if (!err.method) err.method = descriptor.method ? descriptor.method.toUpperCase() : (req.method || 'GET');
    if (!err.source) err.source = descriptor.source || descriptor.file;
    if (!err.file) err.file = descriptor.file;
    if (!err.module) err.module = descriptor.module || null;
    if (!err.phase) err.phase = descriptor && descriptor.type === 'page' ? 'page' : 'handler';
    if (!err.requestId) err.requestId = req && (req.id || (req.headers && req.headers['x-request-id'])) || null;
  }
  return err;
}

/**
 * Executes an API endpoint pipeline
 * @param {Object} params
 * @param {Object} params.descriptor
 * @param {Object} params.context
 * @param {Object} params.apiDef
 * @param {Function} params.handlerFn
 * @param {Object} [params.compiledSchema]
 * @param {Function[]} [params.middlewares]
 * @param {Object} params.req
 * @param {Object} params.res
 * @returns {Promise<any>}
 */
async function executeApiPipeline(params) {
  const {
    descriptor,
    context = {},
    apiDef,
    handlerFn,
    compiledSchema,
    middlewares = [],
    req,
    res,
  } = params;

  const appOptions = context.options || {};
  const isDev = context.isDev !== undefined
    ? context.isDev
    : (appOptions.isDev !== undefined ? appOptions.isDev : process.env.NODE_ENV === 'development');
  const db = context.db || req.db;
  const serviceRegistry = context.serviceRegistry;

  // 1. Injections
  if (db && !req.db) req.db = db;
  if (!req.service && serviceRegistry) {
    req.service = (name, input, opts) => {
      const baseContext = req.context || { req, res, db, user: req.user, session: req.session };
      return serviceRegistry.call(name, input, baseContext, opts);
    };
  }

  // 2. Schema validation
  if (compiledSchema) {
    try {
      const { validateRequestInput } = require('../../src/api/api-loader');
      validateRequestInput(req, compiledSchema);
    } catch (err) {
      if (err instanceof ZodError || err.name === 'ZodError' || Array.isArray(err?.issues)) {
        const pagesDir = context.pagesDir || appOptions.pagesDir || 'pages';
        const routeDir = descriptor.file ? path.dirname(descriptor.file) : '';
        const translatedIssues = translateValidationIssues(err.issues, {
          req,
          pagesDir,
          routeDir,
          isDev,
        });
        if (res && typeof res.status === 'function' && typeof res.json === 'function') {
          return res.status(400).json({
            error: 'Validation Error',
            issues: translatedIssues,
          });
        }
        const validationErr = new Error('Validation Error');
        validationErr.status = 400;
        validationErr.issues = translatedIssues;
        throw validationErr;
      }
      throw err;
    }
  } else {
    req.input = {
      body: req.body,
      params: req.params,
      query: req.query,
    };
  }

  // 2.5 Feature Flag Guard
  if (apiDef && apiDef.flag) {
    const flagKey = typeof apiDef.flag === 'string' ? apiDef.flag : apiDef.flag.key;
    const isEnabled = typeof req.hasFeature === 'function'
      ? req.hasFeature(flagKey)
      : ((context.app?.flags || context.flags)?.isEnabled(flagKey, req) ?? false);

    if (!isEnabled) {
      const statusCode = (typeof apiDef.flag === 'object' && apiDef.flag.statusCode) || 404;
      const message = (typeof apiDef.flag === 'object' && apiDef.flag.message) || (statusCode === 403 ? 'Forbidden' : 'Not Found');

      if (res && typeof res.status === 'function') {
        return res.status(statusCode).json({
          error: statusCode === 403 ? 'Forbidden' : 'Not Found',
          message,
          feature: flagKey,
        });
      }
      const notFound = new Error(message);
      notFound.status = statusCode;
      notFound.statusCode = statusCode;
      throw notFound;
    }
  }

  // 3. Middlewares
  if (middlewares.length > 0) {
    await runMiddlewares(middlewares, req, res);
    if (res && res.headersSent) return;
  }

  // 4. Build Context & Execute
  const pagesDir = context.pagesDir || appOptions.pagesDir || 'pages';
  const routeDir = descriptor.file ? path.dirname(descriptor.file) : '';
  const tr = getTranslatorForRequest(req, { pagesDir, routeDir, isDev });

  const apiCtx = {
    req,
    res,
    params: req.params || {},
    query: req.query || {},
    body: req.body || {},
    input: req.input,
    locale: tr.locale,
    t: tr.t,
    service: req.service
      ? req.service
      : (name, input, opts) =>
          serviceRegistry ? serviceRegistry.call(name, input, req.context || { req, res, db, user: req.user, session: req.session }, opts) : null,
    module: descriptor.module || null,
    config: appOptions,
    logger: console,
    db,
    flags: req.flags || null,
    hasFeature: typeof req.hasFeature === 'function' ? (k, c) => req.hasFeature(k, c) : () => false,
    getVariant: typeof req.getVariant === 'function' ? (k, c) => req.getVariant(k, c) : () => null,
    sse: (sourceOrOptions, maybeOptions) => (res && typeof res.sse === 'function' ? res.sse(sourceOrOptions, maybeOptions) : null),
    streamText: (sourceOrCallback, maybeOptions) => (res && typeof res.streamText === 'function' ? res.streamText(sourceOrCallback, maybeOptions) : null),
    streamJson: (sourceOrCallback, maybeOptions) => (res && typeof res.streamJson === 'function' ? res.streamJson(sourceOrCallback, maybeOptions) : null),
  };

  req.ctx = apiCtx;
  if (res) {
    res.service = apiCtx.service;
    res.input = apiCtx.input;
    res.module = apiCtx.module;
  }

  const result = await handlerFn(req, res, apiCtx);

  // 5. Auto-respond if handler returned a value and response not yet sent
  if (res && !res.headersSent) {
    if (result !== undefined && typeof res.json === 'function') {
      return res.json(result);
    }
  }

  return result;
}

/**
 * Executes an SSR page route pipeline
 * @param {Object} params
 */
async function executePagePipeline(params) {
  const {
    descriptor,
    context = {},
    pageDef,
    middlewares = [],
    req,
    res,
    nunjucks,
    njkCandidate,
    hasNjkTemplate,
  } = params;

  const appOptions = context.options || {};
  const isDev = context.isDev !== undefined
    ? context.isDev
    : (appOptions.isDev !== undefined ? appOptions.isDev : process.env.NODE_ENV === 'development');
  const db = context.db || req.db;
  const serviceRegistry = context.serviceRegistry;
  const pagesDir = context.pagesDir || appOptions.pagesDir || 'pages';

  // 1. Injections
  if (db && !req.db) req.db = db;
  if (!req.service && serviceRegistry) {
    const baseContext = req.context || { req, res, db, user: req.user, session: req.session };
    req.service = (name, input, opts) =>
      serviceRegistry.call(name, input, baseContext, opts);
  }

  // 2. Middlewares
  if (middlewares.length > 0) {
    await runMiddlewares(middlewares, req, res);
    if (res && res.headersSent) return;
  }

  // 3. Build Page Context
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 7331}`;
  const { detectLocale, loadI18n, createTranslator, resolvePageAssets, applyPageAssetsToTemplateData } = require('../../src/file-router');
  const { createHelpers, getAssetManager } = require('../../src/helpers');
  const { sendEarlyHints } = require('../early-hints');

  const locale = detectLocale(req);
  const fsy = createHelpers({ req, res, baseUrl, locale });

  const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
  let t;
  const translatorCache = context.translatorCache;
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
    service: req.service
      ? req.service
      : (name, input, opts) =>
          serviceRegistry ? serviceRegistry.call(name, input, req.context || { req, res, db, user: req.user, session: req.session }, opts) : null,
    module: descriptor.module || null,
    config: appOptions,
    logger: console,
    redirect: (url, status = 302) => {
      if (res && typeof res.redirect === 'function') {
        res.redirect(status, url);
      }
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

  // 4. Early Hints
  const earlyHintsOpt = pageDef.earlyHints !== undefined
    ? pageDef.earlyHints
    : (descriptor.earlyHints !== undefined
        ? descriptor.earlyHints
        : (appOptions && (appOptions.earlyHints ?? appOptions.server?.earlyHints)));

  if (earlyHintsOpt && earlyHintsOpt !== false && res && !res.headersSent) {
    const auto = typeof earlyHintsOpt === 'object' ? (earlyHintsOpt.auto !== false) : Boolean(earlyHintsOpt);
    const linksToSend = [];

    if (Array.isArray(earlyHintsOpt)) {
      linksToSend.push(...earlyHintsOpt);
    } else if (typeof earlyHintsOpt === 'object' && earlyHintsOpt.links) {
      const customLinks = typeof earlyHintsOpt.links === 'function' ? earlyHintsOpt.links(req) : earlyHintsOpt.links;
      if (Array.isArray(customLinks)) linksToSend.push(...customLinks);
      else if (customLinks) linksToSend.push(customLinks);
    }

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

  // 5. Run load() lifecycle
  let loadedData = {};
  if (typeof pageDef.load === 'function') {
    loadedData = (await pageDef.load(pageCtx)) || {};
    if (loadedData.__redirected || (res && res.headersSent)) {
      return;
    }
  }

  // 6. Run head() lifecycle
  let headData = {};
  if (typeof pageDef.head === 'function') {
    headData = (await pageDef.head(loadedData, pageCtx)) || {};
  }

  // 7. Check for companion Nunjucks template
  const fs = require('fs');
  const templateExists = hasNjkTemplate !== undefined && hasNjkTemplate !== null
    ? hasNjkTemplate
    : (njkCandidate ? fs.existsSync(njkCandidate) : false);

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

    return new Promise((resolve, reject) => {
      nunjucks.render(njkCandidate, templateData, (err, html) => {
        if (err) return reject(err);
        if (res) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.send(html);
        }
        resolve(html);
      });
    });
  }

  // 8. Render via definePage render() method
  if (typeof pageDef.render === 'function') {
    const html = await pageDef.render(loadedData, pageCtx);
    if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    return html;
  }

  // 9. Fallback: if json or data
  if (typeof loadedData === 'object' && loadedData !== null) {
    if (res && typeof res.json === 'function') {
      return res.json(loadedData);
    }
    return loadedData;
  }

  if (res && typeof res.send === 'function') {
    return res.send(String(loadedData));
  }
  return String(loadedData);
}

module.exports = {
  runMiddlewares,
  enrichRouteError,
  executeApiPipeline,
  executePagePipeline,
};
