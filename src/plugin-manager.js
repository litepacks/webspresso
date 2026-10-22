/**
 * Webspresso Plugin Manager
 * Handles plugin registration, lifecycle, dependencies, and inter-plugin communication
 */

/**
 * Simple semver comparison utilities
 * (Lightweight alternative to full semver package)
 */
const { globToRegExp } = require('../core/utils/regex');

let scriptInjectorGetter = null;
function getCachedScriptInjector() {
  if (!scriptInjectorGetter) {
    scriptInjectorGetter = require('./helpers').getScriptInjector;
  }
  return scriptInjectorGetter();
}

const semverCache = new Map();

const semver = {
  /**
   * Parse version string to components
   */
  parse(version) {
    if (!version) return null;
    const cached = semverCache.get(version);
    if (cached !== undefined) return cached;
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) {
      if (semverCache.size < 200) semverCache.set(version, null);
      return null;
    }
    const parsed = {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[4] || null
    };
    if (semverCache.size < 200) semverCache.set(version, parsed);
    return parsed;
  },

  /**
   * Compare two versions
   * Returns: -1 if a < b, 0 if a == b, 1 if a > b
   */
  compare(a, b) {
    const va = this.parse(a);
    const vb = this.parse(b);
    if (!va || !vb) return 0;

    if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
    if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
    if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;
    return 0;
  },

  /**
   * Check if version satisfies a range
   * Supports: ^1.0.0, ~1.0.0, >=1.0.0, >1.0.0, <=1.0.0, <1.0.0, 1.0.0, *
   */
  satisfies(version, range) {
    if (!range || range === '*') return true;
    
    const v = this.parse(version);
    if (!v) return false;

    // Handle caret (^) - compatible with major version
    if (range.startsWith('^')) {
      const r = this.parse(range.slice(1));
      if (!r) return false;
      if (v.major !== r.major) return false;
      if (v.major === 0) {
        // For 0.x.x, minor must match
        if (v.minor !== r.minor) return false;
        return v.patch >= r.patch;
      }
      return this.compare(version, range.slice(1)) >= 0;
    }

    // Handle tilde (~) - compatible with minor version
    if (range.startsWith('~')) {
      const r = this.parse(range.slice(1));
      if (!r) return false;
      return v.major === r.major && v.minor === r.minor && v.patch >= r.patch;
    }

    // Handle >=
    if (range.startsWith('>=')) {
      return this.compare(version, range.slice(2)) >= 0;
    }

    // Handle >
    if (range.startsWith('>') && !range.startsWith('>=')) {
      return this.compare(version, range.slice(1)) > 0;
    }

    // Handle <=
    if (range.startsWith('<=')) {
      return this.compare(version, range.slice(2)) <= 0;
    }

    // Handle <
    if (range.startsWith('<') && !range.startsWith('<=')) {
      return this.compare(version, range.slice(1)) < 0;
    }

    // Exact match
    return this.compare(version, range) === 0;
  }
};

const patternRegexCache = new Map();

/**
 * Simple glob/minimatch pattern matching
 */
function matchPattern(path, pattern) {
  if (pattern === '*' || pattern === '**') return true;
  
  let regex = patternRegexCache.get(pattern);
  if (!regex) {
    regex = globToRegExp(pattern, { separator: '/' });
    if (patternRegexCache.size < 500) {
      patternRegexCache.set(pattern, regex);
    }
  }
  return regex.test(path);
}

/**
 * Plugin Manager Class
 */
class PluginManager {
  constructor() {
    this.plugins = new Map();           // name -> plugin instance
    this.pluginAPIs = new Map();        // name -> exposed API
    this.registeredHelpers = new Map(); // name -> helper function
    this.registeredFilters = new Map(); // name -> filter function
    this.requestHelpers = [];           // Array<Function (req) => Record<string, any>>
    this.routes = [];                   // Collected route metadata
    this.customRoutes = [];             // Routes added by plugins
    this.cspDirectives = new Map();     // directive -> Set of sources (from plugins)
    this.disposers = [];                // Array<{ name: string, fn: Function }>
    this._cachedHelpers = null;         // Cached helpers object
    this.pendingAsyncOperations = [];   // Track background promises
    this.app = null;
    this.nunjucksEnv = null;
    this.shutdownManager = null;
  }

