/**
 * Site Analytics Plugin
 * Self-hosted page view tracking with admin panel dashboard
 * @module plugins/site-analytics
 */

const { createTrackingMiddleware } = require('./tracking');
const { createAnalyticsApiHandlers } = require('./api-handlers');
const { generateAnalyticsComponent } = require('./admin-component');

/**
 * Site Analytics Plugin Factory
 * @param {Object} options
 * @param {Object} options.db - Database instance (must expose .knex)
 * @param {string[]} [options.excludePaths=[]] - Extra paths to exclude from tracking
 * @param {boolean} [options.trackBots=true] - Record bot visits (still counted separately)
 * @param {string} [options.tableName='analytics_page_views'] - DB table name
 * @returns {Object} Plugin definition
 */
function siteAnalyticsPlugin(options = {}) {
  const {
    db,
    excludePaths = [],
    trackBots = true,
    tableName = 'analytics_page_views',
  } = options;

  if (!db) {
    throw new Error('site-analytics plugin requires a database instance. Pass `db` in options.');
  }

  return {
    name: 'site-analytics',
    version: '1.0.0',
    description: 'Self-hosted page view analytics with admin dashboard',
    dependencies: { 'admin-panel': '*' },

    csp: {
      scriptSrc: ['https://cdn.jsdelivr.net'],
      connectSrc: ['https://cdn.jsdelivr.net'],
    },

    register(ctx) {
      const knex = db.knex || db;

      const trackingMiddleware = createTrackingMiddleware({
        knex,
        excludePaths,
        trackBots,
        tableName,
      });

      ctx.app.use(trackingMiddleware);
    },

    onRoutesReady(ctx) {
      const adminApi = ctx.usePlugin('admin-panel');
      if (!adminApi) {
        console.warn('[site-analytics] admin-panel plugin not found, skipping admin page registration');
        return;
      }

      const knex = db.knex || db;
      const handlers = createAnalyticsApiHandlers({ knex, tableName });

      adminApi.registerModule({
        id: 'analytics',

        pages: [{
          id: 'analytics',
          title: 'Analytics',
          path: '/analytics',
          icon: 'chart',
          component: generateAnalyticsComponent(),
        }],

        menu: [{
          id: 'analytics',
          label: 'Analytics',
          path: '/analytics',
          icon: 'chart',
          order: 2,
        }],

        api: {
          prefix: '/analytics',
          routes: [
            { method: 'get', path: '/stats', handler: handlers.getStats },
            { method: 'get', path: '/views-over-time', handler: handlers.getViewsOverTime },
            { method: 'get', path: '/top-pages', handler: handlers.getTopPages },
            { method: 'get', path: '/bot-activity', handler: handlers.getBotActivity },
            { method: 'get', path: '/countries', handler: handlers.getCountries },
            { method: 'get', path: '/recent', handler: handlers.getRecent },
          ],
        },
      });
    },
  };
}

module.exports = siteAnalyticsPlugin;
