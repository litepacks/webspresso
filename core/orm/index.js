/**
 * Webspresso ORM
 * Minimal, Eloquent-inspired ORM with Knex and Zod
 * @module core/orm
 */

const path = require('path');
const fs = require('fs');
const { createSchemaHelpers, extractColumnsFromSchema, getColumnMeta } = require('./schema-helpers');
const { defineModel, getModel, getAllModels, hasModel, clearRegistry } = require('./model');
const { createRepository } = require('./repository');
const { createMigrationManager } = require('./migrations');
const { createSeeder } = require('./seeder');
const { createScopeContext } = require('./scopes');
const { ModelEvents, Hooks, HookCancellationError, createEventContext } = require('./events');
const { omitHiddenColumns, sanitizeForOutput } = require('./utils');
const { generateNanoid, zodNanoid, extendZ } = require('./utils/nanoid');
const { createOrmCacheFromConfig, unregisterOrmCacheListeners } = require('./cache');
const {
  ambientTransactionStorage,
  runWithAmbientTransaction,
  getAmbientTransaction,
  hasAmbientTransaction,
  createTransactionContext,
  runTransaction,
} = require('./transaction');

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
    const projectNodeModules = path.join(process.cwd(), 'node_modules');
    
    // Try to find and pre-load driver from project's node_modules
    try {
      const driverPath = require.resolve(driverName, { paths: [projectNodeModules] });
      require(driverPath); // Pre-load into Module._cache
    } catch (e) {
      // Driver not found in project
      const installCmd = driverName === 'better-sqlite3' 
        ? 'npm install better-sqlite3 --save'
        : driverName === 'pg'
        ? 'npm install pg --save'
        : driverName === 'mysql2'
        ? 'npm install mysql2 --save'
        : `npm install ${driverName} --save`;
      
      throw new Error(
        `Database driver "${driverName}" is not installed in your project.\n` +
        `Please install it with: ${installCmd}\n` +
        `Current working directory: ${process.cwd()}`
      );
    }
  }

  // Create Knex instance (default useNullAsDefault: true for SQLite to prevent unneeded warnings)
  const isSqlite = client === 'better-sqlite3' || client === 'sqlite3';
  const knexConfig = {
    ...(isSqlite && config.useNullAsDefault === undefined ? { useNullAsDefault: true } : {}),
    ...config,
  };

  if (isSqlite) {
    const userAfterCreate = knexConfig.pool?.afterCreate;
    knexConfig.pool = {
      ...(knexConfig.pool || {}),
      afterCreate: (conn, cb) => {
        try {
          if (typeof conn.pragma === 'function') {
            const isMemory =
              knexConfig.connection === ':memory:' ||
              knexConfig.connection?.filename === ':memory:' ||
              knexConfig.connection?.database === ':memory:';

            if (!isMemory) {
              try { conn.pragma('journal_mode = WAL'); } catch (e) {}
            }
            try { conn.pragma('synchronous = NORMAL'); } catch (e) {}
            try { conn.pragma('busy_timeout = 5000'); } catch (e) {}
            try { conn.pragma('foreign_keys = ON'); } catch (e) {}
          }
        } catch (e) {}

        if (typeof userAfterCreate === 'function') {
          userAfterCreate(conn, cb);
        } else {
          cb(null, conn);
        }
      },
    };
  }

  let knexInstance;
  try {
    knexInstance = knex(knexConfig);
  } catch (e) {
    // Provide helpful error message
    if (e.message && (e.message.includes('Cannot find module') || e.message.includes('npm install'))) {
      const driverName = driverMap[config.client] || config.client;
      const installCmd = driverName === 'better-sqlite3' 
        ? 'npm install better-sqlite3 --save'
        : driverName === 'pg'
        ? 'npm install pg --save'
        : driverName === 'mysql2'
        ? 'npm install mysql2 --save'
        : `npm install ${driverName} --save`;
      
      throw new Error(
        `Failed to initialize database: ${e.message}\n` +
        `Make sure "${driverName}" is installed: ${installCmd}`
      );
    }
    throw e;
  }

  // Create migration manager
  const migrationConfig = config.migrations || {};
  const migrate = createMigrationManager(knexInstance, migrationConfig);

  const { layer: ormCacheLayer, publicApi: ormCachePublicApi } = createOrmCacheFromConfig(
    config.cache
  );

  // Auto-load models from models directory
  const modelsDir = config.models || './models';
  const absoluteModelsDir = path.resolve(process.cwd(), modelsDir);
  
  if (fs.existsSync(absoluteModelsDir)) {
    const modelFiles = fs.readdirSync(absoluteModelsDir)
      .filter(file => file.endsWith('.js') && !file.startsWith('_'));
    
    for (const file of modelFiles) {
      try {
        const modelPath = path.join(absoluteModelsDir, file);
        require(modelPath);
      } catch (error) {
        console.error(`Error loading model from ${file}:`, error.message);
        // Continue loading other models even if one fails
      }
    }
  }

  // Model registry (use global registry, but keep local for backward compatibility)
  const models = new Map();
  
  // Sync global registry to local registry
  const globalModels = getAllModels();
  for (const [name, model] of globalModels) {
    models.set(name, model);
  }

  /**
   * Get a model by name
   * @param {string|import('./types').ModelDefinition} nameOrModel - Model name or model definition
   * @returns {import('./types').ModelDefinition}
   */
  function getModelInstance(nameOrModel) {
    const name = typeof nameOrModel === 'object' && nameOrModel !== null && nameOrModel.name
      ? nameOrModel.name
      : nameOrModel;

    // First check local registry
    let model = models.get(name);
    
    // If not found, check global registry (for models loaded after database creation)
    if (!model) {
      model = getModel(name);
      if (model) {
        models.set(name, model); // Cache in local registry
      }
    }
    
    if (!model) {
      throw new Error(`Model "${name}" is not defined. Make sure you've called defineModel() first or the model file exists in ${modelsDir}.`);
    }
    return model;
  }

  /**
   * Check if a model exists
   * @param {string} name - Model name
   * @returns {boolean}
   */
  function hasModelInstance(name) {
    return models.has(name);
  }

  /**
   * Get all registered models
   * @returns {Array<import('./types').ModelDefinition>}
   */
  function getAllModelInstances() {
    return Array.from(models.values());
  }

  /**
   * Register a model
   * @param {import('./types').ModelDefinition} model - Model definition
   */
  function registerModel(model) {
    models.set(model.name, model);
    // Also ensure it's in global registry (defineModel already does this, but just in case)
  }

  /**
   * Get repository for a model
   * @param {string} modelName - Model name
   * @param {import('./types').ScopeContext} [scopeContext] - Scope context
   * @returns {import('./types').Repository}
   */
  function getRepository(modelName, scopeContext) {
    const model = getModelInstance(modelName);
    // Always create fresh scope context if not provided to avoid shared state
    const ctx = scopeContext || createScopeContext();
    return createRepository(model, knexInstance, ctx, ormCacheLayer);
  }

  /**
   * Get query builder for a model
   * @param {string} modelName - Model name
   * @param {import('./types').ScopeContext} [scopeContext] - Scope context
   * @returns {import('./query-builder').QueryBuilder}
   */
  function query(modelName, scopeContext) {
    const model = getModelInstance(modelName);
    const ctx = scopeContext || createScopeContext();
    const repo = createRepository(model, knexInstance, ctx, ormCacheLayer);
    return repo.query();
  }

  /**
   * Create seeder instance
   * @returns {import('./types').Seeder}
   */
  function createSeederInstance() {
    return createSeeder(knexInstance, models);
  }

  /**
   * Create repository from model object (alternative to getRepository)
   * @param {import('./types').ModelDefinition} model - Model definition
   * @param {import('./types').ScopeContext} [scopeContext] - Scope context
   * @returns {import('./types').Repository}
   */
  function createRepositoryFromModel(model, scopeContext) {
    const ctx = scopeContext || createScopeContext();
    return createRepository(model, knexInstance, ctx, ormCacheLayer);
  }

  /**
   * Run operations in an ambient transaction
   * @param {Function} callback - Callback receiving transaction context
   * @param {import('./types').ScopeContext} [scopeContext] - Optional scope context
   * @returns {Promise<*>} Result of callback
   */
  async function transaction(callback, scopeContext) {
    return knexInstance.transaction(async (trx) => {
      const trxContext = {
        trx,
        getRepository(modelName, sContext) {
          const model = getModelInstance(modelName);
          const ctx = sContext || scopeContext || createScopeContext();
          return createRepository(model, trx, ctx, ormCacheLayer);
        },
        createRepository(model, sContext) {
          const ctx = sContext || scopeContext || createScopeContext();
          return createRepository(model, trx, ctx, ormCacheLayer);
        },
        forTenant(tenantId) {
          if (!scopeContext) scopeContext = createScopeContext();
          scopeContext.tenantId = tenantId;
          return this;
        },
        getScopeContext() {
          return { ...(scopeContext || createScopeContext()) };
        },
      };
      return runWithAmbientTransaction(trx, () => callback(trxContext));
    });
  }

  return {
    knex: knexInstance,
    migrate,
    getModel: getModelInstance,
    hasModel: hasModelInstance,
    getAllModels: getAllModelInstances,
    registerModel,
    getRepository,
    createRepository: createRepositoryFromModel,
    query,
    transaction,
    runInTransaction: transaction,
    getAmbientTransaction,
    hasActiveTransaction: hasAmbientTransaction,
    createSeeder: createSeederInstance,
    cache: ormCachePublicApi,
    destroy: () => {
      if (ormCacheLayer) unregisterOrmCacheListeners(ormCacheLayer);
      return knexInstance.destroy();
    },
  };
}

