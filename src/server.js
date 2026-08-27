/**
 * Webspresso Server
 * Express + Nunjucks SSR server with file-based routing
 */

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const express = require('express');
const helmet = require('helmet');
const nunjucks = require('nunjucks');
const timeout = require('connect-timeout');

const { setAppContext } = require('./app-context');
const { mountClientRuntime } = require('./client-runtime/mount');
const { resolveClientRuntime } = require('./client-runtime/resolve');
const { mountPages, detectLocale, loadI18n, createTranslator } = require('./file-router');
const { configureAssets, createHelpers, getScriptInjector } = require('./helpers');
const { createPluginManager } = require('./plugin-manager');
const { createServiceRegistry } = require('./services');
const { ShutdownManager, NodeHttpAdapter } = require('../core/shutdown');
const { createCompressionMiddleware } = require('../core/compression');
const {
  WebspressoError,
  HttpError,
  NotFoundError,
  RouteNotFoundError,
  RequestAbortedError,
  ValidationError,
  normalizeError,
  toErrorResponseObject,
  preferJsonErrorResponse,
} = require('../core/errors');

// Async storage for tracking template render call stacks (circular extends guard)
const renderStackStorage = new AsyncLocalStorage();

/**
 * Configure Nunjucks environment with circular extends guard and loader protection
 * @param {string|string[]} templateDirs - Template directory paths
 * @param {Object} options - Nunjucks options
 * @returns {nunjucks.Environment}
 */
function configureSafeNunjucks(templateDirs, options = {}) {
  const env = nunjucks.configure(templateDirs, options);
  const origGetTemplate = env.getTemplate.bind(env);
  const origRender = env.render.bind(env);
  const origRenderString = env.renderString.bind(env);

  function wrapTemplateRoot(tmpl, name, store) {
    if (!tmpl || tmpl._safeWrapped) return;
    tmpl._safeWrapped = true;
    const origRoot = tmpl.rootRenderFunc;
    if (typeof origRoot !== 'function') return;

    tmpl.rootRenderFunc = function(e, context, frame, runtime, renderCb) {
      const normalizedName = String(name || tmpl.path || 'anonymous');
      store.stack.push(normalizedName);
      let finished = false;
      const done = (err, out) => {
        if (!finished) {
          finished = true;
          const idx = store.stack.lastIndexOf(normalizedName);
          if (idx !== -1) store.stack.splice(idx, 1);
        }
        renderCb(err, out);
      };
      try {
        return origRoot.call(this, e, context, frame, runtime, done);
      } catch (ex) {
        const idx = store.stack.lastIndexOf(normalizedName);
        if (idx !== -1) store.stack.splice(idx, 1);
        throw ex;
      }
    };
  }

  env.getTemplate = function(name, eagerCompile, parentName, ignoreMissing, cb) {
    if (typeof parentName === 'function') {
      cb = parentName;
      parentName = null;
    }
    if (typeof eagerCompile === 'function') {
      cb = eagerCompile;
      eagerCompile = false;
    }

    const store = renderStackStorage.getStore();
    if (store && name) {
      const normalizedName = String(name);
      if (store.stack.includes(normalizedName)) {
        const cycle = [...store.stack, normalizedName].join(' -> ');
        const err = new Error(`Circular template extension detected: ${cycle}`);
        if (typeof cb === 'function') return cb(err);
        throw err;
      }
    }

    const wrappedCb = typeof cb === 'function' ? function(err, tmpl) {
      if (tmpl && store) {
        wrapTemplateRoot(tmpl, name, store);
      }
      cb(err, tmpl);
    } : undefined;

    const res = origGetTemplate(name, eagerCompile, parentName, ignoreMissing, wrappedCb);
    if (res && store) {
      wrapTemplateRoot(res, name, store);
    }
    return res;
  };

  env.render = function(name, ctx, cb) {
    return renderStackStorage.run({ stack: [] }, () => {
      return origRender(name, ctx, cb);
    });
  };

  env.renderString = function(src, ctx, opts, cb) {
    return renderStackStorage.run({ stack: [] }, () => {
      return origRenderString(src, ctx, opts, cb);
    });
  };

  return env;
}

