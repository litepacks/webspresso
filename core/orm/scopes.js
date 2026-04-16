/**
 * Webspresso ORM - Scope Modifiers
 * Global scopes for soft delete, timestamps, and multi-tenancy
 * @module core/orm/scopes
 */

const { generateNanoid } = require('./utils/nanoid');

/**
 * Apply soft delete scope to a query builder
 * @param {import('knex').Knex.QueryBuilder} qb - Knex query builder
 * @param {import('./types').ScopeContext} context - Scope context
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {import('knex').Knex.QueryBuilder}
 */
function applySoftDeleteScope(qb, context, model) {
  if (!model.scopes.softDelete) {
    return qb;
  }

  // If onlyTrashed is set, only return deleted records
  if (context.onlyTrashed) {
    return qb.whereNotNull('deleted_at');
  }

  // If withTrashed is set, return all records (no filter)
  if (context.withTrashed) {
    return qb;
  }

  // Default: only return non-deleted records
  return qb.whereNull('deleted_at');
}

/**
 * Apply tenant scope to a query builder
 * @param {import('knex').Knex.QueryBuilder} qb - Knex query builder
 * @param {import('./types').ScopeContext} context - Scope context
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {import('knex').Knex.QueryBuilder}
 */
function applyTenantScope(qb, context, model) {
  const tenantColumn = model.scopes.tenant;
  if (!tenantColumn || context.tenantId === undefined) {
    return qb;
  }

  return qb.where(tenantColumn, context.tenantId);
}

/**
 * Apply all global scopes to a query builder
 * @param {import('knex').Knex.QueryBuilder} qb - Knex query builder
 * @param {import('./types').ScopeContext} context - Scope context
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {import('knex').Knex.QueryBuilder}
 */
function applyScopes(qb, context, model) {
  let builder = qb;
  builder = applySoftDeleteScope(builder, context, model);
  builder = applyTenantScope(builder, context, model);
  return builder;
}

/**
 * Apply timestamp values for insert operations
 * @param {Object} data - Data to insert
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Object} Data with timestamps applied
 */
function applyInsertTimestamps(data, model) {
  if (!model.scopes.timestamps) {
    return data;
  }

  const now = new Date();
  return {
    ...data,
    created_at: data.created_at || now,
    updated_at: data.updated_at || now,
  };
}

/**
 * Apply timestamp values for update operations
 * @param {Object} data - Data to update
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Object} Data with timestamps applied
 */
function applyUpdateTimestamps(data, model) {
  if (!model.scopes.timestamps) {
    return data;
  }

  return {
    ...data,
    updated_at: new Date(),
  };
}

/**
 * Apply tenant ID for insert operations
 * @param {Object} data - Data to insert
 * @param {import('./types').ScopeContext} context - Scope context
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Object} Data with tenant ID applied
 */
function applyInsertTenant(data, context, model) {
  const tenantColumn = model.scopes.tenant;
  if (!tenantColumn || context.tenantId === undefined) {
    return data;
  }

  return {
    ...data,
    [tenantColumn]: data[tenantColumn] || context.tenantId,
  };
}

/**
 * Generate nanoid primary key when missing on insert
 * @param {Object} data - Data to insert
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Object}
 */
function applyInsertNanoidPrimary(data, model) {
  const pk = model.primaryKey;
  const meta = model.columns && model.columns.get(pk);
  if (!meta || meta.type !== 'nanoid') {
    return data;
  }
  const val = data[pk];
  if (val !== undefined && val !== null && val !== '') {
    return data;
  }
  const len = meta.maxLength || 21;
  return {
    ...data,
    [pk]: generateNanoid(len),
  };
}

/**
 * Get soft delete data (for UPDATE instead of DELETE)
 * @returns {Object} Soft delete update data
 */
function getSoftDeleteData() {
  return { deleted_at: new Date() };
}

/**
 * Get restore data (to undo soft delete)
 * @returns {Object} Restore update data
 */
function getRestoreData() {
  return { deleted_at: null };
}

/**
 * Apply all insert modifiers (timestamps, tenant)
 * @param {Object} data - Data to insert
 * @param {import('./types').ScopeContext} context - Scope context
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Object} Modified data
 */
function applyInsertModifiers(data, context, model) {
  let modified = { ...data };
  modified = applyInsertTimestamps(modified, model);
  modified = applyInsertTenant(modified, context, model);
  modified = applyInsertNanoidPrimary(modified, model);
  return modified;
}

/**
 * Apply all update modifiers (timestamps)
 * @param {Object} data - Data to update
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Object} Modified data
 */
function applyUpdateModifiers(data, model) {
  return applyUpdateTimestamps(data, model);
}

/**
 * Create default scope context
 * @returns {import('./types').ScopeContext}
 */
function createScopeContext() {
  return {
    tenantId: undefined,
    withTrashed: false,
    onlyTrashed: false,
  };
}

module.exports = {
  applySoftDeleteScope,
  applyTenantScope,
  applyScopes,
  applyInsertTimestamps,
  applyUpdateTimestamps,
  applyInsertTenant,
  applyInsertNanoidPrimary,
  applyInsertModifiers,
  applyUpdateModifiers,
  getSoftDeleteData,
  getRestoreData,
  createScopeContext,
};

