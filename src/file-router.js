/**
 * Webspresso File-Based Router
 * Scans pages/ directory and registers routes automatically
 */

const fs = require('fs');
const path = require('path');
const { createHelpers } = require('./helpers');

// Cache for i18n files (key: filePath, value: { mtime, data })
const i18nCache = new Map();

// Cache for route configs in production
const configCache = new Map();

/**
 * Convert a file path to an Express route pattern
 * @param {string} filePath - Relative path from pages/
 * @param {string} ext - File extension (.njk or .js)
 * @returns {string} Express route pattern
 */
function filePathToRoute(filePath, ext) {
  // Remove extension
  let route = filePath.replace(ext, '');
  
  // Normalize path separators to forward slashes (handle both / and \)
  route = route.split(path.sep).join('/');
  route = route.split('\\').join('/'); // Also handle literal backslashes
  
  // Handle index files
  if (route.endsWith('/index')) {
    route = route.slice(0, -6) || '/';
  } else if (route === 'index') {
    route = '/';
  }
  
  // Convert [param] to :param
  route = route.replace(/\[([^\]\.]+)\]/g, ':$1');
  
  // Convert [...param] to * (catch-all)
  route = route.replace(/\[\.\.\.([^\]]+)\]/g, '*');
  
  // Ensure leading slash
  if (!route.startsWith('/')) {
    route = '/' + route;
  }
  
  return route;
}

/**
 * Extract HTTP method from API filename
 * @param {string} filename - Filename like health.get.js
 * @returns {{ method: string, baseName: string }}
 */
function extractMethodFromFilename(filename) {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  const parts = filename.replace('.js', '').split('.');
  
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1].toLowerCase();
    if (methods.includes(lastPart)) {
      return {
        method: lastPart,
        baseName: parts.slice(0, -1).join('.')
      };
    }
  }
  
  return { method: 'get', baseName: parts.join('.') };
}

/**
 * Recursively scan a directory for files
 * @param {string} dir - Directory to scan
 * @param {string} baseDir - Base directory for relative paths
 * @returns {string[]} Array of relative file paths
 */
function scanDirectory(dir, baseDir = dir) {
  const files = [];
  
  if (!fs.existsSync(dir)) {
    return files;
  }
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    if (entry.isDirectory()) {
      // Skip locales directories
      if (entry.name === 'locales') continue;
      files.push(...scanDirectory(fullPath, baseDir));
    } else if (entry.isFile()) {
      // Skip files starting with _
      if (entry.name.startsWith('_')) continue;
      files.push(relativePath);
    }
  }
  
  return files;
}

/**
 * Load i18n JSON file with caching
 * @param {string} filePath - Path to JSON file
 * @returns {Object} Parsed JSON or empty object
 */
function loadI18nFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  
  try {
    const stats = fs.statSync(filePath);
    const cached = i18nCache.get(filePath);
    
    if (cached && cached.mtime >= stats.mtimeMs) {
      return cached.data;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    i18nCache.set(filePath, { mtime: stats.mtimeMs, data });
    return data;
  } catch (err) {
    console.error(`Error loading i18n file ${filePath}:`, err.message);
    return {};
  }
}

/**
 * Load merged i18n translations for a route
 * @param {string} pagesDir - Pages directory path
 * @param {string} routeDir - Route directory path
 * @param {string} locale - Locale code
 * @returns {Object} Merged translations
 */
function loadI18n(pagesDir, routeDir, locale) {
  // Load global translations
  const globalPath = path.join(pagesDir, 'locales', `${locale}.json`);
  const globalTranslations = loadI18nFile(globalPath);
  
  // Load route-specific translations
  const routePath = path.join(routeDir, 'locales', `${locale}.json`);
  const routeTranslations = loadI18nFile(routePath);
  
  // Merge: route-specific overrides global
  return { ...globalTranslations, ...routeTranslations };
}

/**
 * Create a translation function
 * @param {Object} translations - Translation object
 * @returns {Function} Translation function t(key)
 */
function createTranslator(translations) {
  return function t(key, params = {}) {
    let value = translations[key];
    
    if (value === undefined) {
      // Try nested key lookup (e.g., "meta.title")
      const parts = key.split('.');
      value = translations;
      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = value[part];
        } else {
          value = undefined;
          break;
        }
      }
    }
    
    if (value === undefined) {
      return key; // Return key if translation not found
    }
    
    // Replace params like {{name}} in the translation
    if (typeof value === 'string' && Object.keys(params).length > 0) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        value = value.replace(new RegExp(`{{\\s*${paramKey}\\s*}}`, 'g'), paramValue);
      }
    }
    
    return value;
  };
}

/**
 * Load route config module
 * @param {string} configPath - Path to config .js file
 * @param {boolean} isDev - Is development mode
 * @returns {Object|null} Route config or null
 */
