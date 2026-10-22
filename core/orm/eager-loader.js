/**
 * Webspresso ORM - Eager Loader
 * Batch loading algorithm for relations (supports direct & arbitrary nested relations)
 * @module core/orm/eager-loader
 */

const { resolveRelationModel, getRelationKeys } = require('./model');
const { applyScopes, createScopeContext } = require('./scopes');
const { getJsonColumns, deserializeJsonFields } = require('./json-fields');

const RELATION_TREE_CACHE_LIMIT = 512;
const relationTreeCache = new Map();

/**
 * Generate a deterministic cache key for relation names specifications
 * @param {string|Array|Object} relationNames
 * @returns {string|null}
 */
function getRelationTreeCacheKey(relationNames) {
  if (typeof relationNames === 'string') {
    return 's:' + relationNames;
  }
  if (Array.isArray(relationNames)) {
    for (let i = 0; i < relationNames.length; i++) {
      if (typeof relationNames[i] !== 'string') {
        try {
          return 'o:' + JSON.stringify(relationNames);
        } catch (_) {
          return null;
        }
      }
    }
    return 'a:' + relationNames.join('|');
  }
  if (relationNames && typeof relationNames === 'object') {
    try {
      return 'o:' + JSON.stringify(relationNames);
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Clone a relation tree Map to prevent external mutation from poisoning cache
 * @param {Map<string, string[]>} tree
 * @returns {Map<string, string[]>}
 */
function cloneRelationTree(tree) {
  const copy = new Map();
  for (const [k, v] of tree.entries()) {
    copy.set(k, v.slice());
  }
  return copy;
}

/**
 * Clear the internal relation tree cache
 */
function clearRelationTreeCache() {
  relationTreeCache.clear();
}

/**
 * Parse relation specifications into a grouped structure: Map<topLevelRelation, string[]>
 * Supports dot notation ('author.profile'), arrays (['author', 'comments.author']),
 * and nested relation chains of arbitrary depth.
 * 
 * @param {Array<string|Object>} relationNames
 * @returns {Map<string, string[]>}
 */
function parseRelationTree(relationNames) {
  if (relationNames instanceof Map) {
    return cloneRelationTree(relationNames);
  }

  const cacheKey = getRelationTreeCacheKey(relationNames);
  if (cacheKey) {
    const cached = relationTreeCache.get(cacheKey);
    if (cached) {
      // Refresh LRU order
      relationTreeCache.delete(cacheKey);
      relationTreeCache.set(cacheKey, cached);
      return cloneRelationTree(cached);
    }
  }

  const tree = new Map();

  function addPath(top, nested) {
    if (!top || typeof top !== 'string') return;
    const cleanTop = top.trim();
    if (!cleanTop) return;

    if (!tree.has(cleanTop)) {
      tree.set(cleanTop, []);
    }
    if (nested) {
      if (Array.isArray(nested)) {
        for (const item of nested) {
          if (item && typeof item === 'string') tree.get(cleanTop).push(item.trim());
        }
      } else if (typeof nested === 'string') {
        const cleanNested = nested.trim();
        if (cleanNested) tree.get(cleanTop).push(cleanNested);
      }
    }
  }

  function processItem(item) {
    if (!item) return;

    if (typeof item === 'string') {
      const dotIndex = item.indexOf('.');
      if (dotIndex === -1) {
        addPath(item);
      } else {
        const top = item.slice(0, dotIndex);
        const rest = item.slice(dotIndex + 1);
        addPath(top, rest);
      }
    } else if (Array.isArray(item)) {
      for (const sub of item) {
        processItem(sub);
      }
    } else if (typeof item === 'object') {
      for (const [key, value] of Object.entries(item)) {
        if (value === true || value == null) {
          processItem(key);
        } else if (typeof value === 'string' || Array.isArray(value)) {
          const dotIndex = key.indexOf('.');
          if (dotIndex === -1) {
            addPath(key, value);
          } else {
            const top = key.slice(0, dotIndex);
            const rest = key.slice(dotIndex + 1);
            const nestedValues = Array.isArray(value) ? value : [value];
            for (const v of nestedValues) {
              addPath(top, `${rest}.${v}`);
            }
          }
        }
      }
    }
  }

  const list = Array.isArray(relationNames) ? relationNames : [relationNames];
  for (const item of list) {
    processItem(item);
  }

  if (cacheKey) {
    if (relationTreeCache.size >= RELATION_TREE_CACHE_LIMIT) {
      const firstKey = relationTreeCache.keys().next().value;
      relationTreeCache.delete(firstKey);
    }
    relationTreeCache.set(cacheKey, tree);
    return cloneRelationTree(tree);
  }

  return tree;
}

/**
 * Load relations for a set of records using batch queries (supports nested relations)
 * @param {Object[]} records - Records to load relations for
 * @param {Array<string|Object>} relationNames - Names of relations to load (e.g. ['author.profile', 'comments.author'])
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {import('knex').Knex|import('knex').Knex.Transaction} knex - Knex instance
 * @param {import('./types').ScopeContext} [scopeContext] - Scope context
 * @returns {Promise<Object[]>} Records with relations attached
 */
async function loadRelations(records, relationNames, model, knex, scopeContext) {
  if (!records || !records.length || !relationNames || !relationNames.length) {
    return records;
  }

  const context = scopeContext || createScopeContext();
  const tree = relationNames instanceof Map ? relationNames : parseRelationTree(relationNames);

  // Process each relation grouped by top-level
  for (const [relationName, nestedPaths] of tree.entries()) {
    const relation = model.relations?.[relationName];
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
      default:
        console.warn(`Unsupported relation type "${relation.type}" for relation "${relationName}" on model "${model.name}"`);
        continue;
    }

    // Process nested relations if any
    if (nestedPaths.length > 0) {
      const childRecords = [];
      const seenRefs = new Set();
      const len = records.length;

      for (let i = 0; i < len; i++) {
        const child = records[i][relationName];
        if (!child) continue;

        if (Array.isArray(child)) {
          for (let j = 0; j < child.length; j++) {
            const item = child[j];
            if (item && typeof item === 'object' && !seenRefs.has(item)) {
              seenRefs.add(item);
              childRecords.push(item);
            }
          }
        } else if (typeof child === 'object' && !seenRefs.has(child)) {
          seenRefs.add(child);
          childRecords.push(child);
        }
      }

      if (childRecords.length > 0) {
        await loadRelations(childRecords, nestedPaths, relatedModel, knex, context);
      }
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

  const jsonCols = getJsonColumns(relatedModel);
  if (jsonCols.size > 0) {
    const rLen = relatedRecords.length;
    for (let i = 0; i < rLen; i++) {
      deserializeJsonFields(relatedRecords[i], jsonCols);
    }
  }

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

  const jsonCols = getJsonColumns(relatedModel);
  if (jsonCols.size > 0) {
    const rLen = relatedRecords.length;
    for (let i = 0; i < rLen; i++) {
      deserializeJsonFields(relatedRecords[i], jsonCols);
    }
  }

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

  const jsonCols = getJsonColumns(relatedModel);
  if (jsonCols.size > 0) {
    const rLen = relatedRecords.length;
    for (let i = 0; i < rLen; i++) {
      deserializeJsonFields(relatedRecords[i], jsonCols);
    }
  }

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
 * Load a single relation (or nested relation path) for a single record
 * @param {Object} record - Record to load relation for
 * @param {string} relationName - Name or dot-separated path of relation to load (e.g. 'author.profile')
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
  parseRelationTree,
  clearRelationTreeCache,
  getRelationTreeCacheKey,
};
