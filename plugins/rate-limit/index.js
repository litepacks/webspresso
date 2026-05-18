/**
 * Rate limit plugin — in-memory limiter for file routes + optional global mount
 * @module plugins/rate-limit
 */

const PLUGIN_ONLY_KEYS = new Set(['global', 'globalOverrides', 'globalSkipPaths']);

const DEFAULT_BASE = {
  windowMs: 60_000,
  limit: 100,
  message: { error: 'Too many requests, please try again later.' },
};

function pickLimiterOptions(opts) {
  const out = { ...opts };
  for (const k of PLUGIN_ONLY_KEYS) {
    delete out[k];
  }
  return out;
}

/**
 * Simple sliding-window rate limiter (Express-compatible req/res/next)
 * @param {object} options
 */
function createRateLimitMiddleware(options = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const limit = options.limit ?? 100;
  const message = options.message ?? { error: 'Too many requests' };
  const keyGenerator =
    options.keyGenerator ||
    ((req) => req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown');
  const skip = options.skip;

  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();

  return (req, res, next) => {
    if (typeof skip === 'function' && skip(req, res)) {
      return next();
    }
    const key = keyGenerator(req, res);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      return res.status(429).json(message);
    }
    return next();
  };
}

function resolveLimiterConfig(...layers) {
  return Object.assign({}, ...layers);
}

function combineSkip(userSkip, builtin) {
  if (!userSkip) return builtin;
  return (req, res) => userSkip(req, res) || builtin(req, res);
}

function createDefaultGlobalSkip(extraPathPrefixes = []) {
  const extras = (Array.isArray(extraPathPrefixes) ? extraPathPrefixes : []).filter(Boolean);
  const prefixes = ['/__webspresso/client-runtime', '/_webspresso', ...extras];
  return (req) => {
    const p = req.path || '';
    if (prefixes.some((x) => p.startsWith(x))) return true;
    if (p === '/health' || p === '/robots.txt' || p === '/favicon.ico') return true;
    return false;
  };
}

function rateLimitPlugin(options = {}) {
  const {
    global: applyGlobal = false,
    globalOverrides = null,
    globalSkipPaths = [],
    ...rest
  } = options;

  const factoryDefaults = pickLimiterOptions(rest);

  return {
    name: 'rate-limit',
    version: '2.0.0',
    description: 'Named rateLimit middleware for file routes; optional global limiter',

    api: {
      createLimiterOptions(routeOpts = {}) {
        const base = { ...DEFAULT_BASE, ...factoryDefaults };
        if (!base.keyGenerator) {
          base.keyGenerator = (req) =>
            req?.ip ||
            (req?.headers &&
              String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
            'unknown';
        }
        return resolveLimiterConfig(base, routeOpts);
      },
    },

    register(ctx) {
      const baseDefaults = { ...DEFAULT_BASE, ...factoryDefaults };

      ctx.middlewares.rateLimit = (routeOpts = {}) =>
        createRateLimitMiddleware(resolveLimiterConfig(baseDefaults, routeOpts));

      if (applyGlobal) {
        const globalBuiltins = createDefaultGlobalSkip(globalSkipPaths);
        const globalResolved = resolveLimiterConfig(
          baseDefaults,
          globalOverrides && typeof globalOverrides === 'object' ? globalOverrides : {}
        );
        const UserSkip = globalResolved.skip;
        const middleware = createRateLimitMiddleware({
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
}

module.exports = { rateLimitPlugin, createRateLimitMiddleware };