  /**
   * Bind API methods to instance and extract prototype properties (classes)
   * @private
   */
  _extractAndBindAPI(api, pluginName) {
    if (!api || typeof api !== 'object') return api;
    const bound = {};
    const proto = Object.getPrototypeOf(api);
    const keys = new Set([
      ...Object.keys(api),
      ...Object.getOwnPropertyNames(api),
      ...(proto && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : [])
    ]);

    for (const key of keys) {
      if (key === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(api, key) || (proto ? Object.getOwnPropertyDescriptor(proto, key) : null);
      if (desc && (desc.get || desc.set)) {
        Object.defineProperty(bound, key, {
          get: desc.get ? desc.get.bind(api) : undefined,
          set: desc.set ? desc.set.bind(api) : undefined,
          enumerable: true,
          configurable: true,
        });
      } else {
        const val = api[key];
        bound[key] = typeof val === 'function' ? val.bind(api) : val;
      }
    }
    return bound;
  }

  /**
   * Register a plugin disposer
   * @param {string} name
   * @param {Function} fn
   */
  registerDisposer(name, fn) {
    if (typeof fn === 'function') {
      this.disposers.push({ name: name || 'plugin', fn });
      if (this.shutdownManager && typeof this.shutdownManager.registerDisposer === 'function') {
        this.shutdownManager.registerDisposer(name, fn);
      }
    }
  }

  /**
   * Register plugins with the manager (async version)
   * @param {Array} plugins - Array of plugin definitions or factory functions
   * @param {Object} context - Context object `{ app, nunjucksEnv, options, middlewares?, shutdownManager? }`
   */
  async register(plugins, context) {
    if (!plugins || !Array.isArray(plugins)) return;

    this.app = context.app;
    this.nunjucksEnv = context.nunjucksEnv;
    this.shutdownManager = context.shutdownManager || null;

    // Normalize plugins (handle factory functions)
    const normalizedPlugins = plugins.map(p => {
      if (typeof p === 'function') {
        // Already a factory that was called
        return p;
      }
      return p;
    });

    // Validate and sort by dependencies
    const sorted = this._resolveDependencyOrder(normalizedPlugins);

    // Register each plugin in order
    for (const plugin of sorted) {
      await this._registerPlugin(plugin, context);
    }
  }

  /**
   * Register plugins with the manager (sync version)
   * @param {Array} plugins - Array of plugin definitions or factory functions
   * @param {Object} context - Context object `{ app, nunjucksEnv, options, middlewares?, shutdownManager? }`
   */
  registerSync(plugins, context) {
    if (!plugins || !Array.isArray(plugins)) return;

    this.app = context.app;
    this.nunjucksEnv = context.nunjucksEnv;
    this.shutdownManager = context.shutdownManager || null;

    // Normalize plugins (handle factory functions)
    const normalizedPlugins = plugins.map(p => {
      if (typeof p === 'function') {
        return p;
      }
      return p;
    });

    // Validate and sort by dependencies
    const sorted = this._resolveDependencyOrder(normalizedPlugins);

    // Register each plugin in order (sync)
    for (const plugin of sorted) {
      this._registerPluginSync(plugin, context);
    }
  }

  /**
   * Resolve dependency order using topological sort
   */
  _resolveDependencyOrder(plugins) {
    if (!plugins || plugins.length === 0) return [];

    const graph = new Map();
    const pluginMap = new Map();

    // Build graph
    for (const plugin of plugins) {
      if (!plugin.name) {
        console.warn('[plugin-manager] Skipping plugin without name:', plugin);
        continue;
      }
      if (pluginMap.has(plugin.name)) {
        console.warn(`[plugin-manager] Duplicate plugin name "${plugin.name}" - skipping`);
        continue;
      }
      pluginMap.set(plugin.name, plugin);
      const depNames = Array.isArray(plugin.dependencies)
        ? plugin.dependencies
        : Object.keys(plugin.dependencies || {});
      graph.set(plugin.name, new Set(depNames));
    }

    // Topological sort (Kahn's algorithm)
    const sorted = [];
    const sortedNames = new Set();
    const noIncoming = [];

    // Find nodes with no dependencies
    for (const [name, deps] of graph) {
      // Filter to only include dependencies that are in our plugin list
      const relevantDeps = new Set([...deps].filter(d => pluginMap.has(d)));
      graph.set(name, relevantDeps);
      if (relevantDeps.size === 0) {
        noIncoming.push(name);
      }
    }

    while (noIncoming.length > 0) {
      const name = noIncoming.shift();
      sorted.push(pluginMap.get(name));
      sortedNames.add(name);

      // Remove this node from all dependencies
      for (const [n, deps] of graph) {
        if (deps.has(name)) {
          deps.delete(name);
          if (deps.size === 0 && !sortedNames.has(n)) {
            noIncoming.push(n);
          }
        }
      }
    }

    // Check for cycles - warn and exclude circular plugins
    if (sorted.length !== pluginMap.size) {
      const remaining = Array.from(pluginMap.keys()).filter(name => !sortedNames.has(name));
      console.warn(
        `[plugin-manager] Circular dependency detected. Skipping plugins: ${remaining.join(', ')}`
      );
    }

    return sorted;
  }

  /**
   * Register a single plugin (async)
   */
  async _registerPlugin(plugin, context) {
    // Validate dependencies
    this._validateDependencies(plugin);

    // Create plugin context
    const ctx = this._createPluginContext(plugin, context);

    // Store plugin
    // Store plugin
    this.plugins.set(plugin.name, plugin);

    // Store API if provided
    if (plugin.api) {
      this.pluginAPIs.set(plugin.name, this._extractAndBindAPI(plugin.api, plugin.name));
    }

    // Collect CSP requirements from plugin
    if (plugin.csp) {
      this._collectCspDirectives(plugin.csp);
    }

    let hasDisposer = false;

    // Call setup hook if provided
    if (typeof plugin.setup === 'function') {
      try {
        const result = await plugin.setup(ctx.app || ctx);
        if (typeof result === 'function') {
          this.registerDisposer(plugin.name, result);
          hasDisposer = true;
        }
      } catch (err) {
        console.warn(`[plugin-manager] Plugin "${plugin.name}" setup() failed:`, err.message);
        await this._rollbackPlugin(plugin.name, plugin, ctx);
        return;
      }
    }

    // Call register hook
    if (typeof plugin.register === 'function') {
      try {
        const result = await plugin.register(ctx);
        if (typeof result === 'function') {
          this.registerDisposer(plugin.name, result);
          hasDisposer = true;
        }
      } catch (err) {
        console.warn(`[plugin-manager] Plugin "${plugin.name}" register() failed:`, err.message);
        await this._rollbackPlugin(plugin.name, plugin, ctx);
        return;
      }
    }

    // Support explicit shutdown or dispose methods if not already registered
    if (!hasDisposer) {
      if (typeof plugin.shutdown === 'function') {
        this.registerDisposer(plugin.name, () => plugin.shutdown(ctx.app || ctx));
      } else if (typeof plugin.dispose === 'function') {
        this.registerDisposer(plugin.name, () => plugin.dispose(ctx));
      }
    }

    // Apply registered helpers to nunjucks
    this._applyHelpersAndFilters();
  }

  /**
   * Roll back any partially acquired state or disposers for a failed plugin
   * @private
   */
  async _rollbackPlugin(name, plugin, ctx) {
    this.plugins.delete(name);
    if (plugin && plugin.api) {
      this.pluginAPIs.delete(name);
    }

    const remainingDisposers = [];
    const rollbackDisposers = [];
    for (const d of this.disposers) {
      if (d.name === name) {
        rollbackDisposers.push(d);
      } else {
        remainingDisposers.push(d);
      }
    }
    this.disposers = remainingDisposers;

    // Run disposers registered so far by this plugin in reverse order
    for (let i = rollbackDisposers.length - 1; i >= 0; i--) {
      try {
        const res = rollbackDisposers[i].fn();
        if (res && typeof res.then === 'function') {
          await res;
        }
      } catch (cleanupErr) {
        console.warn(`[plugin-manager] Rollback disposer for "${name}" failed:`, cleanupErr?.message);
      }
    }

    if (plugin && typeof plugin.dispose === 'function') {
      try {
        const res = plugin.dispose(ctx);
        if (res && typeof res.then === 'function') {
          await res;
        }
      } catch (cleanupErr) {
        console.warn(`[plugin-manager] Rollback dispose() for "${name}" failed:`, cleanupErr?.message);
      }
    }
  }

  /**
   * Roll back partially acquired state or disposers for a failed plugin (sync)
   * @private
   */
  _rollbackPluginSync(name, plugin, ctx) {
    this.plugins.delete(name);
    if (plugin && plugin.api) {
      this.pluginAPIs.delete(name);
    }

    const remainingDisposers = [];
    const rollbackDisposers = [];
    for (const d of this.disposers) {
      if (d.name === name) {
        rollbackDisposers.push(d);
      } else {
        remainingDisposers.push(d);
      }
    }
    this.disposers = remainingDisposers;

    for (let i = rollbackDisposers.length - 1; i >= 0; i--) {
      try {
        rollbackDisposers[i].fn();
      } catch (cleanupErr) {
        console.warn(`[plugin-manager] Rollback disposer for "${name}" failed:`, cleanupErr?.message);
      }
    }

    if (plugin && typeof plugin.dispose === 'function') {
      try {
        plugin.dispose(ctx);
      } catch (cleanupErr) {
        console.warn(`[plugin-manager] Rollback dispose() for "${name}" failed:`, cleanupErr?.message);
      }
    }
  }

  /**
   * Register a single plugin (sync)
   */
  _registerPluginSync(plugin, context) {
    // Validate dependencies
    this._validateDependencies(plugin);

    // Create plugin context
    const ctx = this._createPluginContext(plugin, context);

    // Store plugin
    this.plugins.set(plugin.name, plugin);

    // Store API if provided
    if (plugin.api) {
      this.pluginAPIs.set(plugin.name, this._extractAndBindAPI(plugin.api, plugin.name));
    }

    // Collect CSP requirements from plugin
    if (plugin.csp) {
      this._collectCspDirectives(plugin.csp);
    }

    let hasDisposer = false;

    // Call setup hook if provided
    if (typeof plugin.setup === 'function') {
      try {
        const result = plugin.setup(ctx.app || ctx);
        if (typeof result === 'function') {
          this.registerDisposer(plugin.name, result);
          hasDisposer = true;
        } else if (result && typeof result.then === 'function') {
          this.pendingAsyncOperations.push(result);
          result.catch(err => {
            console.warn(`[plugin-manager] Plugin "${plugin.name}" async setup() failed:`, err?.message || err);
          });
        }
      } catch (err) {
        console.warn(`[plugin-manager] Plugin "${plugin.name}" setup() failed:`, err.message);
        this._rollbackPluginSync(plugin.name, plugin, ctx);
        return;
      }
    }

    // Call register hook (sync - if plugin has async register, it won't block, but promises are safely caught)
    if (typeof plugin.register === 'function') {
      try {
        const result = plugin.register(ctx);
        if (typeof result === 'function') {
          this.registerDisposer(plugin.name, result);
          hasDisposer = true;
        } else if (result && typeof result.then === 'function') {
          this.pendingAsyncOperations.push(result);
          result.catch(err => {
            console.warn(`[plugin-manager] Plugin "${plugin.name}" async register() failed:`, err?.message || err);
          });
        }
      } catch (err) {
        console.warn(`[plugin-manager] Plugin "${plugin.name}" register() failed:`, err.message);
        this._rollbackPluginSync(plugin.name, plugin, ctx);
        return;
      }
    }

    // Support explicit shutdown or dispose methods if not already registered
    if (!hasDisposer) {
      if (typeof plugin.shutdown === 'function') {
        this.registerDisposer(plugin.name, () => plugin.shutdown(ctx.app || ctx));
      } else if (typeof plugin.dispose === 'function') {
        this.registerDisposer(plugin.name, () => plugin.dispose(ctx));
      }
    }

    // Apply registered helpers to nunjucks
    this._applyHelpersAndFilters();
  }

  /**
   * Validate plugin dependencies - logs warning instead of throwing
   */
  _validateDependencies(plugin) {
    if (!plugin.dependencies) return;

    const depEntries = Array.isArray(plugin.dependencies)
      ? plugin.dependencies.map(d => [d, '*'])
      : Object.entries(plugin.dependencies);

    for (const [depName, versionRange] of depEntries) {
      const dep = this.plugins.get(depName);

      if (!dep) {
        console.warn(
          `[plugin-manager] Plugin "${plugin.name}" requires "${depName}" but it's not loaded. ` +
          'Plugin may not work correctly.'
        );
        continue;
      }

      if (dep.version && versionRange !== '*' && !semver.satisfies(dep.version, versionRange)) {
        console.warn(
          `[plugin-manager] Plugin "${plugin.name}" requires "${depName}@${versionRange}" ` +
          `but found v${dep.version}. Plugin may not work correctly.`
        );
      }
    }
  }

  /**
   * Create context object for plugin
   */
  _createPluginContext(plugin, context) {
    const self = this;
    const pluginName = plugin?.name || 'unknown';

    return {
      app: context.app || self.app,
      core: context.core || null,
      http: context.http || null,
      shutdown: context.shutdown || context.shutdownManager || self.shutdownManager || null,
      shutdownManager: context.shutdownManager || context.shutdown || self.shutdownManager || null,
      services: context.services || context.serviceRegistry || null,
      serviceRegistry: context.serviceRegistry || context.services || null,
      events: context.events || null,
      cache: context.cache || null,
      options: plugin?._options || {},
      nunjucksEnv: context.nunjucksEnv || self.nunjucksEnv,
      db: context.options?.db ?? context.db ?? null,
      pagesDir: context.pagesDir || null,
      /** @type {Record<string, unknown>} Named middleware registry (same reference as createApp → mountPages) */
      middlewares: context.middlewares ?? {},

      /**
       * Get another plugin's API
       */
      usePlugin(name) {
        return self.getPluginAPI(name) || null;
      },

      /**
       * Add a template helper (available as fsy.helperName())
       */
      addHelper(name, fn) {
        self.addHelper(name, fn, pluginName);
      },

      /**
       * Add a Nunjucks filter
       */
      addFilter(name, fn) {
        self.addFilter(name, fn, pluginName);
      },

      /**
       * Add a request-scoped helper provider (called on each SSR request)
       */
      addRequestHelper(fn) {
        self.addRequestHelper(fn);
      },

      /**
       * Add a custom route
       */
      addRoute(method, path, ...handlers) {
        const httpMethod = method.toLowerCase();
        if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
          console.log(`  ${method.toUpperCase().padEnd(6)} ${path}`);
        }
        if (self.app && typeof self.app[httpMethod] === 'function') {
          self.app[httpMethod](path, ...handlers);
        } else {
          self.customRoutes.push({ method: httpMethod, path, handlers });
        }
      },

      /**
       * Get all registered routes (available after onRoutesReady)
       */
      get routes() {
        return self.routes;
      },

      // ============================================
      // Script Injection API
      // ============================================

      /**
       * Register a cleanup / disposer hook for this plugin
       * @param {Function} fn
       */
      onDispose(fn) {
        self.registerDisposer(plugin.name, fn);
      },

      /**
       * Alias for onDispose
       * @param {Function} fn
       */
      onShutdown(fn) {
        self.registerDisposer(plugin.name, fn);
      },

      /**
       * Inject content into head section
       * @param {string} content - HTML/script content
       * @param {Object} options - { priority: number, id: string }
       */
      injectHead(content, options = {}) {
        getCachedScriptInjector().addHead(content, options);
      },

      /**
       * Inject content into body end section
       * @param {string} content - HTML/script content
       * @param {Object} options - { priority: number, id: string }
       */
      injectBody(content, options = {}) {
        getCachedScriptInjector().addBody(content, options);
      },

      /**
       * Inject CSS styles
       * @param {string} css - CSS content
       * @param {Object} options - { id: string }
       */
      injectStyle(css, options = {}) {
        getCachedScriptInjector().addStyle(css, options);
      },

      /**
       * Register a link for the dev toolbar
       * @param {Object} link - { name, path, icon, description }
       */
      registerDevLink(link) {
        getCachedScriptInjector().registerPlugin(link);
      },

      /**
       * Get the script injector instance for advanced usage
       */
      getScriptInjector() {
        return getCachedScriptInjector();
      }
    };
  }