/**
 * Get default Helmet configuration
 * @param {boolean} isDev - Whether in development mode
 * @returns {Object} Helmet configuration
 */
function getDefaultHelmetConfig(isDev) {
  return {
    // Disable CSP in development for easier development (Nunjucks hot reload, etc.)
    contentSecurityPolicy: isDev ? false : {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for Tailwind
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: []
      }
    },
    // Other security headers
    crossOriginEmbedderPolicy: false, // Disable for better compatibility
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    dnsPrefetchControl: true,
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true
  };
}



/**
 * Shared CSS for built-in HTML error pages (viewport-safe, fluid type, dark mode)
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
    .container {
      width: 100%;
      max-width: min(100%, 26rem);
      text-align: center;
    }
    .card {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      padding: clamp(1.25rem, 5vw, 2rem);
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }
    h1 {
      font-size: clamp(2.5rem, 12vw, 4rem);
      font-weight: 700;
      line-height: 1.05;
      margin: 0 0 0.35rem;
      letter-spacing: -0.02em;
      color: #262626;
    }
    .muted {
      margin: 0 0 1rem;
      line-height: 1.55;
      color: #525252;
      font-size: clamp(0.9375rem, 3.8vw, 1.0625rem);
    }
    a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      margin-top: 0.25rem;
      color: #0066cc;
      text-decoration: none;
      font-weight: 500;
      font-size: clamp(0.875rem, 3.5vw, 1rem);
      min-height: 44px;
      padding: 0.25rem 0.5rem;
    }
    a:hover { text-decoration: underline; }
    a:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 3px;
      border-radius: 4px;
    }
    pre {
      margin: 1rem 0 0;
      padding: clamp(0.75rem, 3vw, 1rem);
      border-radius: 8px;
      text-align: left;
      font-size: clamp(0.625rem, 2.75vw, 0.8125rem);
      line-height: 1.45;
      overflow-x: auto;
      max-width: 100%;
      width: 100%;
      white-space: pre-wrap;
      word-break: break-word;
      background: #fff;
      border: 1px solid #e5e5e5;
      -webkit-overflow-scrolling: touch;
    }
  `;
}

/**
 * Default 404 page HTML
 */
function default404Html() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>404 - Not Found</title>
  <style>${defaultErrorPageStyles()}
 </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>404</h1>
      <p class="muted">Page not found</p>
      <a href="/">← Back to Home</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Default 500 page HTML
 */
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
  <style>${defaultErrorPageStyles()}
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>500</h1>
      <p class="muted">Internal Server Error</p>
      ${detail}
      <a href="/">← Back to Home</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Default 503 (timeout) page HTML
 */
function default503Html() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>503 - Service Unavailable</title>
  <style>${defaultErrorPageStyles()}
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>503</h1>
      <p class="muted">Request timed out. Please try again.</p>
      <a href="/">← Back to Home</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Middleware to halt processing if request has timed out
 */
function haltOnTimedout(req, res, next) {
  if (!req.timedout) next();
}

