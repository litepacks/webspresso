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
const { renderStream } = require('../core/ssr/stream');

const NOOP = () => {};
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);

// Cache for i18n files (key: filePath, value: { mtime, data })
const i18nCache = new Map();

// Cache for merged i18n (key: `${pagesDir}::${routeDir}::${locale}`, value: { globalMtime, routeMtime, data })
const mergedI18nCache = new Map();

// Cache for route configs in production
const configCache = new Map();

// Dev-only: avoid require() on every SSR request when the .js file is unchanged (mtime)
const routeConfigDevCache = new Map();

// Cache for API filename -> { method, baseName } (basename keys; stable per process)
const methodFromFilenameCache = new Map();

// Cache for translation param replacement regexes
const paramRegexCache = new Map();

const MAX_LOCALE_LEN = 16;

let cachedSupportedLocalesRaw = null;
let cachedSupportedLocaleSet = null;

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
    if (inner.startsWith('...') && inner.length > 3) {
      repl = '*';
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
  
  // Convert [param] / [...param] without regex backtracking hazards
  route = rewriteDynamicRouteMarkers(route);

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
 * @returns {Object} Merged translations
 */
function loadI18n(pagesDir, routeDir, locale) {
  // Load global translations
  const globalPath = path.join(pagesDir, 'locales', `${locale}.json`);
  const globalTranslations = loadI18nFile(globalPath);
  
  // Load route-specific translations
  const routePath = path.join(routeDir, 'locales', `${locale}.json`);
  const routeTranslations = loadI18nFile(routePath);
  
  const gEmpty = globalTranslations === EMPTY_OBJECT || !globalTranslations || Object.keys(globalTranslations).length === 0;
  const rEmpty = routeTranslations === EMPTY_OBJECT || !routeTranslations || Object.keys(routeTranslations).length === 0;

  if (gEmpty && rEmpty) return EMPTY_OBJECT;
  if (gEmpty) return routeTranslations;
  if (rEmpty) return globalTranslations;

  const cacheKey = `${pagesDir}::${routeDir}::${locale}`;
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

function resolveTranslationValue(dict, key) {
  if (!dict || typeof dict !== 'object') return undefined;
  if (dict[key] !== undefined) return dict[key];

  const parts = key.split('.');
  let curr = dict;
  for (const part of parts) {
    if (curr && typeof curr === 'object') {
      curr = curr[part];
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

    // Replace params like {{name}} in the translation
    if (interpolationParams && interpolationParams !== EMPTY_OBJECT && Object.keys(interpolationParams).length > 0) {
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
      return new Intl.NumberFormat(locale, numOpts).format(Number(num));
    } catch {
      return String(num);
    }
  };
  t.formatNumber = t.number;

  t.currency = function formatCurrency(amount, currency = 'USD', currOpts = {}) {
    if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '';
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency, ...currOpts }).format(Number(amount));
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
      return new Intl.DateTimeFormat(locale, dateOpts).format(d);
    } catch {
      return String(date);
    }
  };
  t.formatDate = t.date;

  t.relativeTime = function formatRelativeTime(val, unit = 'day', relOpts = { numeric: 'auto' }) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return '';
    try {
      return new Intl.RelativeTimeFormat(locale, relOpts).format(Number(val), unit);
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
async function executeHook(hooks, hookName, ctx, ...extra) {
  if (hooks && typeof hooks[hookName] === 'function') {
    await hooks[hookName](ctx, ...extra);
  }
}

/**
 * Detect locale from request
 * @param {Object} req - Express request
 * @returns {string} Locale code
 */
function detectLocale(req) {
  const supported = parseSupportedLocaleSet();
  const defaultCand = normalizeLocaleCandidate(process.env.DEFAULT_LOCALE || 'en');
  const def =
    pickMatchingLocale(defaultCand, supported)
    ?? (supported.has('en') ? 'en' : [...supported][0])
    ?? 'en';

  if (req.query && req.query.lang != null && req.query.lang !== '') {
    const q = normalizeLocaleCandidate(String(req.query.lang));
    const hit = pickMatchingLocale(q, supported);
    if (hit) {
      return hit;
    }
  }

  const acceptLanguage = req.get('Accept-Language');
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
function resolveMiddlewares(middlewareConfig, middlewareRegistry = EMPTY_OBJECT) {
  if (!middlewareConfig || !Array.isArray(middlewareConfig) || middlewareConfig.length === 0) {
    return EMPTY_ARRAY;
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

  // Routing and file-system checks at startup
  function checkRoutesAtStartup() {
    function getGenericSegment(name) {
      if (name.startsWith('[') && name.endsWith(']')) {
        const inner = name.slice(1, -1);
        if (inner.startsWith('...')) return '*';
        return ':param';
      }
      return name;
    }

    function checkDir(dirPath, relativeDir = '', isApi = false) {
      if (!fs.existsSync(dirPath)) return;
      const children = fs.readdirSync(dirPath);
      const kept = [];

      for (const child of children) {
        if (child.startsWith('_') || child === 'locales') continue;
        const fullPath = path.join(dirPath, child);
        const relPath = relativeDir ? path.join(relativeDir, child) : child;
        const stats = fs.statSync(fullPath);

        // 1. Check case-sensitivity issues
        if (child !== child.toLowerCase()) {
          console.warn(`[webspresso] WARNING: Path "pages/${relPath.split(path.sep).join('/')}" contains uppercase letters. Use lowercase to avoid routing issues on case-sensitive filesystems.`);
        }

        if (stats.isDirectory()) {
          if (child === 'api' && relativeDir === '') {
            checkDir(fullPath, relPath, true);
          } else {
            checkDir(fullPath, relPath, isApi);
            if (!isApi) {
              kept.push({ name: child, isDir: true, original: child });
            }
          }
        } else {
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
    }

    checkDir(absolutePagesDir, '');
  }

  checkRoutesAtStartup();
  
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
        routePath: filePathToRoute(routePath, ''),
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
    const handler = require(route.fullPath);
    const handlerFn = typeof handler === 'function' ? handler : handler.default || handler.handler;
    const routeMiddleware = handler.middleware;

    const preResolvedMw = routeMiddleware
      ? resolveMiddlewares(routeMiddleware, middlewares)
      : EMPTY_ARRAY;
    
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
        if (serviceRegistry != null) {
          req.service = (name, input, opts) =>
            serviceRegistry.call(name, input, { req, res, db }, opts);
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
    const mountConfig = loadRouteConfig(route.configPath, isDev);
    const preResolvedPageMw = mountConfig?.middleware
      ? resolveMiddlewares(mountConfig.middleware, middlewares)
      : EMPTY_ARRAY;

    app.get(route.routePath, async (req, res, next) => {
      try {
        // Detect locale
        const locale = detectLocale(req);
        const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
        
        // Load translations (primary + fallback)
        const translations = loadI18n(absolutePagesDir, route.routeDir, locale);
        const fallbackTranslations = (locale !== defaultLocale)
          ? loadI18n(absolutePagesDir, route.routeDir, defaultLocale)
          : EMPTY_OBJECT;

        const t = createTranslator(translations, {
          locale,
          fallbackTranslations,
          fallbackLocale: defaultLocale,
        });
        
        // Load route config
        const config = loadRouteConfig(route.configPath, isDev);
        const routeHooks = config?.hooks || EMPTY_OBJECT;
        
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
            title: t('meta.title') !== 'meta.title' ? t('meta.title') : null,
            description: t('meta.description') !== 'meta.description' ? t('meta.description') : null,
            indexable: true,
            canonical: null,
            ...njkTpl.metaPatch,
          },
          fsy: { ...baseHelpers, ...pluginHelpers },
          clientRuntime,
        };
        
        req.context = ctx;
        
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
        if (pluginManager && db) {
          const contentApi = pluginManager.getPluginAPI('content');
          if (contentApi?.getContentService) {
            ctx.content = contentApi.getContentService(db);
          }
        }
        await executeHook(globalHooks, 'beforeLoad', ctx);
        await executeHook(routeHooks, 'beforeLoad', ctx);
        
        // Run load function
        if (config?.load && typeof config.load === 'function') {
          const loadData = await config.load(req, ctx);
          if (loadData && typeof loadData === 'object' && !Array.isArray(loadData)) {
            ctx.data = { ...ctx.data, ...loadData };
          }
        }
        
        // Execute hooks: afterLoad
        await executeHook(globalHooks, 'afterLoad', ctx);
        await executeHook(routeHooks, 'afterLoad', ctx);
        
        // Run meta function
        if (config?.meta && typeof config.meta === 'function') {
          const metaData = await config.meta(req, ctx);
          if (metaData && typeof metaData === 'object' && !Array.isArray(metaData)) {
            ctx.meta = { ...ctx.meta, ...metaData };
          }
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

        // SSR Streaming mode (chunked transfer)
        if (config?.stream || ctx.data?.__stream || ctx.defer) {
          const streamDefer = ctx.defer || ctx.data?.__defer || {};
          const status = (route.routePath === '/404' || route.file === '404.njk') ? 404 : 200;
          return await renderStream(res, templatePath, renderContext, {
            env: nunjucks,
            defer: streamDefer,
            status,
          });
        }

        let html =
          njkTpl.useStringRender && njkTpl.templateBody != null
            ? nunjucks.renderString(njkTpl.templateBody, renderContext, { path: route.fullPath })
            : nunjucks.render(templatePath, renderContext);

        if (pluginManager) {
          const contentApi = pluginManager.getPluginAPI('content');
          if (contentApi?.maybeInjectInlineEdit) {
            html = contentApi.maybeInjectInlineEdit(req, html);
          }
        }
        
        // Execute hooks: afterRender
        ctx.html = html;
        await executeHook(globalHooks, 'afterRender', ctx);
        await executeHook(routeHooks, 'afterRender', ctx);
        
        if (route.routePath === '/404' || route.file === '404.njk') {
          res.status(404);
        }
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

