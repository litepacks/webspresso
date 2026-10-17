/**
 * Webspresso ORM - Repository
 * Repository factory for CRUD operations
 * @module core/orm/repository
 */

const { createQueryBuilder } = require('./query-builder');
const { loadRelations } = require('./eager-loader');
const { resolveRelationModel, isCascadeEnabled } = require('./model');
const {
  applyInsertModifiers,
  applyUpdateModifiers,
  getSoftDeleteData,
  getRestoreData,
  getSoftDeleteColumn,
  createScopeContext,
  applyScopes,
} = require('./scopes');
const { ensureArray } = require('./utils');
const { ModelEvents, createEventContext, Hooks, HookCancellationError } = require('./events');
const { getJsonColumns, serializeJsonFields, deserializeJsonFields } = require('./json-fields');
const { getAmbientTransaction } = require('./transaction');

/**
 * Get or cache partial schema for model
 * @param {import('./types').ModelDefinition} model
 * @returns {import('zod').ZodTypeAny}
 */
function getPartialSchema(model) {
  if (model && model._partialSchema) {
    return model._partialSchema;
  }
  const partial = (model && model.schema && typeof model.schema.partial === 'function')
    ? model.schema.partial()
    : model?.schema;
  if (model) {
    model._partialSchema = partial;
  }
  return partial;
}

/**
 * Create a repository for a model
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {import('knex').Knex|import('knex').Knex.Transaction} knex - Knex instance
 * @param {import('./types').ScopeContext} [initialContext] - Initial scope context
 * @param {import('./cache/layer').OrmCacheLayer|null} [cacheLayer] - Optional ORM cache layer
 * @returns {import('./types').Repository}
 */
