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

      const registry = adminApi.getRegistry();
      const adminPath = adminApi.getAdminPath();
      const { requireAuth } = adminApi;
      const knex = db.knex || db;

      // Register admin page
      registry.registerPage('analytics', {
        title: 'Analytics',
        path: '/analytics',
        icon: 'chart',
      });

      // Register menu item
      registry.registerMenuItem({
        id: 'analytics',
        label: 'Analytics',
        path: '/analytics',
        icon: 'chart',
        order: 2,
      });

      // Register client-side component
      registry.registerClientComponent('analytics', generateAnalyticsComponent());

      // API routes
      const handlers = createAnalyticsApiHandlers({ knex, tableName });

      ctx.addRoute('get', `${adminPath}/api/analytics/stats`, requireAuth, handlers.getStats);
      ctx.addRoute('get', `${adminPath}/api/analytics/views-over-time`, requireAuth, handlers.getViewsOverTime);
      ctx.addRoute('get', `${adminPath}/api/analytics/top-pages`, requireAuth, handlers.getTopPages);
      ctx.addRoute('get', `${adminPath}/api/analytics/bot-activity`, requireAuth, handlers.getBotActivity);
      ctx.addRoute('get', `${adminPath}/api/analytics/countries`, requireAuth, handlers.getCountries);
      ctx.addRoute('get', `${adminPath}/api/analytics/recent`, requireAuth, handlers.getRecent);

      // Serve admin SPA for the analytics route
      ctx.addRoute('get', `${adminPath}/analytics`, adminApi.optionalAuth, adminApi.serveAdminPanel);
    },
  };
}

module.exports = siteAnalyticsPlugin;
