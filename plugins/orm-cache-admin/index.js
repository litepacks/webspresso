/**
 * ORM Cache Admin — metrics, purge, invalidate (requires admin-panel + db.cache)
 * @module plugins/orm-cache-admin
 */

const { createOrmCacheAdminHandlers } = require('./api-handlers');
const { generateOrmCacheAdminComponent } = require('./admin-component');

/**
 * @param {object} options
 * @param {import('../../core/orm/types').DatabaseInstance} options.db - From createDatabase({ cache: true })
 */
function ormCacheAdminPlugin(options = {}) {
  const { db } = options;

  if (!db) {
    throw new Error('orm-cache-admin plugin requires `db` (database instance from createDatabase)');
  }

  return {
    name: 'orm-cache-admin',
    version: '1.0.0',
    description: 'Admin UI for ORM query cache metrics and purge',
    dependencies: { 'admin-panel': '*' },

    register() {},

    onRoutesReady(ctx) {
      const adminApi = ctx.usePlugin('admin-panel');
      if (!adminApi) {
        console.warn('[orm-cache-admin] admin-panel not found, skipping registration');
        return;
      }

      if (!db.cache) {
        console.warn('[orm-cache-admin] db.cache is disabled; enable createDatabase({ cache: true })');
        return;
      }

      const handlers = createOrmCacheAdminHandlers({ db });

      adminApi.registerModule({
        id: 'orm-cache',
        pages: [{
          id: 'orm-cache',
          title: 'ORM Cache',
          path: '/orm-cache',
          icon: 'database',
          component: generateOrmCacheAdminComponent(),
        }],
        menu: [{
          id: 'orm-cache',
          label: 'ORM Cache',
          path: '/orm-cache',
          icon: 'database',
          order: 15,
        }],
        api: {
          prefix: '/orm-cache',
          routes: [
            { method: 'get', path: '/stats', handler: handlers.getStats },
            { method: 'post', path: '/purge', handler: handlers.postPurge },
            { method: 'post', path: '/invalidate', handler: handlers.postInvalidate },
            { method: 'post', path: '/metrics/reset', handler: handlers.postResetMetrics },
          ],
        },
      });
    },
  };
}

module.exports = ormCacheAdminPlugin;
