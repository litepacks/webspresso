/**
 * Edge-safe createApp for Cloudflare Workers (manifest mode, no fs scan / auth / plugins)
 * @module core/build/runtime/create-worker-app
 */

const nunjucks = require('nunjucks');
const { PrecompiledLoader } = require('nunjucks/src/precompiled-loader');
const { setAppContext } = require('../../../src/app-context');
const { createHelpers } = require('../../../src/helpers');
const { detectLocale } = require('../../../src/router-edge');
const { mountPagesFromManifest } = require('./mount-manifest');
const { resolveWorkerDb } = require('./resolve-worker-db');
const {
  createCompatApp,
  getDefaultHelmetConfig,
  helmetToSecureHeaders,
  preferJsonErrorResponse,
  buildReq,
  getCompatRes,
} = require('../../../src/http');

function defaultErrorPageStyles() {
  return `
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f5f5; }
    .card { background: #fff; border-radius: 12px; padding: 2rem; text-align: center; }
  `;
}

function default404Html() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>404</title><style>${defaultErrorPageStyles()}</style></head><body><motion.div class="card"><h1>404</h1><p>Page not found</p></motion.div></body></html>`.replace(/motion\./g, '');
}

function default500Html(err, isDev) {
  const detail = isDev && err ? `<pre>${String(err.stack || err.message).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>500</title><style>${defaultErrorPageStyles()}</style></head><body><motion.div class="card"><h1>500</h1><p>Internal Server Error</p>${detail}</motion.div></body></html>`.replace(/motion\./g, '');
}

function default503Html() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>503</title><style>${defaultErrorPageStyles()}</style></head><body><motion.div class="card"><h1>503</h1><p>Request timed out</p></motion.div></body></html>`.replace(/motion\./g, '');
}

/**
 * Nunjucks loader backed by manifest template bodies (no filesystem).
 * @param {Record<string, { body?: string }>} templates
 */
function createManifestLoader(templates) {
  /** @type {Record<string, string>} */
  const byName = {};
  for (const [key, tpl] of Object.entries(templates || {})) {
    if (!tpl?.body) continue;
    const base = key.includes(':') ? key.split(':').pop() : key;
    byName[base] = tpl.body;
    byName[key] = tpl.body;
  }

  return {
    async: false,
    getSource(name) {
      const src = byName[name];
      if (src == null) return null;
      return { src, path: name, noCache: true };
    },
  };
}