/**
 * Create and configure the Express app
 * @param {Object} options - Configuration options
 * @param {string} options.pagesDir - Path to pages directory
 * @param {string} options.viewsDir - Path to views directory  
 * @param {string} options.publicDir - Path to public/static directory
 * @param {boolean} options.logging - Enable request logging (default: isDev)
 * @param {Object|boolean} options.helmet - Helmet configuration (default: auto-configured, false to disable)
 * @param {Object} options.middlewares - Named middleware registry for route configs
 * @param {Array} options.plugins - Array of plugin definitions
 * @param {Object} options.assets - Asset manager configuration
 * @param {string} options.assets.manifestPath - Path to asset manifest file (Vite, Webpack)
 * @param {string} options.assets.version - Asset version for cache busting
 * @param {string} options.assets.prefix - URL prefix for assets
 * @param {Object} options.errorPages - Custom error page handlers
 * @param {Function|string} options.errorPages.notFound - Custom 404 handler or template path
 * @param {Function|string} options.errorPages.serverError - Custom 500 handler or template path
 * @param {Function|string} options.errorPages.timeout - Custom timeout handler or template path
 * @param {string|boolean} options.timeout - Request timeout (default: '30s', false to disable)
 * @param {Object} options.auth - Authentication manager instance (from createAuth)
 * @param {Object} options.db - Database instance (exposed as ctx.db to plugins)
 * @param {Object} [options.clientRuntime] - Optional client assets: `{ alpine?: boolean|object, swup?: boolean|object }`. Overridable by env `WEBSPRESSO_ALPINE` / `WEBSPRESSO_SWUP` (=1 or true). Serves `/__webspresso/client-runtime/*` when either flag is on.
 * @param {boolean|{enabled?: boolean, stylesheets?: boolean, scripts?: boolean}} [options.pageAssets] - If truthy, route `load()` return values for `stylesheets` and `scripts` are reserved: removed from the root template context and passed as `pageHead` to Nunjucks, with `pageAssets: true` (for layout to emit `<link>` / `<script>`). Default off.
 * @param {function(import('express').Express, Object): void} [options.setupRoutes] - Called after file routes and plugins, before 404 handler
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
    timeout: timeoutConfig = '30s',
    auth: authManager = null,
    setupRoutes,
  } = options;
  
  // Create plugin manager
  const pluginManager = createPluginManager();
  
  // Configure asset manager
  configureAssets({
    publicDir: publicDir || 'public',
    ...assetsConfig
  });
  
  if (!pagesDir) {
    throw new Error('pagesDir is required');
  }

  const clientRuntime = resolveClientRuntime(options);

  const shutdownConfig = {
    enabled: true,
    mode: 'graceful',
    timeout: 10_000,
    ...(options.shutdown || options.server?.shutdown || {}),
  };

  const shutdownManager = new ShutdownManager({
    ...shutdownConfig,
    logger: logging ? console : null,
  });

  // Services Layer initialization
  const servicesDirOption = options.servicesDir ?? options.services?.dir;
  const resolvedServicesDir = servicesDirOption
    ? path.resolve(servicesDirOption)
    : (fs.existsSync(path.join(process.cwd(), 'services'))
      ? path.join(process.cwd(), 'services')
      : null);

  const serviceRegistry = createServiceRegistry({
    servicesDir: resolvedServicesDir,
    isDev,
    logger: logging ? console : null,
  });

  // Auto-register built-in auth services if database is present and service is not custom-defined
  if (options.db) {
    const { createAuthServices } = require('./services/builtins/auth');
    const authServices = createAuthServices({ db: options.db });
    for (const [name, def] of Object.entries(authServices)) {
      if (!serviceRegistry.has(name)) {
        serviceRegistry.register(name, def);
      }
    }
  }

  // Auto-register built-in system services (health, cleanup, cache flush, info)
  const { createSystemServices } = require('./services/builtins/system');
  const systemServices = createSystemServices({
    db: options.db ?? null,
    serviceRegistry,
    pluginManager,
  });
  for (const [name, def] of Object.entries(systemServices)) {
    if (!serviceRegistry.has(name)) {
      serviceRegistry.register(name, def);
    }
  }

  setAppContext({ db: options.db ?? null, shutdownManager, serviceRegistry });
  
  const app = express();
  app.serviceRegistry = serviceRegistry;

  // Services caller middleware
  app.use((req, res, next) => {
    req.service = (name, input, opts) =>
      serviceRegistry.call(name, input, { req, res, db: options.db ?? null, ...(req.context || {}) }, opts);
    next();
  });

  // SSR Streaming Response Helper
  const { renderStream } = require('../core/ssr/stream');
  app.use((req, res, next) => {
    res.renderStream = (templatePath, context = {}, renderOptions = {}) => {
      return renderStream(res, templatePath, context, {
        env: nunjucksEnv,
        ...renderOptions,
      });
    };
    next();
  });

  // Async handler wrapper helper for automatic promise rejection handling
  function wrapAsync(fn) {
    if (typeof fn !== 'function') return fn;
    if (fn.length === 4) {
      return function(err, req, res, next) {
        try {
          const ret = fn.call(this, err, req, res, next);
          if (ret && typeof ret.catch === 'function') {
            ret.catch(next);
          }
          return ret;
        } catch (syncErr) {
          return next(syncErr);
        }
      };
    }
    return function(req, res, next) {
      try {
        const ret = fn.call(this, req, res, next);
        if (ret && typeof ret.catch === 'function') {
          ret.catch(next);
        }
        return ret;
      } catch (syncErr) {
        return next(syncErr);
      }
    };
  }

  // Wrap routing methods on app to catch uncaught async errors
  const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all'];
  for (const method of HTTP_METHODS) {
    const origMethod = app[method];
    if (typeof origMethod === 'function') {
      app[method] = function(path, ...handlers) {
        const wrappedHandlers = handlers.flat().map((h) => wrapAsync(h));
        return origMethod.call(this, path, ...wrappedHandlers);
      };
    }
  }

  // Request draining check during graceful shutdown (zero overhead during normal operation)
  app.use((req, res, next) => {
    if (shutdownManager.isShuttingDown) {
      res.set('Connection', 'close');
      if (!res.headersSent) {
        if (preferJsonErrorResponse(req)) {
          return res.status(503).json({ error: 'Service Unavailable', message: 'Server is shutting down', status: 503 });
        }
        return res.status(503).send('Server is shutting down');
      }
      res.on('finish', () => {
        try {
          if (req.socket && !req.socket.destroyed) {
            req.socket.end();
          }
        } catch (e) {}
      });
    }
    next();
  });
  
  // Security headers with Helmet
  if (helmetConfig !== false) {
    const defaultConfig = getDefaultHelmetConfig(isDev);
    let finalConfig = helmetConfig === undefined || helmetConfig === true
      ? defaultConfig
      : { ...defaultConfig, ...helmetConfig };
    
    // Collect CSP requirements from plugins (before they're fully registered)
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
      
      // Merge plugin CSP sources with default config
      if (finalConfig.contentSecurityPolicy && finalConfig.contentSecurityPolicy.directives) {
        const directives = finalConfig.contentSecurityPolicy.directives;
        for (const [directive, sources] of Object.entries(pluginCspSources)) {
          if (sources.size > 0) {
            const existing = (directives[directive] || []).filter(s => s !== "'none'");
            directives[directive] = [...existing, ...Array.from(sources)];
          }
        }
      }
    }
    
    app.use(helmet(finalConfig));
  }

  // HTTP Response Compression
  const compressionOpt = options.compression ?? options.server?.compression ?? false;
  if (compressionOpt) {
    const compressionConfig = typeof compressionOpt === 'object' ? compressionOpt : {};
    if (compressionConfig.enabled !== false) {
      app.use(createCompressionMiddleware(compressionConfig));
    }
  }
  
  // Request timeout middleware
  if (timeoutConfig !== false) {
    app.use(timeout(timeoutConfig));
  }
  
  // Trust proxy (for correct req.ip, req.protocol behind reverse proxy; configurable via options.trustProxy)
  const trustProxySetting = options.trustProxy !== undefined
    ? options.trustProxy
    : (options.server?.trustProxy !== undefined ? options.server.trustProxy : 1);
  if (trustProxySetting !== false) {
    app.set('trust proxy', trustProxySetting);
  } else {
    app.set('trust proxy', false);
  }

  // Ensure extended query parser for nested filter/sort query parameters (?filter[field]=val)
  app.set('query parser', 'extended');
  
  // JSON body parser for API routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Ensure default empty object for body on mutating requests if not populated
  app.use((req, res, next) => {
    if (req.body === undefined && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
      req.body = {};
    }
    next();
  });
  
  // Halt processing if request has timed out (after body parsers)
  if (timeoutConfig !== false) {
    app.use(haltOnTimedout);
  }
  
  // Authentication middleware (if auth manager provided)
  let authMiddleware = null;
  if (authManager) {
    const { setupAuthMiddleware } = require('../core/auth');
    authMiddleware = setupAuthMiddleware(app, authManager);
    
    // Add auth middleware to named middlewares for route config
    middlewares.auth = authMiddleware.auth;
    middlewares.guest = authMiddleware.guest;
    middlewares.jwt = authMiddleware.jwt;
  }

  // Under Vitest, shared API fixtures use `fixtureRequireAuth`; default no-op unless overridden.
  const runsUnderVitest = process.env.VITEST === 'true' || process.env.VITEST_WORKER_ID !== undefined;
  if (runsUnderVitest && middlewares.fixtureRequireAuth == null) {
    middlewares.fixtureRequireAuth = (req, res, next) => next();
  }
  
  // Static files (if publicDir provided)
  if (publicDir) {
    app.use(express.static(publicDir, {
      maxAge: isDev ? 0 : '1d',
      etag: true
    }));
  }

  mountClientRuntime(app, clientRuntime);

  // Configure Nunjucks with viewsDir priority and circular extension guard
  const templateDirs = viewsDir ? [viewsDir, pagesDir] : [pagesDir];
  
  const nunjucksEnv = configureSafeNunjucks(templateDirs, {
    autoescape: true,
    express: app,
    watch: isDev && !isTest,
    noCache: isDev || isTest
  });
  
  // Add custom Nunjucks filters
  nunjucksEnv.addFilter('json', (obj) => {
    const raw = JSON.stringify(obj, null, 2);
    if (!raw) return '';
    return raw
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
  });

  // Translation filter: {{ 'nav.home' | t }} or {{ 'cart.items' | t({ count: 5 }) }}
  nunjucksEnv.addFilter('t', function(key, params, defaultVal) {
    const tFunc = this.ctx?.t || this.ctx?.fsy?.t;
    if (typeof tFunc === 'function') {
      return tFunc(key, params, defaultVal);
    }
    return defaultVal !== undefined && defaultVal !== null ? defaultVal : key;
  });
  
  nunjucksEnv.addFilter('date', (date, format = 'short') => {
    const d = new Date(date);
    if (format === 'short') {
      return d.toLocaleDateString();
    }
    if (format === 'long') {
      return d.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
    if (format === 'iso') {
      return d.toISOString();
    }
    return d.toString();
  });
  
  // Register plugins (sync) — middlewares is the same object later passed to mountPages
  const pluginContext = { app, nunjucksEnv, options, middlewares, shutdownManager };
  pluginManager.registerSync(plugins, pluginContext);
  
  // Request logging middleware
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
  
  // Mount file-based routes
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
    serviceRegistry,
  });

  // Set route metadata in plugin manager
  pluginManager.setRoutes(routeMetadata);
  
  // Call onRoutesReady hook synchronously (plugins should not be async in this phase)
  // and mount any custom routes added by plugins
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
          // Log route for debugging (only in development)
          if (process.env.NODE_ENV !== 'production' && !isTest) {
            console.log(`  ${method.toUpperCase().padEnd(6)} ${path}`);
          }
          app[method.toLowerCase()](path, ...handlers);
        }
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
      middlewares,
    });
  }

  // Dynamic / catch-all file routes after plugins and setupRoutes so paths like /_admin
  // or custom /login are not shadowed by pages/[slug].njk (/:slug).
  registerDynamicFileRoutes();

  // Helper to create error page context with fsy
  function createErrorContext(req, extraData = {}) {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const locale = detectLocale(req);
    
    // Create fsy helpers
    const fsy = createHelpers({ req, res: {}, baseUrl, locale });
    
    // Merge plugin helpers
    const pluginHelpers = pluginManager.getHelpers();
    Object.assign(fsy, pluginHelpers);

    // Provide safe i18n translator helper (primary + fallback)
    const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
    const translations = loadI18n(pagesDir, '', locale);
    const fallbackTranslations = (locale !== defaultLocale)
      ? loadI18n(pagesDir, '', defaultLocale)
      : undefined;
    const t = createTranslator(translations, {
      locale,
      fallbackTranslations,
      fallbackLocale: defaultLocale,
    });
    
    return {
      fsy,
      locale,
      t,
      service: (name, input, opts) =>
        serviceRegistry.call(name, input, { req, res: {}, fsy, locale, t, db: options.db ?? null }, opts),
      isDev,
      url: req.url,
      method: req.method,
      ...extraData
    };
  }
  
  // Pre-resolve error templates and loaders once at startup to avoid runtime synchronous fs operations
  const resolved404Template = typeof errorPages.notFound === 'string'
    ? errorPages.notFound
    : ((viewsDir && fs.existsSync(path.join(viewsDir, '404.njk'))) || fs.existsSync(path.join(pagesDir, '404.njk')))
      ? '404.njk'
      : null;

  const config404Path = path.join(pagesDir, '404.js');
  const has404DataLoader = fs.existsSync(config404Path);

  const resolved500Template = typeof errorPages.serverError === 'string'
    ? errorPages.serverError
    : ((viewsDir && fs.existsSync(path.join(viewsDir, '500.njk'))) || fs.existsSync(path.join(pagesDir, '500.njk')))
      ? '500.njk'
      : null;

  const resolved503Template = typeof errorPages.timeout === 'string'
    ? errorPages.timeout
    : ((viewsDir && fs.existsSync(path.join(viewsDir, '503.njk'))) || fs.existsSync(path.join(pagesDir, '503.njk')))
      ? '503.njk'
      : null;

  // 404 handler
  app.use(async (req, res) => {
    res.status(404);
    const ctx = createErrorContext(req);
    
    // 1. Custom handler function
    if (typeof errorPages.notFound === 'function') {
      return errorPages.notFound(req, res, ctx);
    }
    
    // 2. Custom or auto-discovered 404 template (pre-resolved at startup)
    const notFoundTemplate = resolved404Template;
    
    if (notFoundTemplate && !preferJsonErrorResponse(req)) {
      try {
        // If pages/404.js exists, execute load() data loader
        if (has404DataLoader) {
          try {
            if (isDev && require.cache[require.resolve(config404Path)]) {
              delete require.cache[require.resolve(config404Path)];
            }
            const config404 = require(config404Path);
            const loadFn = typeof config404 === 'function' ? config404 : config404.load;
            if (typeof loadFn === 'function') {
              const loadData = await loadFn({ req, res, db: ctx.db || null, ctx });
              if (loadData && typeof loadData === 'object') {
                Object.assign(ctx, loadData);
              }
            }
          } catch (loadErr) {
            console.error('Error executing 404.js load():', loadErr);
          }
        }

        const html = nunjucksEnv.render(notFoundTemplate, ctx);
        return res.send(html);
      } catch (e) {
        console.error('Error rendering 404 template:', e);
      }
    }
    
    // Default response
    if (!preferJsonErrorResponse(req)) {
      res.send(default404Html());
    } else {
      res.json({ error: 'Not Found', status: 404 });
    }
  });
  
  let customErrorHandler = null;
  app.setErrorHandler = function(handler) {
    customErrorHandler = typeof handler === 'function' ? handler : null;
    return app;
  };

  // Central Error Handler
  app.use(async (err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    
    // Client connection aborted
    if (err instanceof RequestAbortedError || req.aborted || (req.socket && req.socket.destroyed)) {
      if (!res.headersSent && !res.writableEnded) {
        try {
          res.end();
        } catch (_) {}
      }
      return;
    }

    // Handle timeout errors
    if (req.timedout) {
      console.error('Request timed out:', req.method, req.url);
      res.status(503);
      const ctx = createErrorContext(req);
      
      // Custom timeout handler
      if (typeof errorPages.timeout === 'function') {
        return errorPages.timeout(req, res, ctx);
      }
      
      // Custom or auto-discovered timeout template (pre-resolved at startup)
      const timeoutTemplate = resolved503Template;

      if (timeoutTemplate && !preferJsonErrorResponse(req)) {
        try {
          const html = nunjucksEnv.render(timeoutTemplate, ctx);
          return res.send(html);
        } catch (e) {
          console.error('Error rendering timeout template:', e);
        }
      }
      
      // Default timeout response
      if (!preferJsonErrorResponse(req)) {
        return res.send(default503Html());
      } else {
        return res.json({ error: 'Request Timeout', status: 503 });
      }
    }

    const normalized = normalizeError(err, isDev);
    const status = normalized.status || 500;

    // Attach custom headers from HttpError if present
    if (normalized.headers && typeof normalized.headers === 'object') {
      for (const [key, value] of Object.entries(normalized.headers)) {
        res.setHeader(key, value);
      }
    }

    // Custom Error Handler hook (app.setErrorHandler)
    if (customErrorHandler) {
      try {
        const handled = await customErrorHandler(err, req, res, next);
        if (res.headersSent || handled === true) {
          return;
        }
      } catch (customErr) {
        console.error('[webspresso] Error in custom error handler:', customErr);
      }
    }

    // Log errors based on severity
    if (status >= 500) {
      console.error('Server error:', err);
    } else if (isDev && status >= 400) {
      console.warn(`[webspresso] HTTP ${status}:`, normalized.message);
    }

    res.status(status);
    const ctx = createErrorContext(req, {
      error: isDev ? err : { message: normalized.message },
      status,
      normalizedError: normalized,
    });
    
    // Custom handler function
    if (typeof errorPages.serverError === 'function') {
      return errorPages.serverError(err, req, res, ctx);
    }
    
    // Custom or auto-discovered 500 template (pre-resolved at startup)
    const serverErrorTemplate = resolved500Template;

    if (status >= 500 && serverErrorTemplate && !preferJsonErrorResponse(req)) {
      try {
        const html = nunjucksEnv.render(serverErrorTemplate, ctx);
        return res.send(html);
      } catch (e) {
        console.error('Error rendering 500 template:', e);
      }
    }
    
    // Default response
    if (!preferJsonErrorResponse(req)) {
      res.send(default500Html(normalized, isDev));
    } else {
      res.json(toErrorResponseObject(normalized, isDev));
    }
  });

  // Decorate app with shutdown lifecycle helpers
  app.shutdownManager = shutdownManager;
  Object.defineProperty(app, 'isShuttingDown', {
    get: () => shutdownManager.isShuttingDown,
    configurable: true,
    enumerable: true,
  });

  app.onShutdown = function(fn) {
    shutdownManager.onShutdown(fn);
    return app;
  };

  app.close = function(reason) {
    return shutdownManager.close(reason);
  };

  app.enableShutdownHooks = function() {
    shutdownManager.enableShutdownHooks();
    return app;
  };

  app.disableShutdownHooks = function() {
    shutdownManager.disableShutdownHooks();
    return app;
  };

  // Wrap app.listen to register server adapter and signal hooks
  const origListen = app.listen.bind(app);
  app.listen = function(...args) {
    const server = origListen(...args);
    app.server = server;
    const adapter = new NodeHttpAdapter(server);
    shutdownManager.registerAdapter(adapter);

    if (shutdownConfig.enabled !== false && !isTest) {
      shutdownManager.enableShutdownHooks();
    }

    return server;
  };
  
  return { app, nunjucksEnv, pluginManager, authMiddleware, shutdownManager };
}

// Export for use as library
module.exports = { createApp };
