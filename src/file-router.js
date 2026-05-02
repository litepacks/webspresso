/**
 * Webspresso File-Based Router
 * Scans pages/ directory and registers routes automatically
 */

const fs = require('fs');
const path = require('path');
const { ZodError } = require('zod');
const { compileSchema, invalidateSchema } = require('../core/compileSchema');
const { applySchema } = require('../core/applySchema');
const { createHelpers } = require('./helpers');
const {
  loadNjkRouteTemplate,
  parseNjkFrontmatter,
  frontmatterToPatches,
  clearNjkFrontmatterCaches,
} = require('./njk-frontmatter');

// Cache for i18n files (key: filePath, value: { mtime, data })
const i18nCache = new Map();

// Cache for route configs in production
const configCache = new Map();

// Dev-only: avoid require() on every SSR request when the .js file is unchanged (mtime)
const routeConfigDevCache = new Map();

// Cache for API filename -> { method, baseName } (basename keys; stable per process)
const methodFromFilenameCache = new Map();

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
 * Metadata for ordering route registration: more specific Express paths must be
 * registered before less specific ones (static before dynamic; more literal
 * segments before fewer; deeper paths before shallower among same class).
 * @param {string} routePath
 * @returns {{ tier: number, literalSegCount: number, paramSegCount: number, depth: number, routePath: string }}
 */
function routeRegistrationMeta(routePath) {
  let pathHasStar = false;
  let pathHasColon = false;
  let depth = 0;
  let literalSegCount = 0;
  let paramSegCount = 0;

  const s = routePath;
  const n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && s.charCodeAt(i) === 47 /* / */) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && s.charCodeAt(i) !== 47) i++;

    depth++;
    let segHasStar = false;
    let segHasColon = false;
    for (let j = start; j < i; j++) {
      const c = s.charCodeAt(j);
      if (c === 42 /* * */) segHasStar = true;
      else if (c === 58 /* : */) segHasColon = true;
    }
    if (segHasStar) pathHasStar = true;
    if (segHasColon) pathHasColon = true;

    if (segHasStar) {
      // Same as: seg === '*' || (seg.length > 0 && seg.includes('*'))
      continue;
    }
    if (segHasColon) paramSegCount += 1;
    else literalSegCount += 1;
  }

  let tier;
  if (pathHasStar) tier = 2;
  else if (pathHasColon) tier = 1;
  else tier = 0;

  return {
    tier,
    literalSegCount,
    paramSegCount,
    depth,
    routePath,
  };
}

/**
 * Compare two routes for registration order (negative if a before b).
 * @param {{ routePath: string }} a
 * @param {{ routePath: string }} b
 */
function compareRouteRegistrationOrder(a, b) {
  const ma = routeRegistrationMeta(a.routePath);
  const mb = routeRegistrationMeta(b.routePath);
  if (ma.tier !== mb.tier) return ma.tier - mb.tier;
  if (ma.literalSegCount !== mb.literalSegCount) {
    return mb.literalSegCount - ma.literalSegCount;
  }
  if (ma.depth !== mb.depth) return mb.depth - ma.depth;
  if (ma.paramSegCount !== mb.paramSegCount) return ma.paramSegCount - mb.paramSegCount;
  return ma.routePath.localeCompare(mb.routePath);
}

/**
 * Extract HTTP method from API filename
 * @param {string} filename - Filename like health.get.js
 * @returns {{ method: string, baseName: string }}
 */
function extractMethodFromFilename(filename) {
  const hit = methodFromFilenameCache.get(filename);
  if (hit !== undefined) {
    return hit;
  }

  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  const parts = filename.replace('.js', '').split('.');
  let result;

  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1].toLowerCase();
    if (methods.includes(lastPart)) {
      result = {
        method: lastPart,
        baseName: parts.slice(0, -1).join('.'),
      };
    }
  }

  if (!result) {
    result = { method: 'get', baseName: parts.join('.') };
  }

  methodFromFilenameCache.set(filename, result);
  return result;
}

/**
 * Whether `load()` return values for `stylesheets` and `scripts` are promoted to
 * `pageHead` in Nunjucks (see `createApp({ pageAssets })`).
 * @param {boolean|{enabled?: boolean, stylesheets?: boolean, scripts?: boolean}|null|undefined} raw
 * @returns {{ enabled: boolean, stylesheets: boolean, scripts: boolean }}
 */