  /**
   * Apply registered helpers and filters to Nunjucks
   */
  _applyHelpersAndFilters() {
    if (!this.nunjucksEnv) return;

    // Add filters
    for (const [name, fn] of this.registeredFilters) {
      this.nunjucksEnv.addFilter(name, fn);
    }
  }

  /**
   * Collect CSP directives from a plugin
   * @param {Object} csp - CSP directives object { styleSrc: [...], scriptSrc: [...], ... }
   */
  _collectCspDirectives(csp) {
    for (const [directive, sources] of Object.entries(csp)) {
      if (!this.cspDirectives.has(directive)) {
        this.cspDirectives.set(directive, new Set());
      }
      const directiveSet = this.cspDirectives.get(directive);
      const sourceArray = Array.isArray(sources) ? sources : [sources];
      for (const source of sourceArray) {
        directiveSet.add(source);
      }
    }
  }

  /**
   * Get merged CSP directives from all plugins
   * @returns {Object} CSP directives object to merge with helmet config
   */
  getCspDirectives() {
    const directives = {};
    for (const [directive, sources] of this.cspDirectives) {
      directives[directive] = Array.from(sources);
    }
    return directives;
  }

  /**
   * Get all registered helpers (to be merged with fsy)
   */
  /**
   * Register a template helper (available as fsy.helperName())
   * @param {string} name
   * @param {Function} fn
   * @param {string} [pluginName]
   */
  addHelper(name, fn, pluginName = 'unknown') {
    if (this.registeredHelpers.has(name)) {
      console.warn(`[plugin-manager] Helper "${name}" registered by "${pluginName}" overwrites existing helper.`);
    }
    this.registeredHelpers.set(name, fn);
    this._cachedHelpers = null;
  }

