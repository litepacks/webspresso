/**
 * Webspresso ORM - Eager Loader
 * Batch loading algorithm for relations
 * @module core/orm/eager-loader
 */

const { resolveRelationModel, getRelationKeys } = require('./model');
const { applyScopes, createScopeContext } = require('./scopes');

/**
 * Load relations for a set of records using batch queries
 * @param {Object[]} records - Records to load relations for
 * @param {string[]} relationNames - Names of relations to load
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {import('knex').Knex|import('knex').Knex.Transaction} knex - Knex instance
 * @param {import('./types').ScopeContext} [scopeContext] - Scope context
 * @returns {Promise<Object[]>} Records with relations attached
 */
async function loadRelations(records, relationNames, model, knex, scopeContext) {
  if (!records.length || !relationNames.length) {
    return records;
  }

  const context = scopeContext || createScopeContext();

  // Process each relation
  for (const relationName of relationNames) {
    const relation = model.relations[relationName];
    if (!relation) {
      console.warn(`Relation "${relationName}" not found on model "${model.name}"`);
      continue;
    }

    const { localKey, foreignKey, relatedModel } = getRelationKeys(model, relationName);

    switch (relation.type) {
      case 'belongsTo':
        await loadBelongsTo(records, relationName, localKey, foreignKey, relatedModel, knex, context);
        break;
      case 'hasMany':
        await loadHasMany(records, relationName, localKey, foreignKey, relatedModel, knex, context);
        break;
      case 'hasOne':
        await loadHasOne(records, relationName, localKey, foreignKey, relatedModel, knex, context);
        break;
    }
  }

  return records;
}

/**
 * Execute whereIn query in chunks to prevent parameter limits and query planner degradation
 * @param {import('knex').Knex} knex
 * @param {string} table
 * @param {string} column
 * @param {Array<string|number>} values
 * @param {import('./types').ScopeContext} scopeContext
 * @param {import('./types').ModelDefinition} model
 * @param {number} [chunkSize=500]
 * @returns {Promise<Object[]>}
 */
async function queryInChunks(knex, table, column, values, scopeContext, model, chunkSize = 500) {
  if (values.length <= chunkSize) {
    let qb = knex(table).whereIn(column, values);
    qb = applyScopes(qb, scopeContext, model);
    return await qb;
  }

  const results = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    const slice = values.slice(i, i + chunkSize);
    let qb = knex(table).whereIn(column, slice);
    qb = applyScopes(qb, scopeContext, model);
    const chunkResults = await qb;
    results.push(...chunkResults);
  }
  return results;
}

/**
 * Load belongsTo relation
 * Parent record has foreign key pointing to related record's primary key
 * Example: User belongsTo Company (user.company_id -> company.id)
 * 
 * @param {Object[]} records - Parent records
 * @param {string} relationName - Relation name
 * @param {string} localKey - Local primary key (typically 'id')
 * @param {string} foreignKey - Foreign key on parent (e.g., 'company_id')
 * @param {import('./types').ModelDefinition} relatedModel - Related model
 * @param {import('knex').Knex} knex - Knex instance
 * @param {import('./types').ScopeContext} scopeContext - Scope context
 */
async function loadBelongsTo(records, relationName, localKey, foreignKey, relatedModel, knex, scopeContext) {
  const fkSet = new Set();
  const len = records.length;
  for (let i = 0; i < len; i++) {
    const v = records[i][foreignKey];
    if (v !== null && v !== undefined) fkSet.add(v);
  }

  if (fkSet.size === 0) {
    for (let i = 0; i < len; i++) {
      records[i][relationName] = null;
    }
    return;
  }

  const foreignKeyValues = Array.from(fkSet);
  const relatedRecords = await queryInChunks(
    knex,
    relatedModel.table,
    relatedModel.primaryKey,
    foreignKeyValues,
    scopeContext,
    relatedModel
  );

  const relatedMap = new Map();
  const rLen = relatedRecords.length;
  const pk = relatedModel.primaryKey;
  for (let i = 0; i < rLen; i++) {
    const item = relatedRecords[i];
    relatedMap.set(item[pk], item);
  }

  for (let i = 0; i < len; i++) {
    const rec = records[i];
    const fkValue = rec[foreignKey];
    rec[relationName] = fkValue !== null && fkValue !== undefined
      ? relatedMap.get(fkValue) || null
      : null;
  }
}

