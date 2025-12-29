/**
 * Webspresso Server
 * Express + Nunjucks SSR server with file-based routing
 */

const express = require('express');
const helmet = require('helmet');
const nunjucks = require('nunjucks');

const { mountPages } = require('./file-router');
const { configureAssets } = require('./helpers');

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
 * Create and configure the Express app
 * @param {Object} options - Configuration options
 * @param {string} options.pagesDir - Path to pages directory
 * @param {string} options.viewsDir - Path to views directory  
 * @param {string} options.publicDir - Path to public/static directory
 * @param {boolean} options.logging - Enable request logging (default: isDev)
 * @param {Object|boolean} options.helmet - Helmet configuration (default: auto-configured, false to disable)
 * @param {Object} options.middlewares - Named middleware registry for route configs
 * @param {Object} options.assets - Asset manager configuration
 * @param {string} options.assets.manifestPath - Path to asset manifest file (Vite, Webpack)
 * @param {string} options.assets.version - Asset version for cache busting
 * @param {string} options.assets.prefix - URL prefix for assets
 * @param {Object} options.errorPages - Custom error page handlers
 * @param {Function|string} options.errorPages.notFound - Custom 404 handler or template path
 * @param {Function|string} options.errorPages.serverError - Custom 500 handler or template path
 * @returns {Object} { app, nunjucksEnv }
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
    assets: assetsConfig = {},
    errorPages = {}
  } = options;
  
  // Configure asset manager
  configureAssets({
    publicDir: publicDir || 'public',
    ...assetsConfig
  });
  
  if (!pagesDir) {
    throw new Error('pagesDir is required');
  }
  
  const app = express();
  
  // Security headers with Helmet
  if (helmetConfig !== false) {
    const defaultConfig = getDefaultHelmetConfig(isDev);
    const finalConfig = helmetConfig === undefined || helmetConfig === true
      ? defaultConfig
      : { ...defaultConfig, ...helmetConfig };
    
    app.use(helmet(finalConfig));
  }
  
  // Trust proxy (for correct req.ip, req.protocol behind reverse proxy)
  app.set('trust proxy', 1);
  
  // JSON body parser for API routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
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
  mountPages(app, {
    pagesDir,
    nunjucks: nunjucksEnv,
    middlewares,
    silent: isTest
  });
  
  // 404 handler
  app.use((req, res) => {
    res.status(404);
    
    // Custom handler function
    if (typeof errorPages.notFound === 'function') {
      return errorPages.notFound(req, res);
    }
    
    // Custom template
    if (typeof errorPages.notFound === 'string') {
      try {
        const html = nunjucksEnv.render(errorPages.notFound, {
          url: req.url,
          method: req.method
        });
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
    console.error('Server error:', err);
    res.status(err.status || 500);
    
    // Custom handler function
    if (typeof errorPages.serverError === 'function') {
      return errorPages.serverError(err, req, res);
    }
    
    // Custom template
    if (typeof errorPages.serverError === 'string') {
      try {
        const html = nunjucksEnv.render(errorPages.serverError, {
          error: isDev ? err : { message: 'Internal Server Error' },
          status: err.status || 500,
          isDev
        });
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
  
  return { app, nunjucksEnv };
}

// Export for use as library
module.exports = { createApp };
