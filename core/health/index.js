'use strict';

/**
 * Webspresso Health & Readiness Probes Module
 * Kubernetes, Docker & Cloud-ready liveness (/healthz), readiness (/readyz),
 * and diagnostics endpoints with database pings, queue stats, and graceful draining integration.
 *
 * @module core/health
 */

const {
  DEFAULT_HEALTH_CONFIG,
  normalizeHealthConfig,
} = require('./normalize');

const {
  formatMb,
  createEventLoopMonitor,
  getSystemMetrics,
  probeDatabase,
  probeQueue,
  probeCustomChecks,
} = require('./probes');

const {
  createHealthManager,
  setupHealthMiddleware,
} = require('./middleware');

module.exports = {
  DEFAULT_HEALTH_CONFIG,
  normalizeHealthConfig,
  formatMb,
  createEventLoopMonitor,
  getSystemMetrics,
  probeDatabase,
  probeQueue,
  probeCustomChecks,
  createHealthManager,
  setupHealthMiddleware,
};
