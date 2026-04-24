/**
 * Express middleware: log successful admin model CRUD to audit_logs
 * @module plugins/audit-log/middleware
 */

const { parseAdminModelAudit } = require('./parse');

function stringifyId(val) {
  if (val === undefined || val === null) {
    return null;
  }
  if (typeof val === 'bigint') {
    return val.toString();
  }
  return String(val);
}

function extractResourceIdFromJsonBody(body, action) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  if (action === 'create' && body.data && body.data.id !== undefined) {
    return stringifyId(body.data.id);
  }
  return null;
}

function buildMetadata(action, req) {
  if (action === 'update' && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const changedFields = Object.keys(req.body);
    if (changedFields.length) {
      return { changedFields };
    }
  }
  return null;
}

/**
 * @param {Object} options
 * @param {import('knex').Knex} options.knex
 * @param {string} options.adminPath
 * @param {string} [options.tableName='audit_logs']
 * @returns {import('express').RequestHandler}
 */
function createAuditMiddleware(options) {
  const knex = options.knex;
  const adminPath = options.adminPath || '/_admin';
  const tableName = options.tableName || 'audit_logs';

  return function auditLogMiddleware(req, res, next) {
    const parsed = parseAdminModelAudit(adminPath, req.method, req.path);
    if (!parsed) {
      return next();
    }

    const origJson = res.json.bind(res);
    let lastJsonBody = null;

    res.json = function auditWrappedJson(body) {
      if (body !== undefined && body !== null && typeof body === 'object') {
        lastJsonBody = body;
      }
      return origJson(body);
    };

    res.on('finish', () => {
      try {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return;
        }
        const session = req.session;
        const actor = session && session.adminUser;
        if (!actor) {
          return;
        }

        const { action, resourceModel, resourceId: pathId } = parsed;
        let resourceId = pathId;
        if (action === 'create') {
          resourceId = extractResourceIdFromJsonBody(lastJsonBody, action) || resourceId;
        }

        const metadata = buildMetadata(action, req);
        const pathStr = (req.originalUrl || req.url || req.path || '').slice(0, 2000);
        const row = {
          actor_id: actor.id != null ? Number(actor.id) : null,
          actor_email: actor.email || null,
          action,
          resource_model: resourceModel,
          resource_id: resourceId,
          http_method: req.method,
          path: pathStr,
          ip: req.ip || (req.connection && req.connection.remoteAddress) || null,
          user_agent: req.get && req.get('user-agent') ? req.get('user-agent').slice(0, 2000) : null,
          metadata: metadata || null,
        };

        knex(tableName).insert(row).catch((err) => {
          console.warn('[audit-log] Failed to insert audit row:', err.message);
        });
      } catch (e) {
        console.warn('[audit-log] finish handler error:', e.message);
      }
    });

    next();
  };
}

module.exports = {
  createAuditMiddleware,
  stringifyId,
  extractResourceIdFromJsonBody,
  buildMetadata,
};
