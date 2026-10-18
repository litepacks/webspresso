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
  getCache,
  hasCache,
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
const earlyHints = require('./core/early-hints');
const limits = require('./core/limits');
const health = require('./core/health');
const cache = require('./core/cache');
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
const { scanRoutes, discoverAppRoutes } = require('./src/discovery/scan-routes');
const { generateRouteManifest, loadRouteManifest } = require('./src/discovery/route-manifest');
const { precompileTemplates, loadPrecompiledTemplates } = require('./src/template/precompile');
const { parseFileRoute } = require('./src/discovery/file-route-parser');
const { compileRouteTable, RouteTable } = require('./src/routing/route-table');
const { mountDiscoveredRoutes } = require('./src/routing/mount-discovered-routes');

// Lazy-loaded ORM accessor
let _orm = null;
function getOrm() {
  if (!_orm) {
    _orm = require('./core/orm');
  }
  return _orm;
}

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
  getCache,
  hasCache,
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
  validateServiceInput: require('./src/services').validateServiceInput,
  executeService: require('./src/services').executeService,

  // Shutdown & Lifecycle
  ShutdownManager,
  NodeHttpAdapter,

  // HTTP Response Compression
  compression,
  createCompressionMiddleware: compression.createCompressionMiddleware,

  // HTTP 103 Early Hints
  earlyHints,
  sendEarlyHints: earlyHints.sendEarlyHints,
  createEarlyHintsMiddleware: earlyHints.createEarlyHintsMiddleware,
  formatLink: earlyHints.formatLink,
  formatLinkHeader: earlyHints.formatLinkHeader,
  inferAsType: earlyHints.inferAsType,

  // Payload Limits & DoS Protection
  limits,
  normalizeLimits: limits.normalizeLimits,
  setupLimitsMiddleware: limits.setupLimitsMiddleware,
  createLimitsMiddleware: limits.createLimitsMiddleware,
  parseByteSize: limits.parseByteSize,

  // Health & Readiness Probes
  health,
  normalizeHealthConfig: health.normalizeHealthConfig,
  setupHealthMiddleware: health.setupHealthMiddleware,
  createHealthManager: health.createHealthManager,
  probeDatabase: health.probeDatabase,
  probeQueue: health.probeQueue,

  // High-Performance In-Memory & Tagged LRU Cache Engine
  cache,
  LruCache: cache.LruCache,
  createLruCache: cache.createLruCache,
  TaggedLruCache: cache.TaggedLruCache,
  createTaggedLruCache: cache.createTaggedLruCache,
  approximateByteSize: cache.approximateByteSize,

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
  RequestTimeoutError: errors.RequestTimeoutError,
  TooManyRequestsError: errors.TooManyRequestsError,
  ServiceUnavailableError: errors.ServiceUnavailableError,
  GatewayTimeoutError: errors.GatewayTimeoutError,
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

  // Discovery, Pages, API, Modules & Routing primitives
  definePage,
  page: definePage,
  defineApi,
  api: defineApi,
  defineModule,
  module: defineModule,
  scanRoutes,
  discoverAppRoutes,
  generateRouteManifest,
  loadRouteManifest,
  precompileTemplates,
  loadPrecompiledTemplates,
  parseFileRoute,
  compileRouteTable,
  RouteTable,
  mountDiscoveredRoutes,
  resolveMiddlewares: require('./src/routing/middleware-resolver').resolveMiddlewares,
  translateValidationIssues: require('./src/api/validation-i18n').translateValidationIssues,
  getTranslatorForRequest: require('./src/api/validation-i18n').getTranslatorForRequest,

  // Forms & Flash subsystem (AdonisJS & Django-inspired)
  createFlashMiddleware: require('./core/forms').createFlashMiddleware,
  normalizeErrors: require('./core/forms').normalizeErrors,
  renderField: require('./core/forms').renderField,
  renderFormFor: require('./core/forms').renderFormFor,

  // Authorization & Policies (AdonisJS Bouncer & Django Permissions-inspired)
  Bouncer: require('./core/auth/bouncer').Bouncer,
  createBouncer: require('./core/auth/bouncer').createBouncer,
  createBouncerMiddleware: require('./core/auth/bouncer').createBouncerMiddleware,
  definePolicy: require('./core/auth/policy').definePolicy,
  defineGate: require('./core/auth/policy').defineGate,
  can: require('./core/auth/policy').can,
  cannot: require('./core/auth/policy').cannot,
  authorize: require('./core/auth/policy').authorize,

  // Decoupled Events & Signals (AdonisJS Events & Django Signals-inspired)
  EventDispatcher: require('./core/events').EventDispatcher,
  createEventDispatcher: require('./core/events').createEventDispatcher,
  events: require('./core/events').events,
  Signal: require('./core/events').Signal,
  defineSignal: require('./core/events').defineSignal,
  defineListener: require('./core/events').defineListener,
  loadListeners: require('./core/events').loadListeners,

  // Shared Fetch, Crypto & HTML Utilities
  fetchWithTimeout: require('./core/utils/fetch').fetchWithTimeout,
  safeCompare: require('./core/utils/crypto').safeCompare,
  sha256: require('./core/utils/crypto').sha256,
  hmacSha256: require('./core/utils/crypto').hmacSha256,
  randomToken: require('./core/utils/crypto').randomToken,
  randomId: require('./core/utils/crypto').randomId,
  base64UrlEncode: require('./core/utils/crypto').base64UrlEncode,
  base64UrlDecode: require('./core/utils/crypto').base64UrlDecode,
  escapeHtml: require('./core/utils/html').escapeHtml,
  unescapeHtml: require('./core/utils/html').unescapeHtml,
  walkDirectory: require('./core/utils/fs').walkDirectory,
  walkDirectoryDetailed: require('./core/utils/fs').walkDirectoryDetailed,
  stripTrailingSlash: require('./core/utils/url').stripTrailingSlash,
  ensureLeadingSlash: require('./core/utils/url').ensureLeadingSlash,
  ensureTrailingSlash: require('./core/utils/url').ensureTrailingSlash,
  stripLeadingSlash: require('./core/utils/url').stripLeadingSlash,
  joinUrl: require('./core/utils/url').joinUrl,
  escapeRegExp: require('./core/utils/regex').escapeRegExp,
  escapeRegex: require('./core/utils/regex').escapeRegExp,
  globToRegExp: require('./core/utils/regex').globToRegExp,
  parseDurationSec: require('./core/utils/time').parseDurationSec,
  parseDuration: require('./core/utils/time').parseDurationSec,
  parseDurationMs: require('./core/utils/time').parseDurationMs,
  sleep: require('./core/utils/time').sleep,
  safeJsonParse: require('./core/utils/json').safeJsonParse,
  safeJsonStringify: require('./core/utils/json').safeJsonStringify,
  isValidJson: require('./core/utils/json').isValidJson,
  toSnakeCase: require('./core/utils/string').toSnakeCase,
  snakeToCamel: require('./core/utils/string').snakeToCamel,
  camelToSnake: require('./core/utils/string').camelToSnake,
  toKebabCase: require('./core/utils/string').toKebabCase,
  toPascalCase: require('./core/utils/string').toPascalCase,
  ensureArray: require('./core/utils/object').ensureArray,
  pick: require('./core/utils/object').pick,
  omit: require('./core/utils/object').omit,
  deepClone: require('./core/utils/object').deepClone,

  // Timeout Utilities & Middleware
  DEFAULT_TIMEOUTS: require('./core/utils/timeout').DEFAULT_TIMEOUTS,
  normalizeTimeouts: require('./core/utils/timeout').normalizeTimeouts,
  withTimeout: require('./core/utils/timeout').withTimeout,
  createTimeoutMiddleware: require('./core/utils/timeout').createTimeoutMiddleware,
  TimeoutError: require('./core/utils/timeout').TimeoutError,
};

