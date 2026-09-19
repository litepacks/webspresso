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

// Discovery, Pages, API, Modules & Routing primitives
const { definePage } = require('./src/pages/define-page');
const { defineApi } = require('./src/api/define-api');
const { defineModule } = require('./src/modules/define-module');
const { scanRoutes } = require('./src/discovery/scan-routes');
const { parseFileRoute } = require('./src/discovery/file-route-parser');
const { compileRouteTable, RouteTable } = require('./src/routing/route-table');
const { mountDiscoveredRoutes } = require('./src/routing/mount-discovered-routes');

// ORM exports (lazy loaded)
const orm = require('./core/orm');

// Lazy-loaded built-in plugins
const plugins = require('./plugins');

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
  createFileManagerServices: require('./src/services').createFileManagerServices,
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

  // Discovery, Pages, API, Modules & Routing primitives
  definePage,
  page: definePage,
  defineApi,
  api: defineApi,
  defineModule,
  module: defineModule,
  scanRoutes,
  parseFileRoute,
  compileRouteTable,
  RouteTable,
  mountDiscoveredRoutes,
};

// Define lazy getters for plugins and heavy core subsystems
Object.defineProperties(module.exports, {
  ...Object.getOwnPropertyDescriptors(plugins),

  // SSR Streaming
  ssr: { get: () => require('./core/ssr'), enumerable: true, configurable: true },
  renderStream: { get: () => require('./core/ssr').renderStream, enumerable: true, configurable: true },
  createHtmlStream: { get: () => require('./core/ssr').createHtmlStream, enumerable: true, configurable: true },

  /** Event bus / plugin shell / view resolver / flows (`kernel.createApp` is distinct from SSR `createApp`) */
  kernel: { get: () => require('./core/kernel'), enumerable: true, configurable: true },

  // Validation
  z: { get: () => require('./core/validation').z, enumerable: true, configurable: true },

  // Background jobs & queue
  queue: { get: () => require('./core/queue'), enumerable: true, configurable: true },
  createQueueManager: { get: () => require('./core/queue').createQueueManager, enumerable: true, configurable: true },
  QueueManager: { get: () => require('./core/queue').QueueManager, enumerable: true, configurable: true },

  // Schema-driven CMS core (framework-agnostic)
  content: { get: () => require('./core/content'), enumerable: true, configurable: true },
});

