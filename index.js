/**
 * Webspresso - Minimal file-based SSR framework for Node.js
 */

const { createApp } = require('./src/server');
const { resolveClientRuntime } = require('./src/client-runtime/resolve');
const { CLIENT_RUNTIME_BASE } = require('./src/client-runtime/mount');
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
  detectLocale,
  parseNjkFrontmatter,
  frontmatterToPatches,
  loadNjkRouteTemplate,
  clearNjkFrontmatterCaches,
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

/** Application kernel (event bus, plugin shell, view resolver, flows). Use `kernel.createApp`; not the framework SSR `createApp`. */
const kernel = require('./core/kernel');

// Built-in plugins
const {
  schemaExplorerPlugin,
  adminPanelPlugin,
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
} = require('./plugins');

module.exports = {
  // Main API
  createApp,
  resolveClientRuntime,
  CLIENT_RUNTIME_BASE,

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
  parseNjkFrontmatter,
  frontmatterToPatches,
  loadNjkRouteTemplate,
  clearNjkFrontmatterCaches,
  
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

  /** Event bus / plugin shell / view resolver / flows (`kernel.createApp` is distinct from SSR `createApp`) */
  kernel,

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
  restResourcePlugin,
  ormCacheAdminPlugin,
  uploadPlugin,
  createLocalFileProvider,
  dataExchangePlugin,
  redirectPlugin,
};
