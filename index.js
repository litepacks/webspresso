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
  getShutdownManager,
  hasShutdownManager,
  resetAppContext,
  setAppContext,
} = require('./src/app-context');
const { ShutdownManager, NodeHttpAdapter } = require('./core/shutdown');
const compression = require('./core/compression');
const errors = require('./core/errors');
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
  rateLimitPlugin,
  contentPlugin,
  csrfPlugin,
} = require('./plugins');

const content = require('./core/content');

module.exports = {
  // Main API
  createApp,
  resolveClientRuntime,
  CLIENT_RUNTIME_BASE,

  attachDbMiddleware,
  getAppContext,
  getDb,
  hasDb,
  getShutdownManager,
  hasShutdownManager,
  resetAppContext,
  setAppContext,

  // Shutdown & Lifecycle
  ShutdownManager,
  NodeHttpAdapter,

  // HTTP Response Compression
  compression,
  createCompressionMiddleware: compression.createCompressionMiddleware,

  // Exceptions & Error Handling
  errors,
  WebspressoError: errors.WebspressoError,
  HttpError: errors.HttpError,
  BadRequestError: errors.BadRequestError,
  UnauthorizedError: errors.UnauthorizedError,
  ForbiddenError: errors.ForbiddenError,
  NotFoundError: errors.NotFoundError,
  MethodNotAllowedError: errors.MethodNotAllowedError,
  ConflictError: errors.ConflictError,
  PayloadTooLargeError: errors.PayloadTooLargeError,
  UnsupportedMediaTypeError: errors.UnsupportedMediaTypeError,
  UnprocessableEntityError: errors.UnprocessableEntityError,
  TooManyRequestsError: errors.TooManyRequestsError,
  ValidationError: errors.ValidationError,
  ConfigurationError: errors.ConfigurationError,
  PluginError: errors.PluginError,
  SecurityError: errors.SecurityError,
  RequestError: errors.RequestError,
  RequestAbortedError: errors.RequestAbortedError,
  RouterError: errors.RouterError,
  RouteNotFoundError: errors.RouteNotFoundError,
  RouteGenerationError: errors.RouteGenerationError,
  normalizeError: errors.normalizeError,
  toErrorResponseObject: errors.toErrorResponseObject,
  
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
  rateLimitPlugin,
  contentPlugin,
  csrfPlugin,

  // Schema-driven CMS core (framework-agnostic)
  content,
};