/**
 * Load hasMany relation
 * Related records have foreign key pointing to parent record's primary key
 * Example: User hasMany Posts (post.user_id -> user.id)
 * 
 * @param {Object[]} records - Parent records
 * @param {string} relationName - Relation name
 * @param {string} localKey - Local primary key (typically 'id')
 * @param {string} foreignKey - Foreign key on related records (e.g., 'user_id')
 * @param {import('./types').ModelDefinition} relatedModel - Related model
 * @param {import('knex').Knex} knex - Knex instance
 * @param {import('./types').ScopeContext} scopeContext - Scope context
 */
async function loadHasMany(records, relationName, localKey, foreignKey, relatedModel, knex, scopeContext) {
  const pkSet = new Set();
  const len = records.length;
  for (let i = 0; i < len; i++) {
    const v = records[i][localKey];
    if (v !== null && v !== undefined) pkSet.add(v);
  }

  if (pkSet.size === 0) {
    for (let i = 0; i < len; i++) {
      records[i][relationName] = [];
    }
    return;
  }

  const primaryKeyValues = Array.from(pkSet);
  const relatedRecords = await queryInChunks(
    knex,
    relatedModel.table,
    foreignKey,
    primaryKeyValues,
    scopeContext,
    relatedModel
  );

  const relatedGroups = new Map();
  const rLen = relatedRecords.length;
  for (let i = 0; i < rLen; i++) {
    const item = relatedRecords[i];
    const fkValue = item[foreignKey];
    let group = relatedGroups.get(fkValue);
    if (group === undefined) {
      group = [];
      relatedGroups.set(fkValue, group);
    }
    group.push(item);
  }

  for (let i = 0; i < len; i++) {
    const rec = records[i];
    const pkValue = rec[localKey];
    rec[relationName] = (pkValue !== null && pkValue !== undefined ? relatedGroups.get(pkValue) : undefined) || [];
  }
}

/**
 * Load hasOne relation
 * Related record has foreign key pointing to parent record's primary key
 * Returns single related record (or null)
 * 
 * @param {Object[]} records - Parent records
 * @param {string} relationName - Relation name
 * @param {string} localKey - Local primary key (typically 'id')
 * @param {string} foreignKey - Foreign key on related record
 * @param {import('./types').ModelDefinition} relatedModel - Related model
 * @param {import('knex').Knex} knex - Knex instance
 * @param {import('./types').ScopeContext} scopeContext - Scope context
 */
async function loadHasOne(records, relationName, localKey, foreignKey, relatedModel, knex, scopeContext) {
  const pkSet = new Set();
  const len = records.length;
  for (let i = 0; i < len; i++) {
    const v = records[i][localKey];
    if (v !== null && v !== undefined) pkSet.add(v);
  }

  if (pkSet.size === 0) {
    for (let i = 0; i < len; i++) {
      records[i][relationName] = null;
    }
    return;
  }

  const primaryKeyValues = Array.from(pkSet);
  const relatedRecords = await queryInChunks(
    knex,
    relatedModel.table,
    foreignKey,
    primaryKeyValues,
    scopeContext,
    relatedModel
  );

  const relatedMap = new Map();
  const rLen = relatedRecords.length;
  for (let i = 0; i < rLen; i++) {
    const item = relatedRecords[i];
    const fkValue = item[foreignKey];
    if (!relatedMap.has(fkValue)) {
      relatedMap.set(fkValue, item);
    }
  }

  for (let i = 0; i < len; i++) {
    const rec = records[i];
    const pkValue = rec[localKey];
    rec[relationName] = (pkValue !== null && pkValue !== undefined ? relatedMap.get(pkValue) : undefined) || null;
  }
}

/**
 * Load a single relation for a single record
 * @param {Object} record - Record to load relation for
 * @param {string} relationName - Name of relation to load
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {import('knex').Knex} knex - Knex instance
 * @param {import('./types').ScopeContext} [scopeContext] - Scope context
 * @returns {Promise<Object>} Record with relation attached
 */
async function loadRelation(record, relationName, model, knex, scopeContext) {
  const result = await loadRelations([record], [relationName], model, knex, scopeContext);
  return result[0];
}

module.exports = {
  loadRelations,
  loadRelation,
  loadBelongsTo,
  loadHasMany,
  loadHasOne,
  queryInChunks,
};

