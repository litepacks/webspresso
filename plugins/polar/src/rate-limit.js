'use strict';

const { loadPeer } = require('../../rate-limit/index.js');

const DEFAULT_IPV6_SUBNET = 56;

/**
 * @param {Function} ipKeyGenerator
 * @param {string} prefix
 */
function polarIpKey(ipKeyGenerator, prefix) {
  return (req) => `${prefix}:${ipKeyGenerator(req.ip, DEFAULT_IPV6_SUBNET)}`;
}

/**
 * Prefer authenticated user id; fall back to IPv6-safe IP key (express-rate-limit v8).
 * @param {Function} ipKeyGenerator
 * @param {string} prefix
 */
function polarUserOrIpKey(ipKeyGenerator, prefix) {
  const ipKey = polarIpKey(ipKeyGenerator, prefix);
  return (req) => (req.user?.id != null ? `${prefix}:${req.user.id}` : ipKey(req));
}

/**
 * @param {Function} ipKeyGenerator
 */
function buildDefaultRateLimits(ipKeyGenerator) {
  return {
    webhook: {
      limit: 120,
      windowMs: 60_000,
      message: { error: 'Too many webhook requests' },
      keyGenerator: polarIpKey(ipKeyGenerator, 'polar:webhook'),
    },
    checkout: {
      limit: 5,
      windowMs: 60_000,
      message: { error: 'Too many checkout attempts. Please try again later.' },
      keyGenerator: polarUserOrIpKey(ipKeyGenerator, 'polar:checkout'),
    },
    portal: {
      limit: 10,
      windowMs: 60_000,
      message: { error: 'Too many portal requests. Please try again later.' },
      keyGenerator: polarUserOrIpKey(ipKeyGenerator, 'polar:portal'),
    },
    status: {
      limit: 60,
      windowMs: 60_000,
      message: { error: 'Too many billing status requests' },
      keyGenerator: polarUserOrIpKey(ipKeyGenerator, 'polar:status'),
    },
  };
}

/** @type {ReturnType<typeof buildDefaultRateLimits>|null} */
let cachedDefaults = null;

function loadIpKeyGenerator() {
  try {
    const { ipKeyGenerator } = loadPeer();
    return ipKeyGenerator;
  } catch {
    return null;
  }
}

function getDefaultRateLimits() {
  const ipKeyGenerator = loadIpKeyGenerator();
  if (!ipKeyGenerator) {
    return null;
  }
  if (!cachedDefaults) {
    cachedDefaults = buildDefaultRateLimits(ipKeyGenerator);
  }
  return cachedDefaults;
}

/**
 * Build per-route limiter middleware from rateLimitPlugin factory.
 * @param {Object} ctx - plugin onRoutesReady context
 * @param {import('./config').PolarConfig} config
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

  const defaults = getDefaultRateLimits();
  if (!defaults) {
    console.warn(
      '[polar] rateLimit is enabled but express-rate-limit >= 8 is not installed — skipping polar rate limiters'
    );
    return {};
  }

  const overrides = rlOpt === true ? {} : (rlOpt || {});
  const routes = ['webhook', 'checkout', 'portal', 'status'];
  const out = {};

  for (const route of routes) {
    if (overrides[route] === false) continue;
    const opts = {
      ...defaults[route],
      ...(typeof overrides[route] === 'object' ? overrides[route] : {}),
    };
    out[route] = factory(opts);
  }

  return out;
}

module.exports = {
  loadIpKeyGenerator,
  polarIpKey,
  polarUserOrIpKey,
  buildDefaultRateLimits,
  getDefaultRateLimits,
  resolvePolarRateLimiters,
  /** @deprecated use getDefaultRateLimits() */
  get DEFAULT_RATE_LIMITS() {
    return getDefaultRateLimits() || buildDefaultRateLimits(
      loadIpKeyGenerator() || ((ip) => String(ip))
    );
  },
};
