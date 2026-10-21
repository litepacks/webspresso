/**
 * Webspresso Cloud Metrics & Distributed Tracing Module
 * Zero-dependency: In-memory Prometheus exposition engine (/metrics),
 * request latency histograms, event loop lag telemetries, and W3C trace propagation.
 *
 * @module core/metrics
 */

'use strict';

const {
  MetricsRegistry,
  createMetricsRegistry,
  Counter,
  Gauge,
  Histogram,
} = require('./registry');

const {
  collectSystemMetrics,
  collectDatabaseMetrics,
  collectCacheMetrics,
  collectResilienceMetrics,
} = require('./collectors');

const {
  normalizeMetricsConfig,
  createMetricsManager,
  setupMetricsMiddleware,
} = require('./middleware');

module.exports = {
  MetricsRegistry,
  createMetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  collectSystemMetrics,
  collectDatabaseMetrics,
  collectCacheMetrics,
  collectResilienceMetrics,
  normalizeMetricsConfig,
  createMetricsManager,
  setupMetricsMiddleware,
};
