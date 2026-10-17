/**
 * Webspresso File-Based Router
 * Scans pages/ directory and registers routes automatically
 */

const fs = require('fs');
const path = require('path');
const { compileSchema, invalidateSchema } = require('../core/compileSchema');
const { applySchema } = require('../core/applySchema');
const { translateValidationIssues, getTranslatorForRequest } = require('./api/validation-i18n');
const { createHelpers, getAssetManager } = require('./helpers');
const {
  loadNjkRouteTemplate,
  parseNjkFrontmatter,
  frontmatterToPatches,
  clearNjkFrontmatterCaches,
  registerClearHook,
} = require('./njk-frontmatter');
const { renderStream } = require('../core/ssr/stream');
const {
  loadCascadingMiddlewares,
  runMiddlewareChain,
  findCascadingLayouts,
  executeCascadingLayoutLoads,
  applyCascadingLayouts,
  findNearestErrorBoundary,
  findNearestLoadingTemplate,
  templateHasExtends,
} = require('./routing/cascading');
const {
  isMiddlewareFactory,
  resolveNamedMiddleware,
  resolveMiddlewares,
} = require('./routing/middleware-resolver');

const NOOP = () => {};
const EMPTY_OBJECT = Object.freeze({});

/**
 * Handles directory-level error boundaries (_error.njk and companion _error.js)
 * @returns {Promise<boolean>} True if rendered, false if unhandled
 */
async function handleDirectoryErrorBoundary({
  err,
  route,
  req,
  res,
  ctx,
  absolutePagesDir,
  nunjucks,
  isDev,
  compiledStringTemplateCache,
  baseHelpers,
}) {
  if (res.headersSent) {
    return false;
  }

  const errorBoundary = findNearestErrorBoundary(absolutePagesDir, route.file, isDev);
  if (!errorBoundary) {
    return false;
  }

  const statusCode =
    err?.status ||
    err?.statusCode ||
    (typeof err?.getStatus === 'function' ? err.getStatus() : null) ||
    500;

  try {
    let errorData = {};
    let errorConfig = null;

    if (errorBoundary.configPath) {
      try {
        if (isDev && require.cache[require.resolve(errorBoundary.configPath)]) {
          delete require.cache[require.resolve(errorBoundary.configPath)];
        }
        const mod = require(errorBoundary.configPath);
        errorConfig = mod?.default || mod;
        const loadFn = typeof errorConfig === 'function' ? errorConfig : errorConfig?.load;
        if (typeof loadFn === 'function') {
          const loaded = await loadFn({
            req,
            res,
            error: err,
            ctx,
            db: req.db,
          });
          if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
            Object.assign(errorData, loaded);
          }
        }
      } catch (loadErr) {
        console.error(`[webspresso] Error in _error.js loader "${errorBoundary.configPath}":`, loadErr.message);
      }
    }

    const njkTpl = loadNjkRouteTemplate(errorBoundary.fullPath, isDev);
    if (njkTpl.dataPatch && Object.keys(njkTpl.dataPatch).length > 0) {
      Object.assign(errorData, njkTpl.dataPatch);
    }

    const errorRenderContext = {
      ...(ctx?.data || {}),
      ...errorData,
      error: {
        message: err?.message || 'An error occurred',
        status: statusCode,
        statusCode,
        code: err?.code || 'ERROR',
        name: err?.name || 'Error',
        details: err?.details,
        fields: err?.fields,
        stack: isDev ? err?.stack : undefined,
      },
      route: {
        routePath: route.routePath,
        file: route.file,
      },
      meta: Object.assign({}, ctx?.meta, {
        title: errorData.title || `Error ${statusCode}`,
        description: errorData.description || err?.message,
      }),
      locale: ctx?.locale,
      t: ctx?.t,
      fsy: ctx?.fsy || (typeof createHelpers === 'function' ? createHelpers({ req, res, locale: ctx?.locale || 'en' }) : {}),
      clientRuntime: ctx?.clientRuntime,
      req: {
        path: req.path,
        query: req.query,
        params: req.params,
        method: req.method,
        url: req.url,
      },
      isDev,
    };

    let html;
    if (njkTpl.useStringRender && njkTpl.templateBody != null) {
      if (typeof nunjucks.Template === 'function') {
        let compiled = isDev ? null : compiledStringTemplateCache.get(errorBoundary.fullPath);
        if (!compiled || (isDev && compiled._templateBody !== njkTpl.templateBody)) {
          compiled = new nunjucks.Template(njkTpl.templateBody, nunjucks, errorBoundary.fullPath);
          compiled._templateBody = njkTpl.templateBody;
          compiledStringTemplateCache.set(errorBoundary.fullPath, compiled);
        }
        html = compiled.render(errorRenderContext);
      } else if (typeof nunjucks.renderString === 'function') {
        html = nunjucks.renderString(njkTpl.templateBody, errorRenderContext, { path: errorBoundary.fullPath });
      } else {
        html = nunjucks.render(errorBoundary.errorRelPath, errorRenderContext);
      }
    } else {
      html = nunjucks.render(errorBoundary.errorRelPath, errorRenderContext);
    }

    const shouldApplyLayout = errorConfig?.layout !== false &&
      errorData?.layout !== false &&
      !templateHasExtends(njkTpl.templateBody, errorBoundary.fullPath);

    if (shouldApplyLayout) {
      const errorLayouts = findCascadingLayouts(absolutePagesDir, errorBoundary.errorRelPath, isDev);
      if (errorLayouts.length > 0) {
        const layoutCtx = { data: { ...errorRenderContext } };
        await executeCascadingLayoutLoads(errorLayouts, req, layoutCtx, isDev);
        const mergedLayoutContext = { ...errorRenderContext, ...(layoutCtx.data || {}) };
        html = applyCascadingLayouts(nunjucks, errorLayouts, html, mergedLayoutContext, isDev);
      }
    }

    res.status(statusCode);
    res.send(html);
    return true;
  } catch (renderErr) {
    console.error(`[webspresso] Failed rendering error boundary "${errorBoundary.errorRelPath}":`, renderErr);
    return false;
  }
}
const EMPTY_ARRAY = Object.freeze([]);

// Cache for i18n files (key: filePath, value: { mtime, data })
const i18nCache = new Map();

// Cache for merged i18n (key: `${pagesDir}::${routeDir}::${locale}`, value: { globalMtime, routeMtime, data })
const mergedI18nCache = new Map();

// Cache for translator instances in production
const translatorCache = new Map();

function clearTranslatorCache() {
  translatorCache.clear();
  intlNumberFormatCache.clear();
  intlDateTimeFormatCache.clear();
  intlRelativeTimeFormatCache.clear();
  filePathToRouteCache.clear();
}

