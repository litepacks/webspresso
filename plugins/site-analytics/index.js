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
const { purgeAnalyticsData } = require('./purge');

/**
 * Site Analytics Plugin Factory
 * @param {Object} options
 * @param {Object} options.db - Database instance (must expose .knex)
 * @param {string} [options.title] - Admin page title
 * @param {string} [options.adminTitle] - Admin page title alias
 * @param {string[]} [options.excludePaths=[]] - Extra paths to exclude from tracking
 * @param {boolean} [options.trackBots=true] - Record bot visits (still counted separately)
 * @param {string} [options.tableName='analytics_page_views'] - DB table name
 * @param {number} [options.batchSize=20] - Flush page view queue when it reaches this size
 * @param {number} [options.flushIntervalMs=3000] - Flush interval for low traffic
 * @param {boolean} [options.trackClientErrors=true] - Capture and report client-side JS errors
 * @param {string} [options.errorsTableName='analytics_client_errors'] - Client errors table
 * @param {Object|boolean} [options.retention] - Retention policy configuration (set false to disable)
 * @param {number} [options.retention.days=90] - Days to retain page views
 * @param {number} [options.retention.errorDays=30] - Days to retain client errors
 * @param {number} [options.retention.intervalMs=86400000] - Auto-cleanup timer frequency (24h)
 * @param {boolean} [options.retention.runOnStart=true] - Run initial purge shortly after startup
 * @param {number} [options.retentionDays=90] - Shorthand for retention.days
 * @param {number} [options.errorRetentionDays=30] - Shorthand for retention.errorDays
 * @param {number} [options.cleanupIntervalMs=86400000] - Shorthand for retention.intervalMs
 * @param {boolean} [options.autoCleanup=true] - Enable/disable background periodic cleanup
 * @returns {Object} Plugin definition
 */
function siteAnalyticsPlugin(options = {}) {
  const {
    db,
    title,
    adminTitle,
    excludePaths = [],
    trackBots = true,
    tableName = 'analytics_page_views',
    trackClientErrors = true,
    errorsTableName = 'analytics_client_errors',
  } = options;

  const pageTitle = title || adminTitle || 'Analytics';

  if (!db) {
    throw new Error('site-analytics plugin requires a database instance. Pass `db` in options.');
  }

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
    errorDays: (typeof options.errorRetentionDays === 'number' && options.errorRetentionDays > 0)
      ? options.errorRetentionDays
      : (typeof retentionOption === 'object' && retentionOption?.errorDays ? retentionOption.errorDays : 30),
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
      const knex = db.knex || db;
      return await purgeAnalyticsData(knex, {
        tableName,
        errorsTableName,
        days: retentionConfig.days,
        errorDays: retentionConfig.errorDays,
      });
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[site-analytics] Failed to run retention cleanup:', err.message);
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

  let trackingMiddleware = null;

  return {
    name: 'site-analytics',
    version: '1.0.0',
    description: 'Self-hosted page view analytics with admin dashboard and auto-retention cleanup',
    dependencies: { 'admin-panel': '*' },

    csp: {
      scriptSrc: ['https://cdn.jsdelivr.net'],
      connectSrc: ['https://cdn.jsdelivr.net'],
    },

    api: {
      purge(opts = {}) {
        const knex = db.knex || db;
        return purgeAnalyticsData(knex, {
          tableName,
          errorsTableName,
          days: opts.days !== undefined ? opts.days : (opts.retentionDays !== undefined ? opts.retentionDays : retentionConfig.days),
          errorDays: opts.errorDays !== undefined ? opts.errorDays : (opts.errorRetentionDays !== undefined ? opts.errorRetentionDays : retentionConfig.errorDays),
          ...opts,
        });
      },
      purgeAnalyticsData: (kx, opts) => purgeAnalyticsData(kx || db.knex || db, {
        tableName,
        errorsTableName,
        ...opts,
      }),
      startCleanup,
      stopCleanup,
      getRetentionConfig() {
        return { ...retentionConfig };
      },
    },

    register(ctx) {
      const knex = db.knex || db;

      trackingMiddleware = createTrackingMiddleware({
        knex,
        excludePaths,
        trackBots,
        tableName,
        batchSize: options.batchSize ?? 20,
        flushIntervalMs: options.flushIntervalMs ?? 3000,
        maxRetries: options.maxRetries ?? 3,
        maxBackoffMs: options.maxBackoffMs ?? 60000,
        maxQueueSize: options.maxQueueSize ?? 5000,
        errorLogIntervalMs: options.errorLogIntervalMs ?? 60000,
      });

      ctx.app.use(trackingMiddleware);

      if (trackClientErrors) {
        const script = generateErrorTrackerScript({ endpoint: '/_analytics/report-error' });
        ctx.injectBody(`<script>${script}</script>`, { id: 'site-analytics-error-tracker', priority: 5 });
      }

      if (retentionConfig.enabled && autoCleanupEnabled) {
        startCleanup();
      }

      return () => {
        stopCleanup();
        if (trackingMiddleware && trackingMiddleware.stop) trackingMiddleware.stop();
      };
    },

    dispose() {
      stopCleanup();
      if (trackingMiddleware && trackingMiddleware.stop) trackingMiddleware.stop();
    },

    shutdown() {
      stopCleanup();
      if (trackingMiddleware && trackingMiddleware.stop) trackingMiddleware.stop();
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
        title: pageTitle,

        pages: [{
          id: 'analytics',
          title: pageTitle,
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
            { method: 'post', path: '/purge', handler: handlers.purge },
          ],
        },
      });
    },
  };
}

module.exports = siteAnalyticsPlugin;
module.exports.purgeAnalyticsData = purgeAnalyticsData;
