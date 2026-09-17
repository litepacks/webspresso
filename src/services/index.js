/**
 * Webspresso Services Layer
 * Lightweight, reusable business logic services with zero dependency sprawl
 * @module src/services
 */

const { ServiceRegistry } = require('./registry');
const { discoverServices, filePathToServiceName, toCamelCase } = require('./discovery');
const { validateServiceInput, sanitizeInput } = require('./validator');
const { executeService, SERVICE_CALL_STACK_SYMBOL, maskSensitiveData } = require('./executor');

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
  get createAuthServices() { return require('./builtins/auth').createAuthServices; },
  get createMailServices() { return require('./builtins/mail').createMailServices; },
  get createMediaServices() { return require('./builtins/media').createMediaServices; },
  get createFileManagerServices() { return require('./builtins/file-manager').createFileManagerServices; },
  get createSystemServices() { return require('./builtins/system').createSystemServices; },
  get createExchangeServices() { return require('./builtins/exchange').createExchangeServices; },
  memoize,
  parseTtlMs,
  stableCacheKey,
  sanitizeInput,
  maskSensitiveData,
  toCamelCase,
  discoverServices,
  filePathToServiceName,
  validateServiceInput,
  executeService,
  SERVICE_CALL_STACK_SYMBOL,
};