// Cache for route configs in production
const configCache = new Map();

// Dev-only: avoid require() on every SSR request when the .js file is unchanged (mtime)
const routeConfigDevCache = new Map();

// Cache for compiled frontmatter string templates (key: fullPath, value: compiled Template)
const compiledStringTemplateCache = new Map();

function clearCompiledStringTemplateCache() {
  compiledStringTemplateCache.clear();
}

if (typeof registerClearHook === 'function') {
  registerClearHook(clearCompiledStringTemplateCache);
}

// Cache for API filename -> { method, baseName } (basename keys; stable per process)
const methodFromFilenameCache = new Map();

// Cache for translation param replacement regexes
const paramRegexCache = new Map();

// Caches for file-to-route resolution and Intl formatters
const filePathToRouteCache = new Map();
const intlNumberFormatCache = new Map();
const intlDateTimeFormatCache = new Map();
const intlRelativeTimeFormatCache = new Map();

function getCachedNumberFormat(locale, opts) {
  const key = opts ? `${locale}::${JSON.stringify(opts)}` : locale;
  let fmt = intlNumberFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, opts);
    if (intlNumberFormatCache.size < 500) {
      intlNumberFormatCache.set(key, fmt);
    }
  }
  return fmt;
}

function getCachedDateTimeFormat(locale, opts) {
  const key = opts ? `${locale}::${JSON.stringify(opts)}` : locale;
  let fmt = intlDateTimeFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, opts);
    if (intlDateTimeFormatCache.size < 500) {
      intlDateTimeFormatCache.set(key, fmt);
    }
  }
  return fmt;
}

function getCachedRelativeTimeFormat(locale, opts) {
  const key = opts ? `${locale}::${JSON.stringify(opts)}` : locale;
  let fmt = intlRelativeTimeFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(locale, opts);
    if (intlRelativeTimeFormatCache.size < 500) {
      intlRelativeTimeFormatCache.set(key, fmt);
    }
  }
  return fmt;
}

const MAX_LOCALE_LEN = 16;

let cachedSupportedLocalesRaw = null;
let cachedSupportedLocaleSet = null;
let cachedDefaultLocaleKey = null;
let cachedDefaultLocale = 'en';

