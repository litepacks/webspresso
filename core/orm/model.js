/**
 * Webspresso ORM - Model Definition
 * Define models and maintain a registry
 * @module core/orm/model
 */

const { trimUrlPathSlashes } = require('../url-path-normalize');
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
    rest = {},
    hooks = {},
    hidden = [],
    queryLimits = {},
    cache: cacheOption,
    searchable,
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

  let normalizedSchema = schema;
  if (schema && schema.shape) {
    for (const [key, val] of Object.entries(schema.shape)) {
      if (val && typeof val._finalize === 'function') {
        schema.shape[key] = val._finalize();
      }
    }
  }

  // Check for duplicate registration
  if (modelRegistry.has(name)) {
    throw new Error(`Model "${name}" is already defined`);
  }

  // Extract column metadata from schema
  const columns = extractColumnsFromSchema(normalizedSchema);

  // Validate relations
  const normalizedRelations = {};
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

    if (relation.cascade !== undefined && relation.cascade !== null) {
      const validCascade = typeof relation.cascade === 'boolean' ||
        typeof relation.cascade === 'string' ||
        Array.isArray(relation.cascade) ||
        (typeof relation.cascade === 'object' && relation.cascade !== null);
      if (!validCascade) {
        throw new Error(
          `Invalid cascade option for relation "${relationName}" in model "${name}". Must be boolean, string, array, or object.`
        );
      }
    }

    normalizedRelations[relationName] = {
      ...relation,
    };
  }

  // Create model definition
  const model = {
    name,
    table,
    schema: normalizedSchema,
    primaryKey,
    relations: normalizedRelations,
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
      sortable: admin.sortable,
      sortableColumns: admin.sortableColumns,
      columns: admin.columns,
      listColumns: Array.isArray(admin.listColumns) ? admin.listColumns : null,
      searchFields: Array.isArray(admin.searchFields) ? admin.searchFields : null,
      displayField: typeof admin.displayField === 'string' ? admin.displayField : null,
      readOnly: admin.readOnly === true,
      permissions: {
        create: admin.permissions?.create !== false,
        edit: admin.permissions?.edit !== false,
        delete: admin.permissions?.delete !== false,
      },
      defaultSort: typeof admin.defaultSort === 'object' && admin.defaultSort !== null ? admin.defaultSort : null,
      group: typeof admin.group === 'string' ? admin.group : (typeof admin.menuGroup === 'string' ? admin.menuGroup : null),
      menuOrder: typeof admin.menuOrder === 'number' ? admin.menuOrder : 10,
      actions: Array.isArray(admin.actions) ? admin.actions : null,
      bulkActions: Array.isArray(admin.bulkActions) ? admin.bulkActions : null,
      hooks: typeof admin.hooks === 'object' && admin.hooks !== null ? admin.hooks : null,
      relations: typeof admin.relations === 'object' && admin.relations !== null ? admin.relations : null,
      inlines: Array.isArray(admin.inlines) ? admin.inlines : null,
      listEditable: Array.isArray(admin.listEditable) ? admin.listEditable : null,
      dateHierarchy: typeof admin.dateHierarchy === 'string' ? admin.dateHierarchy : null,
      listFilter: Array.isArray(admin.listFilter) ? admin.listFilter : (Array.isArray(admin.filterable) ? admin.filterable : null),
    },
    rest: {
      enabled: rest.enabled === true,
      path:
        typeof rest.path === 'string' && rest.path.length > 0 ? trimUrlPathSlashes(rest.path) : null,
      allowInclude: Array.isArray(rest.allowInclude) ? rest.allowInclude.filter((x) => typeof x === 'string') : null,
    },
    hidden: Array.isArray(hidden) ? hidden : [],
    searchable: Array.isArray(searchable)
      ? searchable
      : (Array.isArray(admin.searchFields) ? admin.searchFields : null),
    queryLimits: typeof queryLimits === 'object' && queryLimits !== null ? queryLimits : {},
    hooks: {},
    cache: cacheOption,
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
 * Extract model name string from string, String object, or model definition/context
 * @param {string|Object} nameOrModel - Model name or object
 * @returns {string}
 */
function resolveModelName(nameOrModel) {
  if (typeof nameOrModel === 'string') {
    return nameOrModel;
  }
  if (nameOrModel && typeof nameOrModel === 'object') {
    if (typeof nameOrModel.name === 'string') return nameOrModel.name;
    if (typeof nameOrModel.modelName === 'string') return nameOrModel.modelName;
    if (typeof nameOrModel.model === 'string') return nameOrModel.model;
    if (typeof nameOrModel.valueOf === 'function') {
      const val = nameOrModel.valueOf();
      if (typeof val === 'string') return val;
    }
    return String(nameOrModel);
  }
  return nameOrModel != null ? String(nameOrModel) : '';
}

/**
 * Get a model by name
 * @param {string|Object} name - Model name
 * @returns {import('./types').ModelDefinition|undefined}
 */
function getModel(name) {
  const modelName = resolveModelName(name);
  return modelRegistry.get(modelName);
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
 * @param {string|Object} name - Model name
 * @returns {boolean}
 */
function hasModel(name) {
  const modelName = resolveModelName(name);
  return modelRegistry.has(modelName);
}

/**
 * Clear the model registry (useful for testing)
 */
function clearRegistry() {
  modelRegistry.clear();
}

/**
 * Unregister a model by name
 * @param {string|Object} name - Model name
 * @returns {boolean} Whether the model was removed
 */
function unregisterModel(name) {
  const modelName = resolveModelName(name);
  return modelRegistry.delete(modelName);
}

/**
 * Resolve a relation's model (handles lazy loading)
 * @param {import('./types').RelationDefinition} relation - Relation definition
 * @returns {import('./types').ModelDefinition}
 */
function resolveRelationModel(relation) {
  let model = typeof relation.model === 'function' ? relation.model() : relation.model;
  if (typeof model === 'string' || (model && typeof model === 'object' && !model.table)) {
    model = getModel(model);
  }
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

/**
 * Check if a relation has cascade enabled for a given operation ('delete' or 'restore')
 * @param {import('./types').RelationDefinition} relation - Relation definition
 * @param {'delete'|'restore'} operation - Operation to check
 * @returns {boolean}
 */
function isCascadeEnabled(relation, operation) {
  if (!relation || relation.cascade === undefined || relation.cascade === null) {
    return false;
  }
  const { cascade } = relation;
  if (cascade === true) {
    return true;
  }
  if (cascade === false) {
    return false;
  }
  const op = String(operation).toLowerCase();
  if (typeof cascade === 'string') {
    const c = cascade.toLowerCase();
    return c === op || c === 'all';
  }
  if (Array.isArray(cascade)) {
    return cascade.some(item => {
      if (typeof item !== 'string') return false;
      const c = item.toLowerCase();
      return c === op || c === 'all';
    });
  }
  if (typeof cascade === 'object' && cascade !== null) {
    return Boolean(cascade[op]);
  }
  return false;
}

module.exports = {
  defineModel,
  getModel,
  getAllModels,
  hasModel,
  clearRegistry,
  unregisterModel,
  resolveModelName,
  resolveRelationModel,
  getRelationKeys,
  isCascadeEnabled,
  // Export registry for testing
  _registry: modelRegistry,
};

