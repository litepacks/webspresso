/**
 * Delete audit log rows older than a cutoff
 * @module plugins/audit-log/purge
 */

/**
 * @param {import('knex').Knex} knex
 * @param {Object} options
 * @param {string} [options.tableName='audit_logs']
 * @param {Date|string} options.olderThan - Rows with created_at strictly before this are removed
 * @returns {Promise<number>} Deleted row count (driver-dependent; 0 if unknown)
 */
async function purgeAuditLogs(knex, options) {
  const tableName = options.tableName || 'audit_logs';
  const olderThan = options.olderThan instanceof Date
    ? options.olderThan
    : new Date(options.olderThan);

  if (Number.isNaN(olderThan.getTime())) {
    throw new Error('purgeAuditLogs: invalid olderThan date');
  }

  return knex(tableName).where('created_at', '<', olderThan).delete();
}

module.exports = {
  purgeAuditLogs,
};
