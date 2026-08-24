/**
 * Webspresso Core Plugins
 * Export all built-in plugins
 */

const sitemapPlugin = require('./sitemap');
const analyticsPlugin = require('./analytics');
const dashboardPlugin = require('./dashboard/index');
const schemaExplorerPlugin = require('./schema-explorer');
const adminPanelPlugin = require('./admin-panel');
const seoCheckerPlugin = require('./seo-checker');
const siteAnalyticsPlugin = require('./site-analytics');
const auditLogPlugin = require('./audit-log');
const recaptchaPlugin = require('./recaptcha');
const swaggerPlugin = require('./swagger');
const healthCheckPlugin = require('./health-check');
const restResourcePlugin = require('./rest-resources');
const ormCacheAdminPlugin = require('./orm-cache-admin');
const { uploadPlugin, createLocalFileProvider } = require('./upload');
/** Register after adminPanelPlugin (same db + adminPath) for session and routes. */
const { dataExchangePlugin } = require('./data-exchange');
const { redirectPlugin } = require('./redirect');
const { rateLimitPlugin } = require('./rate-limit');
const emailPlugin = require('./email');
const contentPlugin = require('./content');
const csrfPlugin = require('./csrf');
const corsPlugin = require('./cors');
const { basicAuthPlugin, createBasicAuthMiddleware } = require('./basic-auth');
const {
  realtimePlugin,
  realtime,
  createRealtime,
  websocket,
  createWebSocketAdapter,
  sse,
  createSseAdapter,
  socketIo,
  createSocketIoAdapter,
} = require('./realtime');

module.exports = {
  sitemapPlugin,
  analyticsPlugin,
  dashboardPlugin,
  schemaExplorerPlugin,
  adminPanelPlugin,
  seoCheckerPlugin,
  siteAnalyticsPlugin,
  auditLogPlugin,
  recaptchaPlugin,
  swaggerPlugin,
  healthCheckPlugin,
  restResourcePlugin,
  ormCacheAdminPlugin,
  uploadPlugin,
  createLocalFileProvider,
  dataExchangePlugin,
  redirectPlugin,
  rateLimitPlugin,
  emailPlugin,
  contentPlugin,
  csrfPlugin,
  corsPlugin,
  basicAuthPlugin,
  createBasicAuthMiddleware,
  realtimePlugin,
  realtime,
  createRealtime,
  websocket,
  createWebSocketAdapter,
  sse,
  createSseAdapter,
  socketIo,
  createSocketIoAdapter,
};

