/**
 * Webspresso ORM - Scope Modifiers
 * Global scopes for soft delete, timestamps, and multi-tenancy
 * @module core/orm/scopes
 */

const { generateNanoid } = require('./utils/nanoid');

/**
 * Determine the soft delete column name for a model
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {string} Column name ('deletedAt' or 'deleted_at')
 */
function getSoftDeleteColumn(model) {
  if (model && model._deletedCol) {
    return model._deletedCol;
  }
  const col = (model && (
    (model.columns && model.columns.has('deletedAt')) ||
    (model.schema && model.schema.shape && model.schema.shape.deletedAt)
  )) ? 'deletedAt' : 'deleted_at';
  if (model) {
    model._deletedCol = col;
  }
  return col;
}

/**
 * Determine the created at timestamp column name for a model
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {string} Column name ('createdAt' or 'created_at')
 */
function getCreatedAtColumn(model) {
  if (model && model._createdCol) {
    return model._createdCol;
  }
  const col = (model && (
    (model.columns && model.columns.has('createdAt')) ||
    (model.schema && model.schema.shape && model.schema.shape.createdAt)
  )) ? 'createdAt' : 'created_at';
  if (model) {
    model._createdCol = col;
  }
  return col;
}

/**
 * Determine the updated at timestamp column name for a model
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {string} Column name ('updatedAt' or 'updated_at')
 */
function getUpdatedAtColumn(model) {
  if (model && model._updatedCol) {
    return model._updatedCol;
  }
  const col = (model && (
    (model.columns && model.columns.has('updatedAt')) ||
    (model.schema && model.schema.shape && model.schema.shape.updatedAt)
  )) ? 'updatedAt' : 'updated_at';
  if (model) {
    model._updatedCol = col;
  }
  return col;
}

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

  const deletedCol = getSoftDeleteColumn(model);

  // If onlyTrashed is set, only return deleted records
  if (context.onlyTrashed) {
    return qb.whereNotNull(deletedCol);
  }

  // If withTrashed is set, return all records (no filter)
  if (context.withTrashed) {
    return qb;
  }

  // Default: only return non-deleted records
  return qb.whereNull(deletedCol);
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
 * Extract user ID from user object
 * Supports id, userId, _id, sub
 * @param {Object|null} user
 * @returns {string|number|null}
 */
function getUserId(user) {
  if (!user || typeof user !== 'object') return null;
  if (user.id !== undefined && user.id !== null) return user.id;
  if (user.userId !== undefined && user.userId !== null) return user.userId;
  if (user._id !== undefined && user._id !== null) return user._id;
  if (user.sub !== undefined && user.sub !== null) return user.sub;
  return null;
}

/**
 * Extract tenant ID from user or context
 * Supports tenant_id, tenantId, organization_id, organizationId
 * @param {Object|null} user
 * @param {import('./types').ScopeContext} [context]
 * @returns {unknown|null}
 */
function getTenantId(user, context) {
  if (user && typeof user === 'object') {
    if (user.tenant_id !== undefined && user.tenant_id !== null) return user.tenant_id;
    if (user.tenantId !== undefined && user.tenantId !== null) return user.tenantId;
    if (user.organization_id !== undefined && user.organization_id !== null) return user.organization_id;
    if (user.organizationId !== undefined && user.organizationId !== null) return user.organizationId;
  }
  if (context && context.tenantId !== undefined && context.tenantId !== null) {
    return context.tenantId;
  }
  return null;
}

/**
 * Check if RLS is bypassed for the given model, user, context, and action
 * @param {import('./types').ModelDefinition} model
 * @param {import('./types').ScopeContext} context
 * @param {string} [action='read']
 * @returns {boolean}
 */
