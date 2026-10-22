/**
 * Webspresso Service Registry
 * Central registry holding discovered and programmatically registered services.
 * Supports CommonJS and ESM native dynamic import, on-demand lazy loading,
 * and dev-mode hot reloading.
 * @module src/services/registry
 */

'use strict';

const path = require('path');
const { ConfigurationError, WebspressoError } = require('../../core/errors');
const { discoverServices } = require('./discovery');
const { executeService } = require('./executor');
const { memoize } = require('./memoize');
const {
  loadModuleSync,
  loadModuleAsync,
  extractModuleExport,
} = require('./loader');

class ServiceRegistry {
  /**
   * @param {Object} [options]
   * @param {string} [options.servicesDir] - Path to services directory
   * @param {boolean} [options.isDev=false] - Whether in development mode
   * @param {Object} [options.logger] - Logger instance
   * @param {Object} [options.timeouts] - Global timeouts configuration
   * @param {number|string} [options.timeout] - Default execution timeout
   * @param {boolean} [options.lazy=false] - Whether to defer module loading until invocation
   */
  constructor(options = {}) {
    this.servicesDir = options.servicesDir ? path.resolve(options.servicesDir) : null;
    this.isDev = Boolean(options.isDev);
    this.logger = options.logger || null;
    this.timeouts = options.timeouts || null;
    this.timeout = options.timeout !== undefined ? options.timeout : null;
    this.lazy = Boolean(options.lazy);

    /** @type {Map<string, Object>} Materialized service definitions */
    this.services = new Map();

    /** @type {Map<string, string>} Aliases mapping to primary service names */
    this.aliases = new Map();

    /** @type {Map<string, Object>} Deferred lazy service registrations */
    this.lazyServices = new Map();

    /** @type {Function[]} Global middlewares executed in onion order */
    this.middlewares = [];
    if (Array.isArray(options.middlewares)) {
      this.middlewares.push(...options.middlewares);
    } else if (typeof options.middleware === 'function') {
      this.middlewares.push(options.middleware);
    }

    /** @type {Function[]} Global before-hooks */
    this.beforeHooks = [];
    if (Array.isArray(options.before)) {
      this.beforeHooks.push(...options.before);
    } else if (typeof options.before === 'function') {
      this.beforeHooks.push(options.before);
    }

    /** @type {Function[]} Global after-hooks */
    this.afterHooks = [];
    if (Array.isArray(options.after)) {
      this.afterHooks.push(...options.after);
    } else if (typeof options.after === 'function') {
      this.afterHooks.push(options.after);
    }

    /** @type {Function[]} Global onError-hooks */
    this.onErrorHooks = [];
    if (Array.isArray(options.onError)) {
      this.onErrorHooks.push(...options.onError);
    } else if (typeof options.onError === 'function') {
      this.onErrorHooks.push(options.onError);
    }

    /** @type {Object|null} Optional event dispatcher */
    this.events = options.events || null;
  }

  /**
   * Normalize raw module export or definition into a standardized ServiceDefinition
   * @param {string} name - Service name
   * @param {any} raw - Raw module or object
   * @param {string|null} [filePath=null] - Origin file path if discovered from disk
   * @returns {Object} Standardized service definition
   * @private
   */
  _normalizeDefinition(name, raw, filePath = null) {
    const extracted = extractModuleExport(raw);
    const definition = typeof extracted === 'function' ? { handler: extracted } : extracted;

    if (!definition || typeof definition !== 'object') {
      const target = filePath ? `Service file '${filePath}'` : `Service '${name}'`;
      throw new ConfigurationError(`${target} must export an object or handler function`);
    }

    if (typeof definition.handler !== 'function') {
      const target = filePath ? `Service '${name}' in '${filePath}'` : `Service '${name}'`;
      throw new ConfigurationError(`${target} must provide a handler function`);
    }

    let handler = definition.handler;
    let memoizeFn = null;

    if (definition.cache) {
      const memoizeOpts = typeof definition.cache === 'object' && definition.cache !== null
        ? definition.cache
        : { ttl: definition.cache };
      memoizeFn = memoize(definition.handler, memoizeOpts);
      handler = memoizeFn;
    }

    return {
      name,
      filePath: filePath || definition.filePath || null,
      schema: definition.schema || null,
      handler,
      rawHandler: definition.handler,
      memoize: memoizeFn,
      metadata: definition.metadata || {},
      description: definition.description || definition.metadata?.description || '',
      auth: definition.auth,
      cache: definition.cache,
      timeout: definition.timeout,
      transaction: definition.transaction,
      circuitBreaker: definition.circuitBreaker,
      retry: definition.retry,
      before: Array.isArray(definition.before)
        ? definition.before
        : (typeof definition.before === 'function' ? [definition.before] : []),
      after: Array.isArray(definition.after)
        ? definition.after
        : (typeof definition.after === 'function' ? [definition.after] : []),
      onError: Array.isArray(definition.onError)
        ? definition.onError
        : (typeof definition.onError === 'function' ? [definition.onError] : []),
      middleware: Array.isArray(definition.middleware)
        ? definition.middleware
        : (typeof definition.middleware === 'function' ? [definition.middleware] : (Array.isArray(definition.middlewares) ? definition.middlewares : [])),
    };
  }

