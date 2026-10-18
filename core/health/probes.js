'use strict';

/**
 * Webspresso System & Component Health Probes
 * Gathers system metrics (uptime, memory, event loop delay),
 * tests database and queue availability, and runs user-defined health probes.
 *
 * @module core/health/probes
 */

const { monitorEventLoopDelay } = require('perf_hooks');

/**
 * Formats bytes to human-readable megabytes
 * @param {number} bytes
 * @returns {string}
 */
function formatMb(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes)) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Creates an event loop delay monitor
 * @returns {{ getStats: () => Object, destroy: () => void }|null}
 */
function createEventLoopMonitor() {
  try {
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();

    return {
      getStats() {
        const meanNs = histogram.mean || 0;
        const maxNs = histogram.max || 0;
        const p50Ns = histogram.percentile ? histogram.percentile(50) : 0;
        const p99Ns = histogram.percentile ? histogram.percentile(99) : 0;

        return {
          meanMs: Math.round((meanNs / 1e6) * 100) / 100,
          maxMs: Math.round((maxNs / 1e6) * 100) / 100,
          p50Ms: Math.round((p50Ns / 1e6) * 100) / 100,
          p99Ms: Math.round((p99Ns / 1e6) * 100) / 100,
        };
      },
      destroy() {
        try {
          histogram.disable();
        } catch {}
      },
    };
  } catch {
    return null;
  }
}

/**
 * Collects runtime system health metrics
 * @param {Object} [monitor] - Event loop monitor instance
 * @returns {Object}
 */
function getSystemMetrics(monitor = null) {
  const mem = process.memoryUsage();
  const uptimeSeconds = Math.floor(process.uptime());

  const metrics = {
    uptimeSeconds,
    memory: {
      rss: formatMb(mem.rss),
      heapUsed: formatMb(mem.heapUsed),
      heapTotal: formatMb(mem.heapTotal),
      external: formatMb(mem.external),
      bytes: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
    },
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
  };

  if (monitor && typeof monitor.getStats === 'function') {
    metrics.eventLoopLag = monitor.getStats();
  }

  return metrics;
}

/**
 * Safely probes database connectivity with timeout
 * @param {Object} db - Webspresso database instance
 * @param {number} [timeoutMs=3000] - Timeout in milliseconds
 * @returns {Promise<{ status: 'up'|'down'|'skipped', latencyMs?: number, error?: string }>}
 */
async function probeDatabase(db, timeoutMs = 3000) {
  if (!db) {
    return { status: 'skipped', message: 'No database configured' };
  }

  const knex = db.knex || db;
  if (!knex || typeof knex.raw !== 'function') {
    return { status: 'up', message: 'Custom database without raw ping' };
  }

  const startTime = Date.now();
  let timer = null;

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Database ping timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([knex.raw('SELECT 1'), timeoutPromise]);
    const latencyMs = Date.now() - startTime;
    return { status: 'up', latencyMs };
  } catch (err) {
    return { status: 'down', error: err.message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Probes background worker queue readiness
 * @param {Object} queue - Queue instance
 * @returns {Promise<{ status: 'up'|'down'|'skipped', stats?: Object, error?: string }>}
 */
async function probeQueue(queue) {
  if (!queue) {
    return { status: 'skipped', message: 'No queue configured' };
  }

  try {
    if (typeof queue.getStats === 'function') {
      const stats = await queue.getStats();
      return { status: 'up', stats };
    }
    if (typeof queue.isReady === 'boolean') {
      return { status: queue.isReady ? 'up' : 'down' };
    }
    return { status: 'up' };
  } catch (err) {
    return { status: 'down', error: err.message };
  }
}

/**
 * Runs user-registered custom health checks concurrently
 * @param {Record<string, Function>} checks - Map of named probe functions
 * @param {Object} context - Server context
 * @param {number} [timeoutMs=3000] - Timeout per probe
 * @returns {Promise<{ isHealthy: boolean, results: Record<string, Object> }>}
 */
async function probeCustomChecks(checks = {}, context = {}, timeoutMs = 3000) {
  const entries = Object.entries(checks);
  if (entries.length === 0) {
    return { isHealthy: true, results: {} };
  }

  const results = {};
  let isHealthy = true;

  const promises = entries.map(async ([name, checkFn]) => {
    let timer = null;
    const startTime = Date.now();
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Health check "${name}" timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const res = await Promise.race([Promise.resolve(checkFn(context)), timeoutPromise]);
      const latencyMs = Date.now() - startTime;

      if (res === false || (res && typeof res === 'object' && res.status === 'down')) {
        isHealthy = false;
        results[name] = { status: 'down', latencyMs, ...(typeof res === 'object' ? res : {}) };
      } else {
        results[name] = { status: 'up', latencyMs, ...(typeof res === 'object' ? res : {}) };
      }
    } catch (err) {
      isHealthy = false;
      results[name] = { status: 'down', error: err.message };
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  await Promise.all(promises);
  return { isHealthy, results };
}

module.exports = {
  formatMb,
  createEventLoopMonitor,
  getSystemMetrics,
  probeDatabase,
  probeQueue,
  probeCustomChecks,
};
