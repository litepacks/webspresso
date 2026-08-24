/**
 * Process-wide app context set by createApp() — use from API handlers, jobs, etc.
 * @module src/app-context
 */

/** @type {{ db: object|null, shutdownManager: object|null, serviceRegistry: object|null }} */
let context = {
  db: null,
  shutdownManager: null,
  serviceRegistry: null,
};

/**
 * Merge into the current context (typically called once from createApp).
 * @param {{ db?: object|null, shutdownManager?: object|null, serviceRegistry?: object|null }} partial
 */
function setAppContext(partial) {
  context = { ...context, ...partial };
}

/**
 * @returns {{ db: object|null, shutdownManager: object|null, serviceRegistry: object|null }}
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
 * Clear context (e.g. between tests).
 */
function resetAppContext() {
  context = { db: null, shutdownManager: null, serviceRegistry: null };
}

/**
 * Express middleware: sets `req.db` and `req.service` from registered app context.
 * File-based `pages/api/*` routes attach this automatically; use in `setupRoutes`
 * for manually registered handlers that need `req.db` and `req.service`.
 * @type {import('express').RequestHandler}
 */
function attachDbMiddleware(req, res, next) {
  if (context.db != null) {
    req.db = context.db;
  }
  if (context.serviceRegistry != null) {
    req.service = (name, input, opts) =>
      context.serviceRegistry.call(name, input, req.context || { req, res, db: context.db }, opts);
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
  resetAppContext,
  attachDbMiddleware,
};
