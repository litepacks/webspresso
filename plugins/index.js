/**
 * Webspresso Core Plugins
 * Export all built-in plugins
 */

const sitemapPlugin = require('./sitemap');
const analyticsPlugin = require('./analytics');

module.exports = {
  sitemapPlugin,
  analyticsPlugin
};

