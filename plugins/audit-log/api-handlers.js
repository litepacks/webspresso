/**
 * Admin API handlers for audit log listing
 * @module plugins/audit-log/api-handlers
 */

const { purgeAuditLogs } = require('./purge');

/**
 * @param {Object} options
 * @param {import('knex').Knex} options.knex
 * @param {string} [options.tableName='audit_logs']
 */
function createAuditLogHandlers(options) {
  const knex = options.knex;
  const tableName = options.tableName || 'audit_logs';

  function applyFilters(qb, query) {
    if (query.model) {
      qb.where('resource_model', String(query.model));
    }
    if (query.action) {
      qb.where('action', String(query.action));
    }
    if (query.from) {
      qb.where('created_at', '>=', String(query.from));
    }
    if (query.to) {
      qb.where('created_at', '<=', String(query.to));
    }
  }

  async function listHandler(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage, 10) || 25));

      const countQ = knex(tableName).modify((qb) => applyFilters(qb, req.query));
      const countRow = await countQ.count('* as cnt').first();
      const total = Number(countRow?.cnt ?? Object.values(countRow || {})[0] ?? 0);

      const rows = await knex(tableName)
        .modify((qb) => applyFilters(qb, req.query))
        .orderBy('created_at', 'desc')
        .offset((page - 1) * perPage)
        .limit(perPage);

      res.json({
        data: rows,
        meta: { page, perPage, total },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function purgeHandler(req, res) {
    try {
      const body = req.body || {};
      const query = req.query || {};
      const rawDays = body.days !== undefined
        ? body.days
        : (body.retentionDays !== undefined ? body.retentionDays : (query.days !== undefined ? query.days : 90));
      const days = parseInt(rawDays, 10);
      if (Number.isNaN(days) || days < 1) {
        return res.status(400).json({ error: 'days must be a positive integer' });
      }

      const olderThan = body.olderThan
        ? new Date(body.olderThan)
        : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      if (Number.isNaN(olderThan.getTime())) {
        return res.status(400).json({ error: 'invalid olderThan date' });
      }

      const deleted = await purgeAuditLogs(knex, {
        tableName,
        olderThan,
      });

      res.json({ ok: true, success: true, deleted, olderThan: olderThan.toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Programmatic list (for other plugins)
   * @param {Object} [filters]
   * @param {string} [filters.model]
   * @param {string} [filters.action]
   * @param {string} [filters.from]
   * @param {string} [filters.to]
   * @param {number} [filters.limit=100]
   * @param {number} [filters.offset=0]
   */
  async function queryLogs(filters = {}) {
    const limit = Math.min(500, Math.max(1, filters.limit ?? 100));
    const offset = Math.max(0, filters.offset ?? 0);

    return knex(tableName)
      .modify((qb) => applyFilters(qb, filters))
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);
  }

  return {
    listHandler,
    purgeHandler,
    queryLogs,
  };
}

module.exports = {
  createAuditLogHandlers,
};
