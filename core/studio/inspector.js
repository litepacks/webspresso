'use strict';

/**
 * Webspresso DB Studio Schema & Query Inspector
 * Provides dialect-agnostic metadata extraction and CRUD operations for SQLite, Postgres, MySQL
 * @module core/studio/inspector
 */

/**
 * Detect database dialect from knex client
 * @param {import('knex').Knex} knex
 * @returns {'sqlite'|'postgres'|'mysql'|'other'}
 */
function getDialect(knex) {
  const client = knex.client?.dialect || knex.client?.config?.client || '';
  const str = String(client).toLowerCase();
  if (str.includes('sqlite') || str.includes('d1')) return 'sqlite';
  if (str.includes('pg') || str.includes('postgres')) return 'postgres';
  if (str.includes('mysql') || str.includes('mariadb')) return 'mysql';
  return 'sqlite';
}

/**
 * Lists all user tables and row counts in the database
 * @param {import('knex').Knex} knex
 * @returns {Promise<Array<{ name: string, count: number }>>}
 */
async function listTables(knex) {
  const dialect = getDialect(knex);
  let tableNames = [];

  if (dialect === 'sqlite') {
    const rows = await knex.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_knex%' AND name NOT LIKE 'knex_%' ORDER BY name ASC"
    );
    const list = Array.isArray(rows) ? rows : (rows.rows || rows.results || []);
    tableNames = list.map((r) => r.name || r.NAME);
  } else if (dialect === 'postgres') {
    const rows = await knex.raw(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE 'knex_%' ORDER BY table_name ASC"
    );
    const list = rows.rows || [];
    tableNames = list.map((r) => r.table_name);
  } else {
    // MySQL or fallback
    const rows = await knex.raw('SHOW TABLES');
    const list = Array.isArray(rows[0]) ? rows[0] : (rows.rows || rows);
    tableNames = list.map((r) => Object.values(r)[0]);
  }

  const tablesWithCounts = [];
  for (const name of tableNames) {
    let count = 0;
    try {
      const cRes = await knex(name).count({ c: '*' });
      count = Number(cRes[0]?.c || cRes[0]?.count || 0);
    } catch (_) {
      count = 0;
    }
    tablesWithCounts.push({ name, count });
  }

  return tablesWithCounts;
}

/**
 * Gets column metadata for a given table
 * @param {import('knex').Knex} knex
 * @param {string} tableName
 * @returns {Promise<Array<{ name: string, type: string, nullable: boolean, defaultValue: any, isPrimaryKey: boolean }>>}
 */
