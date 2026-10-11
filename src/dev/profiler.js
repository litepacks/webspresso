'use strict';

/**
 * Webspresso Development HTTP & Database Query Profiler
 * AsyncLocalStorage-powered per-request database query tracking and N+1 query detection
 * @module src/dev/profiler
 */

const { AsyncLocalStorage } = require('async_hooks');
const { colors: defaultColors, stripAnsi } = require('./colors');

// Ambient request storage for profiling queries executed during an HTTP request
const profilerStorage = new AsyncLocalStorage();

// Internal tables to ignore when calculating N+1 warnings
const IGNORED_SYSTEM_TABLES = new Set([
  'sqlite_master',
  'sqlite_sequence',
  'sqlite_temp_master',
  'knex_migrations',
  'knex_migrations_lock',
  'information_schema',
  'pg_catalog',
  'spatial_ref_sys',
]);

/**
 * Robustly extracts the primary target table name from an SQL query string
 * @param {string} sql
 * @returns {string|null} Table name, or null if unparseable
 */
function extractTableFromSql(sql) {
  if (!sql || typeof sql !== 'string') return null;
  const cleaned = sql.replace(/\s+/g, ' ').trim();

  // 1. SELECT ... FROM [schema.]table
  const fromMatch = cleaned.match(/\bfrom\s+(?:(?:[`"']?([a-zA-Z0-9_]+)[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?)/i);
  if (fromMatch) {
    return fromMatch[2] || fromMatch[1];
  }

  // 2. INSERT INTO [schema.]table
  const intoMatch = cleaned.match(/\binto\s+(?:(?:[`"']?([a-zA-Z0-9_]+)[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?)/i);
  if (intoMatch) {
    return intoMatch[2] || intoMatch[1];
  }

  // 3. UPDATE [schema.]table
  const updateMatch = cleaned.match(/\bupdate\s+(?:(?:[`"']?([a-zA-Z0-9_]+)[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?)/i);
  if (updateMatch) {
    return updateMatch[2] || updateMatch[1];
  }

  // 4. DELETE FROM [schema.]table
  const deleteMatch = cleaned.match(/\bdelete\s+(?:from\s+)?(?:(?:[`"']?([a-zA-Z0-9_]+)[`"']?\.)?[`"']?([a-zA-Z0-9_]+)[`"']?)/i);
  if (deleteMatch) {
    return deleteMatch[2] || deleteMatch[1];
  }

  return null;
}

/**
 * Analyzes collected queries for potential N+1 anti-patterns
 * @param {Array<Object>} queries - List of executed query records
 * @param {Object} [options]
 * @param {number} [options.threshold=4] - Minimum repeated queries to trigger warning
 * @returns {Array<{ table: string, count: number, totalMs: number, recommendation: string, sampleSql: string }>}
 */
function detectNPlusOne(queries = [], options = {}) {
  const threshold = options.threshold ?? 4;
  if (!Array.isArray(queries) || queries.length < threshold) {
    return [];
  }

  const tableStats = new Map();

  for (const q of queries) {
    if (!q || !q.table) continue;
    const lower = q.table.toLowerCase();
    if (IGNORED_SYSTEM_TABLES.has(lower) || lower.startsWith('knex_')) {
      continue;
    }

    let stats = tableStats.get(lower);
    if (!stats) {
      stats = { table: q.table, count: 0, totalMs: 0, queries: [] };
      tableStats.set(lower, stats);
    }

    stats.count++;
    stats.totalMs += q.durationMs || 0;
    stats.queries.push(q);
  }

  const warnings = [];

  for (const [, stats] of tableStats) {
    if (stats.count >= threshold) {
      const roundedMs = Math.round(stats.totalMs * 100) / 100;
      warnings.push({
        table: stats.table,
        count: stats.count,
        totalMs: roundedMs,
        sampleSql: stats.queries[0]?.sql || '',
        recommendation: `Potential N+1 query pattern detected on table '${stats.table}' (${stats.count} queries in single request, ${roundedMs}ms). Consider eager loading with repo.query().include('${stats.table}') or batching.`,
      });
    }
  }

  return warnings;
}

/**
 * Formats a dev request log line with execution time, DB metrics, and optional query detail
 * @param {Object} params
 * @param {string} params.method
 * @param {string} params.url
 * @param {number} params.status
 * @param {number} params.durationMs
 * @param {Array<Object>} [params.queries]
 * @param {number} [params.slowQueryMs=50]
 * @param {boolean} [params.verbose=false]
 * @param {Object} [params.colors]
 * @returns {{ line: string, queryLines: string[], plainLine: string }}
 */
function formatRequestLog(params) {
  const {
    method = 'GET',
    url = '/',
    status = 200,
    durationMs = 0,
    queries = [],
    slowQueryMs = 50,
    verbose = false,
    colors = defaultColors,
  } = params;

  // 1. Method color
  let methodColored = method;
  const m = method.toUpperCase();
  if (m === 'GET') methodColored = colors.cyan(m);
  else if (m === 'POST') methodColored = colors.green(m);
  else if (m === 'PUT' || m === 'PATCH') methodColored = colors.yellow(m);
  else if (m === 'DELETE') methodColored = colors.red(m);
  else methodColored = colors.white(m);

  // 2. Status color
  let statusColored = String(status);
  if (status >= 500) statusColored = colors.red(String(status));
  else if (status >= 400) statusColored = colors.yellow(String(status));
  else if (status >= 300) statusColored = colors.cyan(String(status));
  else if (status >= 200) statusColored = colors.green(String(status));

  // 3. Duration color
  let durationColored = `${durationMs}ms`;
  if (durationMs > 500) durationColored = colors.red(durationColored);
  else if (durationMs > 150) durationColored = colors.yellow(durationColored);
  else durationColored = colors.gray(durationColored);

  // 4. DB Queries summary
  let dbSummary = '';
  const queryCount = queries.length;
  if (queryCount > 0) {
    const totalDbMs = Math.round(queries.reduce((acc, q) => acc + (q.durationMs || 0), 0) * 10) / 10;
    const slowQueries = queries.filter((q) => (q.durationMs || 0) >= slowQueryMs);
    const slowNote = slowQueries.length > 0 ? ` ${colors.yellow(`⚠️ ${slowQueries.length} slow >${slowQueryMs}ms`)}` : '';
    dbSummary = ` ${colors.gray('|')} ${colors.magenta(`${queryCount} DB ${queryCount === 1 ? 'query' : 'queries'}`)} ${colors.gray(`(${totalDbMs}ms${slowNote})`)}`;
  }

  const line = `[${methodColored} ${statusColored}] ${colors.bold(url)} ${colors.gray('—')} ${durationColored}${dbSummary}`;
  const plainLine = stripAnsi(line);

  // 5. Verbose query breakdown lines
  const queryLines = [];
  if (verbose && queryCount > 0) {
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const isSlow = (q.durationMs || 0) >= slowQueryMs;
      const msLabel = `${q.durationMs}ms`;
      const timeTag = isSlow ? colors.yellow(msLabel) : colors.gray(msLabel);
      const isLast = i === queries.length - 1;
      const branch = isLast ? '└─' : '├─';
      const cleanSql = (q.sql || '').replace(/\s+/g, ' ').slice(0, 120);
      queryLines.push(`   ${colors.gray(branch)} [DB ${timeTag}] ${colors.dim(cleanSql)}`);
    }
  }

  return { line, queryLines, plainLine };
}

/**
 * Attaches query instrumentation listeners to a Knex instance
 * @param {import('knex').Knex} knexInstance
 * @returns {void}
 */
function attachProfilerToKnex(knexInstance) {
  if (!knexInstance || typeof knexInstance.on !== 'function') return;
  if (knexInstance.__wsDevProfilerAttached) return;
  knexInstance.__wsDevProfilerAttached = true;

  const queryStarts = new Map();

  knexInstance.on('query', (queryData) => {
    if (queryData && queryData.__knexQueryUid) {
      queryStarts.set(queryData.__knexQueryUid, process.hrtime.bigint());
      // Self-cleaning bound to avoid memory leak if responses fail to fire
      if (queryStarts.size > 1000) {
        const oldestKey = queryStarts.keys().next().value;
        queryStarts.delete(oldestKey);
      }
    }
  });

  function recordQuery(queryData, isError, error) {
    const uid = queryData?.__knexQueryUid;
    const start = uid ? queryStarts.get(uid) : null;
    if (uid) queryStarts.delete(uid);

    let durationMs = 0;
    if (start) {
      const diff = process.hrtime.bigint() - start;
      durationMs = Number(diff) / 1e6;
    }

    const store = profilerStorage.getStore();
    if (store && Array.isArray(store.queries)) {
      const sql = queryData?.sql || '';
      store.queries.push({
        uid,
        sql,
        bindings: queryData?.bindings || [],
        durationMs: Math.round(durationMs * 100) / 100,
        table: extractTableFromSql(sql),
        isError: Boolean(isError),
        error: error ? error.message : null,
      });
    }
  }

  knexInstance.on('query-response', (response, queryData) => {
    recordQuery(queryData, false);
  });

  knexInstance.on('query-error', (error, queryData) => {
    recordQuery(queryData, true, error);
  });
}

/**
 * Creates Express middleware for dev request logging, DB query profiling, and N+1 detection
 * @param {Object} [options]
 * @param {Object} [options.db] - Knex/ORM database instance
 * @param {Object} [options.logger=console] - Output logger
 * @param {boolean} [options.detectNPlusOne=true] - Whether to detect and warn on N+1 queries
 * @param {number} [options.thresholdNPlusOne=4] - Threshold repeated queries
 * @param {number} [options.slowQueryMs=50] - Threshold for slow query warning
 * @param {boolean} [options.verbose=false] - Whether to print indented SQL queries
 * @param {boolean} [options.colors=true] - Whether to use ANSI colors
 * @returns {import('express').RequestHandler}
 */
function createDevProfilerMiddleware(options = {}) {
  const {
    db = null,
    logger = console,
    detectNPlusOne: shouldDetectNPlusOne = true,
    thresholdNPlusOne = 4,
    slowQueryMs = 50,
    verbose = false,
    colors: useColors = true,
  } = options;

  // Auto-instrument Knex instance if available
  if (db && db.knex) {
    attachProfilerToKnex(db.knex);
  }

  return function devProfilerMiddleware(req, res, next) {
    const startHr = process.hrtime.bigint();
    const requestId = (req.headers && req.headers['x-request-id'])
      ? String(req.headers['x-request-id'])
      : Math.random().toString(36).slice(2, 8);

    const store = {
      requestId,
      method: (req.method || 'GET').toUpperCase(),
      path: req.originalUrl || req.url || '/',
      queries: [],
    };

    // Expose profiler details on req object for inspection
    req.profiler = store;

    profilerStorage.run(store, () => {
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startHr) / 1e6;
        const roundedDuration = Math.round(durationMs * 10) / 10;
        const statusCode = res.statusCode || 200;

        const formatted = formatRequestLog({
          method: store.method,
          url: store.path,
          status: statusCode,
          durationMs: roundedDuration,
          queries: store.queries,
          slowQueryMs,
          verbose,
          colors: useColors ? defaultColors : {
            bold: (s) => s,
            dim: (s) => s,
            cyan: (s) => s,
            green: (s) => s,
            yellow: (s) => s,
            red: (s) => s,
            magenta: (s) => s,
            gray: (s) => s,
            white: (s) => s,
          },
        });

        if (logger && typeof logger.log === 'function') {
          logger.log(formatted.line);
          if (Array.isArray(formatted.queryLines) && formatted.queryLines.length > 0) {
            for (const ql of formatted.queryLines) {
              logger.log(ql);
            }
          }
        }

        // N+1 Query Warning Check
        if (shouldDetectNPlusOne && store.queries.length >= thresholdNPlusOne) {
          const warnings = detectNPlusOne(store.queries, { threshold: thresholdNPlusOne });
          for (const warn of warnings) {
            if (logger && typeof logger.warn === 'function') {
              const prefix = defaultColors.yellow('⚠️  [webspresso:n+1]');
              logger.warn(`   ${prefix} ${warn.recommendation}`);
            }
          }
        }
      });

      next();
    });
  };
}

module.exports = {
  profilerStorage,
  attachProfilerToKnex,
  extractTableFromSql,
  detectNPlusOne,
  formatRequestLog,
  createDevProfilerMiddleware,
};
