/**
 * HTTP redirect plugin — runs in register() before file-based routes.
 * @module plugins/redirect
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * @param {string} to
 * @returns {boolean}
 */
function isExternalTarget(to) {
  if (!to || typeof to !== 'string') return false;
  const t = to.trim();
  return /^https?:\/\//i.test(t) || t.startsWith('//');
}

/**
 * @param {'strip'|'add'|false|undefined} mode
 * @param {string} path
 * @returns {string}
 */
function normalizePathForTrailingSlash(mode, path) {
  if (!path || mode === false || mode == null) return path;
  if (path === '/') return path;
  if (mode === 'strip') {
    return path.endsWith('/') ? path.slice(0, -1) || '/' : path;
  }
  if (mode === 'add') {
    return path.endsWith('/') ? path : `${path}/`;
  }
  return path;
}

/**
 * @param {object} rule
 * @param {object} pluginOpts
 * @returns {object|null} compiled rule or null if invalid / disallowed external
 */
function compileRule(rule, pluginOpts) {
  if (!rule || typeof rule.to !== 'string' || rule.to.trim() === '') {
    console.warn('[redirect] Skipping rule: missing `to`');
    return null;
  }

  const to = rule.to.trim();
  const external = isExternalTarget(to);
  if (external && !pluginOpts.allowExternal) {
    console.warn('[redirect] Skipping rule: external `to` requires allowExternal: true', rule.from);
    return null;
  }

  let status = rule.status != null ? Number(rule.status) : pluginOpts.defaultStatus;
  if (!REDIRECT_STATUSES.has(status)) {
    status = pluginOpts.defaultStatus;
  }

  let matchAnyMethod = false;
  /** @type {Set<string>|null} */
  let methodSet = null;
  if (rule.methods === '*') {
    matchAnyMethod = true;
  } else if (Array.isArray(rule.methods) && rule.methods.length > 0) {
    methodSet = new Set(rule.methods.map((m) => String(m).toUpperCase()));
  } else {
    methodSet = new Set(pluginOpts.defaultMethods.map((m) => String(m).toUpperCase()));
  }

  const trailing = pluginOpts.trailingSlash;

  if (typeof rule.from === 'string') {
    const fromRaw = rule.from.trim();
    const fromNorm = normalizePathForTrailingSlash(trailing, fromRaw);
    return {
      kind: 'string',
      fromNorm,
      fromRaw,
      to,
      status,
      external,
      matchAnyMethod,
      methodSet,
      trailing,
    };
  }

  if (rule.from instanceof RegExp) {
    return {
      kind: 'regex',
      from: rule.from,
      to,
      status,
      external,
      matchAnyMethod,
      methodSet,
      trailing,
    };
  }

  console.warn('[redirect] Skipping rule: `from` must be string or RegExp');
  return null;
}

/**
 * @param {object} compiled
 * @param {string} pathForMatch
 * @param {string} rawPath
 * @returns {boolean}
 */
function pathMatches(compiled, pathForMatch, rawPath) {
  if (compiled.kind === 'string') {
    if (pathForMatch === compiled.fromNorm) return true;
    if (!compiled.trailing) {
      const a = rawPath.replace(/\/$/, '') || '/';
      const b = compiled.fromRaw.replace(/\/$/, '') || '/';
      if (a === b) return true;
    }
    return false;
  }
  return compiled.from.test(pathForMatch);
}

/**
 * @param {object} compiled
 * @param {string} method
 * @returns {boolean}
 */
function methodMatches(compiled, method) {
  const m = method.toUpperCase();
  if (compiled.matchAnyMethod) return true;
  if (compiled.methodSet) return compiled.methodSet.has(m);
  return false;
}

/**
 * @param {object} options
 * @param {Array<{from: string|RegExp, to: string, status?: number, methods?: string[]|'*'}>} [options.rules]
 * @param {number} [options.defaultStatus=302]
 * @param {boolean} [options.preserveQuery=true]
 * @param {boolean} [options.allowExternal=false]
 * @param {'strip'|'add'|false} [options.trailingSlash=false]
 * @param {string[]} [options.defaultMethods=['GET','HEAD']]
 * @returns {{ name: string, version: string, description: string, register: Function }}
 */
function redirectPlugin(options = {}) {
  const {
    rules = [],
    defaultStatus = 302,
    preserveQuery = true,
    allowExternal = false,
    trailingSlash = false,
    defaultMethods = ['GET', 'HEAD'],
  } = options;

  const pluginOpts = {
    defaultStatus: REDIRECT_STATUSES.has(Number(defaultStatus)) ? Number(defaultStatus) : 302,
    preserveQuery,
    allowExternal,
    trailingSlash,
    defaultMethods: Array.isArray(defaultMethods) && defaultMethods.length > 0 ? defaultMethods : ['GET', 'HEAD'],
  };

  const compiled = [];
  for (const rule of rules) {
    const c = compileRule(rule, pluginOpts);
    if (c) compiled.push(c);
  }

  function redirectMiddleware(req, res, next) {
    const rawPath = req.path || '/';
    const pathForMatch = normalizePathForTrailingSlash(pluginOpts.trailingSlash, rawPath);
    const method = req.method || 'GET';

    for (const c of compiled) {
      if (!methodMatches(c, method)) continue;
      if (!pathMatches(c, pathForMatch, rawPath)) continue;

      let location = c.to;
      if (pluginOpts.preserveQuery && !location.includes('?')) {
        const full = req.originalUrl || req.url || '';
        const qi = full.indexOf('?');
        if (qi !== -1) {
          location += full.slice(qi);
        }
      }
      res.redirect(c.status, location);
      return;
    }
    next();
  }

  return {
    name: 'redirect',
    version: '1.0.0',
    description: 'Configurable HTTP redirects before file-based routes',

    register(ctx) {
      if (compiled.length === 0) return;
      ctx.app.use(redirectMiddleware);
    },
  };
}

module.exports = { redirectPlugin };
