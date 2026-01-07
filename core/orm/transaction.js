/**
 * Webspresso ORM - Transaction
 * Transaction wrapper with scoped repositories
 * @module core/orm/transaction
 */

const { createRepository } = require('./repository');
const { createScopeContext } = require('./scopes');

/**
 * Create a transaction context
 * @param {import('knex').Knex.Transaction} trx - Knex transaction
 * @param {import('./types').ScopeContext} [scopeContext] - Scope context
 * @returns {import('./types').TransactionContext}
 */
function createTransactionContext(trx, scopeContext) {
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
 * Run a callback within a transaction
 * @param {import('knex').Knex} knex - Knex instance
 * @param {function(import('./types').TransactionContext): Promise<*>} callback - Transaction callback
 * @param {import('./types').ScopeContext} [scopeContext] - Scope context
 * @returns {Promise<*>} Result of callback
 */
async function runTransaction(knex, callback, scopeContext) {
  return knex.transaction(async (trx) => {
    const ctx = createTransactionContext(trx, scopeContext);
    return callback(ctx);
  });
}

module.exports = {
  createTransactionContext,
  runTransaction,
};

