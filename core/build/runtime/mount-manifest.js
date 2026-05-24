/**
 * Mount routes from build manifest (no fs scan, no dynamic require)
 * @module core/build/runtime/mount-manifest
 */

const { ZodError } = require('zod');
const { compileSchema } = require('../../compileSchema');
const { applySchema } = require('../../applySchema');
const { createHelpers } = require('../../../src/helpers');
const {
  detectLocale,
  createTranslator,
  resolveMiddlewares,
  routeRegistrationMeta,
  resolvePageAssets,
  applyPageAssetsToTemplateData,
} = require('../../../src/file-router');

/**
 * Merge i18n namespaces from manifest for a locale
 * @param {Record<string, Record<string, unknown>>} i18nMap
 * @param {string[]} namespaces
 * @param {string} locale
 */
function loadI18nFromManifest(i18nMap, namespaces, locale) {
  /** @type {Record<string, unknown>} */
  let merged = {};
  for (const ns of namespaces) {
    const parts = ns.split(':');
    const nsLocale = parts[parts.length - 1];
    if (nsLocale !== locale && !ns.endsWith(`:${locale}`)) {
      if (ns.startsWith('global:')) {
        const loc = ns.replace('global:', '');
        if (loc !== locale) continue;
      } else {
        continue;
      }
    }
    const data = i18nMap[ns];
    if (data) merged = { ...merged, ...data };
  }
  for (const [key, data] of Object.entries(i18nMap)) {
    if (key.startsWith('global:') && key === `global:${locale}`) {
      merged = { ...data, ...merged };
    }
  }
  return merged;
}

async function executeHook(hooks, hookName, ctx, ...extra) {
  if (hooks && typeof hooks[hookName] === 'function') {
    await hooks[hookName](ctx, ...extra);
  }
}

async function runRouteMiddlewareChain(req, res, middlewares) {
  for (const mw of middlewares) {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
      try {
        const result = mw(req, res, finish);
        if (result && typeof result.then === 'function') {
          result.then(() => finish()).catch(finish);
          return;
        }
        if (res._handled || res._ended) {
          setImmediate(finish);
        }
      } catch (err) {
        finish(err);
      }
    });
    if (res._handled || res._ended) break;
  }
}

/**
 * @param {object} app
 * @param {object} options
 * @param {import('../types').WebspressoManifest} options.manifest
 * @param {Record<string, Function>} options.handlers
 * @param {object} [options.nunjucks]
 * @param {object} [options.middlewares]
 * @param {object} [options.pluginManager]
 * @param {boolean} [options.silent]
 * @param {object} [options.db]
 * @param {object} [options.clientRuntime]
 * @param {unknown} [options.pageAssets]
 * @param {object} [options.globalHooksModule]
 */