  /**
   * Discover and synchronously load all services from servicesDir.
   * If a file is an ES Module (or options.lazy is true), it is automatically
   * registered as lazy to be resolved asynchronously on invocation.
   * @returns {ServiceRegistry}
   */
  load() {
    if (!this.servicesDir) {
      return this;
    }

    const discovered = discoverServices(this.servicesDir);

    for (const item of discovered) {
      const { name, aliases, filePath } = item;

      // Duplicate check
      if (this.services.has(name) || this.lazyServices.has(name)) {
        const existing = this.services.get(name) || this.lazyServices.get(name);
        throw new ConfigurationError(
          `Duplicate service registered: ${name} (files: ${existing.filePath} and ${filePath})`
        );
      }

      for (const alias of aliases) {
        this.aliases.set(alias, name);
      }

      const isMjs = filePath.endsWith('.mjs');

      // If lazy mode or .mjs file, register lazily
      if (this.lazy || isMjs) {
        this.lazyServices.set(name, {
          name,
          aliases,
          filePath,
          isMjs,
        });
        continue;
      }

      try {
        const mod = loadModuleSync(filePath, { isDev: this.isDev });
        const serviceDef = this._normalizeDefinition(name, mod, filePath);
        this.services.set(name, serviceDef);
      } catch (err) {
        // If file is an ES Module (ERR_REQUIRE_ESM), fall back to lazy async evaluation
        if (err.code === 'ERR_REQUIRE_ESM' || err.message?.includes('ERR_REQUIRE_ESM')) {
          this.lazyServices.set(name, {
            name,
            aliases,
            filePath,
            isMjs: true,
          });
        } else {
          throw new ConfigurationError(`Failed to load service file '${filePath}': ${err.message}`, {
            cause: err,
          });
        }
      }
    }

    return this;
  }

  /**
   * Discover and asynchronously load all services from servicesDir, supporting both CJS and native ESM.
   * @returns {Promise<ServiceRegistry>}
   */
  async loadAsync() {
    if (!this.servicesDir) {
      return this;
    }

    const discovered = discoverServices(this.servicesDir);

    for (const item of discovered) {
      const { name, aliases, filePath } = item;

      if (this.services.has(name) || this.lazyServices.has(name)) {
        const existing = this.services.get(name) || this.lazyServices.get(name);
        throw new ConfigurationError(
          `Duplicate service registered: ${name} (files: ${existing.filePath} and ${filePath})`
        );
      }

      for (const alias of aliases) {
        this.aliases.set(alias, name);
      }

      if (this.lazy) {
        this.lazyServices.set(name, {
          name,
          aliases,
          filePath,
          isMjs: filePath.endsWith('.mjs'),
        });
        continue;
      }

      try {
        const mod = await loadModuleAsync(filePath, { isDev: this.isDev });
        const serviceDef = this._normalizeDefinition(name, mod, filePath);
        this.services.set(name, serviceDef);
      } catch (err) {
        throw new ConfigurationError(`Failed to load service file '${filePath}': ${err.message}`, {
          cause: err,
        });
      }
    }

    return this;
  }

  /**
   * Programmatically register a service
   * @param {string|Object} nameOrDef - Service name or definition object
   * @param {Object|Function} [maybeDef] - Service definition or handler function
   * @param {Object} [options={}] - Options (e.g. { overwrite: true, aliases: [] })
   * @returns {ServiceRegistry}
   */
  register(nameOrDef, maybeDef, options = {}) {
    let name = nameOrDef;
    let definition = maybeDef;

    if (nameOrDef && typeof nameOrDef === 'object' && nameOrDef.name && maybeDef === undefined) {
      name = nameOrDef.name;
      definition = nameOrDef;
    }

    if (!name || typeof name !== 'string') {
      throw new WebspressoError('Service name must be a non-empty string');
    }

    if ((this.services.has(name) || this.lazyServices.has(name)) && !options.overwrite) {
      throw new ConfigurationError(`Duplicate service registered: ${name}`);
    }

    const serviceDef = this._normalizeDefinition(name, definition, definition?.filePath || null);
    this.services.set(name, serviceDef);
    this.lazyServices.delete(name);

    if (Array.isArray(options.aliases)) {
      for (const alias of options.aliases) {
        this.aliases.set(alias, name);
      }
    }

    return this;
  }

