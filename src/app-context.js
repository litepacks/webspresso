/**
 * Process-wide app context set by createApp() — use from API handlers, jobs, etc.
 * @module src/app-context
 */

const { circuitBreakerRegistry, retry } = require('../core/resilience');

/** @type {{ db: object|null, shutdownManager: object|null, serviceRegistry: object|null, events: object|null, mailer: object|null, cache: object|null, breakers: object|null }} */
let context = {
  db: null,
  shutdownManager: null,
  serviceRegistry: null,
  events: null,
  mailer: null,
  cache: null,
  breakers: circuitBreakerRegistry,
};

/**
 * Merge into the current context (typically called once from createApp).
 * @param {{ db?: object|null, shutdownManager?: object|null, serviceRegistry?: object|null, events?: object|null, mailer?: object|null, cache?: object|null }} partial
 */
function setAppContext(partial) {
  context = { ...context, ...partial };
}

/**
 * @returns {{ db: object|null, shutdownManager: object|null, serviceRegistry: object|null, events: object|null, mailer: object|null }}
 */
function getAppContext() {
  return context;
}

/**
 * Database instance passed to createApp({ db }) (Knex + ORM helpers).
 * @returns {object}
 * @throws {Error} If createApp was not given a db instance
 */
function getDb() {
  if (!context.db) {
    throw new Error(
      'No database registered. Create a DB with createDatabase(), then pass it to createApp({ db }). ' +
        'Or use hasDb() before calling getDb().'
    );
  }
  return context.db;
}

/**
 * @returns {boolean}
 */
function hasDb() {
  return context.db != null;
}

/**
 * @returns {object|null}
 */
function getShutdownManager() {
  return context.shutdownManager;
}

/**
 * @returns {boolean}
 */
function hasShutdownManager() {
  return context.shutdownManager != null;
}

/**
 * Get the registered ServiceRegistry instance
 * @returns {object|null}
 */
function getServiceRegistry() {
  return context.serviceRegistry;
}

/**
 * Check if a ServiceRegistry is registered
 * @returns {boolean}
 */
function hasServiceRegistry() {
  return context.serviceRegistry != null;
}

/**
 * Get the registered EventDispatcher instance
 * @returns {object|null}
 */
function getEvents() {
  return context.events;
}

/**
 * Check if an EventDispatcher is registered
 * @returns {boolean}
 */
function hasEvents() {
  return context.events != null;
}

/**
 * Clear context (e.g. between tests).
 */
function resetAppContext() {
  context = { db: null, shutdownManager: null, serviceRegistry: null, events: null, mailer: null, cache: null };
}

/**
 * @returns {object|null}
 */
function getMailer() {
  return context.mailer;
}

/**
 * @returns {boolean}
 */
function hasMailer() {
  return context.mailer != null;
}

/**
 * @returns {object|null}
 */
function getCache() {
  return context.cache;
}

/**
 * @returns {boolean}
 */
function hasCache() {
  return context.cache != null;
}

/**
 * Express middleware: sets `req.db`, `req.service`, `req.events`, `req.mailer`, and `req.cache` from registered app context.
 * File-based `pages/api/*` routes attach this automatically; use in `setupRoutes`
 * for manually registered handlers that need `req.db` and `req.service`.
 * @type {import('express').RequestHandler}
 */
function attachDbMiddleware(req, res, next) {
  if (context.db != null) {
    req.db = context.db;
  }
  if (context.events != null) {
    req.events = context.events;
  }
  if (context.mailer != null) {
    req.mailer = context.mailer;
  }
  if (context.cache != null) {
    req.cache = context.cache;
  }
  req.breakers = context.breakers || circuitBreakerRegistry;
  req.breaker = (name, opts) => (context.breakers || circuitBreakerRegistry).getBreaker(name, opts);
  req.retry = retry;
  if (context.serviceRegistry != null) {
    req.service = (name, input, opts) =>
      context.serviceRegistry.call(name, input, req.context || {
        req,
        res,
        db: context.db,
        events: context.events,
        mailer: context.mailer,
        cache: context.cache,
        breakers: req.breakers,
        breaker: req.breaker,
        retry,
      }, opts);
  }
  next();
}

module.exports = {
  setAppContext,
  getAppContext,
  getDb,
  hasDb,
  getShutdownManager,
  hasShutdownManager,
  getServiceRegistry,
  hasServiceRegistry,
  getEvents,
  hasEvents,
  getMailer,
  hasMailer,
  getCache,
  hasCache,
  resetAppContext,
  attachDbMiddleware,
};