  /**
   * Register a Nunjucks filter
   * @param {string} name
   * @param {Function} fn
   * @param {string} [pluginName]
   */
  addFilter(name, fn, pluginName = 'unknown') {
    if (this.registeredFilters.has(name)) {
      console.warn(`[plugin-manager] Filter "${name}" registered by "${pluginName}" overwrites existing filter.`);
    }
    this.registeredFilters.set(name, fn);
    if (this.nunjucksEnv && typeof this.nunjucksEnv.addFilter === 'function') {
      this.nunjucksEnv.addFilter(name, fn);
    }
  }

  /**
   * Register a request-scoped helper provider (called on each SSR request)
   * @param {Function} fn - (req) => Record<string, any>
   */
  addRequestHelper(fn) {
    if (typeof fn === 'function') {
      this.requestHelpers.push(fn);
    }
  }

  /**
   * Get all request-scoped helpers for a request
   * @param {Object} req
   * @returns {Object|null}
   */
  getRequestHelpers(req) {
    if (!this.requestHelpers || this.requestHelpers.length === 0) return null;
    const result = {};
    for (const fn of this.requestHelpers) {
      try {
        const helpers = fn(req);
        if (helpers && typeof helpers === 'object') {
          Object.assign(result, helpers);
        }
      } catch (err) {
        console.warn('[plugin-manager] Error executing request helper:', err.message);
      }
    }
    return result;
  }