function createRepository(model, knex, initialContext, cacheLayer = null) {
  const scopeContext = initialContext ? { ...initialContext } : createScopeContext();
  const jsonColumns = getJsonColumns(model);
  const hasJson = jsonColumns.size > 0;

  /**
   * Resolve active Knex instance (explicit or ambient transaction)
   * @returns {import('knex').Knex|import('knex').Knex.Transaction}
   */
  function getActiveKnex() {
    if (knex && (knex.isTransaction || typeof knex.commit === 'function')) {
      return knex;
    }
    const ambientTrx = getAmbientTransaction();
    if (ambientTrx) {
      return ambientTrx;
    }
    return knex;
  }

  /**
   * Get transaction handle for lifecycle hooks
   * @returns {import('knex').Knex.Transaction|null}
   */
  function getHookTrx() {
    const active = getActiveKnex();
    return (active && (active.isTransaction || typeof active.commit === 'function')) ? active : null;
  }

  /**
   * Get base query builder
   * @returns {import('knex').Knex.QueryBuilder}
   */
  function baseQuery() {
    const activeKnex = getActiveKnex();
    let qb = activeKnex(model.table);
    return applyScopes(qb, scopeContext, model);
  }

  /**
   * Find a record by primary key
   * @param {number|string} id - Primary key value
   * @param {import('./types').FindOptions} [options={}] - Find options
   * @param {boolean} [emitEvents=true] - Whether to emit find events
   * @returns {Promise<Object|null>}
   */
  async function findById(id, options = {}, emitEvents = true) {
    const { with: withs = options.include || [], select } = options;
    const shouldEmit = emitEvents && (
      ModelEvents.hasListeners(model.name, Hooks.BEFORE_FIND) ||
      ModelEvents.hasListeners(model.name, Hooks.AFTER_FIND)
    );
    const ctx = shouldEmit ? createEventContext(model.name, 'find') : null;

    async function loadFromDb() {
      if (shouldEmit) {
        await ModelEvents.emitAsync(model.name, Hooks.BEFORE_FIND, { [model.primaryKey]: id }, ctx);
        if (ctx.isCancelled) {
          throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_FIND);
        }
      }

      let qb = baseQuery().where(model.primaryKey, id);

      if (select && select.length > 0) {
        qb = qb.select(select);
      }

      const record = await qb.first();

      if (!record) {
        return null;
      }

      if (hasJson) {
        deserializeJsonFields(record, jsonColumns);
      }

      if (withs.length > 0) {
        await loadRelations([record], ensureArray(withs), model, getActiveKnex(), scopeContext);
      }

      if (shouldEmit) {
        ModelEvents.emit(model.name, Hooks.AFTER_FIND, record, ctx);
      }

      return record;
    }

    if (cacheLayer && emitEvents && cacheLayer.strategyFor(model)) {
      const strat = cacheLayer.strategyFor(model);
      const kind = withs.length > 0 ? 'collection' : 'pk';
      const fingerprint = cacheLayer.findByIdFingerprint(
        model,
        scopeContext,
        id,
        select || [],
        withs
      );
      const tags = cacheLayer.buildReadTags(
        model,
        strat,
        kind,
        kind === 'pk' ? id : null
      );
      return cacheLayer.wrapRead(model, getActiveKnex(), scopeContext, fingerprint, tags, loadFromDb, (r) => r != null);
    }

    return loadFromDb();
  }

  /**
   * Find a single record matching conditions
   * @param {Object} conditions - Where conditions
   * @param {import('./types').FindOptions} [options={}] - Find options
   * @returns {Promise<Object|null>}
   */
  async function findOne(conditions, options = {}) {
    const { with: withs = options.include || [], select } = options;
    const shouldEmit = (
      ModelEvents.hasListeners(model.name, Hooks.BEFORE_FIND) ||
      ModelEvents.hasListeners(model.name, Hooks.AFTER_FIND)
    );
    const ctx = shouldEmit ? createEventContext(model.name, 'find') : null;

    const condKeys = Object.keys(conditions);
    const isPkOnly =
      withs.length === 0 &&
      condKeys.length === 1 &&
      condKeys[0] === model.primaryKey;

    async function loadFromDb() {
      if (shouldEmit) {
        await ModelEvents.emitAsync(model.name, Hooks.BEFORE_FIND, conditions, ctx);
        if (ctx.isCancelled) {
          throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_FIND);
        }
      }

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

      if (hasJson) {
        deserializeJsonFields(record, jsonColumns);
      }

      if (withs.length > 0) {
        await loadRelations([record], ensureArray(withs), model, getActiveKnex(), scopeContext);
      }

      if (shouldEmit) {
        ModelEvents.emit(model.name, Hooks.AFTER_FIND, record, ctx);
      }

      return record;
    }

    if (cacheLayer && cacheLayer.strategyFor(model)) {
      const strat = cacheLayer.strategyFor(model);
      if (isPkOnly) {
        const pkVal = conditions[model.primaryKey];
        const fingerprint = cacheLayer.findByIdFingerprint(
          model,
          scopeContext,
          pkVal,
          select || [],
          withs
        );
        const tags = cacheLayer.buildReadTags(model, strat, 'pk', pkVal);
        return cacheLayer.wrapRead(model, getActiveKnex(), scopeContext, fingerprint, tags, loadFromDb, (r) => r != null);
      }
      const fingerprint = cacheLayer.findOneFingerprint(
        model,
        scopeContext,
        conditions,
        select || [],
        withs
      );
      const tags = cacheLayer.buildReadTags(model, strat, 'collection', null);
      return cacheLayer.wrapRead(model, getActiveKnex(), scopeContext, fingerprint, tags, loadFromDb, (r) => r != null);
    }

    return loadFromDb();
  }

  /**
   * Find all records matching scope
   * @param {import('./types').FindOptions} [options={}] - Find options
   * @returns {Promise<Object[]>}
   */
  async function findAll(options = {}) {
    const { with: withs = options.include || [], select } = options;
    const shouldEmit = (
      ModelEvents.hasListeners(model.name, Hooks.BEFORE_FIND) ||
      ModelEvents.hasListeners(model.name, Hooks.AFTER_FIND)
    );
    const ctx = shouldEmit ? createEventContext(model.name, 'find') : null;

    async function loadFromDb() {
      if (shouldEmit) {
        await ModelEvents.emitAsync(model.name, Hooks.BEFORE_FIND, {}, ctx);
        if (ctx.isCancelled) {
          throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_FIND);
        }
      }

      let qb = baseQuery();

      if (select && select.length > 0) {
        qb = qb.select(select);
      }

      const records = await qb;

      if (hasJson) {
        const len = records.length;
        for (let i = 0; i < len; i++) {
          deserializeJsonFields(records[i], jsonColumns);
        }
      }

      if (withs.length > 0 && records.length > 0) {
        await loadRelations(records, ensureArray(withs), model, getActiveKnex(), scopeContext);
      }

      if (shouldEmit) {
        const len = records.length;
        for (let i = 0; i < len; i++) {
          ModelEvents.emit(model.name, Hooks.AFTER_FIND, records[i], ctx);
        }
      }

      return records;
    }

    if (cacheLayer && cacheLayer.strategyFor(model)) {
      const strat = cacheLayer.strategyFor(model);
      const fingerprint = cacheLayer.findAllFingerprint(model, scopeContext, select || []);
      const tags = cacheLayer.buildReadTags(model, strat, 'collection', null);
      return cacheLayer.wrapRead(model, getActiveKnex(), scopeContext, fingerprint, tags, loadFromDb, () => true);
    }

    return loadFromDb();
  }

  /**
   * Create a new record
   * @param {Object} data - Record data
   * @returns {Promise<Object>}
   */
  async function create(data) {
    const ctx = createEventContext(model.name, 'create', getHookTrx());
    let workingData = { ...data };

    // Emit beforeValidation
    await ModelEvents.emitAsync(model.name, Hooks.BEFORE_VALIDATION, workingData, ctx);
    if (ctx.isCancelled) {
      throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_VALIDATION);
    }

    // Validate with Zod schema (partial for insert - allows auto fields to be missing)
    const validated = getPartialSchema(model).parse(workingData);

    // Emit afterValidation
    ModelEvents.emit(model.name, Hooks.AFTER_VALIDATION, validated, ctx);

    // Emit beforeSave (common for create and update)
    await ModelEvents.emitAsync(model.name, Hooks.BEFORE_SAVE, validated, ctx);
    if (ctx.isCancelled) {
      throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_SAVE);
    }

    // Emit beforeCreate
    await ModelEvents.emitAsync(model.name, Hooks.BEFORE_CREATE, validated, ctx);
    if (ctx.isCancelled) {
      throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_CREATE);
    }

    // Apply insert modifiers (timestamps, tenant)
    let insertData = applyInsertModifiers(validated, scopeContext, model);

    // Serialize JSON fields
    if (hasJson) {
      insertData = serializeJsonFields(insertData, jsonColumns);
    }

    // Insert and return the record
    const [id] = await getActiveKnex()(model.table).insert(insertData).returning(model.primaryKey);

    // For databases that don't support returning (SQLite), id might be the row itself
    const insertedId = typeof id === 'object' ? id[model.primaryKey] : id;

    // Fetch the created record (without emitting find events)
    const record = await findById(insertedId, {}, false);

    // Emit afterCreate
    ModelEvents.emit(model.name, Hooks.AFTER_CREATE, record, ctx);

    // Emit afterSave
    ModelEvents.emit(model.name, Hooks.AFTER_SAVE, record, ctx);

    return record;
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
    const ctx = createEventContext(model.name, 'update', getHookTrx());
    // Don't include primary key in working data for validation
    // to avoid type mismatch issues (URL params come as strings)
    let workingData = { ...data };
    delete workingData[model.primaryKey]; // Remove if passed in data

    // Emit beforeValidation
    await ModelEvents.emitAsync(model.name, Hooks.BEFORE_VALIDATION, workingData, ctx);
    if (ctx.isCancelled) {
      throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_VALIDATION);
    }

    // Validate with Zod schema (partial for update)
    const validated = getPartialSchema(model).parse(workingData);

    // Emit afterValidation
    ModelEvents.emit(model.name, Hooks.AFTER_VALIDATION, validated, ctx);

    // Emit beforeSave
    await ModelEvents.emitAsync(model.name, Hooks.BEFORE_SAVE, validated, ctx);
    if (ctx.isCancelled) {
      throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_SAVE);
    }

    // Emit beforeUpdate
    await ModelEvents.emitAsync(model.name, Hooks.BEFORE_UPDATE, validated, ctx);
    if (ctx.isCancelled) {
      throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_UPDATE);
    }

    // Apply update modifiers (timestamps)
    let updateData = applyUpdateModifiers(validated, model);

    // Remove primary key from update data
    delete updateData[model.primaryKey];

    // Serialize JSON fields
    if (hasJson) {
      updateData = serializeJsonFields(updateData, jsonColumns);
    }

    // Update the record
    const updated = await baseQuery()
      .where(model.primaryKey, id)
      .update(updateData);

    if (updated === 0) {
      return null;
    }

    // Fetch and return the updated record (without emitting find events)
    const record = await findById(id, {}, false);

    // Emit afterUpdate
    ModelEvents.emit(model.name, Hooks.AFTER_UPDATE, record, ctx);

    // Emit afterSave
    ModelEvents.emit(model.name, Hooks.AFTER_SAVE, record, ctx);

    return record;
  }

  /**
   * Update records matching conditions
   * @param {Object} conditions - Where conditions
   * @param {Object} data - Data to update
   * @returns {Promise<number>} Number of updated records
   */
  async function updateWhere(conditions, data) {
    // Validate with Zod schema (partial for update)
    const validated = getPartialSchema(model).parse(data);

    // Apply update modifiers (timestamps)
    let updateData = applyUpdateModifiers(validated, model);

    // Serialize JSON fields
    updateData = serializeJsonFields(updateData, jsonColumns);

    let qb = baseQuery();
    
    for (const [key, value] of Object.entries(conditions)) {
      qb = qb.where(key, value);
    }

    const updated = await qb.update(updateData);
    if (cacheLayer && updated > 0) {
      cacheLayer.invalidateModelAll(model);
    }
    return updated;
  }

  /**
   * Cascade soft-delete child records for cascading relations
   * @param {import('./types').ModelDefinition} currentModel
   * @param {Object} record
   * @param {Date} deletedAt
   * @param {Object} [options={}]
   * @param {Set<string>} [visited=new Set()]
   */
  async function cascadeSoftDelete(currentModel, record, deletedAt, options = {}, visited = new Set()) {
    const pkVal = record[currentModel.primaryKey];
    if (pkVal === undefined || pkVal === null) return;
    const visitKey = `${currentModel.name}:${pkVal}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const activeKnex = getActiveKnex();

    for (const [relationName, relation] of Object.entries(currentModel.relations || {})) {
      if (!['hasMany', 'hasOne'].includes(relation.type)) continue;
      if (!isCascadeEnabled(relation, 'delete')) continue;

      let relatedModel;
      try {
        relatedModel = resolveRelationModel(relation);
      } catch {
        continue;
      }
      if (!relatedModel || !relatedModel.scopes.softDelete) continue;

      const localKey = relation.localKey || currentModel.primaryKey;
      const foreignKey = relation.foreignKey;
      const parentVal = record[localKey];
      if (parentVal === undefined || parentVal === null) continue;

      const deletedCol = getSoftDeleteColumn(relatedModel);
      let childQuery = activeKnex(relatedModel.table)
        .where(foreignKey, parentVal)
        .whereNull(deletedCol);

      if (scopeContext && scopeContext.tenantId !== undefined && relatedModel.scopes.tenant) {
        childQuery = childQuery.where(relatedModel.scopes.tenant, scopeContext.tenantId);
      }

      const children = await childQuery.select('*');
      if (!children || children.length === 0) continue;

      const childIds = children.map(c => c[relatedModel.primaryKey]);

      await activeKnex(relatedModel.table)
        .whereIn(relatedModel.primaryKey, childIds)
        .update(getSoftDeleteData(deletedAt, relatedModel));

      if (cacheLayer) {
        cacheLayer.invalidateModelAll(relatedModel);
      }

      const hasDeeper = Object.values(relatedModel.relations || {}).some(
        r => ['hasMany', 'hasOne'].includes(r.type) && isCascadeEnabled(r, 'delete')
      );
      if (hasDeeper) {
        for (const child of children) {
          await cascadeSoftDelete(relatedModel, child, deletedAt, options, visited);
        }
      }

      if (ModelEvents.hasListeners(relatedModel.name, Hooks.AFTER_DELETE)) {
        for (const child of children) {
          const childCtx = createEventContext(relatedModel.name, 'delete', getHookTrx());
          ModelEvents.emit(relatedModel.name, Hooks.AFTER_DELETE, child, childCtx);
        }
      }
    }
  }

  /**
   * Cascade hard-delete child records for cascading relations
   * @param {import('./types').ModelDefinition} currentModel
   * @param {Object} record
   * @param {Object} [options={}]
   * @param {Set<string>} [visited=new Set()]
   */
  async function cascadeHardDelete(currentModel, record, options = {}, visited = new Set()) {
    const pkVal = record[currentModel.primaryKey];
    if (pkVal === undefined || pkVal === null) return;
    const visitKey = `${currentModel.name}:${pkVal}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const activeKnex = getActiveKnex();

    for (const [relationName, relation] of Object.entries(currentModel.relations || {})) {
      if (!['hasMany', 'hasOne'].includes(relation.type)) continue;
      if (!isCascadeEnabled(relation, 'delete')) continue;

      let relatedModel;
      try {
        relatedModel = resolveRelationModel(relation);
      } catch {
        continue;
      }
      if (!relatedModel) continue;

      const localKey = relation.localKey || currentModel.primaryKey;
      const foreignKey = relation.foreignKey;
      const parentVal = record[localKey];
      if (parentVal === undefined || parentVal === null) continue;

      let childQuery = activeKnex(relatedModel.table)
        .where(foreignKey, parentVal);

      if (scopeContext && scopeContext.tenantId !== undefined && relatedModel.scopes.tenant) {
        childQuery = childQuery.where(relatedModel.scopes.tenant, scopeContext.tenantId);
      }

      const children = await childQuery.select('*');
      if (!children || children.length === 0) continue;

      // Delete deeper relations first to avoid FK constraint violations
      const hasDeeper = Object.values(relatedModel.relations || {}).some(
        r => ['hasMany', 'hasOne'].includes(r.type) && isCascadeEnabled(r, 'delete')
      );
      if (hasDeeper) {
        for (const child of children) {
          await cascadeHardDelete(relatedModel, child, options, visited);
        }
      }

      const childIds = children.map(c => c[relatedModel.primaryKey]);
      await activeKnex(relatedModel.table)
        .whereIn(relatedModel.primaryKey, childIds)
        .delete();

      if (cacheLayer) {
        cacheLayer.invalidateModelAll(relatedModel);
      }

      if (ModelEvents.hasListeners(relatedModel.name, Hooks.AFTER_DELETE)) {
        for (const child of children) {
          const childCtx = createEventContext(relatedModel.name, 'delete', getHookTrx());
          ModelEvents.emit(relatedModel.name, Hooks.AFTER_DELETE, child, childCtx);
        }
      }
    }
  }

  /**
   * Cascade restore child records for cascading relations
   * @param {import('./types').ModelDefinition} currentModel
   * @param {Object} trashedRecord
   * @param {Date|string|number} parentDeletedAt
   * @param {Object} [options={}]
   * @param {Set<string>} [visited=new Set()]
   */
  async function cascadeRestore(currentModel, trashedRecord, parentDeletedAt, options = {}, visited = new Set()) {
    const pkVal = trashedRecord[currentModel.primaryKey];
    if (pkVal === undefined || pkVal === null) return;
    const visitKey = `${currentModel.name}:${pkVal}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const activeKnex = getActiveKnex();

    for (const [relationName, relation] of Object.entries(currentModel.relations || {})) {
      if (!['hasMany', 'hasOne'].includes(relation.type)) continue;
      if (!isCascadeEnabled(relation, 'restore')) continue;

      let relatedModel;
      try {
        relatedModel = resolveRelationModel(relation);
      } catch {
        continue;
      }
      if (!relatedModel || !relatedModel.scopes.softDelete) continue;

      const localKey = relation.localKey || currentModel.primaryKey;
      const foreignKey = relation.foreignKey;
      const parentVal = trashedRecord[localKey];
      if (parentVal === undefined || parentVal === null) continue;

      const deletedCol = getSoftDeleteColumn(relatedModel);
      let childQuery = activeKnex(relatedModel.table)
        .where(foreignKey, parentVal)
        .whereNotNull(deletedCol);

      if (scopeContext && scopeContext.tenantId !== undefined && relatedModel.scopes.tenant) {
        childQuery = childQuery.where(relatedModel.scopes.tenant, scopeContext.tenantId);
      }

      // Selective restore by matching deletion timestamp
      if (!options.allChildren && parentDeletedAt != null) {
        childQuery = childQuery.where(deletedCol, parentDeletedAt);
      }

      const children = await childQuery.select('*');
      if (!children || children.length === 0) continue;

      const hasDeeper = Object.values(relatedModel.relations || {}).some(
        r => ['hasMany', 'hasOne'].includes(r.type) && isCascadeEnabled(r, 'restore')
      );
      if (hasDeeper) {
        for (const child of children) {
          const childDeletedAt = child[deletedCol] || child.deleted_at || parentDeletedAt;
          await cascadeRestore(relatedModel, child, childDeletedAt, options, visited);
        }
      }

      const childIds = children.map(c => c[relatedModel.primaryKey]);
      await activeKnex(relatedModel.table)
        .whereIn(relatedModel.primaryKey, childIds)
        .update(getRestoreData(relatedModel));

      if (cacheLayer) {
        cacheLayer.invalidateModelAll(relatedModel);
      }

      if (ModelEvents.hasListeners(relatedModel.name, Hooks.AFTER_RESTORE)) {
        for (const child of children) {
          const childCtx = createEventContext(relatedModel.name, 'restore', getHookTrx());
          ModelEvents.emit(relatedModel.name, Hooks.AFTER_RESTORE, { ...child, [deletedCol]: null, deleted_at: null }, childCtx);
        }
      }
    }
  }

  /**
   * Delete a record by primary key (soft delete if enabled, with relation cascading)
   * @param {number|string} id - Primary key value
   * @param {Object} [options={}] - Delete options ({ cascade?: boolean, deletedAt?: Date })
   * @returns {Promise<boolean>}
   */
  async function del(id, options = {}) {
    const ctx = createEventContext(model.name, 'delete', getHookTrx());
    
    // Get the record before deletion for hooks and cascading
    const record = await findById(id);
    if (!record) {
      return false;
    }

    // Emit beforeDelete
    await ModelEvents.emitAsync(model.name, Hooks.BEFORE_DELETE, record, ctx);
    if (ctx.isCancelled) {
      throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_DELETE);
    }

    let success = false;
    const deletedAt = (options && options.deletedAt instanceof Date) ? options.deletedAt : new Date();

    // Soft delete if enabled
    if (model.scopes.softDelete) {
      const updated = await baseQuery()
        .where(model.primaryKey, id)
        .update(getSoftDeleteData(deletedAt, model));
      success = updated > 0;

      if (success) {
        if (cacheLayer) {
          cacheLayer.invalidateModelAll(model);
        }

        if (!options || options.cascade !== false) {
          await cascadeSoftDelete(model, record, deletedAt, options);
        }

        // Emit afterDelete
        ModelEvents.emit(model.name, Hooks.AFTER_DELETE, record, ctx);
      }
    } else {
      // Hard delete
      // Cascade hard-delete child records first to satisfy FK constraints
      if (!options || options.cascade !== false) {
        await cascadeHardDelete(model, record, options);
      }

      const deleted = await baseQuery()
        .where(model.primaryKey, id)
        .delete();
      success = deleted > 0;

      if (success) {
        if (cacheLayer) {
          cacheLayer.invalidateModelAll(model);
        }

        // Emit afterDelete
        ModelEvents.emit(model.name, Hooks.AFTER_DELETE, record, ctx);
      }
    }

    return success;
  }

  /**
   * Force delete a record (bypass soft delete, cascading to related models)
   * @param {number|string} id - Primary key value
   * @param {Object} [options={}] - Force delete options ({ cascade?: boolean })
   * @returns {Promise<boolean>}
   */
  async function forceDelete(id, options = {}) {
    const record = await getActiveKnex()(model.table)
      .where(model.primaryKey, id)
      .first();

    if (!record) {
      return false;
    }

    if (!options || options.cascade !== false) {
      await cascadeHardDelete(model, record, options);
    }

    // Use raw query to bypass soft delete scope
    const deleted = await getActiveKnex()(model.table)
      .where(model.primaryKey, id)
      .delete();

    if (cacheLayer && deleted > 0) {
      cacheLayer.invalidateModelAll(model);
    }
    return deleted > 0;
  }

  /**
   * Restore a soft-deleted record (with selective cascading restore)
   * @param {number|string} id - Primary key value
   * @param {Object} [options={}] - Restore options ({ cascade?: boolean, allChildren?: boolean })
   * @returns {Promise<Object|null>}
   */
  async function restore(id, options = {}) {
    if (!model.scopes.softDelete) {
      throw new Error(`Model "${model.name}" does not have soft delete enabled`);
    }

    const ctx = createEventContext(model.name, 'restore', getHookTrx());

    const deletedCol = getSoftDeleteColumn(model);

    // Get the trashed record for hooks (bypass soft delete scope)
    const trashedRecord = await getActiveKnex()(model.table)
      .where(model.primaryKey, id)
      .whereNotNull(deletedCol)
      .first();

    if (!trashedRecord) {
      return null;
    }

    // Emit beforeRestore
    await ModelEvents.emitAsync(model.name, Hooks.BEFORE_RESTORE, trashedRecord, ctx);
    if (ctx.isCancelled) {
      throw new HookCancellationError(ctx.cancelReason, model.name, Hooks.BEFORE_RESTORE);
    }

    // Update directly without scopes (to find trashed record)
    const updated = await getActiveKnex()(model.table)
      .where(model.primaryKey, id)
      .whereNotNull(deletedCol)
      .update(getRestoreData(model));

    if (updated === 0) {
      return null;
    }

    if (cacheLayer) {
      cacheLayer.invalidateModelAll(model);
    }

    if (!options || options.cascade !== false) {
      const parentDeletedAt = trashedRecord[deletedCol] || trashedRecord.deleted_at;
      await cascadeRestore(model, trashedRecord, parentDeletedAt, options);
    }

    const record = await findById(id, {}, false);

    // Emit afterRestore
    ModelEvents.emit(model.name, Hooks.AFTER_RESTORE, record, ctx);

    return record;
  }

  /**
   * Get a query builder for this model
   * @returns {import('./query-builder').QueryBuilder}
   */
  function query() {
    return createQueryBuilder(model, getActiveKnex(), { ...scopeContext }, cacheLayer);
  }

  /**
   * Execute a raw query
   * @param {string} sql - SQL query
   * @param {Array} [bindings=[]] - Query bindings
   * @returns {Promise<Object[]>}
   */
  async function raw(sql, bindings = []) {
    const result = await getActiveKnex().raw(sql, bindings);
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

  /**
   * Find records matching conditions (with optional relations to eager load)
   * @param {Object} [conditions={}] - WHERE conditions
   * @param {import('./types').FindOptions} [options={}] - Find options
   * @returns {Promise<Object[]>}
   */
  async function find(conditions = {}, options = {}) {
    if (!conditions || Object.keys(conditions).length === 0) {
      return findAll(options);
    }
    const withs = options.include || options.with || [];
    let qb = query().where(conditions);
    if (withs.length > 0) {
      qb = qb.with(withs);
    }
    if (options.select && options.select.length > 0) {
      qb = qb.select(options.select);
    }
    if (options.limit !== undefined) {
      qb = qb.limit(options.limit);
    }
    if (options.offset !== undefined) {
      qb = qb.offset(options.offset);
    }
    return qb.list();
  }

  /**
   * Search records using Full-Text / Keyword Search
   * @param {string} term - Search query
   * @param {string|string[]} [columns] - Columns to search
   * @param {Object} [options] - Search options
   * @returns {import('./query-builder').QueryBuilder}
   */
  function search(term, columns, options) {
    return query().search(term, columns, options);
  }

  return {
    findById,
    findOne,
    findAll,
    find,
    create,
    createMany,
    update,
    updateWhere,
    delete: del,
    forceDelete,
    restore,
    query,
    search,
    raw,
    count,
    exists,
    with: withRelations,
    include: withRelations,
    // Expose model for introspection
    model,
  };
}

module.exports = {
  createRepository,
};