function isRlsBypassed(model, context, action = 'read') {
  if (!model || !model.rls) {
    return true;
  }
  if (context && context.rlsDisabled === true) {
    return true;
  }

  const rls = model.rls;
  const user = context ? context.user : null;

  // Custom bypass function: bypass(user, action, context)
  if (typeof rls.bypass === 'function') {
    if (rls.bypass(user, action, context)) {
      return true;
    }
  }

  // bypassRoles configuration
  // If explicitly set to false, role-based bypass is disabled
  if (rls.bypassRoles === false) {
    return false;
  }

  // If user has admin/superadmin flags
  if (user && (user.isAdmin === true || user.isSuperAdmin === true)) {
    if (rls.bypassRoles === undefined || rls.bypassRoles === null) {
      return true;
    }
  }

  if (user) {
    if (typeof rls.bypassRoles === 'function') {
      if (rls.bypassRoles(user, action)) return true;
    } else {
      const allowedRoles = Array.isArray(rls.bypassRoles)
        ? rls.bypassRoles
        : (rls.bypassRoles === undefined ? ['admin', 'superadmin'] : []);

      if (allowedRoles.length > 0) {
        const uRole = user.role || user.roleName || user.type;
        const uRoles = Array.isArray(user.roles) ? user.roles : (uRole ? [uRole] : []);
        if (allowedRoles.some((r) => uRoles.includes(r))) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Handle return value from an RLS rule
 * @param {import('knex').Knex.QueryBuilder} qb
 * @param {*} result
 * @returns {import('knex').Knex.QueryBuilder}
 */
function handleRlsResult(qb, result) {
  if (result === false) {
    return qb.whereRaw('1 = 0');
  }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return qb.where(result);
  }
  if (typeof result === 'function') {
    return qb.where((scopedQb) => {
      const fnRes = result(scopedQb);
      return fnRes || scopedQb;
    });
  }
  return qb;
}

/**
 * Apply Row Level Security (RLS) scope to a query builder
 * @param {import('knex').Knex.QueryBuilder} qb - Knex query builder
 * @param {import('./types').ScopeContext} context - Scope context
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {string} [action='read'] - Query action ('read' | 'update' | 'delete' | 'create')
 * @param {Object} [mutationData=null] - Optional mutation data for update/create
 * @returns {import('knex').Knex.QueryBuilder}
 */
function applyRlsScope(qb, context, model, action = 'read', mutationData = null) {
  if (!model || !model.rls) {
    return qb;
  }

  if (isRlsBypassed(model, context, action)) {
    return qb;
  }

  const rls = model.rls;
  const user = context ? context.user : null;
  const ruleCtx = mutationData ? { ...context, data: mutationData } : context;

  // 1. Direct function on model.rls: (user, qb, action, ctx) => ...
  if (typeof rls === 'function') {
    const result = rls(user, qb, action, ruleCtx);
    return handleRlsResult(qb, result);
  }

  // 2. Action-specific handler: rls[action] (e.g. rls.read, rls.update, rls.delete)
  const actionRule = rls[action];
  if (actionRule !== undefined) {
    if (typeof actionRule === 'function') {
      const result = actionRule(user, qb, action, ruleCtx);
      return handleRlsResult(qb, result);
    }
    return handleRlsResult(qb, actionRule);
  }

  // 3. Fallback catch-all rule: rls.rule or rls.filter
  const genericRule = rls.rule || rls.filter;
  if (typeof genericRule === 'function') {
    const result = genericRule(user, qb, action, ruleCtx);
    return handleRlsResult(qb, result);
  } else if (genericRule !== undefined) {
    return handleRlsResult(qb, genericRule);
  }

  // 4. Shorthand column filters (userColumn, tenantColumn)
  let builder = qb;

  if (rls.userColumn) {
    const uid = getUserId(user);
    if (uid !== null) {
      builder = builder.where(rls.userColumn, uid);
    } else {
      // Unauthenticated access to user-scoped resource -> return empty set
      builder = builder.whereRaw('1 = 0');
    }
  }

  if (rls.tenantColumn) {
    const tid = getTenantId(user, context);
    if (tid !== null) {
      builder = builder.where(rls.tenantColumn, tid);
    } else if (!user) {
      builder = builder.whereRaw('1 = 0');
    }
  }

  return builder;
}

/**
 * Apply RLS validation and auto-population for insert operations
 * @param {Object} data - Row data to insert
 * @param {import('./types').ScopeContext} context - Scope context
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Promise<Object>|Object} Modified data
 */
async function applyInsertRls(data, context, model) {
  if (!model || !model.rls) {
    return data;
  }

  if (isRlsBypassed(model, context, 'create')) {
    return data;
  }

  const rls = model.rls;
  const user = context ? context.user : null;
  let modified = { ...data };

  // 1. Custom create rule on model.rls.create
  if (rls.create !== undefined) {
    if (typeof rls.create === 'function') {
      const res = await rls.create(user, modified, context);
      if (res === false) {
        const { ForbiddenError } = require('../errors');
        throw new ForbiddenError(`Access denied by Row Level Security for creating ${model.name}`);
      }
      if (res && typeof res === 'object') {
        modified = { ...modified, ...res };
      }
    } else if (rls.create === false) {
      const { ForbiddenError } = require('../errors');
      throw new ForbiddenError(`Creating ${model.name} is disabled by Row Level Security`);
    }
  }

  // 2. Shorthand userColumn
  if (rls.userColumn) {
    const uid = getUserId(user);
    if (uid === null) {
      const { UnauthorizedError } = require('../errors');
      throw new UnauthorizedError(`Authentication required by Row Level Security to create ${model.name}`);
    }

    if (modified[rls.userColumn] === undefined || modified[rls.userColumn] === null) {
      modified[rls.userColumn] = uid;
    } else if (modified[rls.userColumn] !== uid) {
      const { ForbiddenError } = require('../errors');
      throw new ForbiddenError(`Cannot create ${model.name} for another user under Row Level Security`);
    }
  }

  // 3. Shorthand tenantColumn
  if (rls.tenantColumn) {
    const tid = getTenantId(user, context);
    if (tid !== null) {
      if (modified[rls.tenantColumn] === undefined || modified[rls.tenantColumn] === null) {
        modified[rls.tenantColumn] = tid;
      } else if (modified[rls.tenantColumn] !== tid) {
        const { ForbiddenError } = require('../errors');
        throw new ForbiddenError(`Cannot create ${model.name} for another tenant under Row Level Security`);
      }
    }
  }

  return modified;
}

/**
 * Validate update payload against RLS invariants
 * @param {Object} data - Update data payload
 * @param {import('./types').ScopeContext} context - Scope context
 * @param {import('./types').ModelDefinition} model - Model definition
 */
function checkUpdateRls(data, context, model) {
  if (!model || !model.rls || !data || typeof data !== 'object') {
    return;
  }

  if (isRlsBypassed(model, context, 'update')) {
    return;
  }

  const rls = model.rls;
  const user = context ? context.user : null;

  // If update is explicitly disabled:
  if (rls.update === false) {
    const { ForbiddenError } = require('../errors');
    throw new ForbiddenError(`Updating ${model.name} is disabled by Row Level Security`);
  }

  // Prevent reassigning userColumn
  if (rls.userColumn && data[rls.userColumn] !== undefined) {
    const uid = getUserId(user);
    if (data[rls.userColumn] !== uid) {
      const { ForbiddenError } = require('../errors');
      throw new ForbiddenError(`Cannot reassign ${rls.userColumn} under Row Level Security`);
    }
  }

  // Prevent reassigning tenantColumn
  if (rls.tenantColumn && data[rls.tenantColumn] !== undefined) {
    const tid = getTenantId(user, context);
    if (tid !== null && data[rls.tenantColumn] !== tid) {
      const { ForbiddenError } = require('../errors');
      throw new ForbiddenError(`Cannot reassign ${rls.tenantColumn} under Row Level Security`);
    }
  }

  // Custom update validator if provided
  if (typeof rls.validateUpdate === 'function') {
    const valid = rls.validateUpdate(user, data, context);
    if (valid === false) {
      const { ForbiddenError } = require('../errors');
      throw new ForbiddenError(`Update rejected by Row Level Security policy for ${model.name}`);
    }
  }
}

/**
 * Apply all global scopes to a query builder
 * @param {import('knex').Knex.QueryBuilder} qb - Knex query builder
 * @param {import('./types').ScopeContext} context - Scope context
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {string} [action='read'] - Query action ('read' | 'update' | 'delete' | 'create')
 * @param {Object} [mutationData=null] - Optional mutation data
 * @returns {import('knex').Knex.QueryBuilder}
 */
function applyScopes(qb, context, model, action = 'read', mutationData = null) {
  let builder = qb;
  builder = applySoftDeleteScope(builder, context, model);
  builder = applyTenantScope(builder, context, model);
  builder = applyRlsScope(builder, context, model, action, mutationData);
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
  const createdCol = model._createdCol || ((model.columns && model.columns.has('createdAt')) ? 'createdAt' : 'created_at');
  const updatedCol = model._updatedCol || ((model.columns && model.columns.has('updatedAt')) ? 'updatedAt' : 'updated_at');

  return {
    ...data,
    [createdCol]: data[createdCol] !== undefined ? data[createdCol] : (data.createdAt || data.created_at || now),
    [updatedCol]: data[updatedCol] !== undefined ? data[updatedCol] : (data.updatedAt || data.updated_at || now),
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

  const updatedCol = model._updatedCol || ((model.columns && model.columns.has('updatedAt')) ? 'updatedAt' : 'updated_at');

  return {
    ...data,
    [updatedCol]: new Date(),
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
 * @param {Date|string|number} [date=new Date()] - Soft delete timestamp
 * @param {string|import('./types').ModelDefinition} [colOrModel='deleted_at'] - Column name or model definition
 * @returns {Object} Soft delete update data
 */
function getSoftDeleteData(date = new Date(), colOrModel = 'deleted_at') {
  let columnName = 'deleted_at';
  if (typeof colOrModel === 'string') {
    columnName = colOrModel;
  } else if (colOrModel && typeof colOrModel === 'object') {
    columnName = getSoftDeleteColumn(colOrModel);
  }
  return { [columnName]: date instanceof Date ? date : new Date(date) };
}

/**
 * Get restore data (to undo soft delete)
 * @param {string|import('./types').ModelDefinition} [colOrModel='deleted_at'] - Column name or model definition
 * @returns {Object} Restore update data
 */
function getRestoreData(colOrModel = 'deleted_at') {
  let columnName = 'deleted_at';
  if (typeof colOrModel === 'string') {
    columnName = colOrModel;
  } else if (colOrModel && typeof colOrModel === 'object') {
    columnName = getSoftDeleteColumn(colOrModel);
  }
  return { [columnName]: null };
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
function createScopeContext(overrides = {}) {
  return {
    tenantId: undefined,
    withTrashed: false,
    onlyTrashed: false,
    user: null,
    rlsDisabled: false,
    ...overrides,
  };
}

module.exports = {
  applySoftDeleteScope,
  applyTenantScope,
  applyRlsScope,
  applyScopes,
  applyInsertTimestamps,
  applyUpdateTimestamps,
  applyInsertTenant,
  applyInsertNanoidPrimary,
  applyInsertModifiers,
  applyUpdateModifiers,
  applyInsertRls,
  checkUpdateRls,
  isRlsBypassed,
  getUserId,
  getTenantId,
  getSoftDeleteData,
  getRestoreData,
  getSoftDeleteColumn,
  getCreatedAtColumn,
  getUpdatedAtColumn,
  createScopeContext,
};