  /**
   * Get all registered helpers (to be merged with fsy)
   */
  getHelpers() {
    if (!this._cachedHelpers) {
      const helpers = {};
      for (const [name, fn] of this.registeredHelpers) {
        helpers[name] = fn;
      }
      this._cachedHelpers = helpers;
    }
    return this._cachedHelpers;
  }

  /**
   * Set route metadata (called by file-router after mounting)
   */
  setRoutes(routes) {
    this.routes = routes;
  }

  /**
   * Mount custom routes added by plugins
   */
  mountCustomRoutes() {
    if (!this.app || this.customRoutes.length === 0) return;
    const unmounted = this.customRoutes.splice(0, this.customRoutes.length);
    for (const { method, path, handlers } of unmounted) {
      if (typeof this.app[method] === 'function') {
        this.app[method](path, ...handlers);
      }
    }
  }

  /**
   * Call onRoutesReady hook on all plugins (async)
   */
  async onRoutesReady(context) {
    if (context) {
      if (context.app) this.app = context.app;
      if (context.nunjucksEnv) this.nunjucksEnv = context.nunjucksEnv;
      if (context.shutdownManager) this.shutdownManager = context.shutdownManager;
    }

    for (const [name, plugin] of this.plugins) {
      if (typeof plugin.onRoutesReady === 'function') {
        const ctx = this._createPluginContext(plugin, context);
        try {
          await plugin.onRoutesReady(ctx);
        } catch (err) {
          console.warn(`[plugin-manager] Plugin "${name}" onRoutesReady() failed:`, err.message);
        }
      }
    }

    // Mount any routes added during onRoutesReady
    this.mountCustomRoutes();
  }

