/**
 * HTTP Metrics & Distributed Tracing Middleware for Webspresso
 * Instruments incoming requests, binds W3C/GCP/AWS trace IDs, and exposes Prometheus /metrics.
 *
 * @module core/metrics/middleware
 */

'use strict';

const crypto = require('crypto');
const { MetricsRegistry } = require('./registry');
const {
  collectSystemMetrics,
  collectDatabaseMetrics,
  collectCacheMetrics,
  collectResilienceMetrics,
} = require('./collectors');
const { extractTraceContext } = require('../logger/trace');

/**
 * Normalize metrics configuration options
 * @param {Object|boolean} options
 * @returns {Object}
 */
function normalizeMetricsConfig(options = {}) {
  const envEnabled = process.env.METRICS_ENABLED === 'true';
  const isEnabled = options === true || Boolean(options && options.enabled !== false) || envEnabled;

  const raw = typeof options === 'object' && options !== null ? options : {};

  return {
    enabled: isEnabled,
    path: raw.path || '/metrics',
    collectDefault: raw.collectDefault !== false,
    traceHeader: raw.traceHeader !== false,
    auth: raw.auth || null, // string token, or { token: '...' }
    buckets: Array.isArray(raw.buckets) ? raw.buckets : [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  };
}

/**
 * Creates metrics manager and returns middleware and registry
 * @param {Object} [options]
 * @param {Object} [context={}]
 * @returns {Object}
 */
function createMetricsManager(options = {}, context = {}) {
  const config = normalizeMetricsConfig(options);
  const registry = new MetricsRegistry();

  // Core HTTP metrics
  const requestsTotal = registry.counter(
    'webspresso_http_requests_total',
    'Total number of HTTP requests processed'
  );

  const requestDuration = registry.histogram(
    'webspresso_http_request_duration_seconds',
    'HTTP request duration in seconds',
    config.buckets
  );

  const activeRequests = registry.gauge(
    'webspresso_http_active_requests',
    'Current active in-flight HTTP requests'
  );

  /**
   * Request instrumenter middleware
   */
  function requestMiddleware(req, res, next) {
    // 1. Distributed Tracing Propagation
    const traceCtx = extractTraceContext(req);
    const traceId = traceCtx.traceId || crypto.randomBytes(16).toString('hex');
    const spanId = traceCtx.spanId || crypto.randomBytes(8).toString('hex');

    req.traceId = traceId;
    req.spanId = spanId;
    req.metrics = registry;

    if (config.traceHeader) {
      if (!res.getHeader('x-trace-id')) {
        res.setHeader('x-trace-id', traceId);
      }
      if (!res.getHeader('traceparent')) {
        res.setHeader('traceparent', `00-${traceId.padStart(32, '0')}-${spanId.padStart(16, '0')}-01`);
      }
    }

    // Skip metrics tracking for /metrics and /healthz endpoints to prevent noise
    const isMetricsEndpoint = req.path === config.path || req.path === `${config.path}.json`;
    if (isMetricsEndpoint) {
      return next();
    }

    activeRequests.inc();
    const startHrTime = process.hrtime.bigint();

    res.on('finish', () => {
      try {
        const durationSec = Number(process.hrtime.bigint() - startHrTime) / 1e9;
        const method = req.method || 'GET';
        const status = String(res.statusCode || 200);

        // Extract normalized route path or fallback
        const route = (req.route && req.route.path) ? String(req.route.path) : (req.path || '/');

        requestsTotal.inc({ method, route, status });
        requestDuration.observe({ method, route }, durationSec);
      } finally {
        activeRequests.dec();
      }
    });

    next();
  }

  /**
   * Generate metrics payload on scrape
   * @param {Object} [scrapeContext]
   * @returns {string} Prometheus formatted string
   */
  function getPrometheusMetrics(scrapeContext = {}) {
    const ctx = { ...context, ...scrapeContext };

    if (config.collectDefault) {
      collectSystemMetrics(registry);
      collectDatabaseMetrics(registry, ctx.db);
      collectCacheMetrics(registry, ctx.cache);
      collectResilienceMetrics(registry, ctx.breakers);
    }

    return registry.formatPrometheus();
  }

  /**
   * Generate metrics JSON payload
   * @param {Object} [scrapeContext]
   * @returns {Record<string, any>}
   */
  function getJsonMetrics(scrapeContext = {}) {
    const ctx = { ...context, ...scrapeContext };

    if (config.collectDefault) {
      collectSystemMetrics(registry);
      collectDatabaseMetrics(registry, ctx.db);
      collectCacheMetrics(registry, ctx.cache);
      collectResilienceMetrics(registry, ctx.breakers);
    }

    return registry.formatJson();
  }

  return {
    config,
    registry,
    requestMiddleware,
    getPrometheusMetrics,
    getJsonMetrics,
    requestsTotal,
    requestDuration,
    activeRequests,
  };
}

/**
 * Mount metrics endpoint onto Express application
 * @param {import('express').Application} app
 * @param {Object|boolean} [options]
 * @param {Object} [context={}]
 * @returns {Object|null} Metrics manager or null if disabled
 */
function setupMetricsMiddleware(app, options = {}, context = {}) {
  const config = normalizeMetricsConfig(options);
  if (!config.enabled) {
    return null;
  }

  const manager = createMetricsManager(config, {
    ...context,
    app,
    db: context.db || app.db || (app.get ? app.get('db') : null),
    cache: context.cache || app.cache || (app.get ? app.get('cache') : null),
    breakers: context.breakers || app.breakers,
  });

  // Attach tracking middleware
  app.use(manager.requestMiddleware);

  // Mount scrape endpoint
  const metricsHandler = (req, res) => {
    // Optional auth verification
    if (config.auth) {
      const expectedToken = typeof config.auth === 'string' ? config.auth : config.auth.token;
      const authHeader = req.headers['authorization'] || '';
      const providedToken = authHeader.replace(/^Bearer\s+/i, '').trim();

      if (expectedToken && providedToken !== expectedToken) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="Metrics"');
        return res.status(401).send('Unauthorized');
      }
    }

    const acceptsJson = req.path.endsWith('.json') || (req.headers.accept && req.headers.accept.includes('application/json'));

    if (acceptsJson) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json(manager.getJsonMetrics());
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.status(200).send(manager.getPrometheusMetrics());
  };

  app.get(config.path, metricsHandler);
  if (!config.path.endsWith('.json')) {
    app.get(`${config.path}.json`, metricsHandler);
  }

  return manager;
}

module.exports = {
  normalizeMetricsConfig,
  createMetricsManager,
  setupMetricsMiddleware,
};
