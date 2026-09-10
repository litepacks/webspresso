'use strict';

const DEFAULT_RATE_LIMITS = {
  webhook: {
    limit: 120,
    windowMs: 60_000,
    message: { error: 'Too many webhook requests' },
  },
  checkout: {
    limit: 5,
    windowMs: 60_000,
    message: { error: 'Too many checkout attempts. Please try again later.' },
    keyGenerator: (req) => `polar:checkout:${req.user?.id ?? req.ip}`,
  },
  portal: {
    limit: 10,
    windowMs: 60_000,
    message: { error: 'Too many portal requests. Please try again later.' },
    keyGenerator: (req) => `polar:portal:${req.user?.id ?? req.ip}`,
  },
  status: {
    limit: 60,
    windowMs: 60_000,
    message: { error: 'Too many billing status requests' },
    keyGenerator: (req) => `polar:status:${req.user?.id ?? req.ip}`,
  },
};

/**
 * Build per-route limiter middleware from rateLimitPlugin factory.
 * @param {Object} ctx - plugin onRoutesReady context
 * @param {import('./config').PolarConfig} config
 * @returns {{ webhook?: Function, checkout?: Function, portal?: Function, status?: Function }}
 */
function resolvePolarRateLimiters(ctx, config) {
  const rlOpt = config.rateLimit;
  if (rlOpt === false || rlOpt?.enabled === false) {
    return {};
  }

  const factory = ctx.middlewares?.rateLimit;
  if (typeof factory !== 'function') {
    if (rlOpt === true || (rlOpt && typeof rlOpt === 'object')) {
      console.warn(
        '[polar] rateLimit is enabled but rateLimitPlugin is not loaded — add rateLimitPlugin() before polarPlugin in plugins[]'
      );
    }
    return {};
  }

  const overrides = rlOpt === true ? {} : (rlOpt || {});
  const routes = ['webhook', 'checkout', 'portal', 'status'];
  const out = {};

  for (const route of routes) {
    if (overrides[route] === false) continue;
    const opts = {
      ...DEFAULT_RATE_LIMITS[route],
      ...(typeof overrides[route] === 'object' ? overrides[route] : {}),
    };
    out[route] = factory(opts);
  }

  return out;
}

module.exports = {
  DEFAULT_RATE_LIMITS,
  resolvePolarRateLimiters,
};
