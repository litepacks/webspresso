'use strict';

/**
 * Webspresso Core
 * Framework-agnostic kernel providing services, ORM, events, cache, resilience,
 * validation, and lifecycle coordination with zero Express dependencies.
 *
 * @module core
 */

const { CoreApp, createCoreApp } = require('./app');
const {
  createServiceRegistry,
  defineService,
  ServiceRegistry,
  executeService,
  discoverServices,
  filePathToServiceName,
  toCamelCase,
  validateServiceInput,
  memoize,
  parseTtlMs,
  stableCacheKey,
  sanitizeInput,
  maskSensitiveData,
} = require('../src/services');

const { ShutdownManager } = require('./shutdown');
const errors = require('./errors');
const cache = require('./cache');
const resilience = require('./resilience');
const events = require('./events');
const secrets = require('./secrets');
const metrics = require('./metrics');
const {
  PluginManager,
  createPluginManager,
  getPluginManager,
  resetPluginManager,
} = require('../src/plugin-manager');

// Lazy-loaded ORM accessor
let _orm = null;
function getOrm() {
  if (!_orm) {
    _orm = require('./orm');
  }
  return _orm;
}

module.exports = {
  // Core Application Container
  CoreApp,
  createCoreApp,

  // Services Layer
  createServiceRegistry,
  defineService,
  service: defineService,
  ServiceRegistry,
  executeService,
  discoverServices,
  filePathToServiceName,
  toCamelCase,
  validateServiceInput,
  memoize,
  parseTtlMs,
  stableCacheKey,
  sanitizeInput,
  maskSensitiveData,

  // Route & Endpoint Declarations
  defineApi: require('../src/api/define-api').defineApi,
  api: require('../src/api/define-api').defineApi,
  definePage: require('../src/pages/define-page').definePage,
  page: require('../src/pages/define-page').definePage,

  // Lifecycle & Shutdown
  ShutdownManager,

  // In-Memory & Tagged Cache Engine
  cache,
  LruCache: cache.LruCache,
  createLruCache: cache.createLruCache,
  TaggedLruCache: cache.TaggedLruCache,
  createTaggedLruCache: cache.createTaggedLruCache,
  approximateByteSize: cache.approximateByteSize,
  normalizeCacheConfig: cache.normalizeCacheConfig,
  parseCacheTtlMs: cache.parseCacheTtlMs,
  createOrmCacheProvider: cache.createOrmCacheProvider,

  // Resilience & Fault Tolerance (Circuit Breaker & Retry Engine)
  resilience,
  CircuitBreaker: resilience.CircuitBreaker,
  createCircuitBreaker: resilience.createCircuitBreaker,
  STATE_CLOSED: resilience.STATE_CLOSED,
  STATE_OPEN: resilience.STATE_OPEN,
  STATE_HALF_OPEN: resilience.STATE_HALF_OPEN,
  retry: resilience.retry,
  withRetry: resilience.withRetry,
  isTransientError: resilience.isTransientError,
  calculateBackoffDelay: resilience.calculateBackoffDelay,
  CircuitBreakerRegistry: resilience.CircuitBreakerRegistry,
  circuitBreakerRegistry: resilience.circuitBreakerRegistry,
  getBreaker: resilience.getBreaker,
  CircuitBreakerOpenError: resilience.CircuitBreakerOpenError,
  CircuitBreakerTimeoutError: resilience.CircuitBreakerTimeoutError,

  // Decoupled Events & Signals
  events: events.events,
  EventDispatcher: events.EventDispatcher,
  createEventDispatcher: events.createEventDispatcher,
  Signal: events.Signal,
  defineSignal: events.defineSignal,
  defineListener: events.defineListener,
  loadListeners: events.loadListeners,

  // Cloud Secrets Management
  secrets,
  SecretManager: secrets.SecretManager,
  createSecretManager: secrets.createSecretManager,
  loadSecrets: secrets.loadSecrets,
  resolveSecret: secrets.resolveSecret,
  SecretNotFoundError: secrets.SecretNotFoundError,
  GcpSecretProvider: secrets.GcpSecretProvider,
  AwsSecretProvider: secrets.AwsSecretProvider,
  EnvSecretProvider: secrets.EnvSecretProvider,
  MemorySecretProvider: secrets.MemorySecretProvider,

  // Cloud Metrics & Distributed Tracing
  metrics,
  MetricsRegistry: metrics.MetricsRegistry,
  createMetricsRegistry: metrics.createMetricsRegistry,
  setupMetricsMiddleware: metrics.setupMetricsMiddleware,
  createMetricsManager: metrics.createMetricsManager,

  // Exceptions & Errors
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
  normalizeError: errors.normalizeError,
  toErrorResponseObject: errors.toErrorResponseObject,

  // Validation
  z: require('./validation').z,

  // Plugin System
  PluginManager,
  createPluginManager,
  getPluginManager,
  resetPluginManager,

  // Core Utilities
  fetchWithTimeout: require('./utils/fetch').fetchWithTimeout,
  safeCompare: require('./utils/crypto').safeCompare,
  sha256: require('./utils/crypto').sha256,
  hmacSha256: require('./utils/crypto').hmacSha256,
  randomToken: require('./utils/crypto').randomToken,
  randomId: require('./utils/crypto').randomId,
  base64UrlEncode: require('./utils/crypto').base64UrlEncode,
  base64UrlDecode: require('./utils/crypto').base64UrlDecode,
  escapeHtml: require('./utils/html').escapeHtml,
  unescapeHtml: require('./utils/html').unescapeHtml,
  walkDirectory: require('./utils/fs').walkDirectory,
  walkDirectoryDetailed: require('./utils/fs').walkDirectoryDetailed,
  stripTrailingSlash: require('./utils/url').stripTrailingSlash,
  ensureLeadingSlash: require('./utils/url').ensureLeadingSlash,
  ensureTrailingSlash: require('./utils/url').ensureTrailingSlash,
  stripLeadingSlash: require('./utils/url').stripLeadingSlash,
  joinUrl: require('./utils/url').joinUrl,
  escapeRegExp: require('./utils/regex').escapeRegExp,
  escapeRegex: require('./utils/regex').escapeRegExp,
  globToRegExp: require('./utils/regex').globToRegExp,
  parseDurationSec: require('./utils/time').parseDurationSec,
  parseDuration: require('./utils/time').parseDurationSec,
  parseDurationMs: require('./utils/time').parseDurationMs,
  sleep: require('./utils/time').sleep,
  safeJsonParse: require('./utils/json').safeJsonParse,
  safeJsonStringify: require('./utils/json').safeJsonStringify,
  isValidJson: require('./utils/json').isValidJson,
  toSnakeCase: require('./utils/string').toSnakeCase,
  snakeToCamel: require('./utils/string').snakeToCamel,
  camelToSnake: require('./utils/string').camelToSnake,
  toKebabCase: require('./utils/string').toKebabCase,
  toPascalCase: require('./utils/string').toPascalCase,
  ensureArray: require('./utils/object').ensureArray,
  pick: require('./utils/object').pick,
  omit: require('./utils/object').omit,
  deepClone: require('./utils/object').deepClone,

  // Timeouts
  DEFAULT_TIMEOUTS: require('./utils/timeout').DEFAULT_TIMEOUTS,
  normalizeTimeouts: require('./utils/timeout').normalizeTimeouts,
  withTimeout: require('./utils/timeout').withTimeout,
  TimeoutError: require('./utils/timeout').TimeoutError,

  // Authorization & Policies
  Bouncer: require('./auth/bouncer').Bouncer,
  createBouncer: require('./auth/bouncer').createBouncer,
  definePolicy: require('./auth/policy').definePolicy,
  defineGate: require('./auth/policy').defineGate,
  can: require('./auth/policy').can,
  cannot: require('./auth/policy').cannot,
  authorize: require('./auth/policy').authorize,

  // Forms
  normalizeErrors: require('./forms').normalizeErrors,
  renderField: require('./forms').renderField,
  renderFormFor: require('./forms').renderFormFor,
};

