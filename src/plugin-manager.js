/**
 * Webspresso Plugin Manager
 * Handles plugin registration, lifecycle, dependencies, and inter-plugin communication
 */

/**
 * Simple semver comparison utilities
 * (Lightweight alternative to full semver package)
 */
const semver = {
  /**
   * Parse version string to components
   */
  parse(version) {
    if (!version) return null;
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) return null;
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[4] || null
    };
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

/**
 * Simple glob/minimatch pattern matching
 */
function matchPattern(path, pattern) {
  if (pattern === '*' || pattern === '**') return true;
  
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars
    .replace(/\*\*/g, '{{GLOBSTAR}}')       // Temp placeholder for **
    .replace(/\*/g, '[^/]*')                // * matches anything except /
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')     // ** matches everything
    .replace(/\?/g, '.');                   // ? matches single char

  const regex = new RegExp(`^${regexPattern}$`);
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
    this.routes = [];                   // Collected route metadata
    this.customRoutes = [];             // Routes added by plugins
    this.app = null;
    this.nunjucksEnv = null;
  }

  /**
   * Register plugins with the manager
   * @param {Array} plugins - Array of plugin definitions or factory functions
   * @param {Object} context - Context object { app, nunjucksEnv, options }
   */
  async register(plugins, context) {
    if (!plugins || !Array.isArray(plugins)) return;

    this.app = context.app;
    this.nunjucksEnv = context.nunjucksEnv;

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
   * Resolve dependency order using topological sort
   */
  _resolveDependencyOrder(plugins) {
    const graph = new Map();
    const pluginMap = new Map();

    // Build graph
    for (const plugin of plugins) {
      if (!plugin.name) {
        throw new Error('Plugin must have a name');
      }
      if (pluginMap.has(plugin.name)) {
        throw new Error(`Duplicate plugin name: ${plugin.name}`);
      }
      pluginMap.set(plugin.name, plugin);
      graph.set(plugin.name, new Set(Object.keys(plugin.dependencies || {})));
    }

    // Topological sort (Kahn's algorithm)
    const sorted = [];
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

      // Remove this node from all dependencies
      for (const [n, deps] of graph) {
        if (deps.has(name)) {
          deps.delete(name);
          if (deps.size === 0 && !sorted.find(p => p.name === n)) {
            noIncoming.push(n);
          }
        }
      }
    }

    // Check for cycles
    if (sorted.length !== plugins.length) {
      const remaining = plugins.filter(p => !sorted.includes(p)).map(p => p.name);
      throw new Error(`Circular dependency detected in plugins: ${remaining.join(', ')}`);
    }

    return sorted;
  }

  /**
   * Register a single plugin
   */
  async _registerPlugin(plugin, context) {
    // Validate dependencies
    this._validateDependencies(plugin);

    // Create plugin context
    const ctx = this._createPluginContext(plugin, context);

    // Store plugin
    this.plugins.set(plugin.name, plugin);

    // Store API if provided
    if (plugin.api) {
      // Bind API methods to plugin instance
      const boundAPI = {};
      for (const [key, value] of Object.entries(plugin.api)) {
        boundAPI[key] = typeof value === 'function' ? value.bind(plugin) : value;
      }
      this.pluginAPIs.set(plugin.name, boundAPI);
    }

    // Call register hook
    if (typeof plugin.register === 'function') {
      await plugin.register(ctx);
    }

    // Apply registered helpers to nunjucks
    this._applyHelpersAndFilters();
  }

  /**
   * Validate plugin dependencies
   */
  _validateDependencies(plugin) {
    if (!plugin.dependencies) return;

    for (const [depName, versionRange] of Object.entries(plugin.dependencies)) {
      const dep = this.plugins.get(depName);
      
      if (!dep) {
        throw new Error(
          `Plugin "${plugin.name}" requires "${depName}" but it's not loaded`
        );
      }

      if (dep.version && !semver.satisfies(dep.version, versionRange)) {
        throw new Error(
          `Plugin "${plugin.name}" requires "${depName}@${versionRange}" ` +
          `but found v${dep.version}`
        );
      }
    }
  }

  /**
   * Create context object for plugin
   */
  _createPluginContext(plugin, context) {
    const self = this;

    return {
      app: context.app,
      options: plugin._options || {},
      nunjucksEnv: context.nunjucksEnv,

      /**
       * Get another plugin's API
       */
      usePlugin(name) {
        return self.pluginAPIs.get(name) || null;
      },

      /**
       * Add a template helper (available as fsy.helperName())
       */
      addHelper(name, fn) {
        self.registeredHelpers.set(name, fn);
      },

      /**
       * Add a Nunjucks filter
       */
      addFilter(name, fn) {
        self.registeredFilters.set(name, fn);
      },

      /**
       * Add a custom route
       */
      addRoute(method, path, ...handlers) {
        self.customRoutes.push({ method: method.toLowerCase(), path, handlers });
      },

      /**
       * Get all registered routes (available after onRoutesReady)
       */
      get routes() {
        return self.routes;
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
   * Get all registered helpers (to be merged with fsy)
   */
  getHelpers() {
    const helpers = {};
    for (const [name, fn] of this.registeredHelpers) {
      helpers[name] = fn;
    }
    return helpers;
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
    for (const { method, path, handlers } of this.customRoutes) {
      if (this.app && this.app[method]) {
        this.app[method](path, ...handlers);
      }
    }
  }

  /**
   * Call onRoutesReady hook on all plugins
   */
  async onRoutesReady(context) {
    for (const [name, plugin] of this.plugins) {
      if (typeof plugin.onRoutesReady === 'function') {
        const ctx = this._createPluginContext(plugin, context);
        await plugin.onRoutesReady(ctx);
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
        await plugin.onReady(ctx);
      }
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
    return this.pluginAPIs.get(name);
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(name) {
    return this.plugins.has(name);
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



