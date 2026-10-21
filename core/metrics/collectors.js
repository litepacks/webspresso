/**
 * Standard System & Framework Metric Collectors for Webspresso
 * Collects runtime memory, CPU, event loop lag, Knex DB connection pool, cache, and circuit breakers.
 *
 * @module core/metrics/collectors
 */

'use strict';

const { createEventLoopMonitor } = require('../health/probes');

let globalEventLoopMonitor = null;
function getEventLoopMonitor() {
  if (!globalEventLoopMonitor) {
    globalEventLoopMonitor = createEventLoopMonitor();
  }
  return globalEventLoopMonitor;
}

/**
 * Collect Node.js process and system health metrics
 * @param {import('./registry').MetricsRegistry} registry
 */
function collectSystemMetrics(registry) {
  // 1. Process Uptime
  registry.gauge('process_uptime_seconds', 'The uptime of the process in seconds')
    .set(process.uptime());

  // 2. Memory Usage
  const mem = process.memoryUsage();
  registry.gauge('nodejs_heap_size_total_bytes', 'Process heap size total in bytes')
    .set(mem.heapTotal);
  registry.gauge('nodejs_heap_size_used_bytes', 'Process heap size used in bytes')
    .set(mem.heapUsed);
  registry.gauge('process_resident_memory_bytes', 'Resident memory size in bytes')
    .set(mem.rss);
  registry.gauge('nodejs_external_memory_bytes', 'Node.js external memory in bytes')
    .set(mem.external);

  // 3. CPU Usage
  if (typeof process.cpuUsage === 'function') {
    const cpu = process.cpuUsage();
    registry.gauge('process_cpu_user_seconds_total', 'Total user CPU time spent in seconds')
      .set(cpu.user / 1e6);
    registry.gauge('process_cpu_system_seconds_total', 'Total system CPU time spent in seconds')
      .set(cpu.system / 1e6);
  }

  // 4. Event Loop Lag
  const monitor = getEventLoopMonitor();
  if (monitor && typeof monitor.getStats === 'function') {
    const stats = monitor.getStats();
    const lagGauge = registry.gauge('nodejs_eventloop_lag_seconds', 'Event loop lag in seconds');
    lagGauge.set({ quantile: '0.50' }, (stats.p50Ms || 0) / 1000);
    lagGauge.set({ quantile: '0.99' }, (stats.p99Ms || 0) / 1000);
    lagGauge.set({ quantile: 'max' }, (stats.maxMs || 0) / 1000);
  }
}

/**
 * Collect database pool metrics from Knex
 * @param {import('./registry').MetricsRegistry} registry
 * @param {Object} [db]
 */
function collectDatabaseMetrics(registry, db) {
  if (!db || !db.knex || !db.knex.client || !db.knex.client.pool) return;

  const pool = db.knex.client.pool;
  try {
    const size = typeof pool.numUsed === 'function' ? (pool.numUsed() + (pool.numFree ? pool.numFree() : 0)) : 0;
    const used = typeof pool.numUsed === 'function' ? pool.numUsed() : 0;
    const available = typeof pool.numFree === 'function' ? pool.numFree() : 0;

    registry.gauge('webspresso_db_pool_size', 'Total database connection pool size').set(size);
    registry.gauge('webspresso_db_pool_used', 'Active database connections in use').set(used);
    registry.gauge('webspresso_db_pool_available', 'Available idle database connections').set(available);
  } catch (_) {}
}

/**
 * Collect in-memory cache metrics
 * @param {import('./registry').MetricsRegistry} registry
 * @param {Object} [cache]
 */
function collectCacheMetrics(registry, cache) {
  if (!cache || typeof cache.size !== 'number') return;

  registry.gauge('webspresso_cache_entries', 'Number of entries in in-memory cache')
    .set(cache.size);

  if (typeof cache.currentBytes === 'number') {
    registry.gauge('webspresso_cache_bytes', 'Total memory size consumed by cache in bytes')
      .set(cache.currentBytes);
  }
}

/**
 * Collect resilience / circuit breaker metrics
 * @param {import('./registry').MetricsRegistry} registry
 * @param {Object} [breakers]
 */
function collectResilienceMetrics(registry, breakers) {
  if (!breakers || !breakers.breakers) return;

  const stateGauge = registry.gauge('webspresso_circuit_breaker_state', 'Circuit breaker state (0=closed, 1=half-open, 2=open)');
  const failuresCounter = registry.counter('webspresso_circuit_breaker_failures_total', 'Total recorded circuit breaker failures');

  for (const [name, breaker] of breakers.breakers.entries()) {
    let stateVal = 0;
    if (breaker.state === 'HALF_OPEN') stateVal = 1;
    if (breaker.state === 'OPEN') stateVal = 2;

    stateGauge.set({ name }, stateVal);
    if (typeof breaker.failures === 'number') {
      failuresCounter.inc({ name }, breaker.failures);
    }
  }
}

module.exports = {
  collectSystemMetrics,
  collectDatabaseMetrics,
  collectCacheMetrics,
  collectResilienceMetrics,
};
