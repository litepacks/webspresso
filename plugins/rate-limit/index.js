/**
 * Rate limit plugin — registers named `rateLimit` middleware for file routes + optional global limiter
 * @module plugins/rate-limit
 */

const PLUGIN_ONLY_KEYS = new Set(['global', 'globalOverrides', 'globalSkipPaths']);

const DEFAULT_BASE = {
  windowMs: 60_000,
  limit: 100,
  legacyHeaders: false,
  standardHeaders: 'draft-7',
  message: { error: 'Too many requests, please try again later.' },
};

/**
 * Load express-rate-limit (peer). Throws if missing or too old for ipKeyGenerator.
 * @returns {{ rateLimit: Function, ipKeyGenerator: Function }}
 */
function loadPeer() {
  let mod;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    mod = require('express-rate-limit');
  } catch (e) {
    const err = new Error(
      'rate-limit plugin: install peer dependency `express-rate-limit` (npm install express-rate-limit)'
    );
    err.cause = e;
    throw err;
  }
  const rateLimit = mod.rateLimit || mod.default;
  const { ipKeyGenerator } = mod;
  if (typeof rateLimit !== 'function') {
    throw new Error('rate-limit plugin: express-rate-limit export rateLimit not found');
  }
  if (typeof ipKeyGenerator !== 'function') {
    throw new Error(
      'rate-limit plugin: express-rate-limit must be >= 8 (ipKeyGenerator export required)'
    );
  }
  return { rateLimit, ipKeyGenerator };
}

/**
 * Strip plugin-only options before passing to express-rate-limit.
 * @param {Record<string, unknown>} opts
 */
function pickLimiterOptions(opts) {
  const out = { ...opts };
  for (const k of PLUGIN_ONLY_KEYS) {
    delete out[k];
  }
  return out;
}

/**
 * Merge layers into express-rate-limit options. Default key uses ipKeyGenerator(req.ip, subnet).
 * Custom keyGenerator and top-level ipv6Subnet are mutually exclusive in v8+ validation.
 *
 * @param {Function} ipKeyGenerator
 * @param  {...Record<string, unknown>} layers
 */
function resolveLimiterConfig(ipKeyGenerator, ...layers) {
  /** @type {Record<string, unknown>} */
  const merged = Object.assign({}, ...layers);
  const keyGenerator = merged.keyGenerator;
  const ipv6Subnet = merged.ipv6Subnet;
  const rest = { ...merged };
  delete rest.keyGenerator;
  delete rest.ipv6Subnet;

  if (typeof keyGenerator === 'function') {
    return { ...rest, keyGenerator };
  }

  const subnet = ipv6Subnet !== undefined ? ipv6Subnet : 56;
  return {
    ...rest,
    keyGenerator: (req, res) => ipKeyGenerator(req.ip, subnet),
  };
}

/**
 * @param {import('express').RequestHandler|undefined} userSkip
 * @param {import('express').RequestHandler} builtin
 */
function combineSkip(userSkip, builtin) {
  if (!userSkip) return builtin;
  return (req, res) => userSkip(req, res) || builtin(req, res);
}

/**
 * @param {string[]} extraPathPrefixes
 * @returns {import('express').RequestHandler}
 */
function createDefaultGlobalSkip(extraPathPrefixes = []) {
  const extras = (Array.isArray(extraPathPrefixes) ? extraPathPrefixes : []).filter(Boolean);
  /** @type {string[]} */
  const prefixes = [
    '/__webspresso/client-runtime',
    '/_webspresso',
    ...extras,
  ];
  return (req, res) => {
    const p = req.path || '';
    if (prefixes.some((x) => p.startsWith(x))) return true;
    if (p === '/health' || p === '/robots.txt' || p === '/favicon.ico') return true;
    return false;
  };
}

/**
 * @param {object} [options] — express-rate-limit options plus plugin keys
 * @param {boolean} [options.global=false] — mount a global limiter on ctx.app
 * @param {object} [options.globalOverrides] — shallow merge applied only for the global limiter (after factory defaults)
 * @param {string[]} [options.globalSkipPaths] — extra path prefixes where global limiter skips counting
 */
function rateLimitPlugin(options = {}) {
  const {
    global: applyGlobal = false,
    globalOverrides = null,
    globalSkipPaths = [],
    ...rest
  } = options;

  const factoryDefaults = pickLimiterOptions(rest);

  const plugin = {
    name: 'rate-limit',
    version: '1.0.0',
    description: 'Named rateLimit middleware (express-rate-limit) for file routes; optional global limiter',
    _options: options,

    api: {
      /**
       * Build limiter options object (for setupRoutes / tests).
       * @param {Record<string, unknown>} [routeOpts]
       */
      createLimiterOptions(routeOpts = {}) {
        const { ipKeyGenerator } = loadPeer();
        const baseDefaults = { ...DEFAULT_BASE, ...factoryDefaults };
        return resolveLimiterConfig(ipKeyGenerator, baseDefaults, routeOpts);
      },
    },

    register(ctx) {
      const { rateLimit, ipKeyGenerator } = loadPeer();

      const baseDefaults = { ...DEFAULT_BASE, ...factoryDefaults };

      ctx.middlewares.rateLimit = (routeOpts = {}) =>
        rateLimit(resolveLimiterConfig(ipKeyGenerator, baseDefaults, routeOpts));

      if (applyGlobal) {
        const globalBuiltins = createDefaultGlobalSkip(globalSkipPaths);
        const globalResolved = resolveLimiterConfig(
          ipKeyGenerator,
          baseDefaults,
          globalOverrides && typeof globalOverrides === 'object' ? globalOverrides : {}
        );
        const UserSkip = globalResolved.skip;
        const middleware = rateLimit({
          ...globalResolved,
          skip: combineSkip(
            typeof UserSkip === 'function' ? UserSkip : undefined,
            globalBuiltins
          ),
        });
        ctx.app.use(middleware);
      }
    },
  };

  return plugin;
}

module.exports = { rateLimitPlugin };
