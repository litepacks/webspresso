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
 * @param {Object|boolean} [options.retention] - Retention policy configuration (set false to disable)
 * @param {number} [options.retention.days=90] - Days to retain audit logs
 * @param {number} [options.retention.intervalMs=86400000] - Auto-cleanup timer frequency (24h)
 * @param {boolean} [options.retention.runOnStart=true] - Run initial purge shortly after startup
 * @param {number} [options.retentionDays=90] - Shorthand for retention.days
 * @param {number} [options.cleanupIntervalMs=86400000] - Shorthand for retention.intervalMs
 * @param {boolean} [options.autoCleanup=true] - Enable automatic background cleanup
 * @param {boolean} [options.cleanupOnStart=true] - Run initial purge on start
 * @param {number} [options.cleanupStartDelayMs] - Delay in ms before start purge
 */
function auditLogPlugin(options = {}) {
  const {
    db,
    title,
    adminTitle,
    pageTitle: customPageTitle,
    adminPath: adminPathOpt,
    tableName = 'audit_logs',
    includeDefaultPage = true,
    apiPrefix = '/audit-logs',
  } = options;

  const pageTitle = title || adminTitle || customPageTitle || 'Audit log';

  if (!db) {
    throw new Error('audit-log plugin requires a database instance. Pass `db` in options.');
  }

  const knex = db.knex || db;

  // Retention configuration
  const retentionOption = options.retention;
  const isRetentionDisabled =
    retentionOption === false ||
    (typeof retentionOption === 'object' && retentionOption.enabled === false) ||
    options.retentionDays === null ||
    options.retentionDays === 0;

  const autoCleanupEnabled =
    !isRetentionDisabled &&
    options.autoCleanup !== false &&
    (typeof retentionOption !== 'object' || retentionOption.autoCleanup !== false);

  const retentionConfig = {
    enabled: !isRetentionDisabled,
    autoCleanup: autoCleanupEnabled,
    days: (typeof options.retentionDays === 'number' && options.retentionDays > 0)
      ? options.retentionDays
      : (typeof retentionOption === 'object' && retentionOption?.days ? retentionOption.days : 90),
    intervalMs: (typeof options.cleanupIntervalMs === 'number' && options.cleanupIntervalMs > 0)
      ? options.cleanupIntervalMs
      : (typeof retentionOption === 'object' && retentionOption?.intervalMs ? retentionOption.intervalMs : 24 * 60 * 60 * 1000),
    runOnStart: (typeof retentionOption === 'object' && retentionOption?.runOnStart !== undefined)
      ? !!retentionOption.runOnStart
      : (options.cleanupOnStart !== undefined ? !!options.cleanupOnStart : true),
  };

  let cleanupInterval = null;
  let cleanupStartTimeout = null;

  async function runCleanup() {
    try {
      return await purgeAuditLogs(knex, {
        tableName,
        days: retentionConfig.days,
      });
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[audit-log] Failed to run retention cleanup:', err.message);
      }
    }
  }

  function startCleanup(customIntervalMs) {
    stopCleanup();
    if (!retentionConfig.enabled) return;
    if (typeof customIntervalMs === 'number' && customIntervalMs > 0) {
      retentionConfig.intervalMs = customIntervalMs;
    }

    if (retentionConfig.runOnStart) {
      const delayMs = typeof options.cleanupStartDelayMs === 'number'
        ? options.cleanupStartDelayMs
        : (process.env.NODE_ENV === 'test' ? 50 : 5000);
      cleanupStartTimeout = setTimeout(() => {
        runCleanup();
      }, delayMs);
      if (cleanupStartTimeout && cleanupStartTimeout.unref) {
        cleanupStartTimeout.unref();
      }
    }

    cleanupInterval = setInterval(() => {
      runCleanup();
    }, retentionConfig.intervalMs);
    if (cleanupInterval && cleanupInterval.unref) {
      cleanupInterval.unref();
    }
  }

  function stopCleanup() {
    if (cleanupStartTimeout) {
      clearTimeout(cleanupStartTimeout);
      cleanupStartTimeout = null;
    }
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  }

  const handlers = createAuditLogHandlers({ knex, tableName });

  return {
    name: 'audit-log',
    version: '1.0.0',
    description: 'Audit trail for admin panel model CRUD API with retention cleanup',
    dependencies: { 'admin-panel': '*' },

    api: {
      purge(opts = {}) {
        return purgeAuditLogs(knex, {
          tableName,
          days: opts.days !== undefined ? opts.days : (opts.retentionDays !== undefined ? opts.retentionDays : retentionConfig.days),
          olderThan: opts.olderThan,
          ...opts,
        });
      },
      purgeAuditLogs: (kx, opts = {}) =>
        purgeAuditLogs(kx || knex, { tableName: opts.tableName || tableName, olderThan: opts.olderThan, days: opts.days, retentionDays: opts.retentionDays }),
      startCleanup,
      stopCleanup,
      getRetentionConfig() {
        return { ...retentionConfig };
      },
      queryLogs: (filters) => handlers.queryLogs(filters),
      getMigrationTemplate: (name) => generateAuditLogsMigration(name || tableName),
    },

    register(ctx) {
      const adminPath = adminPathOpt || '/_admin';
      ctx.app.use(createAuditMiddleware({ knex, adminPath, tableName }));

      if (retentionConfig.enabled && autoCleanupEnabled) {
        startCleanup();
      }

      return () => {
        stopCleanup();
      };
    },

    dispose() {
      stopCleanup();
    },

    shutdown() {
      stopCleanup();
    },

    onRoutesReady(ctx) {
      const adminApi = ctx.usePlugin('admin-panel');
      if (!adminApi) {
        console.warn('[audit-log] admin-panel plugin not found, skipping list API / UI');
        return;
      }

      adminApi.registerModule({
        id: 'audit-log',
        title: pageTitle,

        pages: includeDefaultPage
          ? [{
            id: 'audit-log',
            title: pageTitle,
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
            { method: 'post', path: '/purge', handler: handlers.purgeHandler },
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
