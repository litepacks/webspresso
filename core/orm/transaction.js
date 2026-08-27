/**
 * Webspresso ORM - Transaction
 * Transaction wrapper with scoped repositories and AsyncLocalStorage ambient transaction support
 * @module core/orm/transaction
 */

const { AsyncLocalStorage } = require('async_hooks');
const { createScopeContext } = require('./scopes');

// AsyncLocalStorage instance holding the current active ambient transaction
const ambientTransactionStorage = new AsyncLocalStorage();

/**
 * Execute a callback within an ambient transaction context
 * @param {import('knex').Knex.Transaction} trx - Knex transaction
 * @param {Function} callback - Function to execute
 * @returns {Promise<*>} Result of callback
 */
function runWithAmbientTransaction(trx, callback) {
  return ambientTransactionStorage.run({ trx }, callback);
}

/**
 * Get the currently active ambient Knex transaction, or null if none
 * @returns {import('knex').Knex.Transaction|null}
 */
function getAmbientTransaction() {
  const store = ambientTransactionStorage.getStore();
  return store && store.trx ? store.trx : null;
}

/**
 * Check if there is an active ambient Knex transaction in current execution context
 * @returns {boolean}
 */
function hasAmbientTransaction() {
  return Boolean(getAmbientTransaction());
}

/**
 * Create a transaction context
 * @param {import('knex').Knex.Transaction} trx - Knex transaction
 * @param {import('./types').ScopeContext} [scopeContext] - Scope context
 * @returns {import('./types').TransactionContext}
 */
function createTransactionContext(trx, scopeContext) {
  const { createRepository } = require('./repository');
  const context = scopeContext || createScopeContext();

  return {
    trx,
    
    /**
     * Create a repository bound to this transaction
     * @param {import('./types').ModelDefinition} model - Model definition
     * @returns {import('./types').Repository}
     */
    createRepository(model) {
      return createRepository(model, trx, context);
    },

    /**
     * Set tenant context for this transaction
     * @param {*} tenantId - Tenant ID
     * @returns {this}
     */
    forTenant(tenantId) {
      context.tenantId = tenantId;
      return this;
    },

    /**
     * Get the scope context
     * @returns {import('./types').ScopeContext}
     */
    getScopeContext() {
      return { ...context };
    },
  };
}

/**
 * Run a callback within a transaction and bind ambient transaction storage
 * @param {import('knex').Knex} knex - Knex instance
 * @param {function(import('./types').TransactionContext): Promise<*>} callback - Transaction callback
 * @param {import('./types').ScopeContext} [scopeContext] - Scope context
 * @returns {Promise<*>} Result of callback
 */
async function runTransaction(knex, callback, scopeContext) {
  return knex.transaction(async (trx) => {
    const ctx = createTransactionContext(trx, scopeContext);
    return runWithAmbientTransaction(trx, () => callback(ctx));
  });
}

module.exports = {
  ambientTransactionStorage,
  runWithAmbientTransaction,
  getAmbientTransaction,
  hasAmbientTransaction,
  createTransactionContext,
  runTransaction,
};
