/**
 * Admin API handlers for audit log listing
 * @module plugins/audit-log/api-handlers
 */

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
    queryLogs,
  };
}

module.exports = {
  createAuditLogHandlers,
};
