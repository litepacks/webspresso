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
    const recordId = query.recordId || query.resource_id || query.resourceId;
    if (recordId !== undefined && recordId !== null && String(recordId).trim() !== '') {
      qb.where('resource_id', String(recordId));
    }
    const actorId = query.actorId || query.actor_id;
    if (actorId !== undefined && actorId !== null && String(actorId).trim() !== '') {
      qb.where('actor_id', Number(actorId));
    }
    const actorEmail = query.actorEmail || query.actor_email;
    if (actorEmail) {
      qb.where('actor_email', 'like', `%${String(actorEmail).trim()}%`);
    }
    if (query.from) {
      qb.where('created_at', '>=', String(query.from));
    }
    if (query.to) {
      qb.where('created_at', '<=', String(query.to));
    }
    const searchTerm = query.search || query.q;
    if (searchTerm && String(searchTerm).trim() !== '') {
      const term = `%${String(searchTerm).trim()}%`;
      qb.where((sub) => {
        sub.where('actor_email', 'like', term)
          .orWhere('path', 'like', term)
          .orWhere('resource_id', 'like', term)
          .orWhere('resource_model', 'like', term);
      });
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
   * Dedicated Record Timeline Handler
   * GET /audit-logs/timeline/:model/:id or GET /audit-logs/timeline?model=Post&id=1
   */
  async function timelineHandler(req, res) {
    try {
      const model = req.params?.model || req.query?.model;
      const recordId = req.params?.id || req.query?.id || req.query?.recordId || req.query?.resource_id;

      if (!model || recordId === undefined) {
        return res.status(400).json({ error: 'model and id are required to fetch timeline' });
      }

      const rows = await knex(tableName)
        .where({
          resource_model: String(model),
          resource_id: String(recordId),
        })
        .orderBy('created_at', 'asc');

      const totalChanges = rows.length;
      const createdEvent = rows.find((r) => r.action === 'create') || null;
      const lastModifiedEvent = rows.length > 0 ? rows[rows.length - 1] : null;

      const events = rows.map((r, index) => {
        let parsedMetadata = r.metadata;
        if (typeof parsedMetadata === 'string') {
          try {
            parsedMetadata = JSON.parse(parsedMetadata);
          } catch {}
        }

        const changedFields = Array.isArray(parsedMetadata?.changedFields)
          ? parsedMetadata.changedFields
          : [];

        return {
          id: r.id,
          action: r.action,
          createdAt: r.created_at,
          actor: {
            id: r.actor_id,
            email: r.actor_email,
          },
          resourceModel: r.resource_model,
          resourceId: r.resource_id,
          httpMethod: r.http_method,
          path: r.path,
          ip: r.ip,
          userAgent: r.user_agent,
          changedFields,
          metadata: parsedMetadata,
          index: index + 1,
        };
      });

      res.json({
        model: String(model),
        recordId: String(recordId),
        summary: {
          totalChanges,
          createdAt: createdEvent?.created_at || (events[0] ? events[0].createdAt : null),
          createdBy: createdEvent?.actor_email || (events[0] ? events[0].actor?.email : null),
          lastModifiedAt: lastModifiedEvent?.created_at || null,
          lastModifiedBy: lastModifiedEvent?.actor_email || null,
        },
        timeline: events,
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
   * @param {string} [filters.recordId]
   * @param {string} [filters.from]
   * @param {string} [filters.to]
   * @param {string} [filters.search]
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

  /**
   * Programmatic query for single record timeline
   * @param {string} model
   * @param {string|number} recordId
   */
  async function queryTimeline(model, recordId) {
    if (!model || recordId === undefined) return [];
    return knex(tableName)
      .where({
        resource_model: String(model),
        resource_id: String(recordId),
      })
      .orderBy('created_at', 'asc');
  }

  return {
    listHandler,
    timelineHandler,
    purgeHandler,
    queryLogs,
    queryTimeline,
  };
}

module.exports = {
  createAuditLogHandlers,
};
