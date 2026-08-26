/**
 * Webspresso Services Executor
 * Executes services with shared context, auth/role guards, timeout handling, transaction boundaries, sensitive data masking, and branch-safe call stacks
 * @module src/services/executor
 */

const {
  NotFoundError,
  WebspressoError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
} = require('../../core/errors');
const { validateServiceInput } = require('./validator');
const { parseTtlMs } = require('./memoize');

const SERVICE_CALL_STACK_SYMBOL = Symbol.for('webspresso.service.call_stack');

const DEFAULT_REDACT_KEYS = new Set([
  'password',
  'pass',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'ssn',
]);

/**
 * Mask sensitive fields in payloads for safe logging
 * @param {*} data
 * @param {string[]} [customRedactKeys=[]]
 * @returns {*} Masked payload
 */
function maskSensitiveData(data, customRedactKeys = []) {
  if (data === null || typeof data !== 'object') {
    return data;
  }

  const redactKeys = new Set([...DEFAULT_REDACT_KEYS, ...customRedactKeys.map(k => k.toLowerCase())]);

  if (Array.isArray(data)) {
    return data.map(item => maskSensitiveData(item, customRedactKeys));
  }

  const masked = {};
  for (const [k, v] of Object.entries(data)) {
    if (redactKeys.has(k.toLowerCase())) {
      masked[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      masked[k] = maskSensitiveData(v, customRedactKeys);
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

/**
 * Check service authorization and role permissions
 * @param {Object} serviceDef - Service definition
 * @param {Object} ctx - Context object
 * @param {Object} options - Execution options
 */
async function checkServiceAuth(serviceDef, ctx, options = {}) {
  if (options.skipAuth === true || !serviceDef.auth) {
    return;
  }

  const authRequirement = serviceDef.auth;
  const user = ctx.user || ctx.auth?.user || (ctx.req && (ctx.req.user || ctx.req.session?.user)) || null;

  // 1. Boolean check (must be authenticated)
  if (authRequirement === true) {
    if (!user) {
      throw new UnauthorizedError(`Authentication required to execute service '${serviceDef.name}'`);
    }
    return;
  }

  // 2. Single role string check (e.g. 'admin')
  if (typeof authRequirement === 'string') {
    if (!user) {
      throw new UnauthorizedError(`Authentication required to execute service '${serviceDef.name}'`);
    }
    const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
    if (!roles.includes(authRequirement)) {
      throw new ForbiddenError(
        `Insufficient permissions to execute service '${serviceDef.name}' (required role: '${authRequirement}')`
      );
    }
    return;
  }

  // 3. Array of allowed roles check (e.g. ['admin', 'manager'])
  if (Array.isArray(authRequirement)) {
    if (!user) {
      throw new UnauthorizedError(`Authentication required to execute service '${serviceDef.name}'`);
    }
    const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
    const hasAny = authRequirement.some(r => roles.includes(r));
    if (!hasAny) {
      throw new ForbiddenError(
        `Insufficient permissions to execute service '${serviceDef.name}' (required one of: '${authRequirement.join(', ')}')`
      );
    }
    return;
  }

  // 4. Custom predicate function check: (user, ctx) => boolean
  if (typeof authRequirement === 'function') {
    let isAuthorized = false;
    try {
      isAuthorized = await authRequirement(user, ctx);
    } catch (authFnErr) {
      throw new ForbiddenError(
        `Authorization check failed for service '${serviceDef.name}': ${authFnErr.message}`,
        { cause: authFnErr }
      );
    }
    if (!isAuthorized) {
      throw new ForbiddenError(
        `Access denied to execute service '${serviceDef.name}' by authorization policy`
      );
    }
  }
}

/**
 * Execute a service with schema validation, auth checks, and error boundary
 * @param {ServiceRegistry} registry - Service registry instance
 * @param {string} name - Service name
 * @param {unknown} [input] - Raw input payload
 * @param {Object} [ctx={}] - Context object
 * @param {Object} [options={}] - Execution options
 * @returns {Promise<unknown>} Service execution result
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

  // Check authorization requirements
  await checkServiceAuth(serviceDef, ctx, options);

  // Check call stack depth for circular service invocations
  const activeStack = Array.isArray(ctx[SERVICE_CALL_STACK_SYMBOL])
    ? ctx[SERVICE_CALL_STACK_SYMBOL]
    : [];

  if (activeStack.includes(name)) {
    const cycle = [...activeStack, name].join(' -> ');
    const circularErr = new WebspressoError(`Circular service call detected:\n${cycle}`);
    circularErr.code = 'CIRCULAR_SERVICE_CALL';
    circularErr.service = name;
    circularErr.callStack = [...activeStack, name];
    throw circularErr;
  }

  // Configure execution context
  const executionContext = Object.create(ctx);
  executionContext[SERVICE_CALL_STACK_SYMBOL] = [...activeStack, name];
  executionContext.service = (subName, subInput, subOpts) =>
    executeService(registry, subName, subInput, executionContext, subOpts);
  executionContext.service.invalidate = (subName, subInput, subCtx) =>
    registry.invalidate(subName, subInput, subCtx || executionContext);
  executionContext.service.clearCache = (subName) =>
    registry.clearCache(subName);

  // Validate input
  const validatedInput = await validateServiceInput(serviceDef.schema, input, name);

  const startTime = Date.now();
  const logger = executionContext.logger || registry.logger || null;

  const timeoutConfig = options.timeout ?? serviceDef.timeout;
  const timeoutMs = timeoutConfig ? parseTtlMs(timeoutConfig) : null;

  // Helper to execute handler with optional database transaction
  const executeHandler = async (activeCtx) => {
    const shouldUseTx = (options.transaction === true || serviceDef.transaction === true);
    const db = activeCtx.db;

    // Check if knex or transaction-capable database is present
    const knexInstance = db && (db.knex || (typeof db.transaction === 'function' ? db : null));

    if (shouldUseTx && knexInstance && !activeCtx.trx) {
      return await knexInstance.transaction(async (trx) => {
        const txCtx = Object.create(activeCtx);
        txCtx.trx = trx;
        if (activeCtx.db && typeof activeCtx.db.getRepository === 'function') {
          const { createRepository } = require('../../core/orm/repository');
          txCtx.db = Object.assign(Object.create(activeCtx.db), {
            knex: trx,
            getRepository: (modelName, scopeCtx) => {
              const origRepo = activeCtx.db.getRepository(modelName, scopeCtx);
              return createRepository(origRepo.model, trx, scopeCtx);
            },
          });
        } else {
          txCtx.db = trx;
        }
        txCtx.service = (subName, subInput, subOpts) =>
          executeService(registry, subName, subInput, txCtx, subOpts);
        txCtx.service.invalidate = (subName, subInput, subCtx) =>
          registry.invalidate(subName, subInput, subCtx || txCtx);
        txCtx.service.clearCache = (subName) =>
          registry.clearCache(subName);
        return await serviceDef.handler(validatedInput, txCtx);
      });
    }

    return await serviceDef.handler(validatedInput, activeCtx);
  };

  try {
    let result;

    if (timeoutMs && timeoutMs > 0) {
      let timerId;
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => {
          const timeoutErr = new WebspressoError(`Service '${name}' timed out after ${timeoutMs}ms`);
          timeoutErr.code = 'SERVICE_TIMEOUT';
          timeoutErr.statusCode = 504;
          timeoutErr.service = name;
          reject(timeoutErr);
        }, timeoutMs);
      });

      try {
        result = await Promise.race([
          executeHandler(executionContext),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timerId);
      }
    } else {
      result = await executeHandler(executionContext);
    }

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
  }
}

module.exports = {
  SERVICE_CALL_STACK_SYMBOL,
  maskSensitiveData,
  checkServiceAuth,
  executeService,
};