  /**
   * Call onRoutesReady hook on all plugins synchronously (tracking async promises)
   */
  onRoutesReadySync(context) {
    if (context) {
      if (context.app) this.app = context.app;
      if (context.nunjucksEnv) this.nunjucksEnv = context.nunjucksEnv;
      if (context.shutdownManager) this.shutdownManager = context.shutdownManager;
    }

    for (const [name, plugin] of this.plugins) {
      if (typeof plugin.onRoutesReady === 'function') {
        const ctx = this._createPluginContext(plugin, context);
        try {
          const res = plugin.onRoutesReady(ctx);
          if (res && typeof res.then === 'function') {
            this.pendingAsyncOperations.push(res);
            res.catch(err => {
              console.warn(`[plugin-manager] Plugin "${name}" async onRoutesReady() failed:`, err?.message || err);
            });
          }
        } catch (err) {
          console.warn(`[plugin-manager] Plugin "${name}" onRoutesReady() failed:`, err.message);
        }
      }
    }

    // Mount any routes added during onRoutesReady
    this.mountCustomRoutes();
  }

  /**
   * Call onReady hook on all plugins
   */
  async onReady(context) {
    for (const [name, plugin] of this.plugins) {
      if (typeof plugin.onReady === 'function') {
        const ctx = this._createPluginContext(plugin, context);
        try {
          await plugin.onReady(ctx);
        } catch (err) {
          console.warn(`[plugin-manager] Plugin "${name}" onReady() failed:`, err.message);
        }
      }
    }
  }

