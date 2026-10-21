'use strict';

/**
 * Webspresso Core Application Container
 * Framework-agnostic application kernel encapsulating services, database,
 * events, cache, circuit breakers, and lifecycle management without HTTP dependencies.
 *
 * @module core/app
 */

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_TIMEOUTS,
  normalizeTimeouts,
} = require('./utils/timeout');
const { ShutdownManager } = require('./shutdown');
const {
  CircuitBreakerRegistry,
  retry,
  withRetry,
} = require('./resilience');
const { createTaggedLruCache } = require('./cache');
const { createEventDispatcher, loadListeners } = require('./events');
const { createPluginManager } = require('../src/plugin-manager');
const { createServiceRegistry } = require('../src/services');

let isWebspressoPackageCache = null;
function checkIsWebspressoPackage() {
  if (process.env.__WEBSPRESSO_TESTING__ === 'true') return true;
  if (isWebspressoPackageCache === null) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
      if (pkg && pkg.name === 'webspresso') {
        isWebspressoPackageCache = true;
      }
    } catch (_) {
      isWebspressoPackageCache = false;
    }
  }
  return isWebspressoPackageCache === true;
}

class CoreApp {
  /**
   * @param {Object} [options={}]
   */
  constructor(options = {}) {
    this.options = options;
    const NODE_ENV = process.env.NODE_ENV || 'development';
    this.isDev = NODE_ENV !== 'production';
    this.isTest = NODE_ENV === 'test';
    const logging = options.logging !== undefined ? options.logging : (this.isDev && !this.isTest);
    this.logging = logging;

    const { createLogger, CloudLogger } = require('./logger');
    let resolvedLogger = null;
    if (options.logger instanceof CloudLogger) {
      resolvedLogger = options.logger;
    } else if (options.logger && typeof options.logger === 'object' && options.logger !== console) {
      resolvedLogger = createLogger(options.logger);
    } else if (options.logger === true) {
      resolvedLogger = createLogger();
    } else if (options.logger) {
      resolvedLogger = options.logger;
    } else if (logging) {
      resolvedLogger = console;
    }
    this.logger = resolvedLogger;

    this.rootDir = options.rootDir || (() => {
      if (process.env.NODE_ENV === 'test') {
        if (checkIsWebspressoPackage()) return process.cwd();
        return path.resolve(__dirname, '..');
      }
      return process.cwd();
    })();

    // 1. Timeouts Configuration
    this.timeouts = normalizeTimeouts(options);

    // 2. Profiler Knex Auto-Instrumentation (if knex present)
    if (options.db && options.db.knex) {
      try {
        const { attachProfilerToKnex } = require('../src/dev');
        attachProfilerToKnex(options.db.knex);
      } catch (_) {}
    }

    // 3. Plugin Manager
    this.pluginManager = createPluginManager();

    // 4. Shutdown Manager (isolated per application instance)
    const shutdownConfig = {
      enabled: true,
      mode: this.isDev ? 'force' : 'graceful',
      timeout: this.isDev ? 1000 : (this.timeouts.shutdown !== false ? this.timeouts.shutdown : 10_000),
      ...(options.shutdown || options.server?.shutdown || {}),
    };

    this.shutdownManager = new ShutdownManager({
      ...shutdownConfig,
      logger: this.logger,
    });

    // 5. Circuit Breakers Layer (isolated per instance)
    this.breakers = options.breakers instanceof CircuitBreakerRegistry
      ? options.breakers
      : new CircuitBreakerRegistry();
    this.shutdownManager.onShutdown(() => {
      this.breakers.resetAll();
    });

    // 6. Services Layer
    const servicesDirOption = options.servicesDir ?? options.services?.dir;
    const resolvedServicesDir = servicesDirOption
      ? path.resolve(servicesDirOption)
      : (fs.existsSync(path.join(this.rootDir, 'services'))
        ? path.join(this.rootDir, 'services')
        : (fs.existsSync(path.join(process.cwd(), 'services'))
          ? path.join(process.cwd(), 'services')
          : null));

    this.serviceRegistry = createServiceRegistry({
      servicesDir: resolvedServicesDir,
      isDev: this.isDev,
      logger: this.logger,
      timeouts: this.timeouts,
    });

    // Auto-register built-in auth services if database is present
    if (options.db) {
      const { createAuthServices } = require('../src/services/builtins/auth');
      const authServices = createAuthServices({ db: options.db });
      for (const [name, def] of Object.entries(authServices)) {
        if (!this.serviceRegistry.has(name)) {
          this.serviceRegistry.register(name, def);
        }
      }
    }

    // Auto-register built-in system services (health, cleanup, cache flush, info)
    const { createSystemServices } = require('../src/services/builtins/system');
    const systemServices = createSystemServices({
      db: options.db ?? null,
      serviceRegistry: this.serviceRegistry,
      pluginManager: this.pluginManager,
    });
    for (const [name, def] of Object.entries(systemServices)) {
      if (!this.serviceRegistry.has(name)) {
        this.serviceRegistry.register(name, def);
      }
    }

    // 7. Events Subsystem
    this.events = options.events || createEventDispatcher({
      queue: options.queue || null,
      logger: this.logger,
    });
    this.shutdownManager.onShutdown(() => {
      this.events.removeAllListeners();
    });

    // Auto-bridge ORM lifecycle events (ModelEvents)
    if (options.db) {
      try {
        const { ModelEvents } = require('./orm/events');
        this.events.bridgeOrm(ModelEvents);
      } catch (_) {}
    }

    // Auto-discover listeners from listeners/ or options.listenersDir
    const listenersDirOption = options.listenersDir ?? options.listeners?.dir;
    const resolvedListenersDir = listenersDirOption
      ? path.resolve(listenersDirOption)
      : (fs.existsSync(path.join(this.rootDir, 'listeners'))
        ? path.join(this.rootDir, 'listeners')
        : null);
    if (resolvedListenersDir) {
      loadListeners(resolvedListenersDir, this.events, { logger: this.logger });
    }

    // 8. Native High-Performance In-Memory Cache
    const cacheOpt = options.cache ?? options.server?.cache;
    this.cache = cacheOpt === false ? null : createTaggedLruCache(typeof cacheOpt === 'object' ? cacheOpt : {});
    if (this.cache) {
      this.shutdownManager.onShutdown(() => this.cache.clear());
    }

    // 9. Secrets Manager
    if (options.secrets) {
      const { createSecretManager } = require('./secrets');
      this.secrets = createSecretManager(typeof options.secrets === 'object' ? options.secrets : {});
      this.shutdownManager.onShutdown(() => this.secrets.clearCache());
    } else {
      this.secrets = null;
    }

    // 9.5. Metrics Registry
    const metricsOpt = options.metrics ?? options.server?.metrics;
    if (metricsOpt !== false) {
      const { createMetricsRegistry } = require('./metrics');
      this.metrics = createMetricsRegistry();
    } else {
      this.metrics = null;
    }

    // 9.6. Feature Flags
    const flagsOpt = options.flags;
    if (flagsOpt) {
      const { createFeatureFlagManager } = require('./flags');
      this.flags = createFeatureFlagManager(typeof flagsOpt === 'object' ? flagsOpt : { flags: flagsOpt });
    } else {
      this.flags = null;
    }

    // 10. Database & Queue
    this.db = options.db ?? null;
    this.queue = options.queue ?? null;

    // 10. Module Services discovery (if modules directory exists)
    this.moduleMiddlewares = {};
    const modulesDirCandidate = options.modules?.dir
      ? (path.isAbsolute(options.modules.dir) ? options.modules.dir : path.join(this.rootDir, options.modules.dir))
      : (fs.existsSync(path.join(this.rootDir, 'src/modules'))
        ? path.join(this.rootDir, 'src/modules')
        : (fs.existsSync(path.join(this.rootDir, 'modules'))
          ? path.join(this.rootDir, 'modules')
          : null));

    if (modulesDirCandidate && fs.existsSync(modulesDirCandidate) && options.modules !== false) {
      try {
        const { discoverModuleDetails } = require('../src/modules/module-discovery');
        const entries = fs.readdirSync(modulesDirCandidate, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
            const details = discoverModuleDetails(path.join(modulesDirCandidate, entry.name), entry.name);
            for (const [sName, sDef] of Object.entries(details.services)) {
              if (!this.serviceRegistry.has(sName)) {
                this.serviceRegistry.register(sName, sDef);
              }
            }
            for (const [mName, mFn] of Object.entries(details.middlewares)) {
              this.moduleMiddlewares[`${entry.name}.${mName}`] = mFn;
            }
          }
        }
      } catch (mErr) {
        if (this.logger) this.logger.warn('[webspresso] Warning discovering modules:', mErr.message);
      }
    }