function mountPagesFromManifest(app, options) {
  const {
    manifest,
    handlers,
    nunjucks,
    middlewares = {},
    pluginManager = null,
    silent = false,
    db = null,
    clientRuntime = { alpine: false, swup: false },
    pageAssets: pageAssetsOpt = null,
    globalHooksModule = null,
  } = options;

  const pageAssetsResolved = resolvePageAssets(pageAssetsOpt);
  const log = silent ? () => {} : console.log.bind(console);
  const routes = [...manifest.routes].sort((a, b) => a.registrationIndex - b.registrationIndex);

  const apiStatic = routes.filter((r) => r.type === 'api' && r.tier === 0);
  const apiDynamic = routes.filter((r) => r.type === 'api' && r.tier !== 0);
  const ssrStatic = routes.filter((r) => r.type === 'ssr' && r.tier === 0);
  const ssrDynamic = routes.filter((r) => r.type === 'ssr' && r.tier !== 0);

  const globalHooks = globalHooksModule || (manifest.hooks?.global ? handlers._global_hooks : null);

  const registerApiRoutes = (list) => {
    for (const route of list) {
      const exportKey = route.handler.export;
      const handlerFn = handlers[exportKey];
      const mwConfig = route.middleware || [];
      const preResolvedMw = resolveMiddlewares(mwConfig, middlewares);

      if (typeof handlerFn !== 'function') {
        console.warn(`Manifest API route ${route.id} handler "${exportKey}" is not a function`);
        continue;
      }

      app[route.method](route.pattern, async (req, res, next) => {
        try {
          if (db != null) req.db = db;

          const cacheKey = route.id;
          const schemaFn = handlers[`${exportKey}_schema`];
          let compiledSchema;
          try {
            compiledSchema = compileSchema(cacheKey, { schema: schemaFn });
          } catch (schemaErr) {
            if (schemaFn) {
              console.error(`API schema compile error ${route.pattern}:`, schemaErr);
              res.status(500).json({ error: 'Internal Server Error', message: schemaErr.message });
              return;
            }
            compiledSchema = null;
          }

          try {
            applySchema(req, compiledSchema);
          } catch (err) {
            if (err instanceof ZodError) {
              return res.status(400).json({ error: 'Validation Error', issues: err.issues });
            }
            throw err;
          }

          if (preResolvedMw.length) {
            await runRouteMiddlewareChain(req, res, preResolvedMw);
            if (res._handled || res._ended) return;
          }

          await handlerFn(req, res, next);
        } catch (err) {
          console.error(`API error ${route.pattern}:`, err);
          return next(err);
        }
      });

      log(`  ${route.method.toUpperCase()} ${route.pattern} -> ${route.source.file} [manifest]`);
    }
  };

  const registerSsrRoutes = (list) => {
    for (const route of list) {
      const configExport = route.handler.configExport;
      const configMod = configExport ? handlers[configExport] : null;
      const config = configMod?.default || configMod;
      const preResolvedPageMw = config?.middleware
        ? resolveMiddlewares(config.middleware, middlewares)
        : [];
      const routeHooks = config?.hooks || {};
      const tpl = route.template ? manifest.templates[route.template.id] : null;

      app.get(route.pattern, async (req, res, next) => {
        try {
          const locale = detectLocale(req);
          const namespaces = route.i18n?.namespaces || [];
          const translations = loadI18nFromManifest(manifest.i18n, namespaces, locale);
          const t = createTranslator(translations);
          const baseHelpers = createHelpers({ req, res, locale });
          const pluginHelpers = pluginManager ? pluginManager.getHelpers() : {};

          const metaPatch = tpl?.frontmatter?.metaPatch || route.seo || {};
          const dataPatch = tpl?.frontmatter?.dataPatch || {};

          const ctx = {
            req,
            res,
            db,
            path: route.pattern,
            file: route.source.page,
            locale,
            t,
            data: { ...dataPatch },
            meta: {
              title: t('meta.title') !== 'meta.title' ? t('meta.title') : null,
              description: t('meta.description') !== 'meta.description' ? t('meta.description') : null,
              indexable: true,
              canonical: null,
              ...metaPatch,
            },
            fsy: { ...baseHelpers, ...pluginHelpers },
            clientRuntime,
          };

          await executeHook(globalHooks, 'onRequest', ctx);
          await executeHook(routeHooks, 'onRequest', ctx);
          await executeHook(globalHooks, 'onRoute', ctx);
          await executeHook(routeHooks, 'onRoute', ctx);
          await executeHook(globalHooks, 'beforeMiddleware', ctx);
          await executeHook(routeHooks, 'beforeMiddleware', ctx);

          if (preResolvedPageMw.length) {
            await runRouteMiddlewareChain(req, res, preResolvedPageMw);
            if (res._handled || res._ended) return;
          }

          await executeHook(globalHooks, 'afterMiddleware', ctx);
          await executeHook(routeHooks, 'afterMiddleware', ctx);
          await executeHook(globalHooks, 'beforeLoad', ctx);
          await executeHook(routeHooks, 'beforeLoad', ctx);

          if (config?.load && typeof config.load === 'function') {
            const loadData = await config.load(req, ctx);
            ctx.data = { ...ctx.data, ...loadData };
          }

          await executeHook(globalHooks, 'afterLoad', ctx);
          await executeHook(routeHooks, 'afterLoad', ctx);

          if (config?.meta && typeof config.meta === 'function') {
            const metaData = await config.meta(req, ctx);
            ctx.meta = { ...ctx.meta, ...metaData };
          }

          await executeHook(globalHooks, 'beforeRender', ctx);
          await executeHook(routeHooks, 'beforeRender', ctx);

          const pageAssetBundle = applyPageAssetsToTemplateData(pageAssetsResolved, ctx.data);
          ctx.data = pageAssetBundle.data;
          const renderContext = {
            ...ctx.data,
            meta: ctx.meta,
            locale: ctx.locale,
            t: ctx.t,
            fsy: ctx.fsy,
            clientRuntime: ctx.clientRuntime,
            req: { path: req.path, query: req.query, params: req.params },
          };
          if (pageAssetBundle.pageAssets) {
            renderContext.pageAssets = true;
            renderContext.pageHead = pageAssetBundle.pageHead;
          }

          let html;
          if (tpl && tpl.body && nunjucks) {
            html = nunjucks.renderString(tpl.body, renderContext, { path: route.source.page });
          } else {
            html = `<html><body>Missing template ${route.template?.id}</body></html>`;
          }

          ctx.html = html;
          await executeHook(globalHooks, 'afterRender', ctx);
          await executeHook(routeHooks, 'afterRender', ctx);
          res.send(ctx.html);
        } catch (err) {
          console.error(`SSR error ${route.pattern}:`, err);
          const errCtx = { req, res, error: err };
          try {
            await executeHook(globalHooks, 'onError', errCtx, err);
          } catch (hookErr) {
            console.error('Error in onError hook:', hookErr);
          }
          return next(err);
        }
      });

      log(`  GET ${route.pattern} -> ${route.source.page} [manifest]`);
    }
  };

  registerApiRoutes(apiStatic);
  registerSsrRoutes(ssrStatic);

  const registerDynamicFileRoutes = () => {
    registerApiRoutes(apiDynamic);
    registerSsrRoutes(ssrDynamic);
  };

  const routeMetadata = routes.map((r) => ({
    type: r.type,
    method: r.type === 'api' ? r.method : 'get',
    pattern: r.pattern,
    file: r.source.file || r.source.page,
    isDynamic: r.tier !== 0,
  }));

  return { routeMetadata, registerDynamicFileRoutes };
}

module.exports = { mountPagesFromManifest, loadI18nFromManifest };