  /**
   * Call onReady hook on all plugins synchronously (tracking async promises)
   */
  onReadySync(context) {
    for (const [name, plugin] of this.plugins) {
      if (typeof plugin.onReady === 'function') {
        const ctx = this._createPluginContext(plugin, context);
        try {
          const res = plugin.onReady(ctx);
          if (res && typeof res.then === 'function') {
            this.pendingAsyncOperations.push(res);
            res.catch(err => {
              console.warn(`[plugin-manager] Plugin "${name}" async onReady() failed:`, err?.message || err);
            });
          }
        } catch (err) {
          console.warn(`[plugin-manager] Plugin "${name}" onReady() failed:`, err.message);
        }
      }
    }
  }

  /**
   * Wait for all pending asynchronous plugin operations to settle
   * @returns {Promise<void>}
   */
  async whenReady() {
    if (this.pendingAsyncOperations.length > 0) {
      const ops = this.pendingAsyncOperations.slice();
      await Promise.allSettled(ops);
    }
  }

  /**
   * Get a plugin by name
   */
  getPlugin(name) {
    return this.plugins.get(name);
  }

  /**
   * Get a plugin's API by name
   */
  getPluginAPI(name) {
    const plugin = this.plugins.get(name);
    if (plugin && plugin.isLazy && typeof plugin.hydrate === 'function' && !plugin.isHydrated) {
      const real = plugin.hydrate();
      if (real && real.api) {
        this.pluginAPIs.set(name, this._extractAndBindAPI(real.api, name));
      }
      return this.pluginAPIs.get(name) || (real && real.api) || plugin.api;
    }
    return this.pluginAPIs.get(name);
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(name) {
    return this.plugins.has(name);
  }

  /**
   * Get all registered disposers
   * @returns {Array<{ name: string, fn: Function }>}
   */
  getDisposers() {
    return this.disposers.slice();
  }

  /**
   * Execute all registered plugin disposers in reverse registration order with timeout protection
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<void>}
   */
  async dispose(timeoutMs = 5000) {
    const reverseDisposers = this.disposers.slice().reverse();
    for (const { name, fn } of reverseDisposers) {
      try {
        let timer = null;
        const disposerPromise = Promise.resolve().then(() => fn());
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Disposer for "${name}" timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        await Promise.race([disposerPromise, timeoutPromise]).finally(() => {
          if (timer) clearTimeout(timer);
        });
      } catch (err) {
        console.warn(`[plugin-manager] Plugin "${name}" disposer failed:`, err.message);
      }
    }
    this.disposers = [];
    this.requestHelpers = [];
    this._cachedHelpers = null;
  }

  /**
   * Get all registered plugin names
   */
  getPluginNames() {
    return Array.from(this.plugins.keys());
  }
}

// Singleton instance for global access
let globalPluginManager = null;

/**
 * Get or create the global plugin manager
 */
function getPluginManager() {
  if (!globalPluginManager) {
    globalPluginManager = new PluginManager();
  }
  return globalPluginManager;
}

/**
 * Create a new plugin manager (for testing)
 */
function createPluginManager() {
  return new PluginManager();
}

/**
 * Reset the global plugin manager (for testing)
 */
function resetPluginManager() {
  globalPluginManager = null;
}

module.exports = {
  PluginManager,
  getPluginManager,
  createPluginManager,
  resetPluginManager,
  semver,
  matchPattern
};



