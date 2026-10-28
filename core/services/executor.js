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
} = require('../errors');
const { validateServiceInput } = require('./validator');
const { parseTtlMs } = require('./memoize');
const {
  runWithAmbientTransaction,
  hasAmbientTransaction,
} = require('../orm/transaction');
const { ensureArray } = require('../utils/object');
const {
  CircuitBreaker,
  circuitBreakerRegistry,
  retry,
} = require('../resilience');
const { runWithContext } = require('../context/request');

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
 * Internal recursive masking helper avoiding repeated Set allocations
 * @private
 */
function _maskRecursive(val, redactKeys, depth) {
  if (val === null || typeof val !== 'object') {
    return val;
  }

  if (val instanceof Date || Buffer.isBuffer(val)) {
    return val;
  }

  if (depth > 16) {
    return val;
  }

  if (Array.isArray(val)) {
    const len = val.length;
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = _maskRecursive(val[i], redactKeys, depth + 1);
    }
    return result;
  }

  const masked = {};
  const keys = Object.keys(val);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = val[k];
    if (redactKeys.has(k.toLowerCase())) {
      masked[k] = '[REDACTED]';
    } else if (v !== null && typeof v === 'object') {
      masked[k] = _maskRecursive(v, redactKeys, depth + 1);
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

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

  const hasCustom = Array.isArray(customRedactKeys) && customRedactKeys.length > 0;
  const redactKeys = hasCustom
    ? new Set([...DEFAULT_REDACT_KEYS, ...customRedactKeys.map(k => String(k).toLowerCase())])
    : DEFAULT_REDACT_KEYS;

  return _maskRecursive(data, redactKeys, 0);
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
    const roles = ensureArray(user.roles || user.role);
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
    const roles = ensureArray(user.roles || user.role);
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

  let serviceDef = registry.get(name);
  if (!serviceDef && typeof registry.getAsync === 'function') {
    serviceDef = await registry.getAsync(name);
  }

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
  executionContext.service.call = executionContext.service;
  executionContext.service.execute = executionContext.service;
  executionContext.service.invalidate = (subName, subInput, subCtx) =>
    registry.invalidate(subName, subInput, subCtx || executionContext);
  executionContext.service.clearCache = (subName) =>
    registry.clearCache(subName);
  executionContext.service.invalidateByTag = (tag, serviceName) =>
    registry.invalidateByTag(tag, serviceName);
  executionContext.service.invalidateByTags = (tags, serviceName) =>
    registry.invalidateByTags(tags, serviceName);
  executionContext.service.invalidateTag = executionContext.service.invalidateByTag;
  executionContext.service.invalidateTags = executionContext.service.invalidateByTags;
  executionContext.breaker = (bName, bOpts) =>
    circuitBreakerRegistry.getBreaker(bName, bOpts);
  executionContext.retry = retry;

  let validatedInput = input;
  const startTime = Date.now();
  const logger = executionContext.logger || registry.logger || null;

  const timeoutConfig = options.timeout ?? serviceDef.timeout ?? executionContext?.timeouts?.service ?? registry?.timeouts?.service ?? registry?.timeout;
  const timeoutMs = (timeoutConfig !== undefined && timeoutConfig !== null && timeoutConfig !== false)
    ? parseTtlMs(timeoutConfig)
    : null;

  // Resolve circuit breaker configuration
  let breaker = null;
  const cbConfig = options.skipCircuitBreaker === true
    ? null
    : (options.circuitBreaker !== undefined ? options.circuitBreaker : serviceDef.circuitBreaker);

  if (cbConfig) {
    if (cbConfig instanceof CircuitBreaker) {
      breaker = cbConfig;
    } else if (typeof cbConfig === 'string') {
      breaker = circuitBreakerRegistry.getBreaker(cbConfig);
    } else if (typeof cbConfig === 'object' && cbConfig !== null) {
      const breakerName = cbConfig.name || name;
      breaker = circuitBreakerRegistry.getBreaker(breakerName, cbConfig);
    } else if (cbConfig === true) {
      breaker = circuitBreakerRegistry.getBreaker(name);
    }
  }

  // Resolve retry configuration
  const retryConfig = options.skipRetry === true
    ? null
    : (options.retry !== undefined ? options.retry : serviceDef.retry);

  // Compose middlewares and hooks
  const globalMiddlewares = registry.middlewares || [];
  const serviceMiddlewares = serviceDef.middleware || [];
  const allMiddlewares = [...globalMiddlewares, ...serviceMiddlewares];

  const beforeHooks = [...(registry.beforeHooks || []), ...(serviceDef.before || [])];
  const afterHooks = [...(serviceDef.after || []), ...(registry.afterHooks || [])];
  const onErrorHooks = [...(serviceDef.onError || []), ...(registry.onErrorHooks || [])];
  const eventDispatcher = registry.events || executionContext.events || ctx.events || null;

  const runWithRetry = async (fn) => {
    if (!retryConfig) {
      return await fn();
    }
    const retryOpts = typeof retryConfig === 'number'
      ? { retries: retryConfig }
      : (typeof retryConfig === 'object' && retryConfig !== null ? retryConfig : { retries: 3 });

    return await retry((attempt) => fn(attempt), retryOpts);
  };

  const runWithBreaker = async (fn, currentInputPayload) => {
    if (!breaker) {
      return await fn(currentInputPayload, executionContext);
    }
    return await breaker.execute(fn, currentInputPayload, executionContext);
  };

  const runCoreOperation = async (effectiveInput) => {
    let currentInput = effectiveInput;

    // 1. Run before hooks (can transform/enrich input)
    for (const hook of beforeHooks) {
      const hookRes = hook.length >= 2
        ? await hook(currentInput, executionContext)
        : await hook({
            name,
            input: currentInput,
            ctx: executionContext,
            serviceDef,
            options,
          });
      if (hookRes !== undefined) {
        currentInput = hookRes;
      }
    }

    // 2. Emit service:before event if dispatcher is present
    if (eventDispatcher && typeof eventDispatcher.emit === 'function') {
      try {
        eventDispatcher.emit('service:before', {
          name,
          input: currentInput,
          ctx: executionContext,
        });
      } catch (_) {}
    }

    // Helper to execute handler with optional database transaction
    const executeHandler = async (activeCtx) => {
      const shouldUseTx = (options.transaction === true || serviceDef.transaction === true);
      const db = activeCtx.db;

      // Check if knex or transaction-capable database is present
      const knexInstance = db && (db.knex || (typeof db.transaction === 'function' ? db : null));
      const alreadyInTx = Boolean(activeCtx.trx || hasAmbientTransaction());

      if (shouldUseTx && knexInstance && !alreadyInTx) {
        return await knexInstance.transaction(async (trxOrCtx) => {
          const actualTrx = (trxOrCtx && trxOrCtx.trx) ? trxOrCtx.trx : trxOrCtx;
          return await runWithAmbientTransaction(actualTrx, async () => {
            const txCtx = Object.create(activeCtx);
            txCtx.trx = actualTrx;
            if (activeCtx.db && typeof activeCtx.db.getRepository === 'function') {
              const { createRepository } = require('../orm/repository');
              const { createQueryBuilder } = require('../orm/query-builder');
              txCtx.db = Object.assign(Object.create(activeCtx.db), {
                knex: actualTrx,
                trx: actualTrx,
                transaction: (cb, sContext) => {
                  if (typeof activeCtx.db.transaction === 'function') {
                    return activeCtx.db.transaction(cb, sContext);
                  }
                  return actualTrx.transaction(cb);
                },
                getRepository: (modelName, scopeCtx) => {
                  const origRepo = activeCtx.db.getRepository(modelName, scopeCtx);
                  if (!origRepo || !origRepo.model) {
                    return origRepo || null;
                  }
                  return createRepository(
                    origRepo.model,
                    actualTrx,
                    scopeCtx,
                    origRepo.cacheLayer || activeCtx.db.ormCacheLayer || null
                  );
                },
                query: (modelName, scopeCtx) => {
                  if (typeof activeCtx.db.query === 'function') {
                    const origRepo = activeCtx.db.getRepository(modelName, scopeCtx);
                    if (origRepo && origRepo.model) {
                      return createQueryBuilder(
                        origRepo.model,
                        trx,
                        scopeCtx,
                        origRepo.cacheLayer || activeCtx.db.ormCacheLayer || null
                      );
                    }
                    return activeCtx.db.query(modelName, scopeCtx);
                  }
                  return null;
                },
              });
            } else {
              txCtx.db = trx;
            }
            txCtx.service = (subName, subInput, subOpts) =>
              executeService(registry, subName, subInput, txCtx, subOpts);
            txCtx.service.call = txCtx.service;
            txCtx.service.execute = txCtx.service;
            txCtx.service.invalidate = (subName, subInput, subCtx) =>
              registry.invalidate(subName, subInput, subCtx || txCtx);
            txCtx.service.clearCache = (subName) =>
              registry.clearCache(subName);
            txCtx.service.invalidateByTag = (tag, serviceName) =>
              registry.invalidateByTag(tag, serviceName);
            txCtx.service.invalidateByTags = (tags, serviceName) =>
              registry.invalidateByTags(tags, serviceName);
            txCtx.service.invalidateTag = txCtx.service.invalidateByTag;
            txCtx.service.invalidateTags = txCtx.service.invalidateByTags;
            txCtx.breaker = (bName, bOpts) =>
              circuitBreakerRegistry.getBreaker(bName, bOpts);
            txCtx.retry = retry;
            return await runWithContext(txCtx, () => serviceDef.handler(currentInput, txCtx));
          });
        });
      }

      return await runWithContext(activeCtx, () => serviceDef.handler(currentInput, activeCtx));
    };

    const invokeOperation = () => {
      if (timeoutMs && timeoutMs > 0) {
        let timerId;
        const controller = (!executionContext.signal && typeof AbortController !== 'undefined')
          ? new AbortController()
          : null;
        if (controller && !executionContext.signal) {
          executionContext.signal = controller.signal;
        }

        const timeoutPromise = new Promise((_, reject) => {
          timerId = setTimeout(() => {
            const timeoutErr = new WebspressoError(`Service '${name}' timed out after ${timeoutMs}ms`);
            timeoutErr.code = 'SERVICE_TIMEOUT';
            timeoutErr.statusCode = 504;
            timeoutErr.service = name;
            if (controller) {
              try { controller.abort(timeoutErr); } catch (_) {}
            }
            reject(timeoutErr);
          }, timeoutMs);
          if (timerId && typeof timerId.unref === 'function') {
            timerId.unref();
          }
        });

        const handlerPromise = executeHandler(executionContext);
        if (handlerPromise && typeof handlerPromise.catch === 'function') {
          handlerPromise.catch(() => {});
        }

        return Promise.race([
          handlerPromise,
          timeoutPromise,
        ]).finally(() => {
          if (timerId) {
            clearTimeout(timerId);
            timerId = null;
          }
        });
      }

      return executeHandler(executionContext);
    };

    let currentResult = await runWithBreaker(() => runWithRetry(invokeOperation), currentInput);

    // 3. Run after hooks (can transform/enrich result)
    for (const hook of afterHooks) {
      const hookRes = hook.length >= 2
        ? await hook(currentResult, currentInput, executionContext)
        : await hook({
            name,
            result: currentResult,
            input: currentInput,
            ctx: executionContext,
            serviceDef,
            duration: Date.now() - startTime,
            options,
          });
      if (hookRes !== undefined) {
        currentResult = hookRes;
      }
    }

    // 4. Emit service:after event
    if (eventDispatcher && typeof eventDispatcher.emit === 'function') {
      try {
        eventDispatcher.emit('service:after', {
          name,
          result: currentResult,
          input: currentInput,
          ctx: executionContext,
          duration: Date.now() - startTime,
        });
      } catch (_) {}
    }

    return currentResult;
  };

  try {
    validatedInput = await validateServiceInput(serviceDef.schema, input, name, serviceDef.validationOptions || options?.validation);
    if (validatedInput && typeof validatedInput === 'object' && !('input' in validatedInput)) {
      try {
        Object.defineProperty(validatedInput, 'input', {
          value: validatedInput,
          enumerable: false,
          configurable: true,
        });
      } catch (_) {}
    }

    let finalResult;

    if (allMiddlewares.length === 0) {
      finalResult = await runCoreOperation(validatedInput);
    } else {
      const hookContext = {
        name,
        input: validatedInput,
        ctx: executionContext,
        serviceDef,
        options,
        registry,
      };

      finalResult = await composeMiddleware(allMiddlewares)(hookContext, async () => {
        return await runCoreOperation(hookContext.input);
      });
    }

    const duration = Date.now() - startTime;
    if (logger && typeof logger.debug === 'function') {
      logger.debug(`[service] ${name} executed successfully (${duration}ms)`);
    }

    return finalResult;
  } catch (err) {
    const duration = Date.now() - startTime;

    // Run onError hooks
    for (const hook of onErrorHooks) {
      try {
        const recovery = hook.length >= 2
          ? await hook(err, validatedInput, executionContext)
          : await hook({
              name,
              error: err,
              input: validatedInput,
              ctx: executionContext,
              serviceDef,
              duration,
              options,
            });
        if (recovery && typeof recovery === 'object' && recovery.recover === true) {
          return recovery.result;
        }
      } catch (hookErr) {
        err = hookErr;
      }
    }

    // Emit service:error event
    if (eventDispatcher && typeof eventDispatcher.emit === 'function') {
      try {
        eventDispatcher.emit('service:error', {
          name,
          error: err,
          input: validatedInput,
          ctx: executionContext,
          duration,
        });
      } catch (_) {}
    }

    if (logger && typeof logger.error === 'function' && !(err instanceof ValidationError)) {
      logger.error(`[service] ${name} execution failed (${duration}ms): ${err.message}`);
    }

    if (err instanceof ValidationError) {
      if (!err.code) err.code = 'VALIDATION_ERROR';
      if (err.statusCode === undefined) err.statusCode = err.status || 422;
      if (err.status === undefined) err.status = 422;
    }

    // Attach service name to error if not present
    if (!err.service) {
      err.service = name;
    }

    throw err;
  }
}

/**
 * Compose an array of middleware functions into a single executable function
 * following the standard async onion model.
 * Supports both (context, next) and (input, ctx, next) signatures.
 * @param {Function[]} middlewares
 * @returns {Function}
 */
function composeMiddleware(middlewares) {
  if (!Array.isArray(middlewares)) {
    throw new TypeError('Middlewares must be an array');
  }

  return function (context, next) {
    let index = -1;
    function dispatch(i) {
      if (i <= index) {
        return Promise.reject(new Error('next() called multiple times in service middleware'));
      }
      index = i;
      const fn = i === middlewares.length ? next : middlewares[i];
      if (!fn) return Promise.resolve();
      try {
        if (fn.length >= 3) {
          return Promise.resolve(fn(context.input, context.ctx, () => dispatch(i + 1)));
        }
        return Promise.resolve(fn(context, () => dispatch(i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return dispatch(0);
  };
}

module.exports = {
  SERVICE_CALL_STACK_SYMBOL,
  maskSensitiveData,
  checkServiceAuth,
  executeService,
  composeMiddleware,
};
