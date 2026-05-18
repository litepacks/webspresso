/**
 * Webspresso Server
 * Hono SSR server with file-based routing (Express-compatible handler API)
 */

const nunjucks = require('nunjucks');
const { mountAppSession } = require('./http/session');

const { setAppContext } = require('./app-context');
const { mountClientRuntime } = require('./client-runtime/mount');
const { resolveClientRuntime } = require('./client-runtime/resolve');
const { mountPages, detectLocale } = require('./file-router');
const { configureAssets, createHelpers, getScriptInjector } = require('./helpers');
const { createPluginManager } = require('./plugin-manager');
const {
  createCompatApp,
  getDefaultHelmetConfig,
  helmetToSecureHeaders,
  preferJsonErrorResponse,
  buildReq,
  createCompatResponse,
  getCompatRes,
  runExpressHandlers,
} = require('./http');

/**
 * Shared CSS for built-in HTML error pages
 */
function defaultErrorPageStyles() {
  return `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
      background: #f5f5f5;
      color: #1a1a1a;
      -webkit-text-size-adjust: 100%;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #121212; color: #e8e8e8; }
      .card { background: #1e1e1e; border-color: #333; box-shadow: 0 1px 3px rgba(0,0,0,.35); }
      h1 { color: #f5f5f5; }
      .muted { color: #a3a3a3; }
      a { color: #7cc4ff; }
      pre { background: #0d0d0d; color: #e5e5e5; border-color: #333; }
    }
    .container { width: 100%; max-width: min(100%, 26rem); text-align: center; }
    .card {
      background: #fff; border: 1px solid #e5e5e5; border-radius: 12px;
      padding: clamp(1.25rem, 5vw, 2rem); box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }
    h1 {
      font-size: clamp(2.5rem, 12vw, 4rem); font-weight: 700; line-height: 1.05;
      margin: 0 0 0.35rem; letter-spacing: -0.02em; color: #262626;
    }
    .muted {
      margin: 0 0 1rem; line-height: 1.55; color: #525252;
      font-size: clamp(0.9375rem, 3.8vw, 1.0625rem);
    }
    a {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
      margin-top: 0.25rem; color: #0066cc; text-decoration: none; font-weight: 500;
      font-size: clamp(0.875rem, 3.5vw, 1rem); min-height: 44px; padding: 0.25rem 0.5rem;
    }
    a:hover { text-decoration: underline; }
    pre {
      margin: 1rem 0 0; padding: clamp(0.75rem, 3vw, 1rem); border-radius: 8px;
      text-align: left; font-size: clamp(0.625rem, 2.75vw, 0.8125rem); line-height: 1.45;
      overflow-x: auto; max-width: 100%; width: 100%; white-space: pre-wrap;
      word-break: break-word; background: #fff; border: 1px solid #e5e5e5;
    }
  `;
}

function default404Html() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>404 - Not Found</title>
  <style>${defaultErrorPageStyles()}</style>
</head>
<body>
  <motion.div class="container">
    <motion.div class="card">
      <h1>404</h1>
      <p class="muted">Page not found</p>
      <a href="/">← Back to Home</a>
    </motion.div>
  </motion.div>
</body>
</html>`.replace(/motion\./g, '');
}

function default500Html(err, isDev) {
  const detail =
    isDev && err
      ? `<pre>${String(err.stack || err.message)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</pre>`
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>500 - Server Error</title>
  <style>${defaultErrorPageStyles()}</style>
</head>
<body>
  <motion.div class="container">
    <motion.div class="card">
      <h1>500</h1>
      <p class="muted">Internal Server Error</p>
      ${detail}
      <a href="/">← Back to Home</a>
    </motion.div>
  </motion.div>
</body>
</html>`.replace(/motion\./g, '');
}

function default503Html() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>503 - Service Unavailable</title>
  <style>${defaultErrorPageStyles()}</style>
</head>
<body>
  <motion.div class="container">
    <motion.div class="card">
      <h1>503</h1>
      <p class="muted">Request timed out. Please try again.</p>
      <a href="/">← Back to Home</a>
    </motion.div>
  </motion.div>
