'use strict';

/**
 * Webspresso ORM - Cloudflare D1 Native Dialect & Client
 * Zero-dependency native bridge between Knex and Cloudflare D1 (Edge SQLite)
 * @module core/orm/d1
 */

let Client_SQLite3 = null;
function getSQLite3Client() {
  if (!Client_SQLite3) {
    try {
      Client_SQLite3 = require('knex/lib/dialects/sqlite3');
    } catch {
      throw new Error('Knex SQLite dialect is required for Cloudflare D1. Make sure knex is installed.');
    }
  }
  return Client_SQLite3;
}

/**
 * Custom Knex Client for Cloudflare D1
 */
class Client_D1 extends (getSQLite3Client()) {
  constructor(config = {}) {
    const clientConfig = {
      ...config,
      connection: {
        filename: ':memory:',
        ...(config.connection || {}),
      },
    };
    super(clientConfig);
    this.driver = config.d1 || config.connection?.d1;
    this.driverName = 'd1';
  }

  _driver() {
    return this.driver;
  }

  acquireRawConnection() {
    return Promise.resolve(this.driver);
  }

  destroyRawConnection() {
    return Promise.resolve();
  }

  validateConnection() {
    return Promise.resolve(true);
  }

  /**
   * Executes a compiled Knex query against Cloudflare D1
   * @param {Object} connection - D1 Database instance
   * @param {Object} obj - Knex query descriptor
   * @returns {Promise<Object>}
   */
  async _query(connection, obj) {
    if (!obj.sql) {
      throw new Error('The query is empty');
    }

    if (!connection || typeof connection.prepare !== 'function') {
      throw new Error('Cloudflare D1 database connection is not available or missing .prepare() method.');
    }

    // Normalize bindings for SQLite/D1 compatibility (Dates to ISO string, Booleans to 1/0)
    const normalizedBindings = normalizeD1Bindings(obj.bindings);

    const stmt = connection.prepare(obj.sql).bind(...normalizedBindings);
    const { method, returning } = obj;

    // 1. Returning statements (e.g. INSERT ... RETURNING id)
    if (returning) {
      const result = await stmt.all();
      obj.response = result.results || [];
      obj.context = {
        lastID: result.meta?.last_row_id,
        changes: result.meta?.changes,
      };
      return obj;
    }

    // 2. Mutations without RETURNING (insert, update, delete, counter)
    if (method === 'insert' || method === 'update' || method === 'del' || method === 'counter') {
      const result = await stmt.run();
      obj.response = result;
      obj.context = {
        lastID: result.meta?.last_row_id,
        changes: result.meta?.changes,
      };
      return obj;
    }

    // 3. Queries (select, pluck, first)
    const result = await stmt.all();
    obj.response = result.results || [];
    obj.context = {
      lastID: result.meta?.last_row_id,
      changes: result.meta?.changes,
    };
    return obj;
  }
}

/**
 * Normalizes parameter bindings for SQLite / D1 compatibility
 * @param {Array<any>} [rawBindings=[]]
 * @returns {Array<any>}
 */
function normalizeD1Bindings(rawBindings = []) {
  if (!Array.isArray(rawBindings)) return [];
  return rawBindings.map((val) => {
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (val === undefined) return null;
    return val;
  });
}

/**
 * Execute multiple queries atomically in a single Cloudflare D1 batch call
 * @param {Object} d1Database - Cloudflare D1 Database binding
 * @param {Array<any>|Function} queriesOrCallback - Array of queries or builder callback
 * @returns {Promise<Array<any>>}
 */