// Define lazy getters for plugins, ORM, and heavy core subsystems
Object.defineProperties(module.exports, {
  ...Object.getOwnPropertyDescriptors(plugins),

  // Built-in Services Creators (lazy loaded)
  createAuthServices: { get: () => require('./src/services').createAuthServices, enumerable: true, configurable: true },
  createMailServices: { get: () => require('./src/services').createMailServices, enumerable: true, configurable: true },
  createMediaServices: { get: () => require('./src/services').createMediaServices, enumerable: true, configurable: true },
  createFileManagerServices: { get: () => require('./src/services').createFileManagerServices, enumerable: true, configurable: true },
  createSystemServices: { get: () => require('./src/services').createSystemServices, enumerable: true, configurable: true },
  createExchangeServices: { get: () => require('./src/services').createExchangeServices, enumerable: true, configurable: true },

  // ORM & Database Layer (lazy loaded)
  orm: { get: () => getOrm(), enumerable: true, configurable: true },
  createDatabase: { get: () => getOrm().createDatabase, enumerable: true, configurable: true },
  createInMemoryDatabase: { get: () => getOrm().createInMemoryDatabase, enumerable: true, configurable: true },
  defineModel: { get: () => getOrm().defineModel, enumerable: true, configurable: true },
  zdb: { get: () => getOrm().zdb, enumerable: true, configurable: true },
  BaseRepository: { get: () => getOrm().BaseRepository, enumerable: true, configurable: true },
  Repository: { get: () => getOrm().Repository, enumerable: true, configurable: true },
  createRepository: { get: () => getOrm().createRepository, enumerable: true, configurable: true },
  getModel: { get: () => getOrm().getModel, enumerable: true, configurable: true },
  getAllModels: { get: () => getOrm().getAllModels, enumerable: true, configurable: true },
  hasModel: { get: () => getOrm().hasModel, enumerable: true, configurable: true },
  clearRegistry: { get: () => getOrm().clearRegistry, enumerable: true, configurable: true },
  isCascadeEnabled: { get: () => getOrm().isCascadeEnabled, enumerable: true, configurable: true },
  extractColumnsFromSchema: { get: () => getOrm().extractColumnsFromSchema, enumerable: true, configurable: true },
  getColumnMeta: { get: () => getOrm().getColumnMeta, enumerable: true, configurable: true },
  generateNanoid: { get: () => getOrm().generateNanoid, enumerable: true, configurable: true },
  zodNanoid: { get: () => getOrm().zodNanoid, enumerable: true, configurable: true },
  extendZ: { get: () => getOrm().extendZ, enumerable: true, configurable: true },
  omitHiddenColumns: { get: () => getOrm().omitHiddenColumns, enumerable: true, configurable: true },
  sanitizeForOutput: { get: () => getOrm().sanitizeForOutput, enumerable: true, configurable: true },
  ModelEvents: { get: () => getOrm().ModelEvents, enumerable: true, configurable: true },
  Hooks: { get: () => getOrm().Hooks, enumerable: true, configurable: true },
  HookCancellationError: { get: () => getOrm().HookCancellationError, enumerable: true, configurable: true },
  createEventContext: { get: () => getOrm().createEventContext, enumerable: true, configurable: true },
  getTransactionContext: { get: () => getOrm().getTransactionContext, enumerable: true, configurable: true },
  createTransactionContext: { get: () => getOrm().createTransactionContext, enumerable: true, configurable: true },
  runTransaction: { get: () => getOrm().runTransaction, enumerable: true, configurable: true },
  createSchemaHelpers: { get: () => getOrm().createSchemaHelpers, enumerable: true, configurable: true },
  loadRelations: { get: () => getOrm().loadRelations, enumerable: true, configurable: true },
  loadRelation: { get: () => getOrm().loadRelation, enumerable: true, configurable: true },
  parseRelationTree: { get: () => getOrm().parseRelationTree, enumerable: true, configurable: true },
  QueryComplexityError: { get: () => getOrm().QueryComplexityError, enumerable: true, configurable: true },
  validateQueryComplexity: { get: () => getOrm().validateQueryComplexity, enumerable: true, configurable: true },
  resolveQueryLimits: { get: () => getOrm().resolveQueryLimits, enumerable: true, configurable: true },
  DEFAULT_QUERY_LIMITS: { get: () => getOrm().DEFAULT_QUERY_LIMITS, enumerable: true, configurable: true },
  buildSearchClause: { get: () => getOrm().buildSearchClause, enumerable: true, configurable: true },
  tokenizeSearchTerm: { get: () => getOrm().tokenizeSearchTerm, enumerable: true, configurable: true },
  detectDialect: { get: () => getOrm().detectDialect, enumerable: true, configurable: true },
  defineFactory: { get: () => getOrm().defineFactory, enumerable: true, configurable: true },
  FactoryBuilder: { get: () => getOrm().FactoryBuilder, enumerable: true, configurable: true },
  diffSchema: { get: () => getOrm().diffSchema, enumerable: true, configurable: true },
  makeMigrations: { get: () => getOrm().makeMigrations, enumerable: true, configurable: true },
  calculateSafeChunkSize: { get: () => getOrm().calculateSafeChunkSize, enumerable: true, configurable: true },
  chunkArray: { get: () => getOrm().chunkArray, enumerable: true, configurable: true },

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
  getClientIp: { get: () => require('./core/utils/ip').getClientIp, enumerable: true, configurable: true },
  parseUserAgent: { get: () => require('./core/auth').parseUserAgent, enumerable: true, configurable: true },
  sessions: { get: () => require('./core/auth').sessions, enumerable: true, configurable: true },
  SessionManager: { get: () => require('./core/auth').SessionManager, enumerable: true, configurable: true },

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

  // Mail & Mailable (AdonisJS & Django-inspired)
  mail: { get: () => require('./core/mail'), enumerable: true, configurable: true },
  Mailable: { get: () => require('./core/mail').Mailable, enumerable: true, configurable: true },
  createMailer: { get: () => require('./core/mail').createMailer, enumerable: true, configurable: true },
  Mailer: { get: () => require('./core/mail').Mailer, enumerable: true, configurable: true },
  MemoryTransport: { get: () => require('./core/mail').MemoryTransport, enumerable: true, configurable: true },
  ConsoleTransport: { get: () => require('./core/mail').ConsoleTransport, enumerable: true, configurable: true },
  FileTransport: { get: () => require('./core/mail').FileTransport, enumerable: true, configurable: true },

  // Commands & CLI (Django manage.py & Adonis Ace-inspired)
  commands: { get: () => require('./core/commands'), enumerable: true, configurable: true },
  defineCommand: { get: () => require('./core/commands').defineCommand, enumerable: true, configurable: true },
  createCommandRegistry: { get: () => require('./core/commands').createCommandRegistry, enumerable: true, configurable: true },
  executeCommand: { get: () => require('./core/commands').executeCommand, enumerable: true, configurable: true },

  // Row Level Security (RLS) plugin
  rlsPlugin: { get: () => require('./plugins/rls').rlsPlugin, enumerable: true, configurable: true },
  createRlsMiddleware: { get: () => require('./plugins/rls').createRlsMiddleware, enumerable: true, configurable: true },
});

