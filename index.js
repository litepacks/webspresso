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
  getServiceRegistry,
  hasServiceRegistry,
  resetAppContext,
  setAppContext,
} = require('./src/app-context');
const {
  createServiceRegistry,
  defineService,
  ServiceRegistry,
} = require('./src/services');
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

/** Standalone experimental application kernel (event bus, plugin shell, view resolver, flows). Distinct from framework SSR `createApp`. */
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
  corsPlugin,
  emailPlugin,
  basicAuthPlugin,
  realtimePlugin,
  realtime,
  createRealtime,
  websocket,
  sse,
  socketIo,
  redis,
  createRedisAdapter,
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
  getServiceRegistry,
  hasServiceRegistry,
  resetAppContext,
  setAppContext,

  // Services Layer
  createServiceRegistry,
  defineService,
  service: defineService,
  ServiceRegistry,
  memoize: require('./src/services').memoize,
  parseTtlMs: require('./src/services').parseTtlMs,
  stableCacheKey: require('./src/services').stableCacheKey,
  sanitizeInput: require('./src/services').sanitizeInput,
  maskSensitiveData: require('./src/services').maskSensitiveData,
  discoverServices: require('./src/services').discoverServices,
  filePathToServiceName: require('./src/services').filePathToServiceName,
  toCamelCase: require('./src/services').toCamelCase,
  createAuthServices: require('./src/services').createAuthServices,
  createMailServices: require('./src/services').createMailServices,
  createMediaServices: require('./src/services').createMediaServices,
  createSystemServices: require('./src/services').createSystemServices,
  createExchangeServices: require('./src/services').createExchangeServices,
  validateServiceInput: require('./src/services').validateServiceInput,
  executeService: require('./src/services').executeService,

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

  // SSR Streaming
  ssr: require('./core/ssr'),
  renderStream: require('./core/ssr').renderStream,
  createHtmlStream: require('./core/ssr').createHtmlStream,
  
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
  corsPlugin,
  emailPlugin,
  basicAuthPlugin,
  realtimePlugin,
  realtime,
  createRealtime,
  websocket,
  sse,
  socketIo,
  redis,
  createRedisAdapter,
  queuePlugin: require('./plugins/queue'),
  queue: require('./core/queue'),
  createQueueManager: require('./core/queue').createQueueManager,
  QueueManager: require('./core/queue').QueueManager,

  // Schema-driven CMS core (framework-agnostic)
  content,
};

