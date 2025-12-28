/**
 * Webspresso Server
 * Express + Nunjucks SSR server with file-based routing
 */

const express = require('express');
const helmet = require('helmet');
const nunjucks = require('nunjucks');

const { mountPages } = require('./file-router');

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
 * Create and configure the Express app
 * @param {Object} options - Configuration options
 * @param {string} options.pagesDir - Path to pages directory
 * @param {string} options.viewsDir - Path to views directory  
 * @param {string} options.publicDir - Path to public/static directory
 * @param {boolean} options.logging - Enable request logging (default: isDev)
 * @param {Object|boolean} options.helmet - Helmet configuration (default: auto-configured, false to disable)
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
    helmet: helmetConfig
  } = options;
  
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
    silent: isTest
  });
  
  // 404 handler
  app.use((req, res) => {
    res.status(404);
    if (req.accepts('html')) {
      res.send(`
        <!DOCTYPE html>
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
        </html>
      `);
    } else {
      res.json({ error: 'Not Found' });
    }
  });
  
  // Error handler
  app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500);
    if (req.accepts('html')) {
      res.send(`
        <!DOCTYPE html>
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
            ${isDev ? `<pre>${err.stack || err.message}</pre>` : ''}
            <a href="/">← Back to Home</a>
          </div>
        </body>
        </html>
      `);
    } else {
      res.json({ error: 'Internal Server Error' });
    }
  });
  
  return { app, nunjucksEnv };
}

// Export for use as library
module.exports = { createApp };