// Export zdb instance directly
const z = require('zod');
const zdb = z ? createSchemaHelpers(z) : null;

module.exports = {
  // Main factory
  createDatabase,
  // ORM cache (provider + layer utilities)
  createMemoryCacheProvider: require('./cache/memory-provider').createMemoryCacheProvider,
  OrmCacheLayer: require('./cache/layer').OrmCacheLayer,
  createOrmCacheFromConfig: require('./cache').createOrmCacheFromConfig,
  // Ambient transaction management
  ambientTransactionStorage,
  runWithAmbientTransaction,
  getAmbientTransaction,
  hasAmbientTransaction,
  createTransactionContext,
  runTransaction,
  // Schema helpers
  zdb,
  createSchemaHelpers,
  // Model utilities
  defineModel,
  getModel,
  getAllModels,
  hasModel,
  clearRegistry,
  // Column utilities
  extractColumnsFromSchema,
  getColumnMeta,
  generateNanoid,
  zodNanoid,
  extendZ,
  // Output sanitization (exclude hidden columns from API/templates)
  omitHiddenColumns,
  sanitizeForOutput,
  // Events/Signals
  ModelEvents,
  Hooks,
  HookCancellationError,
  createEventContext,
  // Query Complexity & DoS Protection
  QueryComplexityError: require('./complexity').QueryComplexityError,
  validateQueryComplexity: require('./complexity').validateQueryComplexity,
  resolveQueryLimits: require('./complexity').resolveQueryLimits,
  DEFAULT_QUERY_LIMITS: require('./complexity').DEFAULT_QUERY_LIMITS,
};
