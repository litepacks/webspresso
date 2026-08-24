/**
 * Webspresso Services Layer
 * Lightweight, reusable business logic services with zero dependency sprawl
 * @module src/services
 */

const { ServiceRegistry } = require('./registry');
const { discoverServices, filePathToServiceName } = require('./discovery');
const { validateServiceInput } = require('./validator');
const { executeService, SERVICE_CALL_STACK_SYMBOL } = require('./executor');

const { memoize, parseTtlMs, stableCacheKey } = require('./memoize');

/**
 * Define a service definition with optional schema and metadata
 * @param {Object|Function} definition - Service definition or handler function
 * @returns {Object} Normalized service definition
 */
function defineService(definition) {
  if (typeof definition === 'function') {
    return { handler: definition };
  }
  return definition;
}

/**
 * Factory function to create and optionally load a ServiceRegistry
 * @param {Object} [options]
 * @param {string} [options.servicesDir] - Path to services directory
 * @param {boolean} [options.isDev=false] - Whether development mode is active
 * @param {Object} [options.logger] - Optional logger
 * @param {boolean} [options.autoLoad=true] - Whether to load immediately if servicesDir exists
 * @returns {ServiceRegistry}
 */
function createServiceRegistry(options = {}) {
  const registry = new ServiceRegistry(options);
  if (options.autoLoad !== false && options.servicesDir) {
    registry.load();
  }
  return registry;
}

module.exports = {
  ServiceRegistry,
  createServiceRegistry,
  defineService,
  service: defineService, // alias
  memoize,
  parseTtlMs,
  stableCacheKey,
  discoverServices,
  filePathToServiceName,
  validateServiceInput,
  executeService,
  SERVICE_CALL_STACK_SYMBOL,
};