</body>
</html>`.replace(/motion\./g, '');
}

/**
 * @param {Object} options
 * @returns {Object} { app, nunjucksEnv, pluginManager, authMiddleware }
 */
function createApp(options = {}) {
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const isDev = NODE_ENV !== 'production';
  const isTest = NODE_ENV === 'test';

  const {
    pagesDir,
    viewsDir,
    publicDir,
    logging = isDev && !isTest,
    helmet: helmetConfig,
    middlewares = {},
    plugins = [],
    assets: assetsConfig = {},
    errorPages = {},
    timeout: timeoutConfig = isTest ? false : '30s',
    auth: authManager = null,
    setupRoutes,
  } = options;

  const pluginManager = createPluginManager();

  configureAssets({
    publicDir: publicDir || 'public',
    ...assetsConfig,
  });

  if (!pagesDir) {
    throw new Error('pagesDir is required');
  }

  const clientRuntime = resolveClientRuntime(options);
  setAppContext({ db: options.db ?? null });

  const cookieSecret =
    authManager?.config?.session?.secret ||
    process.env.SESSION_SECRET ||
    process.env.AUTH_SESSION_SECRET ||
    'webspresso-dev-secret-change-me-32chars';

  const app = createCompatApp({ cookieSecret });

  if (helmetConfig !== false) {
    const defaultConfig = getDefaultHelmetConfig(isDev);
    let finalConfig =
      helmetConfig === undefined || helmetConfig === true
        ? defaultConfig
        : { ...defaultConfig, ...helmetConfig };

    if (plugins && Array.isArray(plugins) && finalConfig.contentSecurityPolicy) {
      const pluginCspSources = {
        styleSrc: new Set(),
        scriptSrc: new Set(),
        imgSrc: new Set(),
        fontSrc: new Set(),
        connectSrc: new Set(),
        frameSrc: new Set(),
      };

      for (const plugin of plugins) {
        if (plugin && plugin.csp) {
          for (const [directive, sources] of Object.entries(plugin.csp)) {
            if (pluginCspSources[directive]) {
              const sourceArray = Array.isArray(sources) ? sources : [sources];
              for (const source of sourceArray) {
                pluginCspSources[directive].add(source);
              }
            }
          }
        }
      }

      if (finalConfig.contentSecurityPolicy && finalConfig.contentSecurityPolicy.directives) {
        const directives = finalConfig.contentSecurityPolicy.directives;
        for (const [directive, sources] of Object.entries(pluginCspSources)) {
          if (sources.size > 0 && directives[directive]) {
            directives[directive] = [...directives[directive], ...Array.from(sources)];
          }
        }
      }
    }

    app.useSecureHeaders(helmetToSecureHeaders(finalConfig));
  }

  if (timeoutConfig !== false) {
    app.mountTimeout(timeoutConfig);
    app.mountHaltOnTimedout();
  }

  app.mountBodyParsers();

  if (authManager) {
    const sessionCfg = authManager.getSessionConfig();
    mountAppSession(app, {
      secret: sessionCfg.secret,
      sessionCookieName: sessionCfg.name || 'connect.sid',
      maxAgeMs: sessionCfg.cookie?.maxAge || 86400000,
      secure: sessionCfg.cookie?.secure === true,
      sameSite: sessionCfg.cookie?.sameSite || 'Lax',
    });
  }

  let authMiddleware = null;
  if (authManager) {
    const { setupAuthMiddleware } = require('../core/auth');
    authMiddleware = setupAuthMiddleware(app, authManager, { cookieSecret });
    middlewares.auth = authMiddleware.auth;
    middlewares.guest = authMiddleware.guest;
  }

  const runsUnderVitest =
    process.env.VITEST === 'true' || process.env.VITEST_WORKER_ID !== undefined;
  if (runsUnderVitest && middlewares.fixtureRequireAuth == null) {
    middlewares.fixtureRequireAuth = (req, res, next) => next();
  }

  if (publicDir) {
    app.mountStatic(publicDir, { maxAge: isDev ? 0 : '1d' });
  }

  mountClientRuntime(app, clientRuntime);

  const templateDirs = viewsDir ? [pagesDir, viewsDir] : [pagesDir];

  const nunjucksEnv = nunjucks.configure(templateDirs, {
    autoescape: true,
    watch: isDev && !isTest,
    noCache: isDev || isTest,
  });

  nunjucksEnv.addFilter('json', (obj) => JSON.stringify(obj, null, 2));

  nunjucksEnv.addFilter('date', (date, format = 'short') => {
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

  const pluginContext = { app, nunjucksEnv, options, middlewares };
  pluginManager.registerSync(plugins, pluginContext);

  if (logging) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
      });
      next();
    });
  }

  if (!isTest) {
    console.log('\nMounting routes:');
  }

  const { routeMetadata, registerDynamicFileRoutes } = mountPages(app, {
    pagesDir,
    nunjucks: nunjucksEnv,
    middlewares,
    pluginManager,
    silent: isTest,
    db: options.db ?? null,
    clientRuntime,
    pageAssets: options.pageAssets,
  });

  pluginManager.setRoutes(routeMetadata);

  for (const [name, plugin] of pluginManager.plugins) {
    if (typeof plugin.onRoutesReady === 'function') {
      const ctx = {
        app,
        nunjucksEnv,
        options,
        middlewares,
        db: options.db ?? null,
        routes: pluginManager.routes,
        usePlugin: (n) => pluginManager.getPluginAPI(n),
        addHelper: (n, fn) => pluginManager.registeredHelpers.set(n, fn),
        addFilter: (n, fn) => pluginManager.registeredFilters.set(n, fn),
        addRoute: (method, path, ...handlers) => {
          if (process.env.NODE_ENV !== 'production' && !isTest) {
            console.log(`  ${method.toUpperCase().padEnd(6)} ${path}`);
          }
          app[method.toLowerCase()](path, ...handlers);
        },
      };
      try {
        plugin.onRoutesReady(ctx);
      } catch (err) {
        console.warn(`[plugin-manager] Plugin "${name}" onRoutesReady() failed:`, err.message);
      }
    }
  }

  if (typeof setupRoutes === 'function') {
    setupRoutes(app, {
      nunjucksEnv,
      authMiddleware,
      pluginManager,
      options,
      clientRuntime,
    });
  }

  registerDynamicFileRoutes();

  function createErrorContext(req, extraData = {}) {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const locale = detectLocale(req);
    const fsy = createHelpers({ req, res: {}, baseUrl, locale });
    Object.assign(fsy, pluginManager.getHelpers());
    return {
      fsy,
      locale,
      isDev,
      url: req.url,
      method: req.method,
      ...extraData,
    };
  }

  const httpOpts = { cookieSecret };

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
    // compat wrapper passes (c, err)
    const req = buildReq(c, httpOpts);
    const res = getCompatRes(c, httpOpts);

    if (req.timedout) {
      console.error('Request timed out:', req.method, req.url);
      res.status(503);
      const ctx = createErrorContext(req);

      if (typeof errorPages.timeout === 'function') {
        await errorPages.timeout(req, res, ctx);
        const ret = c.get('compatReturnValue');
        if (ret) return ret;
        return;
      }

      if (typeof errorPages.timeout === 'string' && !preferJsonErrorResponse(req)) {
        try {
          const html = nunjucksEnv.render(errorPages.timeout, ctx);
          return res.send(html);
        } catch (e) {
          console.error('Error rendering timeout template:', e);
        }
      }

      if (!preferJsonErrorResponse(req)) {
        return await res.send(default503Html());
      }
      return await res.json({ error: 'Request Timeout', status: 503 });
    }

    console.error('Server error:', err);
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

    if (typeof errorPages.serverError === 'string' && !preferJsonErrorResponse(req)) {
      try {
        const html = nunjucksEnv.render(errorPages.serverError, ctx);
        return await res.send(html);
      } catch (e) {
        console.error('Error rendering 500 template:', e);
      }
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

  return { app, nunjucksEnv, pluginManager, authMiddleware };
}

module.exports = { createApp, getDefaultHelmetConfig };
