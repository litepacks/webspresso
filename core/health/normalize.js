'use strict';

/**
 * Webspresso Health & Readiness Probes Normalization
 * Standardizes configuration for Docker/Kubernetes liveness (/healthz),
 * readiness (/readyz), and combined diagnostics endpoints.
 *
 * @module core/health/normalize
 */

const DEFAULT_HEALTH_CONFIG = Object.freeze({
  enabled: false,
  path: '/healthz',
  readyPath: '/readyz',
  combinedPath: '/health',
  db: true,
  queue: true,
  eventLoopLag: true,
  eventLoopThresholdMs: 300,
  timeoutMs: 3000,
  checks: Object.freeze({}),
  headers: Object.freeze({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  }),
});

/**
 * Normalizes user healthCheck configuration into a validated options object.
 *
 * @param {Object|boolean|string} [options]
 * @returns {Object} Normalized health configuration
 */
function normalizeHealthConfig(options) {
  if (options === undefined || options === null || options === false) {
    return {
      ...DEFAULT_HEALTH_CONFIG,
      enabled: false,
      checks: {},
      headers: { ...DEFAULT_HEALTH_CONFIG.headers },
    };
  }

  // If top-level createApp options passed, extract options.healthCheck ?? options.server?.healthCheck
  let raw = options;
  if (options && typeof options === 'object') {
    if ('healthCheck' in options || (options.server && 'healthCheck' in options.server)) {
      raw = options.healthCheck ?? options.server?.healthCheck ?? false;
    }
  }

  // Boolean shorthand: healthCheck: true
  if (raw === true) {
    return {
      ...DEFAULT_HEALTH_CONFIG,
      enabled: true,
      checks: {},
      headers: { ...DEFAULT_HEALTH_CONFIG.headers },
    };
  }

  // Boolean false or falsy: healthCheck: false
  if (!raw || raw === false) {
    return {
      ...DEFAULT_HEALTH_CONFIG,
      enabled: false,
      checks: {},
      headers: { ...DEFAULT_HEALTH_CONFIG.headers },
    };
  }

  // String shorthand: healthCheck: '/healthz' or healthCheck: '/api/health'
  if (typeof raw === 'string') {
    const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
    return {
      ...DEFAULT_HEALTH_CONFIG,
      enabled: true,
      path: cleanPath,
      combinedPath: cleanPath,
      checks: {},
      headers: { ...DEFAULT_HEALTH_CONFIG.headers },
    };
  }

  // Object configuration: healthCheck: { path, readyPath, ... }
  const opts = typeof raw === 'object' ? raw : {};

  const cleanPath = (p, fallback) => {
    if (p === false || p === null) return false;
    if (typeof p === 'string' && p.trim()) {
      const trimmed = p.trim();
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }
    return fallback;
  };

  const hasExplicitConfig = Object.keys(opts).length > 0;
  const enabled = opts.enabled !== undefined ? Boolean(opts.enabled) : hasExplicitConfig;
  const path = cleanPath(opts.path, DEFAULT_HEALTH_CONFIG.path);
  const readyPath = cleanPath(opts.readyPath, DEFAULT_HEALTH_CONFIG.readyPath);
  const combinedPath = cleanPath(opts.combinedPath, DEFAULT_HEALTH_CONFIG.combinedPath);

  const db = opts.db !== false;
  const queue = opts.queue !== false;
  const eventLoopLag = opts.eventLoopLag !== false;

  const eventLoopThresholdMs = typeof opts.eventLoopThresholdMs === 'number' && opts.eventLoopThresholdMs > 0
    ? opts.eventLoopThresholdMs
    : DEFAULT_HEALTH_CONFIG.eventLoopThresholdMs;

  const timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
    ? opts.timeoutMs
    : DEFAULT_HEALTH_CONFIG.timeoutMs;

  const checks = opts.checks && typeof opts.checks === 'object' ? { ...opts.checks } : {};

  const headers = {
    ...DEFAULT_HEALTH_CONFIG.headers,
    ...(opts.headers && typeof opts.headers === 'object' ? opts.headers : {}),
  };

  return {
    enabled,
    path,
    readyPath,
    combinedPath,
    db,
    queue,
    eventLoopLag,
    eventLoopThresholdMs,
    timeoutMs,
    checks,
    headers,
  };
}

module.exports = {
  DEFAULT_HEALTH_CONFIG,
  normalizeHealthConfig,
};
