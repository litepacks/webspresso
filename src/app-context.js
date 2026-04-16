/**
 * Process-wide app context set by createApp() — use from API handlers, jobs, etc.
 * @module src/app-context
 */

/** @type {{ db: object|null }} */
let context = {
  db: null,
};

/**
 * Merge into the current context (typically called once from createApp).
 * @param {{ db?: object|null }} partial
 */
function setAppContext(partial) {
  context = { ...context, ...partial };
}

/**
 * @returns {{ db: object|null }}
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
 * Clear context (e.g. between tests).
 */
function resetAppContext() {
  context = { db: null };
}

/**
 * Express middleware: sets `req.db` from registered app context.
 * File-based `pages/api/*` routes attach this automatically; use in `setupRoutes`
 * for manually registered handlers that need `req.db`.
 * @type {import('express').RequestHandler}
 */
function attachDbMiddleware(req, res, next) {
  if (context.db != null) {
    req.db = context.db;
  }
  next();
}

module.exports = {
  setAppContext,
  getAppContext,
  getDb,
  hasDb,
  resetAppContext,
  attachDbMiddleware,
};
