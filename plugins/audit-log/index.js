/**
 * Audit log plugin — admin model CRUD audit trail
 * @module plugins/audit-log
 */

const { createAuditMiddleware } = require('./middleware');
const { createAuditLogHandlers } = require('./api-handlers');
const { generateAuditLogComponent } = require('./admin-component');
const { generateAuditLogsMigration } = require('./migration-template');
const { purgeAuditLogs } = require('./purge');

/**
 * @param {Object} options
 * @param {Object} options.db - Database instance (must expose .knex)
 * @param {string} [options.adminPath='/_admin'] - Must match admin panel `path` option
 * @param {string} [options.tableName='audit_logs']
 * @param {boolean} [options.includeDefaultPage=true] - Register Mithril list page + menu
 * @param {string} [options.apiPrefix='/audit-logs'] - GET list under admin API
 */
function auditLogPlugin(options = {}) {
  const {
    db,
    adminPath: adminPathOpt,
    tableName = 'audit_logs',
    includeDefaultPage = true,
    apiPrefix = '/audit-logs',
  } = options;

  if (!db) {
    throw new Error('audit-log plugin requires a database instance. Pass `db` in options.');
  }

  const knex = db.knex || db;

  const handlers = createAuditLogHandlers({ knex, tableName });

  return {
    name: 'audit-log',
    version: '1.0.0',
    description: 'Audit trail for admin panel model CRUD API',
    dependencies: { 'admin-panel': '*' },

    api: {
      purgeAuditLogs: (kx, opts = {}) =>
        purgeAuditLogs(kx || knex, { tableName: opts.tableName || tableName, olderThan: opts.olderThan }),
      queryLogs: (filters) => handlers.queryLogs(filters),
      getMigrationTemplate: (name) => generateAuditLogsMigration(name || tableName),
    },

    register(ctx) {
      const adminPath = adminPathOpt || '/_admin';
      ctx.app.use(createAuditMiddleware({ knex, adminPath, tableName }));
    },

    onRoutesReady(ctx) {
      const adminApi = ctx.usePlugin('admin-panel');
      if (!adminApi) {
        console.warn('[audit-log] admin-panel plugin not found, skipping list API / UI');
        return;
      }

      adminApi.registerModule({
        id: 'audit-log',

        pages: includeDefaultPage
          ? [{
            id: 'audit-log',
            title: 'Audit log',
            path: '/audit-log',
            icon: 'database',
            component: generateAuditLogComponent({ apiPrefix }),
          }]
          : [],

        menu: includeDefaultPage
          ? [{
            id: 'audit-log',
            label: 'Audit log',
            path: '/audit-log',
            icon: 'database',
            order: 95,
          }]
          : [],

        api: {
          prefix: apiPrefix,
          routes: [
            { method: 'get', path: '', handler: handlers.listHandler },
          ],
        },
      });
    },
  };
}

module.exports = auditLogPlugin;
module.exports.auditLogPlugin = auditLogPlugin;
module.exports.generateAuditLogsMigration = generateAuditLogsMigration;
module.exports.purgeAuditLogs = purgeAuditLogs;
