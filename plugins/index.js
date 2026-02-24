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

module.exports = {
  sitemapPlugin,
  analyticsPlugin,
  dashboardPlugin,
  schemaExplorerPlugin,
  adminPanelPlugin,
  seoCheckerPlugin,
  siteAnalyticsPlugin,
};

