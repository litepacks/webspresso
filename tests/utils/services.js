/**
 * Standard Services & Context Test Utilities
 * Provides mocks and test harnesses for Webspresso Services Layer (ServiceRegistry, service context, RBAC).
 * @module tests/utils/services
 */

const { ServiceRegistry } = require('../../src/services/registry');
const { createMockDb } = require('./orm');

/**
 * Creates a spy function using global vi.fn if available, otherwise a minimal fallback spy.
 *
 * @param {Function} [defaultImpl]
 * @returns {Function}
 */
function createSpy(defaultImpl) {
  if (typeof globalThis.vi?.fn === 'function') {
    return globalThis.vi.fn(defaultImpl);
  }
  const calls = [];
  const fn = function (...args) {
    calls.push(args);
    if (defaultImpl) return defaultImpl.apply(this, args);
  };
  fn.calls = calls;
  return fn;
}

/**
 * Creates an isolated mock service execution context (ctx) with db, logger, queue, events, and service spiers.
 *
 * @param {Object} [overrides={}] - Context overrides
 * @param {Object} [overrides.db] - Custom database mock (defaults to createMockDb())
 * @param {Object} [overrides.user] - Authenticated user object (defaults to null)
 * @param {Object} [overrides.logger] - Custom logger mock
 * @param {Object} [overrides.queue] - Custom queue mock
 * @param {Object} [overrides.events] - Custom events mock
 * @returns {Object} Mock service context
 */
function createMockServiceContext(overrides = {}) {
  const db = overrides.db || createMockDb();
  const logger = overrides.logger || {
    info: createSpy(),
    warn: createSpy(),
    error: createSpy(),
    debug: createSpy(),
  };

  const mockedServices = new Map();

  let ctx;

  const defaultServiceHandler = async (name, input) => {
    if (mockedServices.has(name)) {
      const handler = mockedServices.get(name);
      return typeof handler === 'function' ? handler(input, ctx) : handler;
    }
    return { ok: true, name, input };
  };

  const serviceSpy = createSpy(overrides.service || defaultServiceHandler);

  ctx = {
    db,
    user: overrides.user || null,
    logger,
    service: serviceSpy,
    queue: overrides.queue || {
      dispatch: createSpy(async () => ({ id: 'mock-job-id' })),
    },
    events: overrides.events || {
      emit: createSpy(),
      dispatch: createSpy(async () => true),
    },
    /**
     * Registers a mock implementation or static result for a child service call.
     *
     * @param {string} name - Service name (e.g. 'user.get')
     * @param {any|Function} implOrResult - Function handler or static return value
     * @returns {ctx}
     */
    mockService(name, implOrResult) {
      if (typeof implOrResult === 'function') {
        mockedServices.set(name, implOrResult);
      } else {
        mockedServices.set(name, () => implOrResult);
      }
      return ctx;
    },
    ...overrides,
  };

  return ctx;
}

/**
 * Creates a ServiceRegistry pre-populated with initial services for isolated unit testing.
 *
 * @param {Record<string, Function|Object>} [initialServices={}] - Services to register
 * @param {Object} [options={}] - ServiceRegistry constructor options
 * @returns {ServiceRegistry}
 */
function createMockServiceRegistry(initialServices = {}, options = {}) {
  const registry = new ServiceRegistry(options);

  for (const [name, def] of Object.entries(initialServices)) {
    registry.register(name, def);
  }

  const originalCall = registry.call.bind(registry);
  registry.call = createSpy(originalCall);

  return registry;
}

/**
 * Helper to define a test service definition object.
 *
 * @param {string} name - Service name
 * @param {Function|Object} handlerOrDef - Function handler or service definition object
 * @returns {Object} Standardized service registration pair
 */
function defineMockService(name, handlerOrDef) {
  const def = typeof handlerOrDef === 'function' ? { handler: handlerOrDef } : handlerOrDef;
  return { name, def };
}

module.exports = {
  createMockServiceContext,
  createMockServiceRegistry,
  defineMockService,
};
