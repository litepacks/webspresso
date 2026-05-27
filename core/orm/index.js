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

/**
 * Module resolution paths: app cwd first, then webspresso package tree (nested deps when linked via file:).
 * @param {{ modulePaths?: string[] }} [runtime]
 * @returns {string[]}
 */
function getModuleResolvePaths(runtime = {}) {
  const paths = [];
  if (runtime.modulePaths?.length) {
    paths.push(...runtime.modulePaths);
  }
  paths.push(path.join(process.cwd(), 'node_modules'));
  paths.push(process.cwd());

  try {
    const webspressoPkg = require.resolve('webspresso/package.json', {
      paths: [process.cwd(), __dirname],
    });
    const webspressoDir = path.dirname(webspressoPkg);
    paths.push(path.join(webspressoDir, 'node_modules'));
    paths.push(path.dirname(webspressoDir));
  } catch {
    const repoRoot = path.join(__dirname, '..', '..');
    paths.push(path.join(repoRoot, 'node_modules'));
    paths.push(repoRoot);
  }

  return paths;
}

/**
 * Create a database instance
 * @param {import('./types').DatabaseConfig} config - Database configuration
 * @param {{ d1?: object, skipModelScan?: boolean }} [runtime] - Runtime bindings (D1 on Workers)
 * @returns {import('./types').DatabaseInstance}
 */
function createDatabase(config, runtime = {}) {
  const modulePaths = getModuleResolvePaths(runtime);

  const resolveModule = (name) => require(require.resolve(name, { paths: modulePaths }));

  // Lazy load knex to avoid requiring it if ORM is not used
  let knex = runtime.knex;
  if (!knex) {
    try {
      knex = resolveModule('knex');
    } catch {
      throw new Error('Knex is required for ORM. Install it with: npm install knex');
    }
  }

  const driverMap = {
    'better-sqlite3': 'better-sqlite3',
    'pg': 'pg',
    'mysql2': 'mysql2',
    'mysql': 'mysql2',
    'd1': 'knex-cloudflare-d1',
    'd1-remote': 'knex-cloudflare-d1',
  };

  // Check if database driver is available in project's node_modules
  const client = config.client;

  let knexInstance;

  if (client === 'd1') {
    if (!runtime.d1) {
      throw new Error(
        'D1 client requires a runtime binding.\n' +
        'Pass createDatabase({ client: "d1" }, { d1: env.DB }) in Workers.'
      );
    }
    let d1KnexClient = runtime.d1Client;
    if (!d1KnexClient) {
      try {
        resolveModule('knex-cloudflare-d1');
      } catch {
        throw new Error(
          'D1 support requires knex-cloudflare-d1.\n' +
          'Install: npm install knex-cloudflare-d1'
        );
      }
      d1KnexClient = require('./d1-knex-client')(resolveModule('knex-cloudflare-d1'));
    }
    knexInstance = knex({
      client: d1KnexClient,
      connection: { database: runtime.d1 },
    });
  } else if (client === 'd1-remote') {
    let remoteClient;
    try {
      remoteClient = resolveModule('knex-cloudflare-d1/remote-client');
    } catch {
      try {
        remoteClient = resolveModule('knex-cloudflare-d1/dist/remote-client');
      } catch {
        throw new Error(
          'D1 remote migrations require knex-cloudflare-d1 remote client.\n' +
          'Install: npm install knex-cloudflare-d1\n' +
          'Configure accountId, databaseId, and apiToken in webspresso.db.js'
        );
      }
    }
    knexInstance = knex({
      client: remoteClient,
      connection: config.connection || {},
    });
  } else if (client) {
    const driverName = driverMap[client] || client;
    try {
      const driverPath = require.resolve(driverName, { paths: modulePaths });
      require(driverPath);
    } catch (e) {
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

  if (!knexInstance) {
    try {
      knexInstance = knex(config);
    } catch (e) {
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
  }

  const migrationConfig = config.migrations || {};
  const migrate = createMigrationManager(knexInstance, migrationConfig);

  const { layer: ormCacheLayer, publicApi: ormCachePublicApi } = createOrmCacheFromConfig(
    config.cache
  );

  // Auto-load models from models directory
  const modelsDir = config.models || './models';
  const absoluteModelsDir = path.resolve(process.cwd(), modelsDir);
  
  if (!runtime.skipModelScan && fs.existsSync(absoluteModelsDir)) {
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
   * @param {string} name - Model name
   * @returns {import('./types').ModelDefinition}
   */
  function getModelInstance(name) {
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
   * Run operations in a transaction
   * @param {Function} callback - Callback receiving transaction context
   * @returns {Promise<*>} Result of callback
   */
  async function transaction(callback) {
    return knexInstance.transaction(async (trx) => {
      // Create transaction context with repository methods
      const trxContext = {
        trx,
        getRepository(modelName, scopeContext) {
          const model = getModelInstance(modelName);
          const ctx = scopeContext || createScopeContext();
          return createRepository(model, trx, ctx, ormCacheLayer);
        },
        createRepository(model, scopeContext) {
          const ctx = scopeContext || createScopeContext();
          return createRepository(model, trx, ctx, ormCacheLayer);
        },
      };
      return callback(trxContext);
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
};
