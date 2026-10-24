'use strict';

/**
 * Webspresso Ambient Request & Execution Context
 * Zero-dependency execution context powered by Node.js AsyncLocalStorage.
 * Provides composable hooks (useContext, useDb, useAuth, useUser, useLogger, useService,
 * useReq, useRes, useParams, useQuery, useQueue, useCache, useBreaker, useTransaction, withContext)
 * across loaders, services, models, and background workers without prop drilling.
 *
 * @module core/context/request
 */

const { AsyncLocalStorage } = require('async_hooks');

const requestContextStorage = new AsyncLocalStorage();

/**
 * Runs a callback within an ambient request or execution context
 * @param {Object} context - Execution context payload
 * @param {Function} fn - Function to execute within context
 * @returns {*} Return value of fn
 */
function runWithContext(context, fn) {
  return requestContextStorage.run(context || {}, fn);
}

/**
 * Run a callback with shallow-merged overrides on top of the current ambient context
 * @param {Object} overrides - Object containing fields to override in current context
 * @param {Function} fn - Function to execute
 * @returns {*} Return value of fn
 */
function withContext(overrides, fn) {
  const current = requestContextStorage.getStore() || {};
  const merged = { ...current, ...(overrides || {}) };
  return requestContextStorage.run(merged, fn);
}

/**
 * Get the current active ambient context (returns null if outside context)
 * @returns {Object|null}
 */
function getContext() {
  return requestContextStorage.getStore() || null;
}

/**
 * Hook to access the ambient execution context
 * @returns {Object} Active context object
 * @throws {Error} If called outside of an active execution context
 */
function useContext() {
  const store = requestContextStorage.getStore();
  if (!store) {
    throw new Error('useContext() must be called within an active request, job, or execution context.');
  }
  return store;
}

/**
 * Hook to access the ambient database instance
 * @returns {Object|null} Database / ORM instance or null
 */
function useDb() {
  const store = requestContextStorage.getStore();
  return store?.db || store?.req?.db || null;
}

/**
 * Hook to access the ambient authenticated user / principal
 * @returns {Object|null} User / Auth object or null
 */
function useAuth() {
  const store = requestContextStorage.getStore();
  return (
    store?.user ||
    store?.auth?.user ||
    store?.auth ||
    store?.req?.user ||
    store?.req?.auth?.user ||
    store?.req?.auth ||
    null
  );
}

/**
 * Hook to access the ambient authenticated user
 * Alias / dedicated helper for useAuth()
 * @returns {Object|null} User object or null
 */
function useUser() {
  return useAuth();
}

/**
 * Hook to access the ambient logger
 * @returns {Object} Logger instance
 */
function useLogger() {
  const store = requestContextStorage.getStore();
  return store?.logger || store?.req?.logger || console;
}

/**
 * Hook to access the ambient HTTP request object
 * @returns {Object|null} Express/Hono request object or null if outside HTTP request
 */
function useReq() {
  const store = requestContextStorage.getStore();
  return store?.req || null;
}

/**
 * Hook to access the ambient HTTP response object
 * @returns {Object|null} Express/Hono response object or null if outside HTTP request
 */
function useRes() {
  const store = requestContextStorage.getStore();
  return store?.res || null;
}

/**
 * Hook to access the ambient route parameters
 * @returns {Object} Route parameters map (e.g. { id: '123' })
 */
function useParams() {
  const store = requestContextStorage.getStore();
  return store?.params || store?.req?.params || {};
}

/**
 * Hook to access the ambient URL query parameters
 * @returns {Object} URL query parameters map
 */
function useQuery() {
  const store = requestContextStorage.getStore();
  return store?.query || store?.req?.query || {};
}

/**
 * Hook to invoke a registered service using the ambient context
 * @param {string} name - Service name (e.g. 'user.get')
 * @param {*} [input={}] - Input payload
 * @param {Object} [opts] - Optional execution options
 * @returns {Promise<*>}
 */
async function useService(name, input = {}, opts) {
  const store = requestContextStorage.getStore();
  if (store?.service && typeof store.service === 'function') {
    return store.service(name, input, opts);
  }
  if (store?.req?.service && typeof store.req.service === 'function') {
    return store.req.service(name, input, opts);
  }
  throw new Error(`useService() failed: no service registry available in active context.`);
}

/**
 * Hook to access the ambient background queue
 * @returns {Object|null}
 */
function useQueue() {
  const store = requestContextStorage.getStore();
  return store?.queue || store?.req?.queue || null;
}

/**
 * Hook to access the ambient cache
 * @returns {Object|null}
 */
function useCache() {
  const store = requestContextStorage.getStore();
  return store?.cache || store?.req?.cache || null;
}

/**
 * Hook to access or create a circuit breaker by name
 * @param {string} name - Circuit breaker name
 * @param {Object} [options] - Circuit breaker options
 * @returns {Object|null} CircuitBreaker instance or null
 */
function useBreaker(name, options) {
  const store = requestContextStorage.getStore();
  if (store?.breaker && typeof store.breaker === 'function') {
    return store.breaker(name, options);
  }
  if (store?.req?.breaker && typeof store.req.breaker === 'function') {
    return store.req.breaker(name, options);
  }
  try {
    const { circuitBreakerRegistry } = require('../resilience');
    return circuitBreakerRegistry.getBreaker(name, options);
  } catch (_) {
    return null;
  }
}

/**
 * Hook to execute a callback within a managed transaction on the ambient database
 * Automatically binds transactional context to ambient hooks inside the callback.
 * @param {function(trx: any): Promise<*>} callback - Transaction callback
 * @returns {Promise<*>} Result of callback
 */
async function useTransaction(callback) {
  const db = useDb();
  if (!db) {
    throw new Error('useTransaction() failed: no database instance available in active context.');
  }

  if (typeof db.transaction === 'function') {
    return db.transaction(async (trx) => {
      const current = requestContextStorage.getStore() || {};
      const txDb = trx.db || trx;
      const txCtx = { ...current, db: txDb, trx: trx.trx || trx };
      return requestContextStorage.run(txCtx, () => callback(trx));
    });
  }

  throw new Error('useTransaction() failed: db does not support transaction().');
}

module.exports = {
  requestContextStorage,
  runWithContext,
  withContext,
  getContext,
  useContext,
  useDb,
  useAuth,
  useUser,
  useLogger,
  useReq,
  useRes,
  useParams,
  useQuery,
  useService,
  useQueue,
  useCache,
  useBreaker,
  useTransaction,
};
