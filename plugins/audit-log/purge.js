/**
 * Delete audit log rows older than a cutoff
 * @module plugins/audit-log/purge
 */

'use strict';

/**
 * @param {import('knex').Knex} knex
 * @param {Object} [options={}]
 * @param {string} [options.tableName='audit_logs']
 * @param {Date|string|number} [options.olderThan] - Rows with created_at strictly before this are removed
 * @param {number} [options.days] - Number of days of audit logs to keep
 * @param {number} [options.retentionDays=90] - Alias for days
 * @returns {Promise<number>} Deleted row count
 */
async function purgeAuditLogs(knex, options = {}) {
  if (!knex) {
    throw new Error('purgeAuditLogs requires a database (knex) instance');
  }

  const tableName = options.tableName || 'audit_logs';

  let olderThan;
  if (options.olderThan !== undefined) {
    olderThan = options.olderThan instanceof Date
      ? options.olderThan
      : new Date(options.olderThan);

    if (Number.isNaN(olderThan.getTime())) {
      throw new Error('purgeAuditLogs: invalid olderThan date');
    }
  } else {
    const rawDays = options.days !== undefined ? options.days : (options.retentionDays !== undefined ? options.retentionDays : 90);
    const days = typeof rawDays === 'number' ? rawDays : Number(rawDays);
    if (Number.isNaN(days) || days <= 0) {
      throw new Error('purgeAuditLogs: days must be a positive number');
    }
    olderThan = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  let hasTable = true;
  if (knex.schema && typeof knex.schema.hasTable === 'function') {
    try {
      hasTable = await knex.schema.hasTable(tableName);
    } catch {
      hasTable = false;
    }
  }

  if (!hasTable) {
    return 0;
  }

  const client = knex?.client?.config?.client;
  const isSqlite = client === 'sqlite3' || client === 'better-sqlite3';

  let query = knex(tableName);
  if (isSqlite) {
    const iso = olderThan.toISOString();
    const cutoffMs = olderThan.getTime();
    query = query.where((builder) => {
      builder.whereRaw(
        "((typeof(created_at) = 'integer' and created_at < ?) or (typeof(created_at) = 'text' and created_at < ?))",
        [cutoffMs, iso]
      );
    });
  } else {
    query = query.where('created_at', '<', olderThan);
  }

  const deleted = await query.delete();
  return Number(deleted) || 0;
}

module.exports = {
  purgeAuditLogs,
};
