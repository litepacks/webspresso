/**
 * Site Analytics Plugin
 * Self-hosted page view tracking with admin panel dashboard
 * @module plugins/site-analytics
 */

const { createTrackingMiddleware } = require('./tracking');
const { createAnalyticsApiHandlers } = require('./api-handlers');
const { generateAnalyticsComponent } = require('./admin-component');
const { generateErrorTrackerScript } = require('./client-error-tracker');
const { createErrorReportHandler } = require('./client-error-handler');

/**
 * Site Analytics Plugin Factory
 * @param {Object} options
 * @param {Object} options.db - Database instance (must expose .knex)
 * @param {string[]} [options.excludePaths=[]] - Extra paths to exclude from tracking
 * @param {boolean} [options.trackBots=true] - Record bot visits (still counted separately)
 * @param {string} [options.tableName='analytics_page_views'] - DB table name
 * @param {number} [options.batchSize=20] - Flush page view queue when it reaches this size
 * @param {number} [options.flushIntervalMs=3000] - Flush interval for low traffic
 * @param {boolean} [options.trackClientErrors=true] - Capture and report client-side JS errors
 * @param {string} [options.errorsTableName='analytics_client_errors'] - Client errors table
 * @returns {Object} Plugin definition
 */
function siteAnalyticsPlugin(options = {}) {
  const {
    db,
    excludePaths = [],
    trackBots = true,
    tableName = 'analytics_page_views',
    trackClientErrors = true,
    errorsTableName = 'analytics_client_errors',
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
        batchSize: options.batchSize ?? 20,
        flushIntervalMs: options.flushIntervalMs ?? 3000,
      });

      ctx.app.use(trackingMiddleware);

      if (trackClientErrors) {
        const script = generateErrorTrackerScript({ endpoint: '/_analytics/report-error' });
        ctx.injectBody(`<script>${script}</script>`, { id: 'site-analytics-error-tracker', priority: 5 });
      }
    },

    onRoutesReady(ctx) {
      // Client error report endpoint (must be in onRoutesReady - addRoute only mounts there)
      if (trackClientErrors) {
        const knex = db.knex || db;
        const errorHandler = createErrorReportHandler({ knex, tableName: errorsTableName });
        ctx.addRoute('post', '/_analytics/report-error', errorHandler);
      }

      const adminApi = ctx.usePlugin('admin-panel');
      if (!adminApi) {
        console.warn('[site-analytics] admin-panel plugin not found, skipping admin page registration');
        return;
      }

      const knex = db.knex || db;
      const handlers = createAnalyticsApiHandlers({
        knex,
        tableName,
        errorsTableName,
      });

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
            { method: 'get', path: '/referrer-sources', handler: handlers.getReferrerSources },
            { method: 'get', path: '/countries', handler: handlers.getCountries },
            { method: 'get', path: '/client-errors', handler: handlers.getClientErrors },
            { method: 'get', path: '/recent', handler: handlers.getRecent },
          ],
        },
      });
    },
  };
}

module.exports = siteAnalyticsPlugin;
