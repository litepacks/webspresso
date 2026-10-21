'use strict';

/**
 * Webspresso Health Check Middleware & Coordinator
 * Exposes /healthz (liveness) and /readyz (readiness) endpoints conforming to cloud & Kubernetes standards.
 *
 * @module core/health/middleware
 */

const { normalizeHealthConfig } = require('./normalize');
const {
  createEventLoopMonitor,
  getSystemMetrics,
  probeDatabase,
  probeQueue,
  probeCustomChecks,
} = require('./probes');

/**
 * Creates a health manager instance coordinating probes and runtime metrics.
 *
 * @param {Object} config - Normalized health configuration
 * @param {Object} [context={}] - Server context (db, queue, shutdownManager)
 * @returns {Object} HealthManager
 */
function createHealthManager(config, context = {}) {
  const eventLoopMonitor = config.eventLoopLag ? createEventLoopMonitor() : null;

  async function getLiveness() {
    const metrics = getSystemMetrics(eventLoopMonitor);
    let status = 'ok';

    if (config.eventLoopLag && metrics.eventLoopLag && config.eventLoopThresholdMs) {
      if (metrics.eventLoopLag.meanMs > config.eventLoopThresholdMs) {
        status = 'degraded';
      }
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      ...metrics,
    };
  }

  async function getReadiness() {
    const shutdownManager = context.shutdownManager || context.app?.shutdownManager;

    // 1. Check if server is currently draining connections during shutdown
    if (shutdownManager && (shutdownManager.isShuttingDown || shutdownManager.isClosed)) {
      return {
        ready: false,
        status: 'draining',
        message: 'Server is currently shutting down and draining active connections',
        timestamp: new Date().toISOString(),
      };
    }

    let isReady = true;
    const checks = {};

    // 2. Check Database connectivity
    if (config.db && context.db) {
      const dbResult = await probeDatabase(context.db, config.timeoutMs);
      checks.database = dbResult;
      if (dbResult.status === 'down') {
        isReady = false;
      }
    }

    // 3. Check Queue readiness
    if (config.queue && context.queue) {
      const queueResult = await probeQueue(context.queue);
      checks.queue = queueResult;
      if (queueResult.status === 'down') {
        isReady = false;
      }
    }

    // 4. Run user-defined custom checks
    if (config.checks && Object.keys(config.checks).length > 0) {
      const customResults = await probeCustomChecks(config.checks, context, config.timeoutMs);
      checks.custom = customResults.results;
      if (!customResults.isHealthy) {
        isReady = false;
      }
    }

    return {
      ready: isReady,
      status: isReady ? 'ready' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  async function getStatus() {
    const [liveness, readiness] = await Promise.all([getLiveness(), getReadiness()]);
    return {
      status: readiness.ready ? liveness.status : 'unhealthy',
      liveness,
      readiness,
    };
  }

  function destroy() {
    if (eventLoopMonitor) {
      eventLoopMonitor.destroy();
    }
  }

  return {
    config,
    getLiveness,
    getReadiness,
    getStatus,
    destroy,
  };
}

/**
 * Mounts standard health check endpoints onto the Express app
 *
 * @param {import('express').Application} app
 * @param {Object} [options] - Health check options or createApp options
 * @param {Object} [context={}] - Server context (db, queue, shutdownManager)
 * @returns {Object|null} Active HealthManager or null if disabled
 */
function setupHealthMiddleware(app, options = {}, context = {}) {
  const config = normalizeHealthConfig(options);
  if (!config.enabled) {
    return null;
  }

  const serverContext = {
    ...context,
    app,
    db: context.db || options.db || config.db || app.db || (app.get ? app.get('db') : null),
    queue: context.queue || options.queue || config.queue || app.queue || (app.get ? app.get('queue') : null),
    shutdownManager: context.shutdownManager || options.shutdownManager || config.shutdownManager || app.shutdownManager,
  };

  const healthManager = createHealthManager(config, serverContext);

  // Helper to attach configured headers (Cache-Control: no-store, etc.)
  function applyHealthHeaders(res) {
    if (config.headers && typeof config.headers === 'object') {
      for (const [key, val] of Object.entries(config.headers)) {
        res.setHeader(key, val);
      }
    }
  }

  // 1. Mount Liveness Endpoint (/healthz)
  if (config.path) {
    app.get(config.path, async (req, res) => {
      try {
        applyHealthHeaders(res);
        const liveness = await healthManager.getLiveness();
        const statusCode = liveness.status === 'ok' ? 200 : 200; // Liveness passes if process responds
        return res.status(statusCode).json(liveness);
      } catch (err) {
        return res.status(500).json({ status: 'error', error: err.message });
      }
    });
  }

  // 2. Mount Readiness Endpoint (/readyz)
  if (config.readyPath && config.readyPath !== config.path) {
    app.get(config.readyPath, async (req, res) => {
      try {
        applyHealthHeaders(res);
        const readiness = await healthManager.getReadiness();
        const statusCode = readiness.ready ? 200 : 503;
        return res.status(statusCode).json(readiness);
      } catch (err) {
        return res.status(503).json({ ready: false, status: 'error', error: err.message });
      }
    });
  }

  // 3. Mount Combined Diagnostic Endpoint (/health)
  if (config.combinedPath && config.combinedPath !== config.path && config.combinedPath !== config.readyPath) {
    app.get(config.combinedPath, async (req, res) => {
      try {
        applyHealthHeaders(res);
        const status = await healthManager.getStatus();
        const statusCode = status.readiness.ready ? 200 : 503;
        return res.status(statusCode).json(status);
      } catch (err) {
        return res.status(503).json({ status: 'error', error: err.message });
      }
    });
  }

  // Decorate app for programmatic inspection
  app.healthManager = healthManager;
  app.getHealthStatus = () => healthManager.getStatus();

  // Attach cleanup to shutdownManager
  if (serverContext.shutdownManager && typeof serverContext.shutdownManager.onShutdown === 'function') {
    serverContext.shutdownManager.onShutdown(() => {
      healthManager.destroy();
    });
  }

  return healthManager;
}

module.exports = {
  createHealthManager,
  setupHealthMiddleware,
};
