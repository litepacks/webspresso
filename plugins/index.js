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
};

