/**
 * Webspresso Server
 * Express + Nunjucks SSR server with file-based routing
 */

const express = require('express');
const helmet = require('helmet');
const nunjucks = require('nunjucks');
const timeout = require('connect-timeout');

const { setAppContext } = require('./app-context');
const { mountPages } = require('./file-router');
const { configureAssets, createHelpers, getScriptInjector } = require('./helpers');
const { createPluginManager } = require('./plugin-manager');

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
 * Default 404 page HTML
 */
function default404Html() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>404 - Not Found</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; }
    h1 { font-size: 4rem; margin: 0; color: #333; }
    p { color: #666; margin: 1rem 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>404</h1>
    <p>Page not found</p>
    <a href="/">← Back to Home</a>
  </div>
</body>
</html>`;
}

/**
 * Default 500 page HTML
 */
function default500Html(err, isDev) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>500 - Server Error</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; }
    h1 { font-size: 4rem; margin: 0; color: #333; }
    p { color: #666; margin: 1rem 0; }
    pre { background: #fff; padding: 1rem; border-radius: 4px; text-align: left; overflow: auto; max-width: 600px; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>500</h1>
    <p>Internal Server Error</p>
    ${isDev && err ? `<pre>${err.stack || err.message}</pre>` : ''}
    <a href="/">← Back to Home</a>
  </div>
</body>
</html>`;
}

/**
 * Default 503 (timeout) page HTML
 */
function default503Html() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>503 - Service Unavailable</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; }
    h1 { font-size: 4rem; margin: 0; color: #333; }
    p { color: #666; margin: 1rem 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>503</h1>
    <p>Request timed out. Please try again.</p>
    <a href="/">← Back to Home</a>
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

  setAppContext({ db: options.db ?? null });
  
  const app = express();
  
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
          if (sources.size > 0 && directives[directive]) {
            directives[directive] = [...directives[directive], ...Array.from(sources)];
          }
        }
      }
    }
    
    app.use(helmet(finalConfig));
  }
  
  // Request timeout middleware
  if (timeoutConfig !== false) {
    app.use(timeout(timeoutConfig));
  }
  
  // Trust proxy (for correct req.ip, req.protocol behind reverse proxy)
  app.set('trust proxy', 1);
  
  // JSON body parser for API routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
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
  }
  
  // Static files (if publicDir provided)
  if (publicDir) {
    app.use(express.static(publicDir, {
      maxAge: isDev ? 0 : '1d',
      etag: true
    }));
  }
  
  // Configure Nunjucks
  const templateDirs = viewsDir ? [pagesDir, viewsDir] : [pagesDir];
  
  const nunjucksEnv = nunjucks.configure(templateDirs, {
    autoescape: true,
    express: app,
    watch: isDev && !isTest,
    noCache: isDev || isTest
  });
  
  // Add custom Nunjucks filters
  nunjucksEnv.addFilter('json', (obj) => {
    return JSON.stringify(obj, null, 2);
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
  
  // Register plugins (sync)
  const pluginContext = { app, nunjucksEnv, options };
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
  const routeMetadata = mountPages(app, {
    pagesDir,
    nunjucks: nunjucksEnv,
    middlewares,
    pluginManager,
    silent: isTest,
    db: options.db ?? null
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
    });
  }
  
  // Helper to create error page context with fsy
  function createErrorContext(req, extraData = {}) {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const locale = req.query?.lang || process.env.DEFAULT_LOCALE || 'en';
    
    // Create fsy helpers
    const fsy = createHelpers({ req, res: {}, baseUrl, locale });
    
    // Merge plugin helpers
    const pluginHelpers = pluginManager.getHelpers();
    Object.assign(fsy, pluginHelpers);
    
    return {
      fsy,
      locale,
      isDev,
      url: req.url,
      method: req.method,
      ...extraData
    };
  }
  
  // 404 handler
  app.use((req, res) => {
    res.status(404);
    const ctx = createErrorContext(req);
    
    // Custom handler function
    if (typeof errorPages.notFound === 'function') {
      return errorPages.notFound(req, res, ctx);
    }
    
    // Custom template
    if (typeof errorPages.notFound === 'string') {
      try {
        const html = nunjucksEnv.render(errorPages.notFound, ctx);
        return res.send(html);
      } catch (e) {
        console.error('Error rendering 404 template:', e);
      }
    }
    
    // Default response
    if (req.accepts('html')) {
      res.send(default404Html());
    } else {
      res.json({ error: 'Not Found', status: 404 });
    }
  });
  
  // Error handler
  app.use((err, req, res, next) => {
    // Handle timeout errors
    if (req.timedout) {
      console.error('Request timed out:', req.method, req.url);
      res.status(503);
      const ctx = createErrorContext(req);
      
      // Custom timeout handler
      if (typeof errorPages.timeout === 'function') {
        return errorPages.timeout(req, res, ctx);
      }
      
      // Custom timeout template
      if (typeof errorPages.timeout === 'string') {
        try {
          const html = nunjucksEnv.render(errorPages.timeout, ctx);
          return res.send(html);
        } catch (e) {
          console.error('Error rendering timeout template:', e);
        }
      }
      
      // Default timeout response
      if (req.accepts('html')) {
        return res.send(default503Html());
      } else {
        return res.json({ error: 'Request Timeout', status: 503 });
      }
    }
    
    console.error('Server error:', err);
    res.status(err.status || 500);
    const ctx = createErrorContext(req, {
      error: isDev ? err : { message: 'Internal Server Error' },
      status: err.status || 500
    });
    
    // Custom handler function
    if (typeof errorPages.serverError === 'function') {
      return errorPages.serverError(err, req, res, ctx);
    }
    
    // Custom template
    if (typeof errorPages.serverError === 'string') {
      try {
        const html = nunjucksEnv.render(errorPages.serverError, ctx);
        return res.send(html);
      } catch (e) {
        console.error('Error rendering 500 template:', e);
      }
    }
    
    // Default response
    if (req.accepts('html')) {
      res.send(default500Html(err, isDev));
    } else {
      res.json({ 
        error: 'Internal Server Error', 
        status: err.status || 500,
        ...(isDev && { message: err.message, stack: err.stack })
      });
    }
  });
  
  return { app, nunjucksEnv, pluginManager, authMiddleware };
}

// Export for use as library
module.exports = { createApp };