function loadRouteConfig(configPath, isDev) {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  
  try {
    // Clear cache in development mode
    if (isDev && require.cache[require.resolve(configPath)]) {
      delete require.cache[require.resolve(configPath)];
    }
    
    if (!isDev && configCache.has(configPath)) {
      return configCache.get(configPath);
    }
    
    const config = require(configPath);
    
    if (!isDev) {
      configCache.set(configPath, config);
    }
    
    return config;
  } catch (err) {
    console.error(`Error loading route config ${configPath}:`, err.message);
    return null;
  }
}

/**
 * Load global hooks
 * @param {string} pagesDir - Pages directory path
 * @param {boolean} isDev - Is development mode
 * @returns {Object|null} Global hooks or null
 */
function loadGlobalHooks(pagesDir, isDev) {
  const hooksPath = path.join(pagesDir, '_hooks.js');
  return loadRouteConfig(hooksPath, isDev);
}

/**
 * Execute a hook if it exists
 * @param {Object} hooks - Hooks object
 * @param {string} hookName - Hook name
 * @param {Object} ctx - Context object
 */
async function executeHook(hooks, hookName, ctx) {
  if (hooks && typeof hooks[hookName] === 'function') {
    await hooks[hookName](ctx);
  }
}

/**
 * Detect locale from request
 * @param {Object} req - Express request
 * @returns {string} Locale code
 */
function detectLocale(req) {
  // 1. Check query parameter
  if (req.query.lang) {
    return req.query.lang;
  }
  
  // 2. Check Accept-Language header
  const acceptLanguage = req.get('Accept-Language');
  if (acceptLanguage) {
    const supported = (process.env.SUPPORTED_LOCALES || 'en').split(',');
    const preferred = acceptLanguage.split(',')[0].split('-')[0].toLowerCase();
    if (supported.includes(preferred)) {
      return preferred;
    }
  }
  
  // 3. Default locale
  return process.env.DEFAULT_LOCALE || 'en';
}

/**
 * Mount all pages as routes on the Express app
 * @param {Object} app - Express app
 * @param {Object} options - Options
 * @param {string} options.pagesDir - Pages directory path
 * @param {Object} options.nunjucks - Nunjucks environment
 * @param {boolean} options.silent - Suppress console output
 */
