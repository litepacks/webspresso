/**
 * Webspresso ORM
 * Minimal, Eloquent-inspired ORM with Knex and Zod
 * @module core/orm
 */

const { createSchemaHelpers, extractColumnsFromSchema, getColumnMeta } = require('./schema-helpers');
const { defineModel, getModel, getAllModels, hasModel, clearRegistry } = require('./model');
const { createRepository } = require('./repository');
const { createQueryBuilder, QueryBuilder } = require('./query-builder');
const { runTransaction, createTransactionContext } = require('./transaction');
const { createMigrationManager } = require('./migrations');
const { scaffoldMigration, scaffoldAlterMigration, scaffoldDropMigration } = require('./migrations/scaffold');
const { createScopeContext } = require('./scopes');
const { createSeeder } = require('./seeder');

/**
 * Create a database instance
 * @param {import('./types').DatabaseConfig} config - Database configuration
 * @returns {import('./types').DatabaseInstance}
 */
function createDatabase(config) {
  // Lazy load knex to avoid requiring it if ORM is not used
  let knex;
  try {
    knex = require('knex');
  } catch {
    throw new Error('Knex is required for ORM. Install it with: npm install knex');
  }

  // Create Knex instance
  const knexInstance = knex(config);

  // Create migration manager
  const migrationConfig = config.migrations || {};
  const migrate = createMigrationManager(knexInstance, migrationConfig);

  // Default scope context
  let globalScopeContext = createScopeContext();

  /**
   * Set global tenant ID
   * @param {*} tenantId - Tenant ID
   * @returns {DatabaseInstance}
   */
  function forTenant(tenantId) {
    globalScopeContext.tenantId = tenantId;
    return db;
  }

  /**
   * Create a repository for a model
   * @param {import('./types').ModelDefinition} model - Model definition
   * @returns {import('./types').Repository}
   */
  function createRepo(model) {
    return createRepository(model, knexInstance, { ...globalScopeContext });
  }

  /**
   * Run a callback within a transaction
   * @param {function(import('./types').TransactionContext): Promise<*>} callback
   * @returns {Promise<*>}
   */
  function transaction(callback) {
    return runTransaction(knexInstance, callback, { ...globalScopeContext });
  }

  /**
   * Get raw Knex instance for advanced queries
   * @returns {import('knex').Knex}
   */
  function raw() {
    return knexInstance;
  }

  /**
   * Close all database connections
   * @returns {Promise<void>}
   */
  async function destroy() {
    await knexInstance.destroy();
  }

  /**
   * Create a seeder instance
   * @param {Object} faker - Faker instance (@faker-js/faker)
   * @returns {Object} Seeder API
   */
  function seeder(faker) {
    return createSeeder(faker, knexInstance);
  }

  const db = {
    knex: knexInstance,
    createRepository: createRepo,
    transaction,
    migrate,
    seeder,
    forTenant,
    raw,
    destroy,
  };

  return db;
}

// Export everything
module.exports = {
  // Main factory
  createDatabase,

  // Schema helpers
  createSchemaHelpers,
  extractColumnsFromSchema,
  getColumnMeta,

  // Model
  defineModel,
  getModel,
  getAllModels,
  hasModel,
  clearRegistry,

  // Repository (for direct use if needed)
  createRepository,

  // Query builder
  createQueryBuilder,
  QueryBuilder,

  // Transaction
  runTransaction,
  createTransactionContext,

  // Migrations
  createMigrationManager,
  scaffoldMigration,
  scaffoldAlterMigration,
  scaffoldDropMigration,

  // Scopes
  createScopeContext,

  // Seeder
  createSeeder,
};

