/**
 * Edge-safe router utilities (no fs/path imports)
 * Used by manifest mount and Cloudflare Workers runtime.
 * @module src/router-edge
 */

const MAX_LOCALE_LEN = 16;

/** @returns {Set<string>} */
function parseSupportedLocaleSet() {
  const raw = process.env.SUPPORTED_LOCALES || 'en';
  return new Set(
    raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
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

function escapeRegExp(s) {
  return String(s).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
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
 * @param {boolean|{enabled?: boolean, stylesheets?: boolean, scripts?: boolean}|null|undefined} raw
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
 * @param {Object} translations
 */
function createTranslator(translations) {
  return function t(key, params = {}) {
    let value = translations[key];

    if (value === undefined) {
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
      return key;
    }

    if (typeof value === 'string' && Object.keys(params).length > 0) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        const escaped = escapeRegExp(paramKey);
        value = value.replace(new RegExp(`{{\\s*${escaped}\\s*}}`, 'g'), paramValue);
      }
    }

    return value;
  };
}

/**
 * @param {Object} req
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

function isMiddlewareFactory(fn) {
  return typeof fn === 'function' && fn.length <= 1;
}

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

module.exports = {
  detectLocale,
  createTranslator,
  resolveMiddlewares,
  routeRegistrationMeta,
  compareRouteRegistrationOrder,
  resolvePageAssets,
  applyPageAssetsToTemplateData,
  parseSupportedLocaleSet,
  normalizeLocaleCandidate,
  pickMatchingLocale,
  escapeRegExp,
  isMiddlewareFactory,
  resolveNamedMiddleware,
  toList,
};
