/**
 * Webspresso ORM - Model Definition
 * Define models and maintain a registry
 * @module core/orm/model
 */

const { extractColumnsFromSchema } = require('./schema-helpers');
const { ModelEvents, Hooks } = require('./events');

/**
 * Global model registry
 * @type {Map<string, import('./types').ModelDefinition>}
 */
const modelRegistry = new Map();

/**
 * Define a new model
 * @param {import('./types').ModelOptions} options - Model configuration
 * @returns {import('./types').ModelDefinition}
 */
function defineModel(options) {
  const {
    name,
    table,
    schema,
    primaryKey = 'id',
    relations = {},
    scopes = {},
    admin = {},
    hooks = {},
    hidden = [],
  } = options;

  // Validate required fields
  if (!name || typeof name !== 'string') {
    throw new Error('Model name is required and must be a string');
  }
  if (!table || typeof table !== 'string') {
    throw new Error('Model table is required and must be a string');
  }
  if (!schema || typeof schema.parse !== 'function') {
    throw new Error('Model schema is required and must be a Zod schema');
  }

  // Check for duplicate registration
  if (modelRegistry.has(name)) {
    throw new Error(`Model "${name}" is already defined`);
  }

  // Extract column metadata from schema
  const columns = extractColumnsFromSchema(schema);

  // Validate relations
  for (const [relationName, relation] of Object.entries(relations)) {
    if (!['belongsTo', 'hasMany', 'hasOne'].includes(relation.type)) {
      throw new Error(
        `Invalid relation type "${relation.type}" for "${relationName}" in model "${name}"`
      );
    }
    if (typeof relation.model !== 'function') {
      throw new Error(
        `Relation "${relationName}" in model "${name}" must have a model function`
      );
    }
    if (!relation.foreignKey || typeof relation.foreignKey !== 'string') {
      throw new Error(
        `Relation "${relationName}" in model "${name}" must have a foreignKey string`
      );
    }
  }

  // Create model definition
  const model = {
    name,
    table,
    schema,
    primaryKey,
    relations,
    scopes: {
      softDelete: scopes.softDelete || false,
      timestamps: scopes.timestamps || false,
      tenant: scopes.tenant || null,
    },
    columns,
    admin: {
      enabled: admin.enabled === true, // Explicit boolean check
      label: admin.label || name,
      icon: admin.icon || null,
      customFields: admin.customFields || {},
      queries: admin.queries || {},
    },
    hidden: Array.isArray(hidden) ? hidden : [],
    hooks: {},
  };

  // Register model
  modelRegistry.set(name, model);

  // Register model-level hooks with ModelEvents
  registerModelHooks(name, hooks);

  return model;
}

/**
 * Register model-level hooks with the global ModelEvents
 * @param {string} modelName - Model name
 * @param {Object} hooks - Hooks object
 */
function registerModelHooks(modelName, hooks) {
  const validHooks = Object.values(Hooks);
  
  for (const [hookName, callback] of Object.entries(hooks)) {
    if (!validHooks.includes(hookName)) {
      console.warn(`Unknown hook "${hookName}" in model "${modelName}". Valid hooks: ${validHooks.join(', ')}`);
      continue;
    }
    
    if (typeof callback !== 'function') {
      console.warn(`Hook "${hookName}" in model "${modelName}" must be a function`);
      continue;
    }

    ModelEvents.on(`${modelName}.${hookName}`, callback);
  }
}

/**
 * Get a model by name
 * @param {string} name - Model name
 * @returns {import('./types').ModelDefinition|undefined}
 */
function getModel(name) {
  return modelRegistry.get(name);
}

/**
 * Get all registered models
 * @returns {Map<string, import('./types').ModelDefinition>}
 */
function getAllModels() {
  return new Map(modelRegistry);
}

/**
 * Check if a model exists
 * @param {string} name - Model name
 * @returns {boolean}
 */
function hasModel(name) {
  return modelRegistry.has(name);
}

/**
 * Clear the model registry (useful for testing)
 */
function clearRegistry() {
  modelRegistry.clear();
}

/**
 * Unregister a model by name
 * @param {string} name - Model name
 * @returns {boolean} Whether the model was removed
 */
function unregisterModel(name) {
  return modelRegistry.delete(name);
}

/**
 * Resolve a relation's model (handles lazy loading)
 * @param {import('./types').RelationDefinition} relation - Relation definition
 * @returns {import('./types').ModelDefinition}
 */
function resolveRelationModel(relation) {
  const model = relation.model();
  if (!model || !model.name) {
    throw new Error('Invalid relation model reference');
  }
  return model;
}

/**
 * Get the foreign key column info for a relation
 * @param {import('./types').ModelDefinition} model - Parent model
 * @param {string} relationName - Relation name
 * @returns {{ localKey: string, foreignKey: string, relatedModel: import('./types').ModelDefinition }}
 */
function getRelationKeys(model, relationName) {
  const relation = model.relations[relationName];
  if (!relation) {
    throw new Error(`Relation "${relationName}" not found on model "${model.name}"`);
  }

  const relatedModel = resolveRelationModel(relation);
  const localKey = relation.localKey || model.primaryKey;

  return {
    localKey,
    foreignKey: relation.foreignKey,
    relatedModel,
  };
}

module.exports = {
  defineModel,
  getModel,
  getAllModels,
  hasModel,
  clearRegistry,
  unregisterModel,
  resolveRelationModel,
  getRelationKeys,
  // Export registry for testing
  _registry: modelRegistry,
};

