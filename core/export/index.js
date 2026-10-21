'use strict';

/**
 * Webspresso Static Export Subsystem
 * Prerenders SSR pages into static HTML files for zero-cost hosting
 * @module core/export
 */

const { discoverExportRoutes, scanPagesForExport } = require('./discovery');
const {
  exportStaticSite,
  urlToFilePath,
  generateSitemapXml,
  copyDirRecursive,
} = require('./exporter');

module.exports = {
  discoverExportRoutes,
  scanPagesForExport,
  exportStaticSite,
  urlToFilePath,
  generateSitemapXml,
  copyDirRecursive,
};
