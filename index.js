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
  isRouteGroupSegment,
  stripRouteGroups,
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
  isRouteGroupSegment,
  stripRouteGroups,
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
  resolveMiddlewares: require('./src/routing/middleware-resolver').resolveMiddlewares,
};

// Define lazy getters for plugins and heavy core subsystems
Object.defineProperties(module.exports, {
  ...Object.getOwnPropertyDescriptors(plugins),

  // Cascading Middleware & Layouts
  cascading: { get: () => require('./src/routing/cascading'), enumerable: true, configurable: true },

  // SSR Streaming
  ssr: { get: () => require('./core/ssr'), enumerable: true, configurable: true },
  renderStream: { get: () => require('./core/ssr').renderStream, enumerable: true, configurable: true },
  createHtmlStream: { get: () => require('./core/ssr').createHtmlStream, enumerable: true, configurable: true },

  // Server-Sent Events (SSE) Streaming
  sse: { get: () => require('./core/sse'), enumerable: true, configurable: true },
  createSseStream: { get: () => require('./core/sse').createSseStream, enumerable: true, configurable: true },
  ServerSentEventsStream: { get: () => require('./core/sse').ServerSentEventsStream, enumerable: true, configurable: true },

  /** Event bus / plugin shell / view resolver / flows (`kernel.createApp` is distinct from SSR `createApp`) */
  kernel: { get: () => require('./core/kernel'), enumerable: true, configurable: true },

  // Authentication & OAuth
  auth: { get: () => require('./core/auth'), enumerable: true, configurable: true },
  createAuth: { get: () => require('./core/auth').createAuth, enumerable: true, configurable: true },
  quickAuth: { get: () => require('./core/auth').quickAuth, enumerable: true, configurable: true },

  // 2FA / TOTP (RFC 6238, RFC 4226, RFC 4648)
  totp: { get: () => require('./core/auth/totp'), enumerable: true, configurable: true },
  base32Encode: { get: () => require('./core/auth/totp').base32Encode, enumerable: true, configurable: true },
  base32Decode: { get: () => require('./core/auth/totp').base32Decode, enumerable: true, configurable: true },
  generateTotpSecret: { get: () => require('./core/auth/totp').generateTotpSecret, enumerable: true, configurable: true },
  generateHotp: { get: () => require('./core/auth/totp').generateHotp, enumerable: true, configurable: true },
  verifyHotp: { get: () => require('./core/auth/totp').verifyHotp, enumerable: true, configurable: true },
  generateTotp: { get: () => require('./core/auth/totp').generateTotp, enumerable: true, configurable: true },
  verifyTotp: { get: () => require('./core/auth/totp').verifyTotp, enumerable: true, configurable: true },
  generateTotpUri: { get: () => require('./core/auth/totp').generateTotpUri, enumerable: true, configurable: true },
  generateTotpQrSvg: { get: () => require('./core/auth/totp').generateTotpQrSvg, enumerable: true, configurable: true },
  generateTotpQrDataUri: { get: () => require('./core/auth/totp').generateTotpQrDataUri, enumerable: true, configurable: true },
  generateRecoveryCodes: { get: () => require('./core/auth/totp').generateRecoveryCodes, enumerable: true, configurable: true },
  hashRecoveryCode: { get: () => require('./core/auth/totp').hashRecoveryCode, enumerable: true, configurable: true },
  verifyRecoveryCode: { get: () => require('./core/auth/totp').verifyRecoveryCode, enumerable: true, configurable: true },
  createTotpSetup: { get: () => require('./core/auth/totp').createTotpSetup, enumerable: true, configurable: true },
  createQrMatrix: { get: () => require('./core/auth/totp').createQrMatrix, enumerable: true, configurable: true },
  generateQrSvg: { get: () => require('./core/auth/qrcode').generateQrSvg, enumerable: true, configurable: true },
  generateQrDataUri: { get: () => require('./core/auth/qrcode').generateQrDataUri, enumerable: true, configurable: true },
  createAuthMiddleware: { get: () => require('./core/auth').createAuthMiddleware, enumerable: true, configurable: true },
  setupAuthMiddleware: { get: () => require('./core/auth').setupAuthMiddleware, enumerable: true, configurable: true },

  // Validation
  z: { get: () => require('./core/validation').z, enumerable: true, configurable: true },

  // Background jobs & queue
  queue: { get: () => require('./core/queue'), enumerable: true, configurable: true },
  createQueueManager: { get: () => require('./core/queue').createQueueManager, enumerable: true, configurable: true },
  QueueManager: { get: () => require('./core/queue').QueueManager, enumerable: true, configurable: true },
  TaskScheduler: { get: () => require('./core/queue').TaskScheduler, enumerable: true, configurable: true },
  CronExpression: { get: () => require('./core/queue').CronExpression, enumerable: true, configurable: true },
  parseCron: { get: () => require('./core/queue').parseCron, enumerable: true, configurable: true },
  isValidCron: { get: () => require('./core/queue').isValidCron, enumerable: true, configurable: true },

  // Schema-driven CMS core (framework-agnostic)
  content: { get: () => require('./core/content'), enumerable: true, configurable: true },

  // Dev live reload & bundler
  createDevReloadHub: { get: () => require('./src/dev-reload').createDevReloadHub, enumerable: true, configurable: true },
  createDevBundler: { get: () => require('./src/bundle').createDevBundler, enumerable: true, configurable: true },
  buildBundle: { get: () => require('./src/bundle').buildBundle, enumerable: true, configurable: true },
  generateManifest: { get: () => require('./src/bundle').generateManifest, enumerable: true, configurable: true },
  createManifestPlugin: { get: () => require('./src/bundle').createManifestPlugin, enumerable: true, configurable: true },
  findDefaultEntryPoints: { get: () => require('./src/bundle').findDefaultEntryPoints, enumerable: true, configurable: true },
  findPageEntryPoints: { get: () => require('./src/bundle').findPageEntryPoints, enumerable: true, configurable: true },

  // Dev & DX Tooling
  dev: { get: () => require('./src/dev'), enumerable: true, configurable: true },
  formatDevBanner: { get: () => require('./src/dev').formatDevBanner, enumerable: true, configurable: true },
  printDevBanner: { get: () => require('./src/dev').printDevBanner, enumerable: true, configurable: true },
  formatRouteTable: { get: () => require('./src/dev').formatRouteTable, enumerable: true, configurable: true },
  createDevProfilerMiddleware: { get: () => require('./src/dev').createDevProfilerMiddleware, enumerable: true, configurable: true },
  generateTypes: { get: () => require('./src/dev/typegen').generateTypes, enumerable: true, configurable: true },
  typegen: { get: () => require('./src/dev/typegen'), enumerable: true, configurable: true },

  // Webhooks plugin
  webhooks: { get: () => require('./plugins/webhooks'), enumerable: true, configurable: true },
  webhooksPlugin: { get: () => require('./plugins/webhooks').webhooksPlugin, enumerable: true, configurable: true },
});