/** @returns {Set<string>} */
function parseSupportedLocaleSet() {
  const raw = process.env.SUPPORTED_LOCALES || 'en';
  if (raw === cachedSupportedLocalesRaw && cachedSupportedLocaleSet !== null) {
    return cachedSupportedLocaleSet;
  }
  cachedSupportedLocalesRaw = raw;
  cachedSupportedLocaleSet = new Set(
    raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  return cachedSupportedLocaleSet;
}

/**
 * Get default locale matching supported set
 * @param {Set<string>} [supported]
 * @returns {string}
 */
function getDefaultLocale(supported = parseSupportedLocaleSet()) {
  const rawDef = process.env.DEFAULT_LOCALE || 'en';
  const rawSupp = process.env.SUPPORTED_LOCALES || 'en';
  const key = rawDef + '|' + rawSupp;
  if (key === cachedDefaultLocaleKey && cachedDefaultLocale) {
    return cachedDefaultLocale;
  }
  cachedDefaultLocaleKey = key;
  const defaultCand = normalizeLocaleCandidate(rawDef);
  cachedDefaultLocale =
    pickMatchingLocale(defaultCand, supported)
    ?? (supported.has('en') ? 'en' : [...supported][0])
    ?? 'en';
  return cachedDefaultLocale;
}

/**
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeLocaleCandidate(raw) {
  let s = String(raw).trim().toLowerCase().split(';')[0].split(',')[0].trim().replace(/_/g, '-');
  if (s.length < 1 || s.length > MAX_LOCALE_LEN) {
    return null;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) {
    return null;
  }
  return s;
}

/**
 * @param {string|null} normalized
 * @param {Set<string>} supported
 * @returns {string|null}
 */
function pickMatchingLocale(normalized, supported) {
  if (!normalized) {
    return null;
  }
  if (supported.has(normalized)) {
    return normalized;
  }
  const base = normalized.split('-')[0];
  if (supported.has(base)) {
    return base;
  }
  return null;
}

/**
 * Linear-time conversion of [...x] → * then [x] → :x (filesystem route segments only).
 * @param {string} route
 */
function rewriteDynamicRouteMarkers(route) {
  let i = 0;
  let out = '';
  const n = route.length;
  while (i < n) {
    const open = route.indexOf('[', i);
    if (open === -1) {
      out += route.slice(i);
      break;
    }
    out += route.slice(i, open);
    const close = route.indexOf(']', open + 1);
    if (close === -1) {
      out += route.slice(open);
      break;
    }
    const inner = route.slice(open + 1, close);
    let repl;
    if (inner.startsWith('...')) {
      const paramName = inner.length > 3 ? inner.slice(3) : 'splat';
      repl = '*' + paramName;
    } else if (inner.length > 0 && inner.indexOf('[') === -1) {
      repl = ':' + inner;
    } else {
      repl = route.slice(open, close + 1);
    }
    out += repl;
    i = close + 1;
  }
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Checks if a path segment is a route group, e.g. '(marketing)', '(auth)'.
 * Route groups are enclosed in parentheses and do not affect the public URL path.
 * @param {string} segment
 * @returns {boolean}
 */
function isRouteGroupSegment(segment) {
  return (
    typeof segment === 'string' &&
    segment.length > 2 &&
    segment.charCodeAt(0) === 40 /* '(' */ &&
    segment.charCodeAt(segment.length - 1) === 41 /* ')' */
  );
}

/**
 * Strips route group segments from a slash-separated route path.
 * E.g., '(marketing)/about' -> 'about'
 *       '/(auth)/login' -> '/login'
 *       '/(marketing)/(sub)/page' -> '/page'
 *       '(marketing)/index' -> 'index'
 * @param {string} route
 * @returns {string}
 */
function stripRouteGroups(route) {
  if (!route || typeof route !== 'string' || !route.includes('(')) {
    return route;
  }
  const hadLeadingSlash = route.startsWith('/');
  const rawSegments = route.split('/');
  const filtered = rawSegments.filter((seg) => !isRouteGroupSegment(seg));

  if (filtered.length === 0 || (filtered.length === 1 && filtered[0] === '')) {
    return hadLeadingSlash ? '/' : '';
  }

  let res = filtered.join('/');
  if (hadLeadingSlash && !res.startsWith('/')) {
    res = '/' + res;
  }
  return res;
}

/**
 * Checks if a file path belongs to an API route, accounting for optional parent route groups.
 * E.g., 'api/users.get.js' -> true
 *       'api/(v1)/users.get.js' -> true
 *       '(marketing)/api/newsletter.post.js' -> true
 *       'about.njk' -> false
 * @param {string} file
 * @returns {boolean}
 */
function isApiRouteFile(file) {
  if (!file || typeof file !== 'string') return false;
  const normalized = file.split(/[/\\]/).join('/');
  if (normalized.startsWith('api/')) return true;
  const parts = normalized.split('/');
  const apiIndex = parts.indexOf('api');
  if (apiIndex > 0) {
    const prefix = parts.slice(0, apiIndex);
    if (prefix.every(isRouteGroupSegment)) {
      return true;
    }
  }
  return false;
}

/**
 * Convert a file path to an Express route pattern
 * @param {string} filePath - Relative path from pages/
 * @param {string} ext - File extension (.njk or .js)
 * @returns {string} Express route pattern
 */
function filePathToRoute(filePath, ext) {
  const cacheKey = filePath + '::' + ext;
  const cached = filePathToRouteCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // Remove extension
  let route = filePath.replace(ext, '');
  
  // Normalize path separators to forward slashes (handle both / and \)
  route = route.split(path.sep).join('/');
  route = route.split('\\').join('/'); // Also handle literal backslashes

  // Strip route group segments (e.g. (marketing), (auth), (dashboard))
  route = stripRouteGroups(route);
  
  // Handle index files
  if (route.endsWith('/index')) {
    route = route.slice(0, -6) || '/';
  } else if (route === 'index' || route === '') {
    route = '/';
  }
  
  // Convert [param] / [...param] without regex backtracking hazards
  route = rewriteDynamicRouteMarkers(route);

  // Ensure leading slash
  if (!route.startsWith('/')) {
    route = '/' + route;
  }
  
  if (filePathToRouteCache.size < 5000) {
    filePathToRouteCache.set(cacheKey, route);
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
  const ma = a._regMeta || (a._regMeta = routeRegistrationMeta(a.routePath));
  const mb = b._regMeta || (b._regMeta = routeRegistrationMeta(b.routePath));
  if (ma.tier !== mb.tier) return ma.tier - mb.tier;
  if (ma.literalSegCount !== mb.literalSegCount) {
    return mb.literalSegCount - ma.literalSegCount;
  }
  if (ma.depth !== mb.depth) return mb.depth - ma.depth;
  if (ma.paramSegCount !== mb.paramSegCount) return ma.paramSegCount - mb.paramSegCount;
  return ma.routePath < mb.routePath ? -1 : (ma.routePath > mb.routePath ? 1 : 0);
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
 * `pageHead` in Nunjucks (see `createApp({ pageAssets })`), with optional automatic
 * per-route script/stylesheet discovery.
 * @param {boolean|{enabled?: boolean, stylesheets?: boolean, scripts?: boolean, auto?: boolean}|null|undefined} raw
 * @returns {{ enabled: boolean, stylesheets: boolean, scripts: boolean, auto: boolean }}
 */
function resolvePageAssets(raw) {
  if (raw === true) {
    return { enabled: true, stylesheets: true, scripts: true, auto: true };
  }
  if (raw == null || raw === false) {
    return { enabled: false, stylesheets: false, scripts: false, auto: false };
  }
  if (typeof raw === 'object') {
    const on = raw.enabled !== false;
    if (!on) {
      return { enabled: false, stylesheets: false, scripts: false, auto: false };
    }
    return {
      enabled: true,
      stylesheets: raw.stylesheets !== false,
      scripts: raw.scripts !== false,
      auto: raw.auto !== false,
    };
  }
  return { enabled: false, stylesheets: false, scripts: false, auto: false };
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
 * @param {{ enabled: boolean, stylesheets: boolean, scripts: boolean, auto?: boolean }} cfg
 * @param {Object} data
 * @param {{ file?: string, routePath?: string }} [routeInfo={}]
 * @param {Object|null} [assetManager=null]
 * @returns {{ data: Object, pageHead: { stylesheets: unknown[], scripts: unknown[] }|null, pageAssets: boolean }}
 */
function applyPageAssetsToTemplateData(cfg, data, routeInfo = {}, assetManager = null) {
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

  // Auto-discover page assets from route if enabled
  if (cfg.auto && assetManager && (routeInfo.file || routeInfo.routePath)) {
    const candidates = typeof assetManager.getRouteAssetCandidates === 'function'
      ? assetManager.getRouteAssetCandidates(routeInfo.file, routeInfo.routePath)
      : [];

    if (cfg.stylesheets) {
      for (const cand of candidates) {
        if (typeof assetManager.hasPageCss === 'function' && assetManager.hasPageCss(cand)) {
          const cssUrl = assetManager.pageCssUrl(cand);
          const already = styles.some((s) => (typeof s === 'string' ? s === cssUrl : s?.href === cssUrl));
          if (!already) {
            styles.push(cssUrl);
          }
          break;
        }
      }
    }

    if (cfg.scripts) {
      for (const cand of candidates) {
        if (typeof assetManager.hasPageJs === 'function' && assetManager.hasPageJs(cand)) {
          const jsUrl = assetManager.pageJsUrl(cand);
          const already = scriptItems.some((s) => (typeof s === 'string' ? s === jsUrl : s?.src === jsUrl));
          if (!already) {
            scriptItems.push({ src: jsUrl, defer: true });
          }
          break;
        }
      }
    }
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
 * @param {boolean} [isDev=false] - Whether in development mode
 * @returns {Object} Parsed JSON or empty object
 */
function loadI18nFile(filePath, isDev = (process.env.NODE_ENV !== 'production')) {
  if (!isDev) {
    const cached = i18nCache.get(filePath);
    if (cached) {
      return cached.data;
    }
    if (!fs.existsSync(filePath)) {
      i18nCache.set(filePath, { mtime: 0, data: EMPTY_OBJECT });
      return EMPTY_OBJECT;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      i18nCache.set(filePath, { mtime: 0, data });
      return data;
    } catch (err) {
      console.error('Error loading i18n file:', filePath, err.message);
      i18nCache.set(filePath, { mtime: 0, data: EMPTY_OBJECT });
      return EMPTY_OBJECT;
    }
  }

  if (!fs.existsSync(filePath)) {
    return EMPTY_OBJECT;
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
    console.error('Error loading i18n file:', filePath, err.message);
    return EMPTY_OBJECT;
  }
}

/**
 * Load merged i18n translations for a route
 * @param {string} pagesDir - Pages directory path
 * @param {string} routeDir - Route directory path
 * @param {string} locale - Locale code
 * @param {boolean} [isDev=false] - Whether in development mode
 * @returns {Object} Merged translations
 */
function loadI18n(pagesDir, routeDir, locale, isDev = (process.env.NODE_ENV !== 'production')) {
  const cacheKey = `${pagesDir}::${routeDir}::${locale}`;

  if (!isDev) {
    const mergedCached = mergedI18nCache.get(cacheKey);
    if (mergedCached) {
      return mergedCached.data;
    }
  }

  // Load global translations
  const globalPath = path.join(pagesDir, 'locales', `${locale}.json`);
  const globalTranslations = loadI18nFile(globalPath, isDev);
  
  // Load route-specific translations
  const routePath = path.join(routeDir, 'locales', `${locale}.json`);
  const routeTranslations = loadI18nFile(routePath, isDev);
  
  const gEmpty = globalTranslations === EMPTY_OBJECT || !globalTranslations || Object.keys(globalTranslations).length === 0;
  const rEmpty = routeTranslations === EMPTY_OBJECT || !routeTranslations || Object.keys(routeTranslations).length === 0;

  if (gEmpty && rEmpty) {
    if (!isDev) mergedI18nCache.set(cacheKey, { gm: 0, rm: 0, data: EMPTY_OBJECT });
    return EMPTY_OBJECT;
  }
  if (gEmpty) {
    if (!isDev) mergedI18nCache.set(cacheKey, { gm: 0, rm: 0, data: routeTranslations });
    return routeTranslations;
  }
  if (rEmpty) {
    if (!isDev) mergedI18nCache.set(cacheKey, { gm: 0, rm: 0, data: globalTranslations });
    return globalTranslations;
  }

  const gCached = i18nCache.get(globalPath);
  const rCached = i18nCache.get(routePath);
  const gm = gCached?.mtime ?? 0;
  const rm = rCached?.mtime ?? 0;

  const mergedCached = mergedI18nCache.get(cacheKey);
  if (mergedCached && mergedCached.gm === gm && mergedCached.rm === rm) {
    return mergedCached.data;
  }

  // Merge: route-specific overrides global
  const data = { ...globalTranslations, ...routeTranslations };
  mergedI18nCache.set(cacheKey, { gm, rm, data });
  return data;
}

// Cache for Intl.PluralRules instances
const pluralRulesCache = new Map();

function getPluralRules(locale) {
  let pr = pluralRulesCache.get(locale);
  if (!pr) {
    try {
      pr = new Intl.PluralRules(locale);
    } catch {
      pr = new Intl.PluralRules('en');
    }
    if (pluralRulesCache.size < 100) {
      pluralRulesCache.set(locale, pr);
    }
  }
  return pr;
}

const KEY_PARTS_CACHE = new Map();

function resolveTranslationValue(dict, key) {
  if (!dict || typeof dict !== 'object' || typeof key !== 'string') return undefined;
  if (dict[key] !== undefined) return dict[key];
  if (!key.includes('.')) return undefined;

  let parts = KEY_PARTS_CACHE.get(key);
  if (!parts) {
    parts = key.split('.');
    if (KEY_PARTS_CACHE.size < 1000) {
      KEY_PARTS_CACHE.set(key, parts);
    }
  }

  let curr = dict;
  for (let i = 0; i < parts.length; i++) {
    if (curr && typeof curr === 'object') {
      curr = curr[parts[i]];
    } else {
      return undefined;
    }
  }
  return curr;
}

/**
 * Create a translation helper function with pluralization, fallback, and formatting support
 * @param {Object} translations - Primary locale translations dictionary
 * @param {Object|string} [options] - Options object or locale string
 * @param {string} [options.locale='en'] - Active locale code
 * @param {Object} [options.fallbackTranslations] - Fallback translations dictionary
 * @param {string} [options.fallbackLocale='en'] - Fallback locale code
 * @returns {Function} Translation function `t`
 */
function createTranslator(translations = {}, options = EMPTY_OBJECT) {
  const opts = typeof options === 'string' ? { locale: options } : (options || EMPTY_OBJECT);
  const locale = opts.locale || 'en';
  const fallbackTranslations = opts.fallbackTranslations || null;

  function t(key, params = EMPTY_OBJECT, defaultVal = null) {
    const defaultValue = typeof params === 'string' ? params : defaultVal;
    const interpolationParams = typeof params === 'object' && params !== null ? params : EMPTY_OBJECT;

    let value = resolveTranslationValue(translations, key);

    // If missing in primary locale, fallback to fallback translations
    if (value === undefined && fallbackTranslations) {
      value = resolveTranslationValue(fallbackTranslations, key);
    }

    // Handle Pluralization if value is an object (or when count is passed)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const count = interpolationParams.count !== undefined
        ? Number(interpolationParams.count)
        : (interpolationParams.n !== undefined
          ? Number(interpolationParams.n)
          : (interpolationParams.cardinal !== undefined ? Number(interpolationParams.cardinal) : undefined));

      if (count !== undefined && !Number.isNaN(count)) {
        const countStr = String(count);
        if (typeof value[countStr] === 'string') {
          value = value[countStr];
        } else if (count === 0 && typeof value.zero === 'string') {
          value = value.zero;
        } else {
          const category = getPluralRules(locale).select(count);
          if (typeof value[category] === 'string') {
            value = value[category];
          } else if (typeof value.other === 'string') {
            value = value.other;
          } else {
            const firstString = Object.values(value).find((v) => typeof v === 'string');
            value = firstString !== undefined ? firstString : key;
          }
        }
      }
    }

    if (value === undefined) {
      return defaultValue !== null && defaultValue !== undefined ? defaultValue : key;
    }

    if (typeof value !== 'string') {
      return value;
    }

    // Replace params like {{name}} in the translation (skip if no placeholders in template)
    if (value.includes('{{') && interpolationParams && interpolationParams !== EMPTY_OBJECT && Object.keys(interpolationParams).length > 0) {
      for (const [paramKey, paramValue] of Object.entries(interpolationParams)) {
        let regex = paramRegexCache.get(paramKey);
        if (regex === undefined) {
          const escaped = escapeRegExp(paramKey);
          regex = new RegExp(`{{\\s*${escaped}\\s*}}`, 'g');
          if (paramRegexCache.size < 500) {
            paramRegexCache.set(paramKey, regex);
          }
        }
        value = value.replace(regex, () => String(paramValue));
      }
    }

    return value;
  }

  // Attach metadata & native formatting helpers to `t`
  t.locale = locale;
  t.translations = translations;

  t.number = function formatNumber(num, numOpts) {
    if (num === null || num === undefined || Number.isNaN(Number(num))) return '';
    try {
      return getCachedNumberFormat(locale, numOpts).format(Number(num));
    } catch {
      return String(num);
    }
  };
  t.formatNumber = t.number;

  t.currency = function formatCurrency(amount, currency = 'USD', currOpts = {}) {
    if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '';
    try {
      return getCachedNumberFormat(locale, { style: 'currency', currency, ...currOpts }).format(Number(amount));
    } catch {
      return `${amount} ${currency}`;
    }
  };
  t.formatCurrency = t.currency;

  t.date = function formatDate(date, dateOpts = { dateStyle: 'medium' }) {
    if (!date) return '';
    try {
      const d = date instanceof Date ? date : new Date(date);
      if (Number.isNaN(d.getTime())) return '';
      return getCachedDateTimeFormat(locale, dateOpts).format(d);
    } catch {
      return String(date);
    }
  };
  t.formatDate = t.date;

  t.relativeTime = function formatRelativeTime(val, unit = 'day', relOpts = { numeric: 'auto' }) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return '';
    try {
      return getCachedRelativeTimeFormat(locale, relOpts).format(Number(val), unit);
    } catch {
      return `${val} ${unit}`;
    }
  };
  t.formatRelativeTime = t.relativeTime;

  t.plural = function inlinePlural(count, forms, params = {}) {
    if (!forms || typeof forms !== 'object') return '';
    const num = Number(count);
    const countStr = String(num);
    let template = forms[countStr];
    if (typeof template !== 'string') {
      if (num === 0 && typeof forms.zero === 'string') {
        template = forms.zero;
      } else {
        const category = getPluralRules(locale).select(num);
        template = forms[category] || forms.other || Object.values(forms)[0] || '';
      }
    }
    const allParams = { count: num, ...params };
    return template.replace(/{{\s*(\w+)\s*}}/g, (_, k) => String(allParams[k] ?? ''));
  };

  t.has = function hasKey(key) {
    if (resolveTranslationValue(translations, key) !== undefined) return true;
    if (fallbackTranslations && resolveTranslationValue(fallbackTranslations, key) !== undefined) return true;
    return false;
  };
  t.exists = t.has;

  return t;
}

/**
 * Load route config module
 * @param {string} configPath - Path to config .js file
 * @param {boolean} isDev - Is development mode
 * @returns {Object|null} Route config or null
 */
function loadRouteConfig(configPath, isDev) {
  if (!isDev) {
    if (configCache.has(configPath)) {
      return configCache.get(configPath);
    }
    if (!fs.existsSync(configPath)) {
      configCache.set(configPath, null);
      return null;
    }
    try {
      const config = require(configPath);
      configCache.set(configPath, config);
      return config;
    } catch (err) {
      console.error('Error loading route config:', configPath, err.message);
      configCache.set(configPath, null);
      return null;
    }
  }

  if (!fs.existsSync(configPath)) {
    routeConfigDevCache.delete(configPath);
    return null;
  }

  try {
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
  } catch (err) {
    console.error('Error loading route config:', configPath, err.message);
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
function executeHook(hooks, hookName, ctx, ...extra) {
  if (!hooks || typeof hooks[hookName] !== 'function') {
    return;
  }
  return hooks[hookName](ctx, ...extra);
}

function runHooks(globalHooks, routeHooks, hookName, ctx, ...extra) {
  const gFn = globalHooks ? globalHooks[hookName] : undefined;
  const rFn = routeHooks ? routeHooks[hookName] : undefined;
  if (typeof gFn !== 'function' && typeof rFn !== 'function') return;
  return (async () => {
    if (typeof gFn === 'function') {
      const gRes = gFn(ctx, ...extra);
      if (gRes && typeof gRes.then === 'function') await gRes;
    }
    if (typeof rFn === 'function') {
      const rRes = rFn(ctx, ...extra);
      if (rRes && typeof rRes.then === 'function') await rRes;
    }
  })();
}

/**
 * Detect locale from request
 * @param {Object} req - Express request
 * @param {Set<string>} [supported] - Optional precomputed supported locales set
 * @param {string} [def] - Optional precomputed default locale
 * @returns {string} Locale code
 */
function detectLocale(req, supported = parseSupportedLocaleSet(), def = getDefaultLocale(supported)) {
  if (req.query && req.query.lang != null && req.query.lang !== '') {
    const q = normalizeLocaleCandidate(String(req.query.lang));
    const hit = pickMatchingLocale(q, supported);
    if (hit) {
      return hit;
    }
  }

  const acceptLanguage = typeof req.get === 'function'
    ? req.get('Accept-Language')
    : (req.headers && (req.headers['accept-language'] || req.headers['Accept-Language']));
  if (acceptLanguage) {
    const langPart = acceptLanguage.split(',')[0];
    const a = normalizeLocaleCandidate(langPart);
    const hit = pickMatchingLocale(a, supported);
    if (hit) {
      return hit;
    }
  }

  return def;
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
    serviceRegistry = null,
  } = options;
  const pageAssetsResolved = resolvePageAssets(pageAssetsOpt);
  const clientRuntime = clientRuntimeOpt && typeof clientRuntimeOpt === 'object'
    ? { alpine: !!clientRuntimeOpt.alpine, swup: !!clientRuntimeOpt.swup }
    : { alpine: false, swup: false };
  const isDev = process.env.NODE_ENV !== 'production';
  const log = silent ? NOOP : console.log.bind(console);
  
  // Get absolute path to pages directory
  const absolutePagesDir = path.resolve(pagesDir);

  // Single-pass directory scanner with startup collision & case-sensitivity checks (0 statSync calls)
  function getGenericSegment(name) {
    if (name.startsWith('[') && name.endsWith(']')) {
      const inner = name.slice(1, -1);
      if (inner.startsWith('...')) return '*';
      return ':param';
    }
    return name;
  }

  function scanAndCheckDir(dirPath, relativeDir = '', isApi = false) {
    if (!fs.existsSync(dirPath)) return [];
    let children;
    try {
      children = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (_) {
      return [];
    }
    const kept = [];
    const files = [];

    for (const entry of children) {
      const child = entry.name;
      if (child.startsWith('_') || child === 'locales') continue;
      const fullPath = path.join(dirPath, child);
      const relPath = relativeDir ? path.join(relativeDir, child) : child;

      // 1. Check case-sensitivity issues
      if (child !== child.toLowerCase()) {
        console.warn(`[webspresso] WARNING: Path "pages/${relPath.split(path.sep).join('/')}" contains uppercase letters. Use lowercase to avoid routing issues on case-sensitive filesystems.`);
      }

      if (entry.isDirectory()) {
        if (child === 'api' && relativeDir === '') {
          files.push(...scanAndCheckDir(fullPath, relPath, true));
        } else {
          files.push(...scanAndCheckDir(fullPath, relPath, isApi));
          if (!isApi) {
            kept.push({ name: child, isDir: true, original: child });
          }
        }
      } else if (entry.isFile()) {
        files.push(relPath);
        const ext = path.extname(child);
        if (isApi) {
          if (ext === '.js') {
            const base = path.basename(child, ext);
            kept.push({ name: base, isDir: false, original: child });
          }
        } else {
          if (ext === '.njk') {
            const base = path.basename(child, ext);
            kept.push({ name: base, isDir: false, original: child });
          }
        }
      }
    }

    // 2. Check dynamic route collisions
    const groups = new Map();
    for (const item of kept) {
      const normalized = getGenericSegment(item.name);
      if (!groups.has(normalized)) {
        groups.set(normalized, []);
      }
      groups.get(normalized).push(item);
    }

    for (const [norm, items] of groups.entries()) {
      if (items.length > 1) {
        const namesList = items.map(item => `"${item.original}"`).join(' and ');
        console.warn(`[webspresso] WARNING: Dynamic route collision in "pages/${relativeDir.split(path.sep).join('/')}": ${namesList} resolve to the same segment "${norm}" and will conflict at runtime.`);
      }
    }

    return files;
  }

  // Load global hooks
  const globalHooks = loadGlobalHooks(absolutePagesDir, isDev);
  
  // Single-pass scan for files and checks (bypassed if pre-scanned files provided by discovery phase)
  const files = (Array.isArray(options.scannedFiles) && options.scannedFiles.length >= 0)
    ? options.scannedFiles
    : scanAndCheckDir(absolutePagesDir, '');
  const filesSet = new Set(files);
  
  // Separate SSR pages and API routes
  const ssrRoutes = [];
  const apiRoutes = [];
  
  for (const file of files) {
    const ext = path.extname(file);
    const isApi = isApiRouteFile(file);
    
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
        routePath: filePathToRoute(routePath, ''),
        fullPath: path.join(absolutePagesDir, file)
      });
    } else if (ext === '.njk') {
      // SSR page
      const routePath = filePathToRoute(file, '.njk');
      const configRel = file.replace(/\.njk$/, '.js');
      const hasCompanionConfig = filesSet.has(configRel);
      const configPath = path.join(absolutePagesDir, configRel);
      const routeDir = path.dirname(path.join(absolutePagesDir, file));
      
      ssrRoutes.push({
        file,
        routePath,
        fullPath: path.join(absolutePagesDir, file),
        configPath,
        hasCompanionConfig,
        routeDir
      });
    }
  }
  
  // Sort routes: static before dynamic before catch-all; then more literal segments, then deeper paths
  const sortRoutes = (routes) => routes.sort(compareRouteRegistrationOrder);
  sortRoutes(apiRoutes);
  sortRoutes(ssrRoutes);

  // Check for duplicate route bindings
  const registeredRouteMap = new Map();
  for (const r of [...apiRoutes, ...ssrRoutes]) {
    const key = `${(r.method || 'GET').toUpperCase()} ${r.routePath}`;
    if (registeredRouteMap.has(key)) {
      const existing = registeredRouteMap.get(key);
      console.warn(`[webspresso] WARNING: Duplicate route detected: ${key} in "${r.file}" conflicts with existing route in "${existing.file}".`);
    } else {
      registeredRouteMap.set(key, r);
    }
  }

  const apiStatic = apiRoutes.filter((r) => routeRegistrationMeta(r.routePath).tier === 0);
  const apiDynamic = apiRoutes.filter((r) => routeRegistrationMeta(r.routePath).tier !== 0);
  const ssrStatic = ssrRoutes.filter((r) => routeRegistrationMeta(r.routePath).tier === 0);
  const ssrDynamic = ssrRoutes.filter((r) => routeRegistrationMeta(r.routePath).tier !== 0);

  /** Register API routes (shared by static phase and dynamic phase). */
  const registerApiRoutes = (routes) => {
    for (const route of routes) {
      if (options.skipExistingRoutes && options.skipExistingRoutes.has(route.method || 'GET', route.routePath)) {
        continue;
      }
      let handlerFn = null;
      let preResolvedMw = null;
      let preCompiledSchema = null;

      // In production, eager-load to compile schemas & fail fast at startup
      if (!isDev) {
        let handler;
        try {
          handler = require(route.fullPath);
        } catch (loadErr) {
          console.error(`Failed to load API route ${route.file}:`, loadErr);
          continue;
        }
        handlerFn = typeof handler === 'function' ? handler : handler.default || handler.handler;
        if (typeof handlerFn !== 'function') {
          console.warn(`API route ${route.file} does not export a function`);
          continue;
        }
        preResolvedMw = handler.middleware
          ? resolveMiddlewares(handler.middleware, middlewares)
          : EMPTY_ARRAY;
        try {
          preCompiledSchema = compileSchema(route.fullPath, handler);
        } catch (schemaErr) {
          console.error(`API schema compile error ${route.routePath}:`, schemaErr);
        }
      }
      
      app[route.method](route.routePath, async (req, res, next) => {
        try {
          if (route.routePath.includes('*') && req.params) {
            for (const val of Object.values(req.params)) {
              if (Array.isArray(val) && req.params[0] === undefined) {
                req.params[0] = val.join('/');
                break;
              }
            }
          }
          // Same instance as createApp({ db }) / getAppContext().db — available to handler & route middleware
          if (db != null && !req.db) {
            req.db = db;
          }
          if (serviceRegistry != null && !req.service) {
            req.service = (name, input, opts) =>
              serviceRegistry.call(name, input, { req, res, db }, opts);
          }

          let fn = handlerFn;
          let compiledSchema = preCompiledSchema;

          // Reload handler and schema in dev mode
          if (isDev) {
            if (require.cache[require.resolve(route.fullPath)]) {
              delete require.cache[require.resolve(route.fullPath)];
            }
            let currentHandler;
            try {
              currentHandler = require(route.fullPath);
            } catch (err) {
              console.error(`Failed to load API route ${route.file}:`, err);
              return res.status(500).json({ error: 'Internal Server Error', message: `Failed to load API route: ${err.message}` });
            }
            fn = typeof currentHandler === 'function' 
              ? currentHandler 
              : currentHandler.default || currentHandler.handler;

            if (typeof fn !== 'function') {
              console.warn(`API route ${route.file} does not export a function`);
              return res.status(500).json({ error: 'Internal Server Error', message: `Route ${route.file} does not export a valid handler function` });
            }

            // Stateful middlewares (e.g. rate limiters) must be resolved once and preserved across requests
            if (preResolvedMw === null) {
              preResolvedMw = currentHandler.middleware
                ? resolveMiddlewares(currentHandler.middleware, middlewares)
                : EMPTY_ARRAY;
            }

            invalidateSchema(route.fullPath);
            try {
              compiledSchema = compileSchema(route.fullPath, currentHandler);
            } catch (schemaErr) {
              console.error(`API schema compile error ${route.routePath}:`, schemaErr);
              res.status(500).json({ error: 'Internal Server Error', message: schemaErr.message });
              return;
            }
          }

          const routeMw = preResolvedMw || EMPTY_ARRAY;

          try {
            applySchema(req, compiledSchema);
          } catch (err) {
            if (err && (err.name === 'ZodError' || Array.isArray(err.issues))) {
              const translatedIssues = translateValidationIssues(err.issues, {
                req,
                pagesDir: absolutePagesDir,
                routeDir: route.routeDir || (route.fullPath ? path.dirname(route.fullPath) : ''),
                isDev,
              });
              return res.status(400).json({
                error: 'Validation Error',
                issues: translatedIssues,
              });
            }
            throw err;
          }
          
          // Run cascading folder middlewares (_middleware.js)
          const cascadingMw = loadCascadingMiddlewares(absolutePagesDir, route.file, middlewares, isDev);
          if (cascadingMw.length) {
            await runMiddlewareChain(cascadingMw, req, res);
            if (res.headersSent) return;
          }

          // Run middleware if defined
          if (routeMw.length) {
            await runMiddlewareChain(routeMw, req, res);
            if (res.headersSent) return;
          }

          const tr = getTranslatorForRequest(req, {
            pagesDir: absolutePagesDir,
            routeDir: route.routeDir || (route.fullPath ? path.dirname(route.fullPath) : ''),
            isDev,
          });

          const apiCtx = Object.assign((err) => next(err), {
            req,
            res,
            next,
            params: req.params || {},
            query: req.query || {},
            body: req.body || {},
            input: req.input,
            locale: tr.locale,
            t: tr.t,
            service: req.service,
            db,
            sse: res.sse,
          });

          await fn(req, res, apiCtx);
        } catch (err) {
          console.error(`API error ${route.routePath}:`, err);
          const hookCtx = { req, res, error: err };
          try {
            await executeHook(globalHooks, 'onError', hookCtx, err);
          } catch (hookErr) {
            console.error('Error in onError hook:', hookErr);
          }
          return next(err);
        }
      });
      
      log(`  ${route.method.toUpperCase()} ${route.routePath} -> ${route.file}`);
    }
  };

  /** Register SSR GET routes (shared by static phase and dynamic phase). */
  const registerSsrRoutes = (routes) => {
    for (const route of routes) {
      if (options.skipExistingRoutes && options.skipExistingRoutes.has('GET', route.routePath)) {
        continue;
      }
      const mountConfig = (!isDev && route.hasCompanionConfig)
        ? loadRouteConfig(route.configPath, false)
        : null;
      let preResolvedPageMw = mountConfig?.middleware
        ? resolveMiddlewares(mountConfig.middleware, middlewares)
        : (!isDev ? EMPTY_ARRAY : null);
      const staticRouteHooks = mountConfig?.hooks || EMPTY_OBJECT;

      app.get(route.routePath, async (req, res, next) => {
        try {
          if (route.routePath.includes('*') && req.params) {
            for (const val of Object.values(req.params)) {
              if (Array.isArray(val) && req.params[0] === undefined) {
                req.params[0] = val.join('/');
                break;
              }
            }
          }
          // Detect locale
          const supported = parseSupportedLocaleSet();
          const defaultLocale = getDefaultLocale(supported);
          const locale = detectLocale(req, supported, defaultLocale);
          
          // Load translations (primary + fallback)
          let t;
          if (!isDev) {
            const transKey = `${absolutePagesDir}::${route.routeDir}::${locale}::${defaultLocale}`;
            t = translatorCache.get(transKey);
            if (!t) {
              const translations = loadI18n(absolutePagesDir, route.routeDir, locale, false);
              const fallbackTranslations = (locale !== defaultLocale)
                ? loadI18n(absolutePagesDir, route.routeDir, defaultLocale, false)
                : EMPTY_OBJECT;
              t = createTranslator(translations, {
                locale,
                fallbackTranslations,
                fallbackLocale: defaultLocale,
              });
              translatorCache.set(transKey, t);
            }
          } else {
            const translations = loadI18n(absolutePagesDir, route.routeDir, locale, true);
            const fallbackTranslations = (locale !== defaultLocale)
              ? loadI18n(absolutePagesDir, route.routeDir, defaultLocale, true)
              : EMPTY_OBJECT;
            t = createTranslator(translations, {
              locale,
              fallbackTranslations,
              fallbackLocale: defaultLocale,
            });
          }
          
          // Load route config
          const config = isDev
            ? (route.hasCompanionConfig ? loadRouteConfig(route.configPath, true) : null)
            : mountConfig;
          const routeHooks = isDev ? (config?.hooks || EMPTY_OBJECT) : staticRouteHooks;
          if (preResolvedPageMw === null) {
            preResolvedPageMw = config?.middleware
              ? resolveMiddlewares(config.middleware, middlewares)
              : EMPTY_ARRAY;
          }
          const pageMw = preResolvedPageMw;
        
        // Create context with plugin helpers merged
        const baseHelpers = createHelpers({ req, res, locale, t });
        const pluginHelpers = pluginManager ? pluginManager.getHelpers() : EMPTY_OBJECT;
        if (pluginManager) {
          const contentApi = pluginManager.getPluginAPI('content');
          if (contentApi?.createRequestHelpers) {
            const buildHelpers = contentApi.createRequestHelpers();
            pluginHelpers.content = buildHelpers(req);
          }
        }
        
        const njkTpl = loadNjkRouteTemplate(route.fullPath, isDev);
        const metaTitle = t('meta.title');
        const metaDesc = t('meta.description');

        const ctx = {
          req,
          res,
          db,
          path: route.routePath,
          file: route.file,
          routeDir: route.routeDir,
          locale,
          t,
          service: (name, input, opts) => {
            if (serviceRegistry) {
              return serviceRegistry.call(name, input, ctx, opts);
            }
            throw new Error(`Services not configured. Cannot call service '${name}'.`);
          },
          data: { ...njkTpl.dataPatch },
          meta: {
            title: metaTitle !== 'meta.title' ? metaTitle : null,
            description: metaDesc !== 'meta.description' ? metaDesc : null,
            indexable: true,
            canonical: null,
            ...njkTpl.metaPatch,
          },
          fsy: { ...baseHelpers, ...pluginHelpers },
          clientRuntime,
        };
        
        req.context = ctx;
        
        // Execute hooks: onRequest
        let hookPromise = runHooks(globalHooks, routeHooks, 'onRequest', ctx);
        if (hookPromise) await hookPromise;
        
        // Execute hooks: onRoute
        hookPromise = runHooks(globalHooks, routeHooks, 'onRoute', ctx);
        if (hookPromise) await hookPromise;
        
        // Execute hooks: beforeMiddleware
        hookPromise = runHooks(globalHooks, routeHooks, 'beforeMiddleware', ctx);
        if (hookPromise) await hookPromise;
        
        // Run cascading folder middlewares (_middleware.js)
        const cascadingMw = loadCascadingMiddlewares(absolutePagesDir, route.file, middlewares, isDev);
        if (cascadingMw.length) {
          await runMiddlewareChain(cascadingMw, req, res);
          if (res.headersSent) return;
        }

        // Run route middleware
        if (pageMw.length) {
          await runMiddlewareChain(pageMw, req, res);
          if (res.headersSent) return;
        }
        
        // Execute hooks: afterMiddleware
        hookPromise = runHooks(globalHooks, routeHooks, 'afterMiddleware', ctx);
        if (hookPromise) await hookPromise;
        
        // Execute hooks: beforeLoad
        if (pluginManager && db) {
          const contentApi = pluginManager.getPluginAPI('content');
          if (contentApi?.getContentService) {
            ctx.content = contentApi.getContentService(db);
          }
        }
        hookPromise = runHooks(globalHooks, routeHooks, 'beforeLoad', ctx);
        if (hookPromise) await hookPromise;
        
        // Find cascading layouts (_layout.njk)
        const cascadingLayouts = findCascadingLayouts(absolutePagesDir, route.file, isDev);

        // Run cascading _layout.js load() functions in top-down order (outermost first)
        if (cascadingLayouts.length > 0) {
          await executeCascadingLayoutLoads(cascadingLayouts, req, ctx, isDev);
        }

        // Run load function
        if (config?.load && typeof config.load === 'function') {
          const loadData = await config.load(req, ctx);
          if (loadData && typeof loadData === 'object' && !Array.isArray(loadData)) {
            ctx.data = { ...ctx.data, ...loadData };
          }
        }
        
        // Execute hooks: afterLoad
        hookPromise = runHooks(globalHooks, routeHooks, 'afterLoad', ctx);
        if (hookPromise) await hookPromise;
        
        // Run meta function
        if (config?.meta && typeof config.meta === 'function') {
          const metaData = await config.meta(req, ctx);
          if (metaData && typeof metaData === 'object' && !Array.isArray(metaData)) {
            ctx.meta = { ...ctx.meta, ...metaData };
          }
        }
        
        // Execute hooks: beforeRender
        hookPromise = runHooks(globalHooks, routeHooks, 'beforeRender', ctx);
        if (hookPromise) await hookPromise;
        
        const pageAssetBundle = applyPageAssetsToTemplateData(
          pageAssetsResolved,
          ctx.data,
          {
            file: route.file,
            routePath: route.routePath,
          },
          ctx.fsy?.assetManager || getAssetManager()
        );
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
        const nearestLoading = findNearestLoadingTemplate(absolutePagesDir, route.file, isDev);
        if (nearestLoading) {
          renderContext.loadingTemplate = nearestLoading.loadingRelPath;
        }

        // SSR Streaming mode (chunked transfer)
        if (config?.stream || ctx.data?.__stream || ctx.data?.stream || ctx.defer || ctx.data?.defer) {
          const streamDefer = ctx.defer || ctx.data?.defer || ctx.data?.__defer || {};
          const status = (route.routePath === '/404' || route.file === '404.njk') ? 404 : 200;
          const shouldApplyLayout = config?.layout !== false &&
            ctx.data?.layout !== false &&
            ctx.meta?.layout !== false &&
            !templateHasExtends(njkTpl.templateBody, route.fullPath);

          return await renderStream(res, templatePath, renderContext, {
            env: nunjucks,
            defer: streamDefer,
            status,
            loadingTemplate: nearestLoading?.loadingRelPath,
            layouts: shouldApplyLayout && cascadingLayouts.length > 0 ? cascadingLayouts : undefined,
          });
        }

        let html;
        if (njkTpl.useStringRender && njkTpl.templateBody != null) {
          if (typeof nunjucks.Template === 'function') {
            let compiled = isDev ? null : compiledStringTemplateCache.get(route.fullPath);
            if (!compiled || (isDev && compiled._templateBody !== njkTpl.templateBody)) {
              compiled = new nunjucks.Template(njkTpl.templateBody, nunjucks, route.fullPath);
              compiled._templateBody = njkTpl.templateBody;
              compiledStringTemplateCache.set(route.fullPath, compiled);
            }
            html = compiled.render(renderContext);
          } else if (typeof nunjucks.renderString === 'function') {
            html = nunjucks.renderString(njkTpl.templateBody, renderContext, { path: route.fullPath });
          } else {
            html = nunjucks.render(templatePath, renderContext);
          }
        } else {
          html = nunjucks.render(templatePath, renderContext);
        }

        // Apply cascading nested layouts if not opted-out and template does not extend another template
        const shouldApplyLayout = config?.layout !== false &&
          ctx.data?.layout !== false &&
          ctx.meta?.layout !== false &&
          !templateHasExtends(njkTpl.templateBody, route.fullPath);

        if (shouldApplyLayout && cascadingLayouts.length > 0) {
          html = applyCascadingLayouts(nunjucks, cascadingLayouts, html, renderContext, isDev);
        }

        if (pluginManager) {
          const contentApi = pluginManager.getPluginAPI('content');
          if (contentApi?.maybeInjectInlineEdit) {
            html = contentApi.maybeInjectInlineEdit(req, html);
          }
        }
        
        // Execute hooks: afterRender
        ctx.html = html;
        hookPromise = runHooks(globalHooks, routeHooks, 'afterRender', ctx);
        if (hookPromise) await hookPromise;
        
        if (route.routePath === '/404' || route.file === '404.njk') {
          res.status(404);
        }
        res.send(ctx.html);
      } catch (err) {
        console.error(`SSR error ${route.routePath}:`, err);
        
        // Execute onError hook
        const hookCtx = { req, res, error: err };
        try {
          await executeHook(globalHooks, 'onError', hookCtx, err);
        } catch (hookErr) {
          console.error('Error in onError hook:', hookErr);
        }
        
        const handled = await handleDirectoryErrorBoundary({
          err,
          route,
          req,
          res,
          ctx: req.context || hookCtx,
          absolutePagesDir,
          nunjucks,
          isDev,
          compiledStringTemplateCache,
        });

        if (handled) return;

        return next(err);
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
  isRouteGroupSegment,
  stripRouteGroups,
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
  compiledStringTemplateCache,
  clearCompiledStringTemplateCache,
  translatorCache,
  clearTranslatorCache,
  translateValidationIssues,
  getTranslatorForRequest,
};