function addNunjucksFilters(env) {
  env.addFilter('json', (obj) => JSON.stringify(obj, null, 2));
  env.addFilter('date', (date, format = 'short') => {
    const d = new Date(date);
    if (format === 'short') return d.toLocaleDateString();
    if (format === 'long') {
      return d.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    if (format === 'iso') return d.toISOString();
    return d.toString();
  });
}

/**
 * @param {object} options
 * @param {import('../types').WebspressoManifest} options.manifest
 * @param {Record<string, unknown>} options.handlers
 * @param {object} [options.bindings]
 */
function createWorkerApp(options = {}) {
  const NODE_ENV = process.env.NODE_ENV || 'production';
  const isDev = NODE_ENV !== 'production';

  const {
    manifest,
    handlers,
    bindings,
    pagesDir,
    middlewares = {},
    helmet: helmetConfig,
    errorPages = {},
    timeout: timeoutConfig = false,
    logging = false,
    clientRuntime = { alpine: false, swup: false },
    pageAssets = null,
    precompiledTemplates = null,
    db = null,
  } = options;

  if (!manifest || !handlers) {
    throw new Error('createWorkerApp requires manifest and handlers');
  }
  if (!pagesDir) {
    throw new Error('pagesDir is required');
  }

  const resolvedDb = resolveWorkerDb(bindings, db, {
    modulePaths: options.modulePaths,
    dbRuntime: options.dbRuntime,
  });

  setAppContext({ db: resolvedDb ?? null, bindings: bindings ?? null });

  const cookieSecret =
    process.env.SESSION_SECRET ||
    process.env.AUTH_SESSION_SECRET ||
    'webspresso-worker-secret-change-me-32chars';

  const app = createCompatApp({ cookieSecret });

  if (helmetConfig !== false) {
    const defaultConfig = getDefaultHelmetConfig(isDev);
    const finalConfig =
      helmetConfig === undefined || helmetConfig === true
        ? defaultConfig
        : { ...defaultConfig, ...helmetConfig };
    app.useSecureHeaders(helmetToSecureHeaders(finalConfig));
  }

  if (timeoutConfig !== false) {
    app.mountTimeout(timeoutConfig);
    app.mountHaltOnTimedout();
  }

  app.mountBodyParsers();

  let nunjucksEnv;
  if (precompiledTemplates && Object.keys(precompiledTemplates).length > 0) {
    nunjucksEnv = new nunjucks.Environment(new PrecompiledLoader(precompiledTemplates), {
      autoescape: true,
      watch: false,
      noCache: true,
    });
  } else {
    const loader = createManifestLoader(manifest.templates);
    nunjucksEnv = new nunjucks.Environment(loader, {
      autoescape: true,
      watch: false,
      noCache: true,
    });
  }
  addNunjucksFilters(nunjucksEnv);

  if (logging) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
      });
      next();
    });
  }

  const { registerDynamicFileRoutes } = mountPagesFromManifest(app, {
    manifest,
    handlers,
    nunjucks: nunjucksEnv,
    middlewares,
    pluginManager: null,
    silent: !logging,
    db: resolvedDb,
    clientRuntime,
    pageAssets,
    globalHooksModule: handlers._global_hooks,
  });

  registerDynamicFileRoutes();

  const httpOpts = { cookieSecret };

  function createErrorContext(req, extraData = {}) {
    const locale = detectLocale(req);
    const fsy = createHelpers({ req, res: {}, locale });
    return {
      fsy,
      locale,
      isDev,
      url: req.url,
      method: req.method,
      ...extraData,
    };
  }

  app.notFound(async (c) => {
    const req = buildReq(c, httpOpts);
    const res = getCompatRes(c, httpOpts);
    res.status(404);
    const ctx = createErrorContext(req);

    if (typeof errorPages.notFound === 'function') {
      await errorPages.notFound(req, res, ctx);
      const ret = c.get('compatReturnValue');
      if (ret) return ret;
      return;
    }

    if (typeof errorPages.notFound === 'string') {
      try {
        const html = nunjucksEnv.render(errorPages.notFound, ctx);
        return await res.send(html);
      } catch (e) {
        console.error('Error rendering 404 template:', e);
      }
    }

    if (req.accepts('html')) {
      return await res.send(default404Html());
    }
    return await res.json({ error: 'Not Found', status: 404 });
  });

  app.onError(async (c, err) => {
    const req = buildReq(c, httpOpts);
    const res = getCompatRes(c, httpOpts);

    if (req.timedout) {
      res.status(503);
      if (!preferJsonErrorResponse(req)) {
        return await res.send(default503Html());
      }
      return await res.json({ error: 'Request Timeout', status: 503 });
    }

    console.error('Worker error:', err);
    res.status(err.status || 500);
    const ctx = createErrorContext(req, {
      error: isDev ? err : { message: 'Internal Server Error' },
      status: err.status || 500,
    });

    if (typeof errorPages.serverError === 'function') {
      await errorPages.serverError(err, req, res, ctx);
      const ret = c.get('compatReturnValue');
      if (ret) return ret;
      return;
    }

    if (!preferJsonErrorResponse(req)) {
      return await res.send(default500Html(err, isDev));
    }
    return await res.json({
      error: 'Internal Server Error',
      status: err.status || 500,
      ...(isDev && { message: err.message, stack: err.stack }),
    });
  });

  return { app, nunjucksEnv };
}

module.exports = { createWorkerApp };
