/**
 * Webspresso Core Plugins
 * Export all built-in plugins
 */

const sitemapPlugin = require('./sitemap');
const analyticsPlugin = require('./analytics');
const dashboardPlugin = require('./dashboard/index');

module.exports = {
  sitemapPlugin,
  analyticsPlugin,
  dashboardPlugin
};