async function getTableSchema(knex, tableName) {
  const dialect = getDialect(knex);

  if (dialect === 'sqlite') {
    const rawInfo = await knex.raw(`PRAGMA table_info("${tableName}")`);
    const cols = Array.isArray(rawInfo) ? rawInfo : (rawInfo.rows || rawInfo.results || []);
    return cols.map((c) => ({
      name: c.name,
      type: (c.type || 'TEXT').toLowerCase(),
      nullable: c.notnull === 0,
      defaultValue: c.dflt_value,
      isPrimaryKey: Boolean(c.pk > 0),
    }));
  }

  if (dialect === 'postgres') {
    const res = await knex.raw(
      `SELECT column_name, data_type, is_nullable, column_default 
       FROM information_schema.columns 
       WHERE table_schema = 'public' AND table_name = ?
       ORDER BY ordinal_position ASC`,
      [tableName]
    );
    const pkRes = await knex.raw(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = ?`,
      [tableName]
    );
    const pkCols = new Set((pkRes.rows || []).map((r) => r.column_name));
    return (res.rows || []).map((c) => ({
      name: c.column_name,
      type: c.data_type.toLowerCase(),
      nullable: c.is_nullable === 'YES',
      defaultValue: c.column_default,
      isPrimaryKey: pkCols.has(c.column_name),
    }));
  }

  // Fallback knex columnInfo
  const info = await knex(tableName).columnInfo();
  return Object.entries(info).map(([name, meta]) => ({
    name,
    type: meta.type || 'string',
    nullable: meta.nullable,
    defaultValue: meta.defaultValue,
    isPrimaryKey: name === 'id',
  }));
}

/**
 * Fetches paginated rows with filtering and sorting
 * @param {import('knex').Knex} knex
 * @param {string} tableName
 * @param {Object} [options]
 * @returns {Promise<{ rows: Array<any>, total: number, page: number, limit: number, totalPages: number }>}
 */
async function getTableRows(knex, tableName, options = {}) {
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(options.limit, 10) || 25));
  const offset = (page - 1) * limit;
  const sort = options.sort;
  const order = options.order === 'desc' ? 'desc' : 'asc';
  const search = options.search ? String(options.search).trim() : '';

  let query = knex(tableName);

  if (search) {
    const cols = await getTableSchema(knex, tableName);
    const textCols = cols.filter((c) =>
      ['text', 'varchar', 'char', 'string'].some((t) => c.type.includes(t))
    );
    if (textCols.length > 0) {
      query = query.where((builder) => {
        textCols.forEach((col, idx) => {
          if (idx === 0) {
            builder.where(col.name, 'like', `%${search}%`);
          } else {
            builder.orWhere(col.name, 'like', `%${search}%`);
          }
        });
      });
    }
  }

  const countQuery = query.clone();
  const cRes = await countQuery.count({ c: '*' });
  const total = Number(cRes[0]?.c || cRes[0]?.count || 0);

  if (sort) {
    query = query.orderBy(sort, order);
  }

  const rows = await query.limit(limit).offset(offset);
  const totalPages = Math.ceil(total / limit) || 1;

  return {
    rows,
    total,
    page,
    limit,
    totalPages,
  };
}

/**
 * Insert a new record
 * @param {import('knex').Knex} knex
 * @param {string} tableName
 * @param {Object} data
 * @returns {Promise<any>}
 */
async function insertRow(knex, tableName, data) {
  const res = await knex(tableName).insert(data);
  return { success: true, result: res };
}

/**
 * Update an existing record
 * @param {import('knex').Knex} knex
 * @param {string} tableName
 * @param {string|number} id
 * @param {Object} data
 * @param {string} [pkField='id']
 * @returns {Promise<any>}
 */
async function updateRow(knex, tableName, id, data, pkField = 'id') {
  const count = await knex(tableName).where(pkField, id).update(data);
  return { success: true, updated: count };
}

/**
 * Delete a record
 * @param {import('knex').Knex} knex
 * @param {string} tableName
 * @param {string|number} id
 * @param {string} [pkField='id']
 * @returns {Promise<any>}
 */
async function deleteRow(knex, tableName, id, pkField = 'id') {
  const count = await knex(tableName).where(pkField, id).delete();
  return { success: true, deleted: count };
}

/**
 * Execute raw SQL query with execution timing
 * @param {import('knex').Knex} knex
 * @param {string} sql
 * @param {Array<any>} [bindings=[]]
 * @returns {Promise<{ rows: Array<any>, durationMs: number, changes?: number }>}
 */
async function executeRawQuery(knex, sql, bindings = []) {
  const start = Date.now();
  const rawRes = await knex.raw(sql, bindings);
  const durationMs = Date.now() - start;

  let rows = [];
  if (Array.isArray(rawRes)) {
    rows = rawRes;
  } else if (rawRes && Array.isArray(rawRes.rows)) {
    rows = rawRes.rows;
  } else if (rawRes && Array.isArray(rawRes.results)) {
    rows = rawRes.results;
  } else if (rawRes && typeof rawRes === 'object') {
    rows = [rawRes];
  }

  return {
    rows,
    durationMs,
    changes: rawRes?.meta?.changes || rawRes?.rowCount,
  };
}

module.exports = {
  getDialect,
  listTables,
  getTableSchema,
  getTableRows,
  insertRow,
  updateRow,
  deleteRow,
  executeRawQuery,
};