function mountPages(app, options) {
  const { pagesDir, nunjucks, silent = false } = options;
  const isDev = process.env.NODE_ENV !== 'production';
  const log = silent ? () => {} : console.log.bind(console);
  
  // Get absolute path to pages directory
  const absolutePagesDir = path.resolve(pagesDir);
  
  // Load global hooks
  const globalHooks = loadGlobalHooks(absolutePagesDir, isDev);
  
  // Scan for files
  const files = scanDirectory(absolutePagesDir);
  
  // Separate SSR pages and API routes
  const ssrRoutes = [];
  const apiRoutes = [];
  
  for (const file of files) {
    const ext = path.extname(file);
    const isApi = file.startsWith('api' + path.sep) || file.startsWith('api/');
    
    if (isApi && ext === '.js') {
      // API route
      const { method, baseName } = extractMethodFromFilename(path.basename(file));
      const dirPart = path.dirname(file);
      const routePath = dirPart === '.' 
        ? `/${baseName}` 
        : `/${dirPart}/${baseName}`.split(path.sep).join('/');
      
      apiRoutes.push({
        file,
        method,
        routePath: filePathToRoute(routePath.replace(/^\/api/, '/api'), ''),
        fullPath: path.join(absolutePagesDir, file)
      });
    } else if (ext === '.njk') {
      // SSR page
      const routePath = filePathToRoute(file, '.njk');
      const configPath = path.join(absolutePagesDir, file.replace('.njk', '.js'));
      const routeDir = path.dirname(path.join(absolutePagesDir, file));
      
      ssrRoutes.push({
        file,
        routePath,
        fullPath: path.join(absolutePagesDir, file),
        configPath,
        routeDir
      });
    }
  }
  
  // Sort routes: specific routes first, then dynamic, then catch-all
  const sortRoutes = (routes) => {
    return routes.sort((a, b) => {
      const aHasCatchAll = a.routePath.includes('*');
      const bHasCatchAll = b.routePath.includes('*');
      const aHasDynamic = a.routePath.includes(':');
      const bHasDynamic = b.routePath.includes(':');
      
      if (aHasCatchAll && !bHasCatchAll) return 1;
      if (!aHasCatchAll && bHasCatchAll) return -1;
      if (aHasDynamic && !bHasDynamic) return 1;
      if (!aHasDynamic && bHasDynamic) return -1;
      
      return a.routePath.localeCompare(b.routePath);
    });
  };
  
  // Register API routes
  for (const route of sortRoutes(apiRoutes)) {
    const handler = require(route.fullPath);
    const handlerFn = typeof handler === 'function' ? handler : handler.default || handler.handler;
    
    if (typeof handlerFn !== 'function') {
      console.warn(`API route ${route.file} does not export a function`);
      continue;
    }
    
    app[route.method](route.routePath, async (req, res, next) => {
      try {
        // Reload handler in dev mode
        if (isDev && require.cache[require.resolve(route.fullPath)]) {
          delete require.cache[require.resolve(route.fullPath)];
        }
        const currentHandler = isDev 
          ? require(route.fullPath) 
          : handler;
        const fn = typeof currentHandler === 'function' 
          ? currentHandler 
          : currentHandler.default || currentHandler.handler;
        
        await fn(req, res, next);
      } catch (err) {
        console.error(`API error ${route.routePath}:`, err);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });
    
    log(`  ${route.method.toUpperCase()} ${route.routePath} -> ${route.file}`);
  }
  
  // Register SSR routes
  for (const route of sortRoutes(ssrRoutes)) {
    app.get(route.routePath, async (req, res, next) => {
      try {
        // Detect locale
        const locale = detectLocale(req);
        
        // Load translations
        const translations = loadI18n(absolutePagesDir, route.routeDir, locale);
        const t = createTranslator(translations);
        
        // Load route config
        const config = loadRouteConfig(route.configPath, isDev);
        const routeHooks = config?.hooks || {};
        
        // Create context
        const ctx = {
          req,
          res,
          path: route.routePath,
          file: route.file,
          routeDir: route.routeDir,
          locale,
          t,
          data: {},
          meta: {
            title: t('meta.title') !== 'meta.title' ? t('meta.title') : null,
            description: t('meta.description') !== 'meta.description' ? t('meta.description') : null,
            indexable: true,
            canonical: null
          },
          fsy: createHelpers({ req, res, locale })
        };
        
        // Execute hooks: onRequest
        await executeHook(globalHooks, 'onRequest', ctx);
        await executeHook(routeHooks, 'onRequest', ctx);
        
        // Execute hooks: onRoute
        await executeHook(globalHooks, 'onRoute', ctx);
        await executeHook(routeHooks, 'onRoute', ctx);
        
        // Execute hooks: beforeMiddleware
        await executeHook(globalHooks, 'beforeMiddleware', ctx);
        await executeHook(routeHooks, 'beforeMiddleware', ctx);
        
        // Run route middleware
        if (config?.middleware && Array.isArray(config.middleware)) {
          for (const mw of config.middleware) {
            await new Promise((resolve, reject) => {
              mw(req, res, (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        }
        
        // Execute hooks: afterMiddleware
        await executeHook(globalHooks, 'afterMiddleware', ctx);
        await executeHook(routeHooks, 'afterMiddleware', ctx);
        
        // Execute hooks: beforeLoad
        await executeHook(globalHooks, 'beforeLoad', ctx);
        await executeHook(routeHooks, 'beforeLoad', ctx);
        
        // Run load function
        if (config?.load && typeof config.load === 'function') {
          const loadData = await config.load(req, ctx);
          ctx.data = { ...ctx.data, ...loadData };
        }
        
        // Execute hooks: afterLoad
        await executeHook(globalHooks, 'afterLoad', ctx);
        await executeHook(routeHooks, 'afterLoad', ctx);
        
        // Run meta function
        if (config?.meta && typeof config.meta === 'function') {
          const metaData = await config.meta(req, ctx);
          ctx.meta = { ...ctx.meta, ...metaData };
        }
        
        // Execute hooks: beforeRender
        await executeHook(globalHooks, 'beforeRender', ctx);
        await executeHook(routeHooks, 'beforeRender', ctx);
        
        // Render the template
        const templatePath = route.file.split(path.sep).join('/');
        const html = nunjucks.render(templatePath, {
          ...ctx.data,
          meta: ctx.meta,
          locale: ctx.locale,
          t: ctx.t,
          fsy: ctx.fsy,
          req: {
            path: req.path,
            query: req.query,
            params: req.params
          }
        });
        
        // Execute hooks: afterRender
        ctx.html = html;
        await executeHook(globalHooks, 'afterRender', ctx);
        await executeHook(routeHooks, 'afterRender', ctx);
        
        res.send(ctx.html);
      } catch (err) {
        console.error(`SSR error ${route.routePath}:`, err);
        
        // Execute onError hook
        const ctx = { req, res, error: err };
        try {
          await executeHook(globalHooks, 'onError', ctx, err);
        } catch (hookErr) {
          console.error('Error in onError hook:', hookErr);
        }
        
        res.status(500).send('Internal Server Error');
      }
    });
    
    log(`  GET ${route.routePath} -> ${route.file}`);
  }
}

module.exports = {
  mountPages,
  filePathToRoute,
  extractMethodFromFilename,
  scanDirectory,
  loadI18n,
  createTranslator,
  detectLocale
};

