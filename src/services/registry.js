/**
 * Webspresso Service Registry
 * Central registry holding discovered and programmatically registered services
 * @module src/services/registry
 */

const path = require('path');
const { ConfigurationError, WebspressoError } = require('../../core/errors');
const { discoverServices } = require('./discovery');
const { executeService } = require('./executor');
const { memoize } = require('./memoize');

class ServiceRegistry {
  /**
   * @param {Object} [options]
   * @param {string} [options.servicesDir] - Path to services directory
   * @param {boolean} [options.isDev=false] - Whether in development mode
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.servicesDir = options.servicesDir ? path.resolve(options.servicesDir) : null;
    this.isDev = Boolean(options.isDev);
    this.logger = options.logger || null;

    /** @type {Map<string, Object>} */
    this.services = new Map();

    /** @type {Map<string, string>} */
    this.aliases = new Map();
  }

  /**
   * Discover and load all services from servicesDir
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
      if (this.services.has(name)) {
        const existing = this.services.get(name);
        throw new ConfigurationError(
          `Duplicate service registered: ${name} (files: ${existing.filePath} and ${filePath})`
        );
      }

      // In dev mode, ensure fresh require
      if (this.isDev) {
        try {
          const resolved = require.resolve(filePath);
          delete require.cache[resolved];
        } catch (e) {}
      }

      let mod;
      try {
        mod = require(filePath);
      } catch (err) {
        throw new ConfigurationError(`Failed to load service file '${filePath}': ${err.message}`, {
          cause: err,
        });
      }

      const raw = mod && mod.__esModule && mod.default ? mod.default : (mod && mod.default ? mod.default : mod);
      const definition = typeof raw === 'function' ? { handler: raw } : raw;

      if (!definition || typeof definition !== 'object') {
        throw new ConfigurationError(
          `Service file '${filePath}' must export an object or handler function`
        );
      }

      if (typeof definition.handler !== 'function') {
        throw new ConfigurationError(
          `Service '${name}' in '${filePath}' must provide a handler function`
        );
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

      const serviceDef = {
        name,
        filePath,
        schema: definition.schema || null,
        handler,
        rawHandler: definition.handler,
        memoize: memoizeFn,
        metadata: definition.metadata || {},
        auth: definition.auth,
        cache: definition.cache,
        timeout: definition.timeout,
        transaction: definition.transaction,
      };

      this.services.set(name, serviceDef);

      for (const alias of aliases) {
        this.aliases.set(alias, name);
      }
    }

    return this;
  }

  /**
   * Programmatically register a service
   * @param {string} name - Service name (e.g. 'user.get')
   * @param {Object|Function} definition - Service definition or handler function
   * @returns {ServiceRegistry}
   */
  register(name, definition) {
    if (!name || typeof name !== 'string') {
      throw new WebspressoError('Service name must be a non-empty string');
    }

    if (this.services.has(name)) {
      throw new ConfigurationError(`Duplicate service registered: ${name}`);
    }

    const def = typeof definition === 'function' ? { handler: definition } : definition;

    if (!def || typeof def !== 'object' || typeof def.handler !== 'function') {
      throw new ConfigurationError(`Service '${name}' must provide a handler function`);
    }

    let handler = def.handler;
    let memoizeFn = null;

    if (def.cache) {
      const memoizeOpts = typeof def.cache === 'object' && def.cache !== null
        ? def.cache
        : { ttl: def.cache };
      memoizeFn = memoize(def.handler, memoizeOpts);
      handler = memoizeFn;
    }

    const serviceDef = {
      name,
      filePath: def.filePath || null,
      schema: def.schema || null,
      handler,
      rawHandler: def.handler,
      memoize: memoizeFn,
      metadata: def.metadata || {},
      auth: def.auth,
      cache: def.cache,
      timeout: def.timeout,
      transaction: def.transaction,
    };

    this.services.set(name, serviceDef);
    return this;
  }

  /**
   * Get a service definition by name or alias
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
    if (aliasedName && this.services.has(aliasedName)) {
      return this.services.get(aliasedName);
    }

    return undefined;
  }

  /**
   * Check if a service exists
   * @param {string} name - Service name
   * @returns {boolean}
   */
  has(name) {
    return this.get(name) !== undefined;
  }

  /**
   * List all registered service names
   * @returns {string[]}
   */
  list() {
    return Array.from(this.services.keys());
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
   * Reload services from disk (useful in development)
   * @returns {ServiceRegistry}
   */
  reload() {
    this.services.clear();
    this.aliases.clear();
    return this.load();
  }
}

module.exports = {
  ServiceRegistry,
};