    // 11. Register plugins on Core if provided
    this.pluginsList = options.plugins || [];
    if (Array.isArray(this.pluginsList) && this.pluginsList.length > 0) {
      const pluginContext = {
        core: this,
        app: this,
        http: options.http || null,
        options: this.options,
        shutdownManager: this.shutdownManager,
        shutdown: this.shutdownManager,
        events: this.events,
        serviceRegistry: this.serviceRegistry,
        services: this.serviceRegistry,
        cache: this.cache,
        breakers: this.breakers,
        db: this.db,
        queue: this.queue,
        metrics: this.metrics,
        timeouts: this.timeouts,
      };
      this.pluginManager.registerSync(this.pluginsList, pluginContext);
    }

    // 12. Base Context representation
    this.http = options.http || null;
    this.context = {
      db: this.db,
      queue: this.queue,
      events: this.events,
      cache: this.cache,
      breakers: this.breakers,
      getBreaker: (name, opts) => this.breakers.getBreaker(name, opts),
      breaker: (name, opts) => this.breakers.getBreaker(name, opts),
      retry,
      serviceRegistry: this.serviceRegistry,
      secrets: this.secrets,
      secret: (name, opts) => (this.secrets ? this.secrets.get(name, opts) : (process.env[name] ?? null)),
      core: this,
      http: this.http,
    };
  }

  /**
   * Get or create a named circuit breaker
   * @param {string} name
   * @param {Object} [opts]
   * @returns {CircuitBreaker}
   */
  getBreaker(name, opts) {
    return this.breakers.getBreaker(name, opts);
  }

  /**
   * Alias for getBreaker
   * @param {string} name
   * @param {Object} [opts]
   * @returns {CircuitBreaker}
   */
  breaker(name, opts) {
    return this.breakers.getBreaker(name, opts);
  }

  /**
   * Exponential backoff retry engine
   * @param {Function} fn
   * @param {Object} [opts]
   * @returns {Promise<*>}
   */
  retry(fn, opts) {
    return retry(fn, opts);
  }

  /**
   * No-op HTTP middleware registration on framework-agnostic kernel.
   * HTTP middlewares are mounted on the underlying adapter (Express / Hono).
   */
  use() {
    return this;
  }

  /**
   * Creates an execution context linked to this Core application.
   * State and object identity are preserved without destructive shallow cloning.
   *
   * @param {Object} [extra={}] - Additional context fields (e.g. req, res, app, user)
   * @returns {Object} Context object
   */
  createContext(extra = {}) {
    const ctx = Object.create(this.context);
    Object.assign(ctx, extra);
    ctx.service = (subName, subInput, subOpts) =>
      this.service(subName, subInput, ctx, subOpts);
    return ctx;
  }

  /**
   * Executes a service with schema validation, auth/role checks, ACID transactions,
   * timeouts, circuit breaker protection, and retries.
   * Can be invoked directly without an HTTP server or fake req/res objects.
   *
   * @param {string} name - Service name (e.g. 'user.get')
   * @param {*} [input={}] - Service input payload
   * @param {Object} [ctxOrOpts] - Context or execution options
   * @param {Object} [maybeOpts] - Execution options if ctxOrOpts is context
   * @returns {Promise<*>} Service result
   */
  service(name, input = {}, ctxOrOpts, maybeOpts) {
    let callCtx;
    let callOpts;

    // Determine whether 3rd argument is context or options
    const isContext = ctxOrOpts && (
      ctxOrOpts.req ||
      ctxOrOpts.res ||
      ctxOrOpts.db ||
      ctxOrOpts.service ||
      ctxOrOpts.app ||
      ctxOrOpts.core ||
      (ctxOrOpts.context !== undefined && typeof ctxOrOpts.context === 'object')
    );

    if (isContext) {
      callCtx = ctxOrOpts;
      callOpts = maybeOpts || {};
    } else {
      callOpts = ctxOrOpts || {};
      const base = callOpts.context || callOpts.ctx || this.context;
      if (callOpts.user !== undefined || callOpts.auth !== undefined) {
        callCtx = Object.create(base);
        if (callOpts.user !== undefined) callCtx.user = callOpts.user;
        if (callOpts.auth !== undefined) callCtx.auth = callOpts.auth;
      } else {
        callCtx = base;
      }
    }

    return this.serviceRegistry.call(name, input, callCtx, callOpts);
  }

  /**
   * Gracefully close all core resources (circuit breakers, cache, events, shutdown hooks)
   * @param {string} [reason='core_close']
   * @returns {Promise<void>}
   */
  close(reason = 'core_close') {
    return this.shutdownManager.close(reason);
  }
}

/**
 * Creates a Webspresso Core Application instance
 * @param {Object} [options={}]
 * @returns {CoreApp}
 */
function createCoreApp(options = {}) {
  return new CoreApp(options);
}

module.exports = {
  CoreApp,
  createCoreApp,
  checkIsWebspressoPackage,
};
