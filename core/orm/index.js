/**
 * Webspresso ORM
 * Minimal, Eloquent-inspired ORM with Knex and Zod
 * @module core/orm
 */

const path = require('path');
const { createSchemaHelpers, extractColumnsFromSchema, getColumnMeta } = require('./schema-helpers');
const { defineModel, getModel, getAllModels, hasModel, clearRegistry } = require('./model');

// Create zdb instance with zod (zod is a dependency)
let z;
try {
  z = require('zod');
} catch {
  // Zod not installed, zdb will be undefined
  z = null;
}

// Export zdb instance directly
const zdb = z ? createSchemaHelpers(z) : null;
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

  // Check if database driver is available in project's node_modules
  const client = config.client;
  if (client) {
    const driverMap = {
      'better-sqlite3': 'better-sqlite3',
      'pg': 'pg',
      'mysql2': 'mysql2',
      'mysql': 'mysql2',
    };
    
    const driverName = driverMap[client] || client;
    
    // Try to resolve and pre-load the driver from project's node_modules
    // This ensures Knex can find it when it tries to load it
    let driverPath = null;
    const resolvePaths = [
      path.join(process.cwd(), 'node_modules'),
      process.cwd(),
    ];
    
    // Also try to resolve from parent directories (for nested projects)
    let currentPath = process.cwd();
    for (let i = 0; i < 5; i++) {
      resolvePaths.push(path.join(currentPath, 'node_modules'));
      const parent = path.dirname(currentPath);
      if (parent === currentPath) break; // Reached root
      currentPath = parent;
    }
    
    for (const resolvePath of resolvePaths) {
      try {
        driverPath = require.resolve(driverName, { paths: [resolvePath] });
        // Pre-load the driver so Knex can find it in Module._cache
        // This is critical: Knex uses require() internally, so we need to
        // load it into the cache first
        require(driverPath);
        break;
      } catch (e) {
        // Continue to next path
      }
    }
    
    // If still not found, try default resolution (might be in webspresso's node_modules)
    if (!driverPath) {
      try {
        // Try to find it anywhere in the module resolution path
        driverPath = require.resolve(driverName);
        require(driverPath);
      } catch (e) {
        // Driver not found anywhere
        const installCmd = driverName === 'better-sqlite3' 
          ? 'npm install better-sqlite3 --save'
          : driverName === 'pg'
          ? 'npm install pg --save'
          : driverName === 'mysql2'
          ? 'npm install mysql2 --save'
          : `npm install ${driverName} --save`;
        
        throw new Error(
          `Database driver "${driverName}" is not installed in your project. ` +
          `Please install it with: ${installCmd}\n` +
          `Note: Database drivers are peer dependencies and must be installed in your project's node_modules, not globally.\n` +
          `Current working directory: ${process.cwd()}\n` +
          `Make sure you run "${installCmd}" in your project directory.`
        );
      }
    }
  }

  // Create Knex instance
  // Knex will try to load the driver from its own node_modules
  // We need to ensure the driver is available in the project's node_modules
  let knexInstance;
  try {
    knexInstance = knex(config);
  } catch (e) {
    // If knex throws an error about missing driver, provide better message
    if (e.message && (e.message.includes('Cannot find module') || e.message.includes('run') || e.message.includes('npm install'))) {
      const driverName = config.client;
      const installCmd = driverName === 'better-sqlite3' 
        ? 'npm install better-sqlite3 --save'
        : driverName === 'pg'
        ? 'npm install pg --save'
        : driverName === 'mysql2'
        ? 'npm install mysql2 --save'
        : `npm install ${driverName} --save`;
      
      // Check if driver exists in project's node_modules
      let driverExists = false;
      let foundDriverPath = null;
      const checkPaths = [
        path.join(process.cwd(), 'node_modules'),
        process.cwd(),
      ];
      
      // Also check parent directories
      let currentPath = process.cwd();
      for (let i = 0; i < 5; i++) {
        checkPaths.push(path.join(currentPath, 'node_modules'));
        const parent = path.dirname(currentPath);
        if (parent === currentPath) break;
        currentPath = parent;
      }
      
      for (const checkPath of checkPaths) {
        try {
          foundDriverPath = require.resolve(driverName, { paths: [checkPath] });
          driverExists = true;
          break;
        } catch (resolveError) {
          // Continue checking
        }
      }
      
      if (!driverExists) {
        throw new Error(
          `Database driver "${driverName}" is not installed in your project. ` +
          `Please install it with: ${installCmd}\n` +
          `Note: Database drivers are peer dependencies and must be installed in your project's node_modules, not globally.\n` +
          `Current working directory: ${process.cwd()}\n` +
          `Make sure you run "${installCmd}" in your project directory.`
        );
      } else {
        // Driver exists but Knex can't find it - try to manually require it
        try {
          // Force load the driver into Module._cache
          require(foundDriverPath);
          // Retry Knex initialization
          knexInstance = knex(config);
        } catch (retryError) {
          throw new Error(
            `Database driver "${driverName}" is installed but Knex cannot find it. ` +
            `This might be a module resolution issue. Try:\n` +
            `1. Delete node_modules and package-lock.json\n` +
            `2. Run "npm install" again\n` +
            `3. Make sure "${driverName}" is in your package.json dependencies\n` +
            `4. Verify the driver is accessible: node -e "require('${driverName}')"\n` +
            `Driver found at: ${foundDriverPath}\n` +
            `Original error: ${e.message}`
          );
        }
      }
    }
    throw e;
  }

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

  // Schema helpers - zdb instance (direct export)
  zdb,
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

