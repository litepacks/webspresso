/**
 * Webspresso Server
 * Express + Nunjucks SSR server with file-based routing
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
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
const { registerClearHook } = require('./njk-frontmatter');
const { createPluginManager } = require('./plugin-manager');
const { createServiceRegistry } = require('./services');
const { scanRoutes } = require('./discovery/scan-routes');
const { compileRouteTable } = require('./routing/route-table');
const { mountDiscoveredRoutes } = require('./routing/mount-discovered-routes');
const { discoverModuleDetails } = require('./modules/module-discovery');
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
 * Fast hardware-accelerated Weak ETag generator using native zlib.crc32
 * Up to 13x faster than Express default SHA-1, zero external dependencies.
 * Compliant with RFC 7232 Section 2.3 (Weak Entity Tag).
 * Format: W/"<len-hex>-<crc32-hex>"
 *
 * @param {Buffer|string} body - Response body
 * @param {string} [encoding] - String encoding if body is string
 * @returns {string} RFC 7232 formatted Weak ETag
 */
function fastETag(body, encoding) {
  if (!body || body.length === 0) {
    return 'W/"0-0"';
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, encoding || 'utf8');
  if (buf.length === 0) {
    return 'W/"0-0"';
  }
  if (typeof zlib.crc32 === 'function') {
    return `W/"${buf.length.toString(16)}-${zlib.crc32(buf).toString(16)}"`;
  }
  // Graceful fallback for environments without zlib.crc32
  let h1 = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h1 = Math.imul(h1 ^ buf[i], 0x01000193);
  }
  return `W/"${buf.length.toString(16)}-${(h1 >>> 0).toString(16)}"`;
}

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

  // Production template cache to bypass loader traversal when caching is active
  const productionTemplateCache = (!options.noCache) ? new Map() : null;
  if (productionTemplateCache) {
    registerClearHook(() => productionTemplateCache.clear());
  }

  function wrapTemplateRoot(tmpl, name) {
    if (!tmpl || tmpl._safeWrapped) return;
    tmpl._safeWrapped = true;
    const origRoot = tmpl.rootRenderFunc;
    if (typeof origRoot !== 'function') return;

    const normalizedName = String(name || tmpl.path || 'anonymous');

    tmpl.rootRenderFunc = function(e, context, frame, runtime, renderCb) {
      const store = renderStackStorage.getStore();
      if (store) {
        store.stack.push(normalizedName);
      }
      let finished = false;
      const done = (err, out) => {
        if (!finished) {
          finished = true;
          if (store) {
            if (store.stack[store.stack.length - 1] === normalizedName) {
              store.stack.pop();
            } else {
              const idx = store.stack.lastIndexOf(normalizedName);
              if (idx !== -1) store.stack.splice(idx, 1);
            }
          }
        }
        renderCb(err, out);
      };
      try {
        return origRoot.call(this, e, context, frame, runtime, done);
      } catch (ex) {
        if (store) {
          if (store.stack[store.stack.length - 1] === normalizedName) {
            store.stack.pop();
          } else {
            const idx = store.stack.lastIndexOf(normalizedName);
            if (idx !== -1) store.stack.splice(idx, 1);
          }
        }
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

    if (!cb && !parentName && productionTemplateCache && typeof name === 'string') {
      const cached = productionTemplateCache.get(name);
      if (cached) return cached;
    }

    const wrappedCb = typeof cb === 'function' ? function(err, tmpl) {
      if (tmpl && !tmpl._safeWrapped) {
        wrapTemplateRoot(tmpl, name);
      }
      if (productionTemplateCache && tmpl && !err && typeof name === 'string' && !parentName) {
        productionTemplateCache.set(name, tmpl);
      }
      cb(err, tmpl);
    } : undefined;

    const res = origGetTemplate(name, eagerCompile, parentName, ignoreMissing, wrappedCb);
    if (res && !res._safeWrapped) {
      wrapTemplateRoot(res, name);
    }
    if (productionTemplateCache && res && typeof name === 'string' && !parentName) {
      productionTemplateCache.set(name, res);
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
    pagesDir: initialPagesDir,
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
  
  if (!initialPagesDir && !options.pages && !options.api && !options.modules && !options.routes && !options.rootDir) {
    throw new Error('pagesDir is required');
  }

  const rootDir = options.rootDir || process.cwd();
  let pagesDir = initialPagesDir;
  if (!pagesDir) {
    if (typeof options.pages === 'string') {
      pagesDir = path.isAbsolute(options.pages) ? options.pages : path.join(rootDir, options.pages);
    } else if (typeof options.pages === 'object' && options.pages?.dir) {
      pagesDir = path.isAbsolute(options.pages.dir) ? options.pages.dir : path.join(rootDir, options.pages.dir);
    } else if (fs.existsSync(path.join(rootDir, 'src/pages'))) {
      pagesDir = path.join(rootDir, 'src/pages');
    } else if (fs.existsSync(path.join(rootDir, 'pages'))) {
      pagesDir = path.join(rootDir, 'pages');
    } else {
      pagesDir = path.join(rootDir, 'pages');
    }
  }

  // Create plugin manager
  const pluginManager = createPluginManager();
  
  // Configure asset manager
  configureAssets({
    publicDir: publicDir || 'public',
    ...assetsConfig
  });
  
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

  // Unified Request Context & Lifecycle Initializer middleware
  const { renderStream } = require('../core/ssr/stream');
  app.use((req, res, next) => {
    // 1. Request draining check during graceful shutdown
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

    // 2. Correlation Request ID
    const reqId = (req.headers && req.headers['x-request-id']) ? req.headers['x-request-id'] : crypto.randomUUID();
    req.id = reqId;
    res.setHeader('X-Request-Id', reqId);

    // 3. Request DB, Services, and Context
    if (options.db) {
      req.db = options.db;
    }
    req.context = {
      req,
      res,
      db: options.db ?? null,
      app,
      serviceRegistry,
      ...(req.context || {}),
    };
    req.service = (name, input, opts) =>
      serviceRegistry.call(name, input, req.context, opts);

    // 4. SSR Streaming Response Helper
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
    if (fn._isWrappedAsync) return fn;
    let wrapped;
    if (fn.length === 4) {
      wrapped = function(err, req, res, next) {
        try {
          const ret = fn.call(this, err, req, res, next);
          if (ret && ret.then) {
            ret.catch(next);
          }
          return ret;
        } catch (syncErr) {
          return next(syncErr);
        }
      };
    } else {
      wrapped = function(req, res, next) {
        try {
          const ret = fn.call(this, req, res, next);
          if (ret && ret.then) {
            ret.catch(next);
          }
          return ret;
        } catch (syncErr) {
          return next(syncErr);
        }
      };
    }
    wrapped._isWrappedAsync = true;
    return wrapped;
  }

  function dispatchFastPath(handlers, req, res, next) {
    let idx = 0;
    function runNext(err) {
      if (err) return next(err);
      if (idx >= handlers.length) return next();
      const fn = handlers[idx++];
      try {
        const ret = fn(req, res, runNext);
        if (ret && typeof ret.then === 'function') {
          ret.catch(runNext);
        }
      } catch (e) {
        runNext(e);
      }
    }
    runNext();
  }

  const fastPathStaticByMethod = {
    GET: new Map(),
    POST: new Map(),
    PUT: new Map(),
    DELETE: new Map(),
    PATCH: new Map(),
    HEAD: new Map(),
    OPTIONS: new Map(),
  };
  const fastPathStaticMap = new Map();
  app.fastPathStaticMap = fastPathStaticMap;
  app.fastPathStaticByMethod = fastPathStaticByMethod;

  // Dynamic route registration list and LRU lookup cache
  const dynamicRouteList = [];
  const dynamicRouteMap = new Map();
  const dynamicRouteLookupCache = new Map();
  const MAX_DYNAMIC_CACHE_SIZE = 2000;
  const NOT_FOUND_SENTINEL = Symbol('NOT_FOUND');

  app.dynamicRouteList = dynamicRouteList;
  app.dynamicRouteLookupCache = dynamicRouteLookupCache;

  function getDynamicCache(key) {
    const val = dynamicRouteLookupCache.get(key);
    if (!val) return undefined;
    dynamicRouteLookupCache.delete(key);
    dynamicRouteLookupCache.set(key, val);
    return val;
  }

  function setDynamicCache(key, val) {
    if (dynamicRouteLookupCache.size >= MAX_DYNAMIC_CACHE_SIZE) {
      const oldestKey = dynamicRouteLookupCache.keys().next().value;
      dynamicRouteLookupCache.delete(oldestKey);
    }
    dynamicRouteLookupCache.set(key, val);
  }

  function extractRouteParams(paramNames, match) {
    const params = {};
    for (let i = 0; i < paramNames.length; i++) {
      const val = match[i + 1];
      if (val !== undefined) {
        try {
          params[paramNames[i]] = decodeURIComponent(val);
        } catch (_) {
          params[paramNames[i]] = val;
        }
      }
    }
    return params;
  }

  function compileRoutePattern(pattern) {
    if (typeof pattern !== 'string') return null;
    if (pattern === '*' || pattern === '/*' || pattern === '') return null;
    if (pattern.includes('(') || pattern.includes(')')) return null;

    const paramNames = [];
    const parts = pattern.split('/');
    let regexStr = '^';
    let hasWildcard = false;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      regexStr += '\\/';
      if (part.startsWith(':')) {
        const isOptional = part.endsWith('?');
        const name = isOptional ? part.slice(1, -1) : part.slice(1);
        paramNames.push(name);
        regexStr += isOptional ? '([^/]+)?' : '([^/]+)';
      } else if (part.startsWith('*')) {
        const name = part.slice(1) || '0';
        paramNames.push(name);
        regexStr += '(.*)';
        hasWildcard = true;
      } else {
        regexStr += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }

    if (regexStr === '^') {
      regexStr = '^\\/?$';
    } else {
      regexStr += '\\/?$';
    }

    return {
      pattern,
      regex: new RegExp(regexStr),
      paramNames,
      hasWildcard,
    };
  }

  // Wrap routing methods on app to catch uncaught async errors and register fast-path static and dynamic routes
  const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all'];
  for (const method of HTTP_METHODS) {
    const origMethod = app[method];
    if (typeof origMethod === 'function') {
      app[method] = function(path, ...handlers) {
        if (handlers.length === 0) {
          return origMethod.call(this, path);
        }
        const wrappedHandlers = handlers.flat().map((h) => wrapAsync(h));

        const normPath = (typeof path === 'string' && path.length > 1 && path.endsWith('/'))
          ? path.slice(0, -1)
          : path;

        // Fast-path static registration for literal string paths without dynamic parameters or regex
        if (
          typeof normPath === 'string' &&
          normPath.length > 0 &&
          !normPath.includes(':') &&
          !normPath.includes('*') &&
          !normPath.includes('(') &&
          !normPath.includes(')') &&
          !normPath.includes('?')
        ) {
          const uMethod = method.toUpperCase();
          const routeInfo = { path: normPath, methods: { [method.toLowerCase()]: true } };
          const registerStatic = (m) => {
            const key = `${m} ${normPath}`;
            let methodMap = fastPathStaticByMethod[m];
            if (!methodMap) {
              methodMap = new Map();
              fastPathStaticByMethod[m] = methodMap;
            }
            const existing = methodMap.get(normPath);
            if (existing) {
              existing.handlers.push(...wrappedHandlers);
            } else {
              const entry = {
                path: normPath,
                handlers: [...wrappedHandlers],
                routeInfo,
              };
              methodMap.set(normPath, entry);
              fastPathStaticMap.set(key, entry);
            }
          };

          if (uMethod === 'ALL') {
            for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
              registerStatic(m);
            }
          } else {
            registerStatic(uMethod);
          }
          dynamicRouteLookupCache.clear();
        } else if (
          typeof path === 'string' &&
          path.length > 0 &&
          (path.includes(':') || path.includes('*')) &&
          path !== '*' &&
          path !== '/*' &&
          !path.includes('(') &&
          !path.includes(')')
        ) {
          const compiled = compileRoutePattern(path);
          if (compiled) {
            const uMethod = method.toUpperCase();
            const routeInfo = { path, methods: { [method.toLowerCase()]: true } };
            const registerDynamic = (m) => {
              const key = `${m} ${path}`;
              const existing = dynamicRouteMap.get(key);
              if (existing) {
                existing.handlers.push(...wrappedHandlers);
              } else {
                const entry = {
                  method: m,
                  path,
                  compiled,
                  handlers: [...wrappedHandlers],
                  routeInfo,
                };
                dynamicRouteMap.set(key, entry);
                dynamicRouteList.push(entry);
              }
            };

            if (uMethod === 'ALL') {
              for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
                registerDynamic(m);
              }
            } else {
              registerDynamic(uMethod);
            }
            dynamicRouteLookupCache.clear();
          }
        }

        return origMethod.call(this, path, ...wrappedHandlers);
      };
    }
  }
  
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
    
    const helmetMw = helmet(finalConfig);

    // Check if configuration uses purely static directives (no per-request dynamic functions)
    let isDynamicCsp = false;
    if (finalConfig.contentSecurityPolicy && finalConfig.contentSecurityPolicy.directives) {
      for (const val of Object.values(finalConfig.contentSecurityPolicy.directives)) {
        if (typeof val === 'function') {
          isDynamicCsp = true;
          break;
        }
        if (Array.isArray(val) && val.some((item) => typeof item === 'function')) {
          isDynamicCsp = true;
          break;
        }
      }
    }

    if (!isDynamicCsp) {
      const staticHeaders = {};
      let removePoweredBy = false;
      const dummyRes = {
        setHeader(name, value) {
          staticHeaders[name] = value;
        },
        removeHeader(name) {
          if (name && name.toLowerCase() === 'x-powered-by') {
            removePoweredBy = true;
          }
        },
      };

      try {
        helmetMw({ headers: {} }, dummyRes, () => {});
      } catch (_) {
        // Fallback to standard helmet middleware if mock invocation fails
      }

      const headerEntries = Object.entries(staticHeaders);
      if (headerEntries.length > 0) {
        if (removePoweredBy) {
          app.disable('x-powered-by');
        }
        app.use((req, res, next) => {
          for (let i = 0; i < headerEntries.length; i++) {
            res.setHeader(headerEntries[i][0], headerEntries[i][1]);
          }
          if (removePoweredBy) {
            res.removeHeader('X-Powered-By');
          }
          next();
        });
      } else {
        app.use(helmetMw);
      }
    } else {
      app.use(helmetMw);
    }
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
  
  // Fast hardware-accelerated Weak ETag (CRC32 + Hex length) as default
  // Configurable via options.etag or options.server.etag
  const etagSetting = options.etag !== undefined
    ? options.etag
    : (options.server?.etag !== undefined ? options.server.etag : 'fast');

  if (etagSetting === false || etagSetting === null) {
    app.set('etag', false);
  } else if (etagSetting === 'fast' || etagSetting === true) {
    app.set('etag', fastETag);
  } else {
    app.set('etag', etagSetting);
  }
  
  // JSON body parser for API routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Ensure default empty object for body on mutating requests if not populated
  // and halt processing if request has timed out (after body parsers)
  app.use((req, res, next) => {
    if (timeoutConfig !== false && req.timedout) return;
    if (req.body === undefined && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
      req.body = {};
    }
    next();
  });
  
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
  const templateDirs = [viewsDir, pagesDir].filter(Boolean);
  if (templateDirs.length === 0) {
    templateDirs.push(path.join(rootDir, 'pages'));
  }
  
  const nunjucksOpts = options.nunjucks || {};
  const nunjucksEnv = configureSafeNunjucks(templateDirs, {
    autoescape: true,
    express: app,
    watch: isDev && !isTest,
    noCache: nunjucksOpts.noCache ?? (isDev || isTest),
    ...nunjucksOpts,
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

  // Auto-discover module services and middlewares if modules directory exists
  const modulesDirCandidate = options.modules?.dir
    ? (path.isAbsolute(options.modules.dir) ? options.modules.dir : path.join(rootDir, options.modules.dir))
    : (fs.existsSync(path.join(rootDir, 'src/modules')) ? path.join(rootDir, 'src/modules') : (fs.existsSync(path.join(rootDir, 'modules')) ? path.join(rootDir, 'modules') : null));

  if (modulesDirCandidate && fs.existsSync(modulesDirCandidate) && options.modules !== false) {
    try {
      const entries = fs.readdirSync(modulesDirCandidate, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
          const details = discoverModuleDetails(path.join(modulesDirCandidate, entry.name), entry.name);
          for (const [sName, sDef] of Object.entries(details.services)) {
            if (!serviceRegistry.has(sName)) {
              serviceRegistry.register(sName, sDef);
            }
          }
          for (const [mName, mFn] of Object.entries(details.middlewares)) {
            middlewares[`${entry.name}.${mName}`] = mFn;
          }
        }
      }
    } catch (mErr) {
      console.warn('[webspresso] Warning discovering modules:', mErr.message);
    }
  }

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
  
  // 1. Scan and compile discovered routes (src/pages, src/api, modules/*)
  const discoveredDescriptors = scanRoutes({
    rootDir,
    pages: options.pages !== undefined ? options.pages : (options.pagesDir ? { dir: options.pagesDir } : true),
    api: options.api,
    modules: options.modules,
  });

  const routeTable = compileRouteTable(discoveredDescriptors, {
    explicitRoutes: options.routes || [],
    isDev,
  });

  // Expose RouteTable on app instance
  app.routes = routeTable;
  app.routeTable = routeTable;

  if (!isTest && routeTable.size > 0) {
    console.log('\nMounting routes:');
  }

  // Fast-Path Static & Dynamic Route Dispatcher ($O(1) direct static & dynamic LRU lookup)
  // Eliminates Express linear layer regex matching (matchLayer) for static, dynamic, and 404 routes
  app.use(function fastPathDispatcher(req, res, next) {
    const rawPath = req.path || (req.url ? req.url.split('?')[0] : '/');
    const pathname = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
    const method = req.method ? req.method.toUpperCase() : 'GET';

    // 1. Static fast-path ($O(1) partitioned by method - zero string concat)
    const methodMap = fastPathStaticByMethod[method];
    let entry = methodMap ? methodMap.get(pathname) : undefined;
    if (!entry && method === 'HEAD') {
      entry = fastPathStaticByMethod.GET ? fastPathStaticByMethod.GET.get(pathname) : undefined;
    }
    if (entry) {
      if (!req.params) req.params = {};
      req.route = entry.routeInfo;
      return dispatchFastPath(entry.handlers, req, res, next);
    }

    // 2. Dynamic route fast-path with LRU caching
    if (dynamicRouteList.length > 0) {
      const cacheKey = `${method} ${pathname}`;
      const cached = getDynamicCache(cacheKey);

      if (cached === NOT_FOUND_SENTINEL) {
        return next();
      }

      if (cached) {
        req.params = Object.assign({}, cached.params);
        req.route = cached.entry.routeInfo;
        return dispatchFastPath(cached.entry.handlers, req, res, next);
      }

      if (method === 'HEAD') {
        const cachedGet = getDynamicCache(`GET ${pathname}`);
        if (cachedGet && cachedGet !== NOT_FOUND_SENTINEL) {
          req.params = Object.assign({}, cachedGet.params);
          req.route = cachedGet.entry.routeInfo;
          return dispatchFastPath(cachedGet.entry.handlers, req, res, next);
        }
      }

      // Linear pattern scan over registered dynamic routes (only once per unique pathname)
      for (let i = 0; i < dynamicRouteList.length; i++) {
        const entry = dynamicRouteList[i];
        if (entry.method !== method && !(method === 'HEAD' && entry.method === 'GET')) {
          continue;
        }

        const match = pathname.match(entry.compiled.regex);
        if (match) {
          const params = extractRouteParams(entry.compiled.paramNames, match);
          setDynamicCache(cacheKey, { entry, params });

          req.params = Object.assign({}, params);
          req.route = entry.routeInfo;
          return dispatchFastPath(entry.handlers, req, res, next);
        }
      }

      // Memoize as not found so subsequent requests for this path bypass regex scanning
      setDynamicCache(cacheKey, NOT_FOUND_SENTINEL);
    }

    next();
  });

  // Mount discovered routes
  const { routeMetadata: discoveredMeta, registerDynamicDiscoveredRoutes } = mountDiscoveredRoutes(app, routeTable, {
    nunjucks: nunjucksEnv,
    middlewares,
    pluginManager,
    silent: isTest,
    db: options.db ?? null,
    clientRuntime,
    pageAssets: options.pageAssets,
    serviceRegistry,
    options,
  });

  // 2. Mount classic file-based routes for backwards compatibility
  let classicRouteMeta = [];
  let registerDynamicFileRoutes = () => {};
  if (pagesDir && fs.existsSync(path.resolve(pagesDir))) {
    const classicMount = mountPages(app, {
      pagesDir,
      nunjucks: nunjucksEnv,
      middlewares,
      pluginManager,
      silent: isTest,
      db: options.db ?? null,
      clientRuntime,
      pageAssets: options.pageAssets,
      serviceRegistry,
      skipExistingRoutes: routeTable,
    });
    classicRouteMeta = classicMount.routeMetadata || [];
    registerDynamicFileRoutes = classicMount.registerDynamicFileRoutes || (() => {});
  }

  // Combine route metadata for plugin manager
  const allRouteMeta = [...discoveredMeta, ...classicRouteMeta];
  pluginManager.setRoutes(allRouteMeta);
  
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

  // Dynamic / catch-all file routes after plugins and setupRoutes
  registerDynamicFileRoutes();
  registerDynamicDiscoveredRoutes();

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
  const notFoundHandler = async (req, res) => {
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
  };
  app.use(notFoundHandler);
  
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

    // HTTP Server Socket Tuning: prevent 502 race conditions behind Cloudflare / Nginx / AWS ALB
    // Node.js defaults keepAliveTimeout to 5s, whereas Cloudflare/ALB default to 60s idle keep-alive.
    // Note: Node requires headersTimeout > keepAliveTimeout.
    const serverOpts = options.server || {};
    const keepAliveTimeout = serverOpts.keepAliveTimeout != null
      ? serverOpts.keepAliveTimeout
      : 65000;
    const headersTimeout = serverOpts.headersTimeout != null
      ? serverOpts.headersTimeout
      : Math.max(keepAliveTimeout + 1000, 66000);

    if (typeof server.keepAliveTimeout === 'number') {
      server.keepAliveTimeout = keepAliveTimeout;
    }
    if (typeof server.headersTimeout === 'number') {
      server.headersTimeout = headersTimeout;
    }

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
module.exports = { createApp, fastETag };
