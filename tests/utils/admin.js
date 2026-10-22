/**
 * Standard Admin Panel & Plugin Test Utilities
 * Provides mocks and test harnesses for Admin Panel extensions, AdminRegistry, and Plugin Context.
 * @module tests/utils/admin
 */

const { AdminRegistry } = require('../../plugins/admin-panel/core/registry');

/**
 * Creates an instance of AdminRegistry.
 *
 * @returns {AdminRegistry}
 */
function createMockAdminRegistry() {
  return new AdminRegistry();
}

/**
 * Creates mock dependencies for admin module registration tests.
 *
 * @param {AdminRegistry} [registryOverride] - Optional pre-configured registry
 * @returns {Object} Mock admin dependencies
 */
function createMockAdminDeps(registryOverride) {
  const registry = registryOverride || createMockAdminRegistry();
  const routes = [];

  return {
    registry,
    adminPath: '/_admin',
    ctx: {
      addRoute: (method, path, ...handlers) => {
        routes.push({ method, path, handlers });
      },
    },
    requireAuth: function requireAuth(req, res, next) {
      if (typeof next === 'function') next();
    },
    optionalAuth: function optionalAuth(req, res, next) {
      if (typeof next === 'function') next();
    },
    serveAdminPanel: function serveAdminPanel(req, res) {
      if (res && typeof res.send === 'function') res.send('ok');
    },
    _routes: routes,
  };
}

/**
 * Creates a mock Plugin Context object for testing plugin.register(ctx) and plugin.onRoutesReady(ctx).
 *
 * @param {Object} [overrides={}] - Context overrides
 * @returns {Object} Mock plugin context
 */
function createMockPluginContext(overrides = {}) {
  const routes = [];
  const disposers = [];
  const requestHelpers = [];

  const app = overrides.app || {
    use: typeof globalThis.vi?.fn === 'function' ? globalThis.vi.fn() : () => {},
    get: typeof globalThis.vi?.fn === 'function' ? globalThis.vi.fn() : () => {},
    post: typeof globalThis.vi?.fn === 'function' ? globalThis.vi.fn() : () => {},
    put: typeof globalThis.vi?.fn === 'function' ? globalThis.vi.fn() : () => {},
    delete: typeof globalThis.vi?.fn === 'function' ? globalThis.vi.fn() : () => {},
  };

  const middlewares = overrides.middlewares || {};

  const ctx = {
    app,
    middlewares,
    routes,
    _routes: routes,
    disposers,
    _disposers: disposers,
    requestHelpers,
    usePlugin: typeof globalThis.vi?.fn === 'function' ? globalThis.vi.fn() : () => {},
    addRoute(method, path, ...handlers) {
      routes.push({ method: String(method).toLowerCase(), path, handlers });
    },
    addRequestHelper(fn) {
      requestHelpers.push(fn);
    },
    onDispose(fn) {
      disposers.push(fn);
    },
    onShutdown(fn) {
      disposers.push(fn);
    },
    ...overrides,
  };

  return ctx;
}

module.exports = {
  createMockAdminRegistry,
  createMockAdminDeps,
  createMockPluginContext,
};