// Lazy getters for ORM, queue, mail, commands, and built-in service factories
Object.defineProperties(module.exports, {
  // Built-in Services Creators
  createAuthServices: { get: () => require('../src/services').createAuthServices, enumerable: true, configurable: true },
  createMailServices: { get: () => require('../src/services').createMailServices, enumerable: true, configurable: true },
  createMediaServices: { get: () => require('../src/services').createMediaServices, enumerable: true, configurable: true },
  createFileManagerServices: { get: () => require('../src/services').createFileManagerServices, enumerable: true, configurable: true },
  createSystemServices: { get: () => require('../src/services').createSystemServices, enumerable: true, configurable: true },
  createExchangeServices: { get: () => require('../src/services').createExchangeServices, enumerable: true, configurable: true },

  // ORM & Database Layer
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
  runTransaction: { get: () => getOrm().runTransaction, enumerable: true, configurable: true },
  runCloudMigration: { get: () => getOrm().runCloudMigration, enumerable: true, configurable: true },
  waitForDatabaseConnection: { get: () => getOrm().waitForDatabaseConnection, enumerable: true, configurable: true },
  freeStaleMigrationLock: { get: () => getOrm().freeStaleMigrationLock, enumerable: true, configurable: true },
  getMigrationStatus: { get: () => getOrm().getMigrationStatus, enumerable: true, configurable: true },

  // Background Jobs & Queue
  queue: { get: () => require('./queue'), enumerable: true, configurable: true },
  createQueueManager: { get: () => require('./queue').createQueueManager, enumerable: true, configurable: true },
  QueueManager: { get: () => require('./queue').QueueManager, enumerable: true, configurable: true },
  TaskScheduler: { get: () => require('./queue').TaskScheduler, enumerable: true, configurable: true },
  CronExpression: { get: () => require('./queue').CronExpression, enumerable: true, configurable: true },
  parseCron: { get: () => require('./queue').parseCron, enumerable: true, configurable: true },
  isValidCron: { get: () => require('./queue').isValidCron, enumerable: true, configurable: true },
  SqsQueueAdapter: { get: () => require('./queue').SqsQueueAdapter, enumerable: true, configurable: true },
  PubSubQueueAdapter: { get: () => require('./queue').PubSubQueueAdapter, enumerable: true, configurable: true },

  // Mail & Mailable
  mail: { get: () => require('./mail'), enumerable: true, configurable: true },
  Mailable: { get: () => require('./mail').Mailable, enumerable: true, configurable: true },
  createMailer: { get: () => require('./mail').createMailer, enumerable: true, configurable: true },
  Mailer: { get: () => require('./mail').Mailer, enumerable: true, configurable: true },
  MemoryTransport: { get: () => require('./mail').MemoryTransport, enumerable: true, configurable: true },
  ConsoleTransport: { get: () => require('./mail').ConsoleTransport, enumerable: true, configurable: true },
  FileTransport: { get: () => require('./mail').FileTransport, enumerable: true, configurable: true },

  // Commands & CLI
  commands: { get: () => require('./commands'), enumerable: true, configurable: true },
  defineCommand: { get: () => require('./commands').defineCommand, enumerable: true, configurable: true },
  createCommandRegistry: { get: () => require('./commands').createCommandRegistry, enumerable: true, configurable: true },
  executeCommand: { get: () => require('./commands').executeCommand, enumerable: true, configurable: true },

  // Content
  content: { get: () => require('./content'), enumerable: true, configurable: true },

  // HTTP Adapter & Pipeline Layer
  http: { get: () => require('./http'), enumerable: true, configurable: true },
  HttpAdapter: { get: () => require('./http').HttpAdapter, enumerable: true, configurable: true },
  ExpressHttpAdapter: { get: () => require('./http').ExpressHttpAdapter, enumerable: true, configurable: true },
  createExpressHttpAdapter: { get: () => require('./http').createExpressHttpAdapter, enumerable: true, configurable: true },
  HonoHttpAdapter: { get: () => require('./http').HonoHttpAdapter, enumerable: true, configurable: true },
  createHonoHttpAdapter: { get: () => require('./http').createHonoHttpAdapter, enumerable: true, configurable: true },
  executeApiPipeline: { get: () => require('./http').executeApiPipeline, enumerable: true, configurable: true },
  executePagePipeline: { get: () => require('./http').executePagePipeline, enumerable: true, configurable: true },
  runMiddlewares: { get: () => require('./http').runMiddlewares, enumerable: true, configurable: true },
  enrichRouteError: { get: () => require('./http').enrichRouteError, enumerable: true, configurable: true },

  // Authentication & Verification
  auth: { get: () => require('./auth'), enumerable: true, configurable: true },
  authenticateRequest: { get: () => require('./auth').authenticateRequest, enumerable: true, configurable: true },

  // Structured Cloud Logging
  logger: { get: () => require('./logger'), enumerable: true, configurable: true },
  createLogger: { get: () => require('./logger').createLogger, enumerable: true, configurable: true },
  createLogMiddleware: { get: () => require('./logger').createLogMiddleware, enumerable: true, configurable: true },
  CloudLogger: { get: () => require('./logger').CloudLogger, enumerable: true, configurable: true },
  extractTraceContext: { get: () => require('./logger').extractTraceContext, enumerable: true, configurable: true },

  // Stateless Scale-Out & Distributed Sessions
  createRedisSessionStore: { get: () => require('./auth').createRedisSessionStore, enumerable: true, configurable: true },
  createRedisSessionTracker: { get: () => require('./auth').createRedisSessionTracker, enumerable: true, configurable: true },
  RedisSessionStore: { get: () => require('./auth').RedisSessionStore, enumerable: true, configurable: true },
  createMiniRedisClient: { get: () => require('./auth').createMiniRedisClient, enumerable: true, configurable: true },

  // Serverless Database Connection Pool
  normalizeServerlessPoolConfig: { get: () => require('./orm').normalizeServerlessPoolConfig, enumerable: true, configurable: true },
  isServerlessEnvironment: { get: () => require('./orm').isServerlessEnvironment, enumerable: true, configurable: true },

  // Zero-Dependency Rate Limiting
  rateLimit: { get: () => require('./rate-limit').rateLimit, enumerable: true, configurable: true },
  createRateLimiter: { get: () => require('./rate-limit').createRateLimiter, enumerable: true, configurable: true },
  RateLimiter: { get: () => require('./rate-limit').RateLimiter, enumerable: true, configurable: true },
  MemoryRateLimitStore: { get: () => require('./rate-limit').MemoryRateLimitStore, enumerable: true, configurable: true },
  RedisRateLimitStore: { get: () => require('./rate-limit').RedisRateLimitStore, enumerable: true, configurable: true },

  // Zero-Dependency Feature Flags & Canary Traffic Splitter
  flags: { get: () => require('./flags'), enumerable: true, configurable: true },
  FeatureFlagManager: { get: () => require('./flags').FeatureFlagManager, enumerable: true, configurable: true },
  createFeatureFlagManager: { get: () => require('./flags').createFeatureFlagManager, enumerable: true, configurable: true },
  MemoryFlagStore: { get: () => require('./flags').MemoryFlagStore, enumerable: true, configurable: true },
  evaluateFlag: { get: () => require('./flags').evaluateFlag, enumerable: true, configurable: true },
  getBucket: { get: () => require('./flags').getBucket, enumerable: true, configurable: true },
});
