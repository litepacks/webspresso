'use strict';

/**
 * Webspresso Module Definition Helper
 * Creates feature-oriented modules compatible with Webspresso PluginManager
 * @module src/modules/define-module
 */

/**
 * Defines a feature module with pages, api, services, middlewares, and lifecycle hooks
 * @param {Object} config
 * @param {string} config.name - Module unique name (e.g. 'auth', 'shop')
 * @param {string} [config.version='1.0.0'] - Module version
 * @param {string} [config.description] - Module description
 * @param {Array<string>} [config.imports] - Dependent module names
 * @param {Array<string>} [config.dependencies] - Alias for imports
 * @param {boolean|Object} [config.pages] - Pages configuration ({ dir, prefix })
 * @param {boolean|Object} [config.api] - API configuration ({ dir, prefix })
 * @param {Object} [config.services] - Registered service definitions
 * @param {Object} [config.middlewares] - Module-local named middleware functions
 * @param {Object} [config.exports] - Public API methods
 * @param {Object} [config.api] - Public API alias
 * @param {Function} [config.onInit] - Initialization lifecycle hook
 * @param {Function} [config.onDestroy] - Destruction lifecycle hook
 * @returns {Function} Module factory function returning a Webspresso plugin object
 */
function defineModule(config = {}) {
  const {
    name,
    version = '1.0.0',
    description = '',
    imports = [],
    dependencies = [],
    pages,
    api: apiConfig,
    services = {},
    middlewares = {},
    exports: publicExports = {},
    onInit,
    onDestroy,
  } = config;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('defineModule requires a valid non-empty "name" string');
  }

  const combinedDeps = Array.from(new Set([...(imports || []), ...(dependencies || [])]));

  return function moduleFactory(userOptions = {}) {
    return {
      name,
      version,
      description,
      dependencies: combinedDeps,
      __isWebspressoModule: true,
      moduleConfig: {
        ...config,
        ...userOptions,
      },
      api: typeof publicExports === 'object' && publicExports !== null ? publicExports : {},

      register(ctx) {
        // 1. Register module services into serviceRegistry
        if (ctx.app && ctx.app.serviceRegistry && services && typeof services === 'object') {
          for (const [sName, sDef] of Object.entries(services)) {
            const qualifiedName = sName.includes('.') ? sName : `${name}.${sName}`;
            if (!ctx.app.serviceRegistry.has(qualifiedName)) {
              ctx.app.serviceRegistry.register(qualifiedName, sDef);
            }
          }
        }

        // 2. Register module-local middlewares into context
        if (ctx.middlewares && middlewares && typeof middlewares === 'object') {
          for (const [mwName, mwFn] of Object.entries(middlewares)) {
            // Register with module prefix as well
            ctx.middlewares[`${name}.${mwName}`] = mwFn;
          }
        }

        // 3. Run onInit lifecycle hook if provided
        if (typeof onInit === 'function') {
          onInit(ctx);
        }

        // 4. Register onDestroy hook with ShutdownManager if provided
        if (typeof onDestroy === 'function' && ctx.shutdownManager) {
          ctx.shutdownManager.registerDisposer(onDestroy, {
            name: `module:${name}`,
          });
        }
      },
    };
  };
}

module.exports = {
  defineModule,
};