function resolvePageAssets(raw) {
  if (raw === true) {
    return { enabled: true, stylesheets: true, scripts: true };
  }
  if (raw == null || raw === false) {
    return { enabled: false, stylesheets: false, scripts: false };
  }
  if (typeof raw === 'object') {
    const on = raw.enabled !== false;
    if (!on) {
      return { enabled: false, stylesheets: false, scripts: false };
    }
    return {
      enabled: true,
      stylesheets: raw.stylesheets !== false,
      scripts: raw.scripts !== false,
    };
  }
  return { enabled: false, stylesheets: false, scripts: false };
}

/**
 * @param {unknown} v
 * @returns {unknown[]}
 */
function toList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * @param {{ enabled: boolean, stylesheets: boolean, scripts: boolean }} cfg
 * @param {Object} data
 * @returns {{ data: Object, pageHead: { stylesheets: unknown[], scripts: unknown[] }|null, pageAssets: boolean }}
 */
function applyPageAssetsToTemplateData(cfg, data) {
  if (!cfg || !cfg.enabled) {
    return { data, pageHead: null, pageAssets: false };
  }
  const out = { ...data };
  let styles = [];
  let scriptItems = [];
  if (cfg.stylesheets && Object.prototype.hasOwnProperty.call(out, 'stylesheets')) {
    styles = toList(out.stylesheets);
    delete out.stylesheets;
  }
  if (cfg.scripts && Object.prototype.hasOwnProperty.call(out, 'scripts')) {
    scriptItems = toList(out.scripts);
    delete out.scripts;
  }
  return {
    data: out,
    pageHead: { stylesheets: styles, scripts: scriptItems },
    pageAssets: true,
  };
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
    routeConfigDevCache.delete(configPath);
    return null;
  }

  try {
    if (isDev) {
      const stats = fs.statSync(configPath);
      const devCached = routeConfigDevCache.get(configPath);
      if (devCached && devCached.mtime >= stats.mtimeMs) {
        return devCached.config;
      }
      if (require.cache[require.resolve(configPath)]) {
        delete require.cache[require.resolve(configPath)];
      }
      const config = require(configPath);
      routeConfigDevCache.set(configPath, { mtime: stats.mtimeMs, config });
      return config;
    }

    if (configCache.has(configPath)) {
      return configCache.get(configPath);
    }

    const config = require(configPath);
    configCache.set(configPath, config);
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
 * True when the registry entry is (options) => (req, res, next) => …
 * Express handlers typically have length >= 2 (req, res) or 3 (req, res, next).
 */
function isMiddlewareFactory(fn) {
  return typeof fn === 'function' && fn.length <= 1;
}

/**
 * Resolve a named middleware from createApp({ middlewares }).
 * @param {string} name
 * @param {Function} entry
 * @param {boolean} fromTuple - true when route used ['name', options]
 * @param {unknown} tupleOptions - second element of the tuple (only when fromTuple)
 * @param {Object} middlewareRegistry - for error messages
 * @returns {Function} Express middleware
 */
function resolveNamedMiddleware(name, entry, fromTuple, tupleOptions, middlewareRegistry) {
  if (!entry) {
    throw new Error(`Middleware "${name}" not found in registry. Available: ${Object.keys(middlewareRegistry).join(', ') || 'none'}`);
  }
  if (typeof entry !== 'function') {
    throw new Error(`Middleware "${name}" must be a function`);
  }

  if (fromTuple) {
    if (!isMiddlewareFactory(entry)) {
      throw new Error(
        `Middleware "${name}" must be a factory (options) => (req, res, next) => … when using ["${name}", options] tuple form`
      );
    }
    const produced = entry(tupleOptions);
    if (typeof produced !== 'function') {
      throw new Error(`Middleware factory "${name}" must return an Express middleware function`);
    }
    return produced;
  }

  if (isMiddlewareFactory(entry)) {
    const produced = entry({});
    if (typeof produced !== 'function') {
      throw new Error(`Middleware factory "${name}" must return an Express middleware function`);
    }
    return produced;
  }

  return entry;
}

/**
 * Resolve middleware from config — functions, string names, or [name, options] tuples
 * @param {Array} middlewareConfig - middleware functions, names, or ['name', options] tuples
 * @param {Object} middlewareRegistry - Named middleware registry (plain handlers or option factories)
 * @returns {Array} Array of resolved middleware functions
 */
function resolveMiddlewares(middlewareConfig, middlewareRegistry = {}) {
  if (!middlewareConfig || !Array.isArray(middlewareConfig)) {
    return [];
  }
  
  return middlewareConfig.map((mw, index) => {
    if (typeof mw === 'function') {
      return mw;
    }
    
    if (typeof mw === 'string') {
      return resolveNamedMiddleware(mw, middlewareRegistry[mw], false, undefined, middlewareRegistry);
    }

    if (Array.isArray(mw) && mw.length === 2 && typeof mw[0] === 'string') {
      const name = mw[0];
      return resolveNamedMiddleware(name, middlewareRegistry[name], true, mw[1], middlewareRegistry);
    }
    
    throw new Error(
      `Invalid middleware at index ${index}: must be a function, string name, or [name, options] tuple`
    );
  });
}

/**
 * Mount all pages as routes on the Express app
 * @param {Object} app - Express app
 * @param {Object} options - Options
 * @param {string} options.pagesDir - Pages directory path
 * @param {Object} options.nunjucks - Nunjucks environment
 * @param {Object} options.middlewares - Named middleware registry
 * @param {Object} options.pluginManager - Plugin manager instance
 * @param {boolean} options.silent - Suppress console output
 * @param {Object} options.db - Database instance (exposed as ctx.db in load/meta)
 * @param {{ alpine?: boolean, swup?: boolean }} [options.clientRuntime] - Passed to Nunjucks as `clientRuntime` (default both false)
 * @param {boolean|{enabled?: boolean, stylesheets?: boolean, scripts?: boolean}} [options.pageAssets] - If set, `load()` may return `stylesheets` / `scripts` promoted to `pageHead` in templates
 * @returns {Array} Route metadata for plugins
 */
function mountPages(app, options) {
  const {
    pagesDir,
    nunjucks,
    middlewares = {},
    pluginManager = null,
    silent = false,
    db = null,
    clientRuntime: clientRuntimeOpt = null,
    pageAssets: pageAssetsOpt = null,
  } = options;
  const pageAssetsResolved = resolvePageAssets(pageAssetsOpt);
  const clientRuntime = clientRuntimeOpt && typeof clientRuntimeOpt === 'object'
    ? { alpine: !!clientRuntimeOpt.alpine, swup: !!clientRuntimeOpt.swup }
    : { alpine: false, swup: false };
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
  
  // Sort routes: static before dynamic before catch-all; then more literal segments, then deeper paths
  const sortRoutes = (routes) => routes.sort(compareRouteRegistrationOrder);
  sortRoutes(apiRoutes);
  sortRoutes(ssrRoutes);

  const apiStatic = apiRoutes.filter((r) => routeRegistrationMeta(r.routePath).tier === 0);
  const apiDynamic = apiRoutes.filter((r) => routeRegistrationMeta(r.routePath).tier !== 0);
  const ssrStatic = ssrRoutes.filter((r) => routeRegistrationMeta(r.routePath).tier === 0);
  const ssrDynamic = ssrRoutes.filter((r) => routeRegistrationMeta(r.routePath).tier !== 0);

  /** Register API routes (shared by static phase and dynamic phase). */
  const registerApiRoutes = (routes) => {
    for (const route of routes) {
    const handler = require(route.fullPath);
    const handlerFn = typeof handler === 'function' ? handler : handler.default || handler.handler;
    const routeMiddleware = handler.middleware;

    const preResolvedMw = routeMiddleware
      ? resolveMiddlewares(routeMiddleware, middlewares)
      : [];
    
    if (typeof handlerFn !== 'function') {
      console.warn(`API route ${route.file} does not export a function`);
      continue;
    }
    
    app[route.method](route.routePath, async (req, res, next) => {
      try {
        // Same instance as createApp({ db }) / getAppContext().db — available to handler & route middleware
        if (db != null) {
          req.db = db;
        }

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

        if (isDev) {
          invalidateSchema(route.fullPath);
        }
        let compiledSchema;
        try {
          compiledSchema = compileSchema(route.fullPath, currentHandler);
        } catch (schemaErr) {
          console.error(`API schema compile error ${route.routePath}:`, schemaErr);
          res.status(500).json({ error: 'Internal Server Error', message: schemaErr.message });
          return;
        }

        try {
          applySchema(req, compiledSchema);
        } catch (err) {
          if (err instanceof ZodError) {
            return res.status(400).json({
              error: 'Validation Error',
              issues: err.issues,
            });
          }
          throw err;
        }
        
        // Run middleware if defined (resolved at route registration — required for stateful middleware like express-rate-limit)
        if (preResolvedMw.length) {
          for (const mw of preResolvedMw) {
            await new Promise((resolve, reject) => {
              mw(req, res, (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        }
        
        await fn(req, res, next);
      } catch (err) {
        console.error(`API error ${route.routePath}:`, err);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });
    
    log(`  ${route.method.toUpperCase()} ${route.routePath} -> ${route.file}`);
    }
  };

  /** Register SSR GET routes (shared by static phase and dynamic phase). */
  const registerSsrRoutes = (routes) => {
    for (const route of routes) {
    const mountConfig = loadRouteConfig(route.configPath, isDev);
    const preResolvedPageMw = mountConfig?.middleware
      ? resolveMiddlewares(mountConfig.middleware, middlewares)
      : [];

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
        
        // Create context with plugin helpers merged
        const baseHelpers = createHelpers({ req, res, locale });
        const pluginHelpers = pluginManager ? pluginManager.getHelpers() : {};
        
        const njkTpl = loadNjkRouteTemplate(route.fullPath, isDev);

        const ctx = {
          req,
          res,
          db,
          path: route.routePath,
          file: route.file,
          routeDir: route.routeDir,
          locale,
          t,
          data: { ...njkTpl.dataPatch },
          meta: {
            title: t('meta.title') !== 'meta.title' ? t('meta.title') : null,
            description: t('meta.description') !== 'meta.description' ? t('meta.description') : null,
            indexable: true,
            canonical: null,
            ...njkTpl.metaPatch,
          },
          fsy: { ...baseHelpers, ...pluginHelpers },
          clientRuntime,
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
        
        // Run route middleware (chain fixed at route registration; edit middleware in dev → restart)
        if (preResolvedPageMw.length) {
          for (const mw of preResolvedPageMw) {
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
        
        const pageAssetBundle = applyPageAssetsToTemplateData(pageAssetsResolved, ctx.data);
        ctx.data = pageAssetBundle.data;
        const renderContext = {
          ...ctx.data,
          meta: ctx.meta,
          locale: ctx.locale,
          t: ctx.t,
          fsy: ctx.fsy,
          clientRuntime: ctx.clientRuntime,
          req: {
            path: req.path,
            query: req.query,
            params: req.params
          }
        };
        if (pageAssetBundle.pageAssets) {
          renderContext.pageAssets = true;
          renderContext.pageHead = pageAssetBundle.pageHead;
        }
        
        // Render the template
        const templatePath = route.file.split(path.sep).join('/');
        const html =
          njkTpl.useStringRender && njkTpl.templateBody != null
            ? nunjucks.renderString(njkTpl.templateBody, renderContext, { path: route.fullPath })
            : nunjucks.render(templatePath, renderContext);
        
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
  };

  // Static / literal file routes first so plugins can register reserved paths (e.g. /_admin)
  // before catch-all dynamics like /:slug shadow them.
  registerApiRoutes(apiStatic);
  registerSsrRoutes(ssrStatic);

  const registerDynamicFileRoutes = () => {
    registerApiRoutes(apiDynamic);
    registerSsrRoutes(ssrDynamic);
  };

  // Return route metadata for plugins
  const routeMetadata = [
    ...ssrRoutes.map(r => ({
      type: 'ssr',
      method: 'get',
      pattern: r.routePath,
      file: r.file,
      isDynamic: r.routePath.includes(':') || r.routePath.includes('*')
    })),
    ...apiRoutes.map(r => ({
      type: 'api',
      method: r.method,
      pattern: r.routePath,
      file: r.file,
      isDynamic: r.routePath.includes(':') || r.routePath.includes('*')
    }))
  ];

  return { routeMetadata, registerDynamicFileRoutes };
}

module.exports = {
  mountPages,
  filePathToRoute,
  extractMethodFromFilename,
  scanDirectory,
  loadI18n,
  createTranslator,
  detectLocale,
  resolveMiddlewares,
  routeRegistrationMeta,
  compareRouteRegistrationOrder,
  resolvePageAssets,
  applyPageAssetsToTemplateData,
  parseNjkFrontmatter,
  frontmatterToPatches,
  loadNjkRouteTemplate,
  clearNjkFrontmatterCaches,
};

