'use strict';

/**
 * Webspresso DB Studio HTTP Server
 * Serves the Studio UI and provides REST APIs for database management
 * @module core/studio/server
 */

const http = require('http');
const express = require('express');
const { spawn } = require('child_process');
const {
  listTables,
  getTableSchema,
  getTableRows,
  insertRow,
  updateRow,
  deleteRow,
  executeRawQuery,
} = require('./inspector');
const { renderStudioHtml } = require('./ui');

/**
 * Creates the Studio Express application instance
 * @param {Object} options
 * @param {import('knex').Knex} options.knex
 * @returns {import('express').Express}
 */
function createStudioApp(options = {}) {
  const knex = options.knex || (options.db ? options.db.knex : null);
  if (!knex) {
    throw new Error('[DB Studio] Knex instance is required to start Studio.');
  }

  const app = express();
  app.use(express.json());

  // UI routes
  const handleHtml = (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderStudioHtml());
  };

  app.get('/', handleHtml);
  app.get('/_studio', handleHtml);

  // API routes
  app.get('/_studio/api/tables', async (req, res, next) => {
    try {
      const tables = await listTables(knex);
      res.json(tables);
    } catch (err) {
      next(err);
    }
  });

  app.get('/_studio/api/tables/:table/schema', async (req, res, next) => {
    try {
      const schema = await getTableSchema(knex, req.params.table);
      res.json(schema);
    } catch (err) {
      next(err);
    }
  });

  app.get('/_studio/api/tables/:table/rows', async (req, res, next) => {
    try {
      const result = await getTableRows(knex, req.params.table, req.query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/_studio/api/tables/:table/rows', async (req, res, next) => {
    try {
      const result = await insertRow(knex, req.params.table, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.put('/_studio/api/tables/:table/rows/:id', async (req, res, next) => {
    try {
      const pkField = req.query.pk || 'id';
      const result = await updateRow(knex, req.params.table, req.params.id, req.body, pkField);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/_studio/api/tables/:table/rows/:id', async (req, res, next) => {
    try {
      const pkField = req.query.pk || 'id';
      const result = await deleteRow(knex, req.params.table, req.params.id, pkField);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/_studio/api/query', async (req, res, next) => {
    try {
      const { sql, bindings = [] } = req.body || {};
      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({ error: 'SQL query string is required.' });
      }
      if (!Array.isArray(bindings)) {
        return res.status(400).json({ error: 'Bindings must be an array.' });
      }
      const result = await executeRawQuery(knex, sql, bindings);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Telemetry & Metrics
  app.get('/_studio/api/telemetry', async (req, res, next) => {
    try {
      const data = await getTelemetrySnapshot(knex, options);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // Server-Sent Events (SSE) Live Telemetry Stream
  app.get('/_studio/api/live', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const sendData = async () => {
      try {
        const snapshot = await getTelemetrySnapshot(knex, options);
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      } catch (_) {}
    };

    await sendData();
    const timer = setInterval(sendData, 1500);

    req.on('close', () => {
      clearInterval(timer);
    });
  });

  // Circuit Breaker reset action
  app.post('/_studio/api/breakers/:name/reset', (req, res) => {
    try {
      const { circuitBreakerRegistry } = require('../resilience');
      const { name } = req.params;
      if (circuitBreakerRegistry.hasBreaker(name)) {
        const breaker = circuitBreakerRegistry.getBreaker(name);
        breaker.reset();
        return res.json({ success: true, name, state: 'CLOSED' });
      }
      return res.status(404).json({ error: `Breaker '${name}' not found.` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Background Queue actions
  app.post('/_studio/api/queue/:action', async (req, res) => {
    const queueManager = options.queue || (options.app && options.app.queue);
    if (!queueManager) {
      return res.status(400).json({ error: 'Queue is not configured.' });
    }
    const { action } = req.params;
    if (action === 'pause' && typeof queueManager.pause === 'function') {
      queueManager.pause();
      return res.json({ success: true, isPaused: true });
    }
    if (action === 'resume' && typeof queueManager.resume === 'function') {
      queueManager.resume();
      return res.json({ success: true, isPaused: false });
    }
    return res.status(400).json({ error: `Unknown queue action: ${action}` });
  });

  // Central error handler
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

/**
 * Collects runtime telemetry snapshot (memory, DB pool, circuit breakers, queue)
 * @param {import('knex').Knex} knex
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function getTelemetrySnapshot(knex, options = {}) {
  const mem = process.memoryUsage();
  const memory = {
    rssMb: +(mem.rss / (1024 * 1024)).toFixed(2),
    heapUsedMb: +(mem.heapUsed / (1024 * 1024)).toFixed(2),
    heapTotalMb: +(mem.heapTotal / (1024 * 1024)).toFixed(2),
    externalMb: +(mem.external / (1024 * 1024)).toFixed(2),
  };

  const poolObj = knex && knex.client ? knex.client.pool : null;
  const pool = {
    client: (knex && knex.client && (knex.client.dialect || (knex.client.config && knex.client.config.client))) || 'unknown',
    used: poolObj && typeof poolObj.numUsed === 'function' ? poolObj.numUsed() : 0,
    free: poolObj && typeof poolObj.numFree === 'function' ? poolObj.numFree() : 0,
    pending: poolObj && typeof poolObj.numPendingAcquires === 'function' ? poolObj.numPendingAcquires() : 0,
  };

  // Circuit Breakers
  let breakers = [];
  try {
    const { circuitBreakerRegistry } = require('../resilience');
    const stats = circuitBreakerRegistry.getStats();
    breakers = Object.entries(stats).map(([name, s]) => ({
      name,
      state: s.state || 'CLOSED',
      failures: s.failures || 0,
      successes: s.successes || 0,
      totalCalls: s.totalCalls || 0,
      failureRate: s.failureRate || 0,
      lastFailureTime: s.lastFailureTime || null,
    }));
  } catch (_) {}

  // Queue stats
  let queue = { enabled: false };
  const queueManager = options.queue || (options.app && options.app.queue);
  if (queueManager && typeof queueManager.getStats === 'function') {
    try {
      const qStats = await queueManager.getStats();
      queue = {
        enabled: true,
        ...qStats,
      };
    } catch (_) {
      queue = { enabled: true, error: 'Failed to fetch queue stats' };
    }
  }

  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    pid: process.pid,
    memory,
    pool,
    breakers,
    queue,
  };
}

/**
 * Attempts to open URL in user's default browser
 * @param {string} url
 */
function openBrowser(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return;
    }
    if (!/^[a-zA-Z0-9.:/?#\[\]@!$&'()*+,;=-]+$/.test(url)) {
      return;
    }
  } catch (_) {
    return;
  }

  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
      spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (_) {}
}

/**
 * Starts the Webspresso DB Studio server
 * @param {Object} options
 * @param {import('knex').Knex} [options.knex]
 * @param {Object} [options.db]
 * @param {number} [options.port=4567]
 * @param {string} [options.host='127.0.0.1']
 * @param {boolean} [options.open=false]
 * @param {boolean} [options.silent=false]
 * @returns {Promise<{ server: import('http').Server, url: string, close: () => Promise<void> }>}
 */
async function startStudio(options = {}) {
  const app = createStudioApp(options);
  const server = http.createServer(app);
  const host = options.host || '127.0.0.1';
  const port = options.port !== undefined ? options.port : 4567;
  const silent = options.silent === true;
  const shouldOpen = options.open === true;

  await new Promise((resolve, reject) => {
    server.listen(port, host, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const actualPort = server.address().port;
  const url = `http://${host}:${actualPort}`;

  if (!silent) {
    console.log(`\n🔍 Webspresso DB Studio running at: ${url}`);
    console.log(`   Press Ctrl+C to stop.\n`);
  }

  if (shouldOpen) {
    openBrowser(url);
  }

  return {
    server,
    url,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = {
  createStudioApp,
  startStudio,
  openBrowser,
  getTelemetrySnapshot,
};
