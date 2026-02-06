/**
 * Webspresso ORM - Repository
 * Repository factory for CRUD operations
 * @module core/orm/repository
 */

const { createQueryBuilder } = require('./query-builder');
const { loadRelations } = require('./eager-loader');
const {
  applyInsertModifiers,
  applyUpdateModifiers,
  getSoftDeleteData,
  createScopeContext,
  applyScopes,
} = require('./scopes');
const { ensureArray } = require('./utils');

/**
 * Get JSON column names from model
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Set<string>} Set of JSON column names
 */
function getJsonColumns(model) {
  const jsonCols = new Set();
  if (model.columns) {
    for (const [name, meta] of model.columns) {
      if (meta.type === 'json') {
        jsonCols.add(name);
      }
    }
  }
  return jsonCols;
}

/**
 * Serialize JSON fields for database storage
 * @param {Object} data - Data to serialize
 * @param {Set<string>} jsonColumns - JSON column names
 * @returns {Object} Serialized data
 */
function serializeJsonFields(data, jsonColumns) {
  if (jsonColumns.size === 0) return data;
  
  const serialized = { ...data };
  for (const col of jsonColumns) {
    if (col in serialized && serialized[col] !== null && serialized[col] !== undefined) {
      // Only stringify if it's not already a string
      if (typeof serialized[col] !== 'string') {
        serialized[col] = JSON.stringify(serialized[col]);
      }
    }
  }
  return serialized;
}

/**
 * Deserialize JSON fields from database
 * @param {Object} record - Record from database
 * @param {Set<string>} jsonColumns - JSON column names
 * @returns {Object} Deserialized record
 */
function deserializeJsonFields(record, jsonColumns) {
  if (!record || jsonColumns.size === 0) return record;
  
  for (const col of jsonColumns) {
    if (col in record && record[col] !== null && record[col] !== undefined) {
      // Only parse if it's a string
      if (typeof record[col] === 'string') {
        try {
          record[col] = JSON.parse(record[col]);
        } catch {
          // If parsing fails, keep the original string value
        }
      }
    }
  }
  return record;
}

/**
 * Create a repository for a model
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {import('knex').Knex|import('knex').Knex.Transaction} knex - Knex instance
 * @param {import('./types').ScopeContext} [initialContext] - Initial scope context
 * @returns {import('./types').Repository}
 */