  /**
   * Programmatically register a lazy service with a custom loader function or file path
   * @param {string} name - Service name
   * @param {Function|string} loader - Async loader function or file path
   * @param {Object} [options={}] - Registration options
   * @returns {ServiceRegistry}
   */
  registerLazy(name, loader, options = {}) {
    if (!name || typeof name !== 'string') {
      throw new WebspressoError('Service name must be a non-empty string');
    }

    if (typeof loader !== 'function' && typeof loader !== 'string') {
      throw new ConfigurationError(
        `Lazy service loader for '${name}' must be an async loader function or file path string`
      );
    }

    if ((this.services.has(name) || this.lazyServices.has(name)) && !options.overwrite) {
      throw new ConfigurationError(`Duplicate service registered: ${name}`);
    }

    this.lazyServices.set(name, {
      name,
      loader: typeof loader === 'function' ? loader : null,
      filePath: typeof loader === 'string' ? loader : (options.filePath || null),
      options,
    });

    if (Array.isArray(options.aliases)) {
      for (const alias of options.aliases) {
        this.aliases.set(alias, name);
      }
    }

    return this;
  }

  /**
   * Unregister a service by name
   * @param {string} name - Service name
   * @returns {boolean} Whether service was found and removed
   */
  unregister(name) {
    if (!name || typeof name !== 'string') return false;
    const removedService = this.services.delete(name);
    const removedLazy = this.lazyServices.delete(name);
    return removedService || removedLazy;
  }

