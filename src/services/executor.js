/**
 * Webspresso Services Executor
 * Executes services with shared context, circular dependency detection, and error preservation
 * @module src/services/executor
 */

const { NotFoundError, WebspressoError, ValidationError } = require('../../core/errors');
const { validateServiceInput } = require('./validator');

const SERVICE_CALL_STACK_SYMBOL = Symbol.for('webspresso.service.call_stack');

/**
 * Execute a registered service
 * @param {import('./registry').ServiceRegistry} registry - Service registry instance
 * @param {string} name - Service name to execute
 * @param {*} [input={}] - Input arguments
 * @param {Object} [ctx={}] - Request or execution context
 * @param {Object} [options={}] - Execution options
 * @returns {Promise<*>} Service execution result
 */
async function executeService(registry, name, input = {}, ctx = {}, options = {}) {
  if (!name || typeof name !== 'string') {
    throw new WebspressoError('Service name must be a non-empty string');
  }

  const serviceDef = registry.get(name);
  if (!serviceDef) {
    const notFoundErr = new NotFoundError(`Service not found: ${name}`);
    notFoundErr.code = 'SERVICE_NOT_FOUND';
    notFoundErr.service = name;
    throw notFoundErr;
  }

  // Ensure context is an object
  const execCtx = ctx && typeof ctx === 'object' ? ctx : {};

  // Bind service caller into the shared context so nested services reuse the same ctx
  if (!execCtx.service) {
    execCtx.service = (subName, subInput, subOpts) =>
      executeService(registry, subName, subInput, execCtx, subOpts);
    execCtx.service.invalidate = (subName, subInput, subCtx) =>
      registry.invalidate(subName, subInput, subCtx || execCtx);
    execCtx.service.clearCache = (subName) =>
      registry.clearCache(subName);
  }

  // Circular call stack detection
  if (!execCtx[SERVICE_CALL_STACK_SYMBOL]) {
    execCtx[SERVICE_CALL_STACK_SYMBOL] = [];
  }
  const callStack = execCtx[SERVICE_CALL_STACK_SYMBOL];

  if (callStack.includes(name)) {
    const cycle = [...callStack, name].join(' -> ');
    const circularErr = new WebspressoError(`Circular service call detected:\n${cycle}`);
    circularErr.code = 'CIRCULAR_SERVICE_CALL';
    circularErr.service = name;
    circularErr.callStack = [...callStack, name];
    throw circularErr;
  }

  // Validate input against schema
  const validatedInput = validateServiceInput(serviceDef.schema, input, name);

  // Push to call stack
  callStack.push(name);
  const startTime = Date.now();
  const logger = execCtx.logger || registry.logger || null;

  try {
    const result = await serviceDef.handler(validatedInput, execCtx);
    const duration = Date.now() - startTime;

    if (logger && typeof logger.debug === 'function') {
      logger.debug(`[service] ${name} executed successfully (${duration}ms)`);
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;

    if (logger && typeof logger.error === 'function' && !(err instanceof ValidationError)) {
      logger.error(`[service] ${name} execution failed (${duration}ms): ${err.message}`);
    }

    // Attach service name to error if not present
    if (!err.service) {
      err.service = name;
    }

    throw err;
  } finally {
    callStack.pop();
  }
}

module.exports = {
  SERVICE_CALL_STACK_SYMBOL,
  executeService,
};