function createRepository(model, knex, initialContext) {
  const scopeContext = initialContext || createScopeContext();
  const jsonColumns = getJsonColumns(model);

  /**
   * Get base query builder
   * @returns {import('knex').Knex.QueryBuilder}
   */
  function baseQuery() {
    let qb = knex(model.table);
    return applyScopes(qb, scopeContext, model);
  }

  /**
   * Find a record by primary key
   * @param {number|string} id - Primary key value
   * @param {import('./types').FindOptions} [options={}] - Find options
   * @returns {Promise<Object|null>}
   */
  async function findById(id, options = {}) {
    const { with: withs = [], select } = options;

    let qb = baseQuery().where(model.primaryKey, id);
    
    if (select && select.length > 0) {
      qb = qb.select(select);
    }

    const record = await qb.first();

    if (!record) {
      return null;
    }

    // Deserialize JSON fields
    deserializeJsonFields(record, jsonColumns);

    // Load relations if requested
    if (withs.length > 0) {
      await loadRelations([record], ensureArray(withs), model, knex, scopeContext);
    }

    return record;
  }

  /**
   * Find a single record matching conditions
   * @param {Object} conditions - Where conditions
   * @param {import('./types').FindOptions} [options={}] - Find options
   * @returns {Promise<Object|null>}
   */
  async function findOne(conditions, options = {}) {
    const { with: withs = [], select } = options;

    let qb = baseQuery();

    for (const [key, value] of Object.entries(conditions)) {
      qb = qb.where(key, value);
    }

    if (select && select.length > 0) {
      qb = qb.select(select);
    }

    const record = await qb.first();

    if (!record) {
      return null;
    }

    // Deserialize JSON fields
    deserializeJsonFields(record, jsonColumns);

    // Load relations if requested
    if (withs.length > 0) {
      await loadRelations([record], ensureArray(withs), model, knex, scopeContext);
    }

    return record;
  }

  /**
   * Find all records
   * @param {import('./types').FindOptions} [options={}] - Find options
   * @returns {Promise<Object[]>}
   */
  async function findAll(options = {}) {
    const { with: withs = [], select } = options;

    let qb = baseQuery();

    if (select && select.length > 0) {
      qb = qb.select(select);
    }

    const records = await qb;

    // Deserialize JSON fields
    for (const record of records) {
      deserializeJsonFields(record, jsonColumns);
    }

    // Load relations if requested
    if (withs.length > 0 && records.length > 0) {
      await loadRelations(records, ensureArray(withs), model, knex, scopeContext);
    }

    return records;
  }

  /**
   * Create a new record
   * @param {Object} data - Record data
   * @returns {Promise<Object>}
   */
  async function create(data) {
    // Validate with Zod schema (partial for insert - allows auto fields to be missing)
    const validated = model.schema.partial().parse(data);

    // Apply insert modifiers (timestamps, tenant)
    let insertData = applyInsertModifiers(validated, scopeContext, model);

    // Serialize JSON fields
    insertData = serializeJsonFields(insertData, jsonColumns);

    // Insert and return the record
    const [id] = await knex(model.table).insert(insertData).returning(model.primaryKey);

    // For databases that don't support returning (SQLite), id might be the row itself
    const insertedId = typeof id === 'object' ? id[model.primaryKey] : id;

    // Fetch the created record
    return findById(insertedId);
  }

  /**
   * Create multiple records
   * @param {Object[]} dataArray - Array of record data
   * @returns {Promise<Object[]>}
   */
  async function createMany(dataArray) {
    const records = [];
    
    for (const data of dataArray) {
      const record = await create(data);
      records.push(record);
    }

    return records;
  }

  /**
   * Update a record by primary key
   * @param {number|string} id - Primary key value
   * @param {Object} data - Data to update
   * @returns {Promise<Object|null>}
   */
  async function update(id, data) {
    // Validate with Zod schema (partial for update)
    const validated = model.schema.partial().parse(data);

    // Apply update modifiers (timestamps)
    let updateData = applyUpdateModifiers(validated, model);

    // Serialize JSON fields
    updateData = serializeJsonFields(updateData, jsonColumns);

    // Update the record
    const updated = await baseQuery()
      .where(model.primaryKey, id)
      .update(updateData);

    if (updated === 0) {
      return null;
    }

    // Fetch and return the updated record
    return findById(id);
  }

  /**
   * Update records matching conditions
   * @param {Object} conditions - Where conditions
   * @param {Object} data - Data to update
   * @returns {Promise<number>} Number of updated records
   */
  async function updateWhere(conditions, data) {
    // Validate with Zod schema (partial for update)
    const validated = model.schema.partial().parse(data);

    // Apply update modifiers (timestamps)
    let updateData = applyUpdateModifiers(validated, model);

    // Serialize JSON fields
    updateData = serializeJsonFields(updateData, jsonColumns);

    let qb = baseQuery();
    
    for (const [key, value] of Object.entries(conditions)) {
      qb = qb.where(key, value);
    }

    return qb.update(updateData);
  }

  /**
   * Delete a record by primary key (soft delete if enabled)
   * @param {number|string} id - Primary key value
   * @returns {Promise<boolean>}
   */
  async function del(id) {
    // Soft delete if enabled
    if (model.scopes.softDelete) {
      const updated = await baseQuery()
        .where(model.primaryKey, id)
        .update(getSoftDeleteData());
      return updated > 0;
    }

    // Hard delete
    const deleted = await baseQuery()
      .where(model.primaryKey, id)
      .delete();
    return deleted > 0;
  }

  /**
   * Force delete a record (bypass soft delete)
   * @param {number|string} id - Primary key value
   * @returns {Promise<boolean>}
   */
  async function forceDelete(id) {
    // Use raw query to bypass soft delete scope
    const deleted = await knex(model.table)
      .where(model.primaryKey, id)
      .delete();
    return deleted > 0;
  }

  /**
   * Restore a soft-deleted record
   * @param {number|string} id - Primary key value
   * @returns {Promise<Object|null>}
   */
  async function restore(id) {
    if (!model.scopes.softDelete) {
      throw new Error(`Model "${model.name}" does not have soft delete enabled`);
    }

    // Update directly without scopes (to find trashed record)
    const updated = await knex(model.table)
      .where(model.primaryKey, id)
      .whereNotNull('deleted_at')
      .update({ deleted_at: null });

    if (updated === 0) {
      return null;
    }

    return findById(id);
  }

  /**
   * Get a query builder for this model
   * @returns {import('./query-builder').QueryBuilder}
   */
  function query() {
    return createQueryBuilder(model, knex, scopeContext);
  }

  /**
   * Execute a raw query
   * @param {string} sql - SQL query
   * @param {Array} [bindings=[]] - Query bindings
   * @returns {Promise<Object[]>}
   */
  async function raw(sql, bindings = []) {
    const result = await knex.raw(sql, bindings);
    // Normalize result across database drivers
    return result.rows || result;
  }

  /**
   * Count records
   * @param {Object} [conditions={}] - Where conditions
   * @returns {Promise<number>}
   */
  async function count(conditions = {}) {
    let qb = baseQuery();

    for (const [key, value] of Object.entries(conditions)) {
      qb = qb.where(key, value);
    }

    const result = await qb.count('* as count').first();
    return parseInt(result?.count || 0, 10);
  }

  /**
   * Check if a record exists
   * @param {Object} conditions - Where conditions
   * @returns {Promise<boolean>}
   */
  async function exists(conditions) {
    const cnt = await count(conditions);
    return cnt > 0;
  }

  /**
   * Get query builder with relations to eager load
   * Helper for common pattern: query().with(...).list()
   * @param {string[]} relations - Relations to load
   * @returns {import('./query-builder').QueryBuilder}
   */
  function withRelations(...relations) {
    return query().with(...relations);
  }

  return {
    findById,
    findOne,
    findAll,
    create,
    createMany,
    update,
    updateWhere,
    delete: del,
    forceDelete,
    restore,
    query,
    raw,
    count,
    exists,
    with: withRelations,
    // Expose model for introspection
    model,
  };
}

module.exports = {
  createRepository,
};