  /**
   * Get a service definition by name or alias (synchronous).
   * If the service is registered as lazy CommonJS, it will be loaded and cached synchronously.
   * If the service is an ES Module, call getAsync() or execute() instead.
   * @param {string} name - Service name
   * @returns {Object|undefined}
   */
  get(name) {
    if (!name || typeof name !== 'string') {
      return undefined;
    }

    if (this.services.has(name)) {
      return this.services.get(name);
    }

    const aliasedName = this.aliases.get(name);
    const targetName = (aliasedName && (this.services.has(aliasedName) || this.lazyServices.has(aliasedName)))
      ? aliasedName
      : name;

    if (this.services.has(targetName)) {
      return this.services.get(targetName);
    }

    if (this.lazyServices.has(targetName)) {
      const lazyItem = this.lazyServices.get(targetName);
      // Attempt synchronous require if it is a CJS file path
      if (lazyItem.filePath && !lazyItem.isMjs) {
        try {
          const mod = loadModuleSync(lazyItem.filePath, { isDev: this.isDev });
          const serviceDef = this._normalizeDefinition(targetName, mod, lazyItem.filePath);
          this.services.set(targetName, serviceDef);
          this.lazyServices.delete(targetName);
          return serviceDef;
        } catch (err) {
          if (err.code !== 'ERR_REQUIRE_ESM' && !err.message?.includes('ERR_REQUIRE_ESM')) {
            throw err;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Asynchronously get or load a service definition by name or alias.
   * Seamlessly resolves lazy CJS, ESM dynamic imports, and custom loader functions.
   * @param {string} name - Service name
   * @returns {Promise<Object|undefined>}
   */
  async getAsync(name) {
    if (!name || typeof name !== 'string') {
      return undefined;
    }

    if (this.services.has(name)) {
      return this.services.get(name);
    }

    const aliasedName = this.aliases.get(name);
    const targetName = (aliasedName && (this.services.has(aliasedName) || this.lazyServices.has(aliasedName)))
      ? aliasedName
      : name;

    if (this.services.has(targetName)) {
      return this.services.get(targetName);
    }

    if (this.lazyServices.has(targetName)) {
      const lazyItem = this.lazyServices.get(targetName);
      let mod;
      if (typeof lazyItem.loader === 'function') {
        mod = await lazyItem.loader();
      } else if (lazyItem.filePath) {
        mod = await loadModuleAsync(lazyItem.filePath, { isDev: this.isDev });
      }

      const serviceDef = this._normalizeDefinition(targetName, mod, lazyItem.filePath);
      this.services.set(targetName, serviceDef);
      this.lazyServices.delete(targetName);
      return serviceDef;
    }

    return undefined;
  }

  /**
   * Check if a service exists (either materialized or registered lazily)
   * @param {string} name - Service name
   * @returns {boolean}
   */
  has(name) {
    if (!name || typeof name !== 'string') return false;
    if (this.services.has(name) || this.lazyServices.has(name)) return true;
    const aliasedName = this.aliases.get(name);
    if (aliasedName) {
      return this.services.has(aliasedName) || this.lazyServices.has(aliasedName);
    }
    return false;
  }

  /**
   * List all registered service names (including lazy services)
   * @returns {string[]}
   */
  list() {
    const names = new Set(this.services.keys());
    for (const name of this.lazyServices.keys()) {
      names.add(name);
    }
    return Array.from(names);
  }

  /**
   * Invalidate cached results for a specific service and input
   * @param {string} name - Service name
   * @param {*} [input] - Input arguments
   * @param {Object} [ctx] - Context
   * @returns {boolean} Whether cache was invalidated
   */
  invalidate(name, input, ctx) {
    const serviceDef = this.get(name);
    if (serviceDef && serviceDef.memoize) {
      return serviceDef.memoize.invalidate(input, ctx);
    }
    return false;
  }

  /**
   * Clear cache for a specific service or all services
   * @param {string} [name] - Optional service name (omitting clears all)
   * @returns {boolean}
   */
  clearCache(name) {
    if (name) {
      const serviceDef = this.get(name);
      if (serviceDef && serviceDef.memoize) {
        serviceDef.memoize.clear();
        return true;
      }
      return false;
    }

    for (const serviceDef of this.services.values()) {
      if (serviceDef.memoize) {
        serviceDef.memoize.clear();
      }
    }
    return true;
  }

  /**
   * Clear all service caches
   * @returns {boolean}
   */
  clearAllCaches() {
    return this.clearCache();
  }

  /**
   * Execute a service by name
   * @param {string} name - Service name
   * @param {*} [input={}] - Input data
   * @param {Object} [ctx={}] - Context object
   * @param {Object} [options={}] - Options
   * @returns {Promise<*>}
   */
  call(name, input = {}, ctx = {}, options = {}) {
    return executeService(this, name, input, ctx, options);
  }

  /**
   * Alias for call()
   */
  execute(name, input = {}, ctx = {}, options = {}) {
    return this.call(name, input, ctx, options);
  }

  /**
   * Register a global service middleware following the async onion model
   * @param {Function} middleware - ({ name, input, ctx, serviceDef, options, registry }, next) => Promise<any>
   * @returns {ServiceRegistry}
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new WebspressoError('Service middleware must be a function');
    }
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Register a global pre-execution hook
   * @param {Function} hook - ({ name, input, ctx, serviceDef, options }) => Promise<any>|void
   * @returns {ServiceRegistry}
   */
  before(hook) {
    if (typeof hook !== 'function') {
      throw new WebspressoError('Service before hook must be a function');
    }
    this.beforeHooks.push(hook);
    return this;
  }

  /**
   * Register a global post-execution hook
   * @param {Function} hook - ({ name, result, input, ctx, serviceDef, duration, options }) => Promise<any>|void
   * @returns {ServiceRegistry}
   */
  after(hook) {
    if (typeof hook !== 'function') {
      throw new WebspressoError('Service after hook must be a function');
    }
    this.afterHooks.push(hook);
    return this;
  }

  /**
   * Register a global error interception hook
   * @param {Function} hook - ({ name, error, input, ctx, serviceDef, duration, options }) => Promise<any>|void
   * @returns {ServiceRegistry}
   */
  onError(hook) {
    if (typeof hook !== 'function') {
      throw new WebspressoError('Service onError hook must be a function');
    }
    this.onErrorHooks.push(hook);
    return this;
  }

  /**
   * Attach an EventDispatcher instance to emit service lifecycle events
   * @param {Object} events - EventDispatcher instance
   * @returns {ServiceRegistry}
   */
  setEventDispatcher(events) {
    this.events = events;
    return this;
  }

  /**
   * Reload services from disk synchronously (useful in development)
   * @returns {ServiceRegistry}
   */
  reload() {
    this.services.clear();
    this.lazyServices.clear();
    this.aliases.clear();
    return this.load();
  }

  /**
   * Reload services from disk asynchronously (useful in development for ESM)
   * @returns {Promise<ServiceRegistry>}
   */
  async reloadAsync() {
    this.services.clear();
    this.lazyServices.clear();
    this.aliases.clear();
    return this.loadAsync();
  }
}

module.exports = {
  ServiceRegistry,
};
