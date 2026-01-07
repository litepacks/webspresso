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
  // Collect unique foreign key values
  const foreignKeyValues = [...new Set(
    records
      .map(r => r[foreignKey])
      .filter(v => v !== null && v !== undefined)
  )];

  if (foreignKeyValues.length === 0) {
    // No foreign keys, set all relations to null
    for (const record of records) {
      record[relationName] = null;
    }
    return;
  }

  // Build query for related records
  let qb = knex(relatedModel.table).whereIn(relatedModel.primaryKey, foreignKeyValues);
  
  // Apply scopes to related model
  qb = applyScopes(qb, scopeContext, relatedModel);

  const relatedRecords = await qb;

  // Index related records by primary key
  const relatedMap = new Map();
  for (const related of relatedRecords) {
    relatedMap.set(related[relatedModel.primaryKey], related);
  }

  // Attach related records to parent records
  for (const record of records) {
    const fkValue = record[foreignKey];
    record[relationName] = fkValue !== null && fkValue !== undefined
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
  // Collect unique primary key values from parent records
  const primaryKeyValues = [...new Set(
    records
      .map(r => r[localKey])
      .filter(v => v !== null && v !== undefined)
  )];

  if (primaryKeyValues.length === 0) {
    // No primary keys, set all relations to empty arrays
    for (const record of records) {
      record[relationName] = [];
    }
    return;
  }

  // Build query for related records
  let qb = knex(relatedModel.table).whereIn(foreignKey, primaryKeyValues);
  
  // Apply scopes to related model
  qb = applyScopes(qb, scopeContext, relatedModel);

  const relatedRecords = await qb;

  // Group related records by foreign key
  const relatedGroups = new Map();
  for (const related of relatedRecords) {
    const fkValue = related[foreignKey];
    if (!relatedGroups.has(fkValue)) {
      relatedGroups.set(fkValue, []);
    }
    relatedGroups.get(fkValue).push(related);
  }

  // Attach related records to parent records
  for (const record of records) {
    const pkValue = record[localKey];
    record[relationName] = relatedGroups.get(pkValue) || [];
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
  // Collect unique primary key values from parent records
  const primaryKeyValues = [...new Set(
    records
      .map(r => r[localKey])
      .filter(v => v !== null && v !== undefined)
  )];

  if (primaryKeyValues.length === 0) {
    // No primary keys, set all relations to null
    for (const record of records) {
      record[relationName] = null;
    }
    return;
  }

  // Build query for related records
  let qb = knex(relatedModel.table).whereIn(foreignKey, primaryKeyValues);
  
  // Apply scopes to related model
  qb = applyScopes(qb, scopeContext, relatedModel);

  const relatedRecords = await qb;

  // Index related records by foreign key (first occurrence wins for hasOne)
  const relatedMap = new Map();
  for (const related of relatedRecords) {
    const fkValue = related[foreignKey];
    if (!relatedMap.has(fkValue)) {
      relatedMap.set(fkValue, related);
    }
  }

  // Attach related records to parent records
  for (const record of records) {
    const pkValue = record[localKey];
    record[relationName] = relatedMap.get(pkValue) || null;
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
};

