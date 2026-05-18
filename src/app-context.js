/**
 * Process-wide app context set by createApp()
 * @module src/app-context
 */

/** @type {{ db: object|null }} */
let context = {
  db: null,
};

function setAppContext(partial) {
  context = { ...context, ...partial };
}

function getAppContext() {
  return context;
}

function getDb() {
  if (!context.db) {
    throw new Error(
      'No database registered. Create a DB with createDatabase(), then pass it to createApp({ db }). ' +
        'Or use hasDb() before calling getDb().'
    );
  }
  return context.db;
}

function hasDb() {
  return context.db != null;
}

function resetAppContext() {
  context = { db: null };
}

/**
 * Compat middleware: sets req.db from app context
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
