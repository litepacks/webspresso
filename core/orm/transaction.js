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
 * @param {import('knex').Knex.Transaction|{ trx: import('knex').Knex.Transaction }} trx - Knex transaction or transaction context
 * @param {Function} callback - Function to execute
 * @returns {Promise<*>} Result of callback
 */
function runWithAmbientTransaction(trx, callback) {
  const actualTrx = (trx && trx.trx) ? trx.trx : trx;
  return ambientTransactionStorage.run({ trx: actualTrx }, callback);
}

/**
 * Get the currently active ambient Knex transaction, or null if none
 * @returns {import('knex').Knex.Transaction|null}
 */
function getAmbientTransaction() {
  const store = ambientTransactionStorage.getStore();
  if (!store || !store.trx) return null;
  const rawTrx = (store.trx && store.trx.trx) ? store.trx.trx : store.trx;
  if (typeof rawTrx.isCompleted === 'function' && rawTrx.isCompleted()) {
    return null;
  }
  return rawTrx;
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
 * @param {import('./cache/layer').OrmCacheLayer|null} [ormCacheLayer] - Optional ORM cache layer
 * @param {Function|null} [modelResolver] - Optional model resolver function
 * @returns {import('./types').TransactionContext}
 */
function createTransactionContext(trx, scopeContext, ormCacheLayer = null, modelResolver = null) {
  const { createRepository } = require('./repository');
  const { createQueryBuilder } = require('./query-builder');
  const { getModel } = require('./model');
  let context = scopeContext ? { ...scopeContext } : createScopeContext();

  const resolveModel = (nameOrModel) => {
    if (typeof modelResolver === 'function') {
      return modelResolver(nameOrModel);
    }
    if (nameOrModel && typeof nameOrModel === 'object' && nameOrModel.name) {
      return nameOrModel;
    }
    const model = getModel(nameOrModel);
    if (!model) {
      throw new Error(`Model "${nameOrModel}" not found in model registry`);
    }
    return model;
  };

  const trxContext = {
    trx,
    knex: trx,

    /**
     * Get or create a repository bound to this transaction by model name
     * @param {string} modelName - Model name
     * @param {import('./types').ScopeContext} [sContext] - Optional scope context
     * @returns {import('./types').Repository}
     */
    getRepository(modelName, sContext) {
      const model = resolveModel(modelName);
      const ctx = sContext || context;
      return createRepository(model, trx, ctx, ormCacheLayer);
    },

    /**
     * Create a repository bound to this transaction
     * @param {import('./types').ModelDefinition} model - Model definition
     * @param {import('./types').ScopeContext} [sContext]
     * @returns {import('./types').Repository}
     */
    createRepository(model, sContext) {
      const ctx = sContext || context;
      return createRepository(model, trx, ctx, ormCacheLayer);
    },

    /**
     * Create a query builder bound to this transaction
     * @param {string|import('./types').ModelDefinition} modelOrName
     * @param {import('./types').ScopeContext} [sContext]
     * @returns {import('./query-builder').QueryBuilder}
     */
    query(modelOrName, sContext) {
      const model = resolveModel(modelOrName);
      const ctx = sContext ? { ...sContext } : context;
      return createQueryBuilder(model, trx, ctx, ormCacheLayer);
    },

    /**
     * Nest another transaction (creates a savepoint within this transaction)
     * @param {Function} cb
     * @param {import('./types').ScopeContext} [sContext]
     * @returns {Promise<*>}
     */
    transaction(cb, sContext) {
      return runTransaction(trx, cb, sContext || context, ormCacheLayer, modelResolver);
    },

    /**
     * Set tenant context for this transaction
     * @param {*} tenantId - Tenant ID
     * @returns {this}
     */
    forTenant(tenantId) {
      context = { ...context, tenantId };
      return trxContext;
    },

    /**
     * Set user context for this transaction
     * @param {*} user
     * @returns {this}
     */
    forUser(user) {
      context = { ...context, user };
      return trxContext;
    },

    /**
     * Disable RLS for this transaction scope
     * @returns {this}
     */
    withoutRls() {
      context = { ...context, rlsDisabled: true };
      return trxContext;
    },

    /**
     * Get the scope context
     * @returns {import('./types').ScopeContext}
     */
    getScopeContext() {
      return { ...context };
    },
  };

  return trxContext;
}

/**
 * Run a callback within a transaction and bind ambient transaction storage
 * @param {import('knex').Knex} knex - Knex instance
 * @param {function(import('./types').TransactionContext): Promise<*>} callback - Transaction callback
 * @param {import('./types').ScopeContext} [scopeContext] - Scope context
 * @param {import('./cache/layer').OrmCacheLayer|null} [ormCacheLayer] - Optional ORM cache layer
 * @param {Function|null} [modelResolver] - Optional model resolver function
 * @returns {Promise<*>} Result of callback
 */
async function runTransaction(knex, callback, scopeContext, ormCacheLayer = null, modelResolver = null) {
  const ambientTrx = getAmbientTransaction();
  const runner = (ambientTrx && typeof ambientTrx.transaction === 'function') ? ambientTrx : knex;
  if (!runner || typeof runner.transaction !== 'function') {
    const ctx = createTransactionContext(runner, scopeContext, ormCacheLayer, modelResolver);
    return callback(ctx);
  }

  let originalError = null;
  try {
    return await runner.transaction(async (trx) => {
      const ctx = createTransactionContext(trx, scopeContext, ormCacheLayer, modelResolver);
      try {
        return await runWithAmbientTransaction(trx, () => callback(ctx));
      } catch (err) {
        originalError = err;
        throw err;
      }
    });
  } catch (err) {
    if (originalError && err !== originalError) {
      if (!originalError.cause) {
        originalError.cause = err;
      }
      throw originalError;
    }
    throw err;
  }
}

module.exports = {
  ambientTransactionStorage,
  runWithAmbientTransaction,
  getAmbientTransaction,
  hasAmbientTransaction,
  createTransactionContext,
  runTransaction,
};
