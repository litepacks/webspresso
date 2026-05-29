/**
 * Delete email log rows older than a cutoff
 * @module plugins/email/purge
 */

/**
 * @param {import('knex').Knex} knex
 * @param {Object} options
 * @param {string} [options.tableName='email_logs']
 * @param {Date|string} options.olderThan
 * @returns {Promise<number>}
 */
async function purgeEmailLogs(knex, options) {
  const tableName = options.tableName || 'email_logs';
  const olderThan = options.olderThan instanceof Date
    ? options.olderThan
    : new Date(options.olderThan);

  if (Number.isNaN(olderThan.getTime())) {
    throw new Error('purgeEmailLogs: invalid olderThan date');
  }

  return knex(tableName).where('created_at', '<', olderThan).delete();
}

module.exports = {
  purgeEmailLogs,
};
