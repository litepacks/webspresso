/**
 * Webspresso - Minimal file-based SSR framework for Node.js
 */

const { createApp } = require('./src/server');
const {
  attachDbMiddleware,
  getAppContext,
  getDb,
  hasDb,
  resetAppContext,
  setAppContext,
} = require('./src/app-context');
const { 
  mountPages, 
  filePathToRoute, 
  extractMethodFromFilename,
  scanDirectory,
  loadI18n,
  createTranslator,
  detectLocale
} = require('./src/file-router');
const { 
  createHelpers, 
  utils, 
  AssetManager, 
  configureAssets, 
  getAssetManager 
} = require('./src/helpers');
const {
  PluginManager,
  createPluginManager,
  getPluginManager,
  resetPluginManager
} = require('./src/plugin-manager');

// ORM exports (lazy loaded)
const orm = require('./core/orm');

// Built-in plugins
const { schemaExplorerPlugin, adminPanelPlugin, siteAnalyticsPlugin, auditLogPlugin, recaptchaPlugin, swaggerPlugin, healthCheckPlugin } = require('./plugins');

module.exports = {
  // Main API
  createApp,

  attachDbMiddleware,
  getAppContext,
  getDb,
  hasDb,
  resetAppContext,
  setAppContext,
  
  // Router utilities (for advanced use)
  mountPages,
  filePathToRoute,
  extractMethodFromFilename,
  scanDirectory,
  loadI18n,
  createTranslator,
  detectLocale,
  
  // Template helpers
  createHelpers,
  utils,
  
  // Asset management
  AssetManager,
  configureAssets,
  getAssetManager,
  
  // Plugin system
  PluginManager,
  createPluginManager,
  getPluginManager,
  resetPluginManager,
  
  // ORM
  ...orm,
  
  // Direct zdb export (for convenience)
  zdb: orm.zdb,

  // Plugins
  schemaExplorerPlugin,
  adminPanelPlugin,
  siteAnalyticsPlugin,
  auditLogPlugin,
  recaptchaPlugin,
  swaggerPlugin,
  healthCheckPlugin,
};