async function executeD1Batch(d1Database, queriesOrCallback) {
  if (!d1Database || typeof d1Database.batch !== 'function') {
    throw new Error('[executeD1Batch] Cloudflare D1 Database instance with .batch() method is required.');
  }

  let queryList = [];
  if (typeof queriesOrCallback === 'function') {
    const collector = [];
    const batchProxy = {
      add(q) {
        collector.push(q);
        return batchProxy;
      },
      raw(sql, bindings = []) {
        collector.push({ sql, bindings });
        return batchProxy;
      },
    };
    const res = await queriesOrCallback(batchProxy);
    queryList = Array.isArray(res) ? res : collector;
  } else if (Array.isArray(queriesOrCallback)) {
    queryList = queriesOrCallback;
  } else if (queriesOrCallback) {
    queryList = [queriesOrCallback];
  }

  if (queryList.length === 0) {
    return [];
  }

  const statements = [];
  const metaDescriptors = [];

  for (const item of queryList) {
    let sql = '';
    let bindings = [];
    let method = 'select';

    if (item && typeof item.toSQL === 'function') {
      const sqlObj = item.toSQL();
      sql = sqlObj.sql;
      bindings = sqlObj.bindings || [];
      method = sqlObj.method || 'select';
    } else if (item && typeof item.toKnex === 'function') {
      const sqlObj = item.toKnex().toSQL();
      sql = sqlObj.sql;
      bindings = sqlObj.bindings || [];
      method = sqlObj.method || 'select';
    } else if (typeof item === 'string') {
      sql = item;
      method = item.trim().split(/\s+/)[0].toLowerCase();
    } else if (item && typeof item === 'object') {
      // Check if already a prepared D1 statement (duck-typed)
      if (typeof item.bind === 'function' || (typeof item.all === 'function' && typeof item.run === 'function')) {
        statements.push(item);
        metaDescriptors.push({ isRawStmt: true });
        continue;
      }
      sql = item.sql || '';
      bindings = item.bindings || item.params || [];
      method = item.method || (sql ? sql.trim().split(/\s+/)[0].toLowerCase() : 'select');
    }

    if (!sql) {
      throw new Error('[executeD1Batch] Invalid query passed to batch: query has no SQL string.');
    }

    const normBindings = normalizeD1Bindings(bindings);
    const stmt = d1Database.prepare(sql).bind(...normBindings);
    statements.push(stmt);
    metaDescriptors.push({ method, sql });
  }

  const batchResults = await d1Database.batch(statements);

  return batchResults.map((res, idx) => {
    const meta = metaDescriptors[idx];
    if (meta?.isRawStmt) return res;

    const isSelect = meta?.method === 'select' || /^select/i.test(meta?.sql || '');
    if (isSelect) {
      return res.results || [];
    }

    const hasReturning = /returning/i.test(meta?.sql || '');
    if (hasReturning) {
      return res.results || [];
    }

    return {
      success: Boolean(res.success !== false),
      changes: res.meta?.changes !== undefined ? res.meta.changes : 0,
      lastID: res.meta?.last_row_id,
    };
  });
}

/**
 * Factory to create a Knex instance configured for Cloudflare D1
 * @param {Object} d1Database - Cloudflare D1 Database binding (env.DB)
 * @param {Object} [options={}] - Additional Knex configuration options
 * @returns {import('knex').Knex}
 */
function createD1Knex(d1Database, options = {}) {
  let knex;
  try {
    knex = require('knex');
  } catch {
    throw new Error('Knex is required for Cloudflare D1 ORM. Install it with: npm install knex');
  }

  const { d1: _d1, client: _client, connection: userConn, ...restOptions } = options;

  const instance = knex({
    client: Client_D1,
    connection: {
      d1: d1Database,
      filename: ':memory:',
      ...(userConn || {}),
    },
    d1: d1Database,
    useNullAsDefault: true,
    ...restOptions,
  });

  // Attach atomic batch helper directly to the Knex instance
  instance.batch = (queriesOrCallback) => executeD1Batch(d1Database, queriesOrCallback);

  return instance;
}

module.exports = {
  Client_D1,
  createD1Knex,
  normalizeD1Bindings,
  executeD1Batch,
};
