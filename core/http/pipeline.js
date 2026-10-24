'use strict';

/**
 * Webspresso HTTP Pipeline Layer
 * Framework-agnostic execution pipelines for API endpoints and SSR routes
 * @module core/http/pipeline
 */

const fs = require('fs');
const path = require('path');
const { ZodError } = require('zod');
const { translateValidationIssues, getTranslatorForRequest } = require('../../src/api/validation-i18n');
const { runWithContext } = require('../context/request');
const { detectLocale, loadI18n, createTranslator, resolvePageAssets, applyPageAssetsToTemplateData } = require('../../src/file-router');
const { createHelpers, getAssetManager } = require('../../src/helpers');
const { sendEarlyHints } = require('../early-hints');

/**
 * Validates request input against compiled schema
 * @param {Object} req - Request object
 * @param {Object} compiledSchema - Compiled Zod schema object
 */
function validateRequestInput(req, compiledSchema) {
  req.input = {
    body: undefined,
    params: undefined,
    query: undefined,
    headers: undefined,
  };

  if (!compiledSchema) return;

  if (compiledSchema.body && typeof compiledSchema.body.parse === 'function') {
    req.input.body = compiledSchema.body.parse(req.body);
  } else {
    req.input.body = req.body;
  }

  if (compiledSchema.params && typeof compiledSchema.params.parse === 'function') {
    req.input.params = compiledSchema.params.parse(req.params);
  } else {
    req.input.params = req.params;
  }

  if (compiledSchema.query && typeof compiledSchema.query.parse === 'function') {
    req.input.query = compiledSchema.query.parse(req.query);
  } else {
    req.input.query = req.query;
  }

  if (compiledSchema.headers && typeof compiledSchema.headers.parse === 'function') {
    req.input.headers = compiledSchema.headers.parse(req.headers);
  }
}

/**
 * Runs a sequence of middleware functions.
 * Supports Express-style (req, res, next), 2-arg modern async (req, res),
 * error propagation, and response termination detection.
 *
 * @param {Function[]} middlewares
 * @param {Object} req
 * @param {Object} res
 * @returns {Promise<void>}
 */
async function runMiddlewares(middlewares, req, res) {
  if (!Array.isArray(middlewares) || middlewares.length === 0) return;

  for (const mw of middlewares) {
    if (typeof mw !== 'function') continue;

    // Fast-path: if response already finished/flushed, stop executing chain
    if (res && (res.headersSent || res.writableEnded || res.finished)) return;

    await new Promise((resolve, reject) => {
      let settled = false;
      const prevEnd = typeof res?.end === 'function' ? res.end : null;

      const done = (err) => {
        if (settled) return;
        settled = true;
        if (res && prevEnd && res.end !== prevEnd) {
          res.end = prevEnd;
        }
        if (err) reject(err);
        else resolve();
      };

      if (prevEnd) {
        res.end = function (...args) {
          if (res && prevEnd) res.end = prevEnd;
          const ret = prevEnd.apply(this, args);
          done();
          return ret;
        };
      }

      try {
        const ret = mw(req, res, (err) => {
          done(err);
        });

        if (ret && typeof ret.then === 'function') {
          ret.then(
            () => {
              // Auto-advance for 2-arg async middlewares or when response was sent
              if (mw.length < 3 || (res && (res.headersSent || res.writableEnded || res.finished))) {
                done();
              }
            },
            (asyncErr) => {
              // Asynchronous exception in async middleware caught and forwarded
              done(asyncErr);
            }
          );
        } else if (mw.length < 3 || (res && (res.headersSent || res.writableEnded || res.finished))) {
          done();
        }
      } catch (syncErr) {
        done(syncErr);
      }
    });

    if (res && (res.headersSent || res.writableEnded || res.finished)) return;
  }
}

/**
 * Creates a reusable pipeline runner function for a middleware array
 * @param {Function[]} [middlewares=[]]
 * @returns {(req: any, res: any) => Promise<void>}
 */
function createPipelineRunner(middlewares = []) {
  const mws = Array.isArray(middlewares) ? middlewares.slice() : [];
  return function pipelineRunner(req, res) {
    return runMiddlewares(mws, req, res);
  };
}

/**
 * Decorates an error with route execution metadata
 * @param {Error} err
 * @param {Object} [descriptor]
 * @param {Object} [req]
 * @returns {Error}
 */
function enrichRouteError(err, descriptor = {}, req = {}) {
  if (err && typeof err === 'object') {
    if (!err.route && descriptor?.path) err.route = descriptor.path;
    if (!err.method) err.method = descriptor?.method ? descriptor.method.toUpperCase() : (req?.method || 'GET');
    if (!err.source && (descriptor?.source || descriptor?.file)) err.source = descriptor.source || descriptor.file;
    if (!err.file && descriptor?.file) err.file = descriptor.file;
    if (!err.module && descriptor?.module) err.module = descriptor.module;
    if (!err.phase) err.phase = descriptor?.type === 'page' ? 'page' : 'handler';
    if (!err.requestId) err.requestId = (req && (req.id || (req.headers && req.headers['x-request-id']))) || null;
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
    descriptor = {},
    context = {},
    apiDef,
    handlerFn,
    compiledSchema,
    middlewares = [],
    req,
    res,
  } = params;

  try {
    const appOptions = context.options || {};
    const isDev = context.isDev !== undefined
      ? context.isDev
      : (appOptions.isDev !== undefined ? appOptions.isDev : process.env.NODE_ENV === 'development');
    const db = context.db || req.db;
    const serviceRegistry = context.serviceRegistry;

    // 1. Injections
    if (db && !req.db) req.db = db;
    if (!req.service && serviceRegistry) {
      const getCallContext = (explicitCtx) => {
        if (explicitCtx) return explicitCtx;
        const ctx = req.context ? { ...req.context } : { req, res, db: req.db || db };
        if (!ctx.req) ctx.req = req;
        if (!ctx.res) ctx.res = res;
        if (!ctx.db) ctx.db = req.db || db;
        if (req.user !== undefined) ctx.user = req.user;
        if (req.auth !== undefined) ctx.auth = req.auth;
        if (req.session !== undefined) ctx.session = req.session;
        return ctx;
      };
      req.service = (name, input, opts) => {
        return serviceRegistry.call(name, input, getCallContext(opts?.ctx), opts);
      };
      req.service.call = req.service;
      req.service.execute = req.service;
      req.service.invalidate = (name, input, ctx) =>
        serviceRegistry.invalidate(name, input, getCallContext(ctx));
      req.service.clearCache = (name) =>
        serviceRegistry.clearCache(name);
      req.service.invalidateByTag = (tag, serviceName) =>
        serviceRegistry.invalidateByTag(tag, serviceName);
      req.service.invalidateByTags = (tags, serviceName) =>
        serviceRegistry.invalidateByTags(tags, serviceName);
      req.service.invalidateTag = req.service.invalidateByTag;
      req.service.invalidateTags = req.service.invalidateByTags;
    }

    // 2. Schema validation
    const pagesDir = context.pagesDir || appOptions.pagesDir || 'pages';
    const routeDir = descriptor._routeDir !== undefined
      ? descriptor._routeDir
      : (descriptor._routeDir = descriptor.file ? path.dirname(descriptor.file) : '');

    if (compiledSchema) {
      try {
        validateRequestInput(req, compiledSchema);
      } catch (err) {
        if (err instanceof ZodError || err.name === 'ZodError' || Array.isArray(err?.issues)) {
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

    // 3. Build Context
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
      logger: req.logger || console,
      db,
      user: req.user,
      auth: req.auth,
      session: req.session,
      queue: req.queue || context.queue || null,
      cache: req.cache || context.cache || null,
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

    // 4. Execute within Ambient Request Context
    return await runWithContext(apiCtx, async () => {
      if (middlewares.length > 0) {
        await runMiddlewares(middlewares, req, res);
        if (res && (res.headersSent || res.writableEnded || res.finished)) return;
      }

      const result = await handlerFn(req, res, apiCtx);

      // 5. Auto-respond if handler returned a value and response not yet sent
      if (res && !res.headersSent && !res.writableEnded && !res.finished) {
        if (result !== undefined && typeof res.json === 'function') {
          res.json(result);
          return result;
        }
      }

      return result;
    });
  } catch (err) {
    enrichRouteError(err, descriptor, req);
    throw err;
  }
}

/**
 * Executes an SSR page route pipeline
 * @param {Object} params
 */
async function executePagePipeline(params) {
  const {
    descriptor = {},
    context = {},
    pageDef,
    middlewares = [],
    req,
    res,
    nunjucks,
    njkCandidate,
    hasNjkTemplate,
  } = params;

  try {
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
      req.service.call = req.service;
      req.service.execute = req.service;
      req.service.invalidate = (name, input, ctx) =>
        serviceRegistry.invalidate(name, input, ctx || baseContext);
      req.service.clearCache = (name) =>
        serviceRegistry.clearCache(name);
      req.service.invalidateByTag = (tag, serviceName) =>
        serviceRegistry.invalidateByTag(tag, serviceName);
      req.service.invalidateByTags = (tags, serviceName) =>
        serviceRegistry.invalidateByTags(tags, serviceName);
      req.service.invalidateTag = req.service.invalidateByTag;
      req.service.invalidateTags = req.service.invalidateByTags;
    }

    // 2. Build Page Context
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 7331}`;
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
      logger: req.logger || console,
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
      renderStream: (tpl, data = {}, opts = {}) => {
        if (res && typeof res.renderStream === 'function') {
          return res.renderStream(tpl, data, opts);
        }
        const { renderStream } = require('../ssr/stream');
        return renderStream(res, tpl, data, { env: nunjucks, ...opts });
      },
      streamText: (sourceOrCallback, maybeOptions) => {
        if (res && typeof res.streamText === 'function') {
          return res.streamText(sourceOrCallback, maybeOptions);
        }
        const { streamText } = require('../stream/text-stream');
        return streamText(req, res, sourceOrCallback, maybeOptions);
      },
      streamJson: (sourceOrCallback, maybeOptions) => {
        if (res && typeof res.streamJson === 'function') {
          return res.streamJson(sourceOrCallback, maybeOptions);
        }
        const { streamJson } = require('../stream/text-stream');
        return streamJson(req, res, sourceOrCallback, maybeOptions);
      },
      fsy,
      locale,
      t,
      db,
      user: req.user,
      auth: req.auth,
      session: req.session,
      queue: req.queue || context.queue || null,
      cache: req.cache || context.cache || null,
    };

    req.ctx = pageCtx;

    // 3. Execute within Ambient Request Context
    return await runWithContext(pageCtx, async () => {
      // 3.1. Middlewares
      if (middlewares.length > 0) {
        await runMiddlewares(middlewares, req, res);
        if (res && (res.headersSent || res.writableEnded || res.finished)) return;
      }

      // 4. Early Hints
      const earlyHintsOpt = pageDef.earlyHints !== undefined
        ? pageDef.earlyHints
        : (descriptor.earlyHints !== undefined
            ? descriptor.earlyHints
            : (appOptions && (appOptions.earlyHints ?? appOptions.server?.earlyHints)));

      if (earlyHintsOpt && earlyHintsOpt !== false && res && !res.headersSent && !res.writableEnded && !res.finished) {
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
        if (loadedData.__redirected || (res && (res.headersSent || res.writableEnded || res.finished))) {
          return;
        }
      }

      // 6. Run head() lifecycle
      let headData = {};
      if (typeof pageDef.head === 'function') {
        headData = (await pageDef.head(loadedData, pageCtx)) || {};
      }

      // 7. Check for companion Nunjucks template
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

        const isStreaming = Boolean(
          pageDef.stream ||
          descriptor.stream ||
          loadedData.__stream ||
          loadedData.stream ||
          loadedData.defer ||
          loadedData.__defer
        );

        if (isStreaming && res && !res.headersSent) {
          const { renderStream } = require('../ssr/stream');
          const streamDefer = loadedData.defer || loadedData.__defer || pageDef.defer || {};
          return await renderStream(res, njkCandidate, templateData, {
            env: nunjucks,
            defer: streamDefer,
            status: 200,
            loadingTemplate: pageDef.loadingTemplate || descriptor.loadingTemplate,
            layouts: pageDef.layouts || descriptor.layouts,
          });
        }

        return new Promise((resolve, reject) => {
          nunjucks.render(njkCandidate, templateData, (err, html) => {
            if (err) return reject(err);
            if (res && !res.headersSent && !res.writableEnded && !res.finished) {
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
        if (res && !res.headersSent && !res.writableEnded && !res.finished) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(html);
        }
        return html;
      }

      // 9. Fallback: if json or data
      if (typeof loadedData === 'object' && loadedData !== null) {
        if (res && !res.headersSent && !res.writableEnded && !res.finished && typeof res.json === 'function') {
          return res.json(loadedData);
        }
        return loadedData;
      }

      if (res && !res.headersSent && !res.writableEnded && !res.finished && typeof res.send === 'function') {
        return res.send(String(loadedData));
      }
      return String(loadedData);
    });
  } catch (err) {
    enrichRouteError(err, descriptor, req);
    throw err;
  }
}

module.exports = {
  createPipelineRunner,
  runMiddlewares,
  enrichRouteError,
  validateRequestInput,
  executeApiPipeline,
  executePagePipeline,
};
