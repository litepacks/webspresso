/**
 * Webspresso ORM - Universal Query Filter Engine
 *
 * Unified column filtering engine powering both REST Resources and Admin Panel.
 * Supports comparison operators, pattern matching, sets, ranges, nullability,
 * and column type coercion.
 *
 * @module core/orm/query-filters
 */

'use strict';

const RESERVED_QUERY_KEYS = new Set([
  'page',
  'perPage',
  'per_page',
  'limit',
  'offset',
  'sort',
  'order',
  'include',
  'trashed',
  'fields',
  'select',
  'search',
  'q',
]);

/**
 * Normalizes an operator name to canonical form
 * @param {string} op
 * @returns {string}
 */
function normalizeOperator(op) {
  const s = String(op || 'contains').toLowerCase().trim();
  switch (s) {
    case 'equals':
    case '=':
    case 'eq':
      return 'eq';

    case 'ne':
    case '!=':
    case '<>':
    case 'not_equals':
    case 'notequals':
      return 'ne';

    case 'gt':
    case '>':
      return 'gt';

    case 'gte':
    case '>=':
      return 'gte';

    case 'lt':
    case '<':
      return 'lt';

    case 'lte':
    case '<=':
      return 'lte';

    case 'in':
      return 'in';

    case 'nin':
    case 'notin':
    case 'not_in':
      return 'notin';

    case 'like':
      return 'like';

    case 'ilike':
      return 'ilike';

    case 'contains':
      return 'contains';

    case 'starts_with':
    case 'startswith':
      return 'startswith';

    case 'ends_with':
    case 'endswith':
      return 'endswith';

    case 'is_null':
    case 'isnull':
    case 'null':
      return 'is_null';

    case 'is_not_null':
    case 'isnotnull':
    case 'not_null':
    case 'notnull':
      return 'is_not_null';

    case 'between':
      return 'between';

    default:
      return s;
  }
}

/**
 * Applies a single filter condition to one or more query builder instances
 *
 * @param {Array<Object>} targets - Query builder instances to mutate
 * @param {string} column - Target column name
 * @param {string} rawOp - Operator name
 * @param {unknown} rawVal - Value or object containing from/to
 * @param {Object} [meta] - Optional column metadata from model definition
 */
function applyFilterCondition(targets, column, rawOp, rawVal, meta = null) {
  if (!targets || targets.length === 0) return;

  const colType = meta?.type;
  const operator = normalizeOperator(rawOp);
  let val = rawVal;

  // Handle boolean column type coercion
  if (colType === 'boolean' && typeof val === 'string') {
    if (val === 'true' || val === '1') {
      val = true;
    } else if (val === 'false' || val === '0') {
      val = false;
    }
  }

  // Handle nullability operators
  if (operator === 'is_null') {
    const isTrue = val === undefined || val === null || val === true || val === 'true' || val === '1' || val === 1 || val === '';
    if (isTrue) {
      for (const t of targets) t.whereNull(column);
    }
    return;
  }

  if (operator === 'is_not_null') {
    const isTrue = val === undefined || val === null || val === true || val === 'true' || val === '1' || val === 1 || val === '';
    if (isTrue) {
      for (const t of targets) t.whereNotNull(column);
    }
    return;
  }

  // Handle between operator
  if (operator === 'between') {
    let from = undefined;
    let to = undefined;

    if (Array.isArray(val)) {
      from = val[0];
      to = val[1];
    } else if (typeof val === 'string') {
      const parts = val.split(',').map((s) => s.trim());
      from = parts[0];
      to = parts[1];
    } else if (val && typeof val === 'object') {
      from = val.from;
      to = val.to;
    }

    const hasFrom = from !== undefined && from !== null && from !== '';
    const hasTo = to !== undefined && to !== null && to !== '';

    if (hasFrom && hasTo) {
      for (const t of targets) {
        t.where(column, '>=', from);
        t.where(column, '<=', to);
      }
    } else if (hasFrom) {
      for (const t of targets) t.where(column, '>=', from);
    } else if (hasTo) {
      for (const t of targets) t.where(column, '<=', to);
    }
    return;
  }

  // Handle in & notin
  if (operator === 'in') {
    const arr = Array.isArray(val)
      ? val
      : (typeof val === 'string' ? val.split(',').map((s) => s.trim()).filter(Boolean) : (val !== undefined && val !== '' ? [val] : []));
    if (arr.length > 0) {
      for (const t of targets) t.whereIn(column, arr);
    }
    return;
  }

  if (operator === 'notin') {
    const arr = Array.isArray(val)
      ? val
      : (typeof val === 'string' ? val.split(',').map((s) => s.trim()).filter(Boolean) : (val !== undefined && val !== '' ? [val] : []));
    if (arr.length > 0) {
      for (const t of targets) t.whereNotIn(column, arr);
    }
    return;
  }

  // Ignore inactive empty values for standard scalar operators
  if (val === undefined || val === null || val === '') {
    return;
  }

  switch (operator) {
    case 'contains':
      for (const t of targets) t.where(column, 'like', `%${val}%`);
      break;

    case 'startswith':
      for (const t of targets) t.where(column, 'like', `${val}%`);
      break;

    case 'endswith':
      for (const t of targets) t.where(column, 'like', `%${val}`);
      break;

    case 'like':
      for (const t of targets) t.where(column, 'like', String(val));
      break;

    case 'ilike':
      for (const t of targets) t.where(column, 'ilike', String(val));
      break;

    case 'gt':
      for (const t of targets) t.where(column, '>', val);
      break;

    case 'gte':
      for (const t of targets) t.where(column, '>=', val);
      break;

    case 'lt':
      for (const t of targets) t.where(column, '<', val);
      break;

    case 'lte':
      for (const t of targets) t.where(column, '<=', val);
      break;

    case 'ne':
      for (const t of targets) t.where(column, '!=', val);
      break;

    case 'eq':
    default:
      for (const t of targets) t.where(column, '=', val);
      break;
  }
}

/**
 * Builds a query with filters applied (used by Admin Panel and Repositories)
 *
 * @param {Object} repoOrQuery - Repository instance or Knex QueryBuilder
 * @param {Object} filters - Filter object: { column: { op, value, from, to } } or { column: value }
 * @param {Object} [options] - Options
 * @param {boolean} [options.onlyTrashed] - For soft delete: only trashed records
 * @param {Object} [options.model] - Optional ModelDefinition for column verification
 * @returns {Object} Query builder with filters applied
 */
function buildFilteredQuery(repoOrQuery, filters, options = {}) {
  let query = (repoOrQuery && typeof repoOrQuery.query === 'function')
    ? repoOrQuery.query()
    : repoOrQuery;

  if (options.onlyTrashed && query && typeof query.onlyTrashed === 'function') {
    query = query.onlyTrashed();
  }

  if (!filters || typeof filters !== 'object' || Object.keys(filters).length === 0) {
    return query;
  }

  const model = options.model || (repoOrQuery && repoOrQuery.model);
  const columns = model?.columns;

  for (const [column, filter] of Object.entries(filters)) {
    if (!filter) continue;
    if (columns && typeof columns.has === 'function' && !columns.has(column)) {
      continue;
    }

    const meta = columns && typeof columns.get === 'function' ? columns.get(column) : null;

    if (typeof filter === 'object' && !Array.isArray(filter)) {
      const rawOp = filter.op || filter.operator;
      const normOp = rawOp ? normalizeOperator(rawOp) : null;
      if (normOp === 'is_null' || normOp === 'is_not_null') {
        applyFilterCondition([query], column, normOp, filter.value !== undefined ? filter.value : true, meta);
      } else if (normOp === 'between') {
        applyFilterCondition([query], column, rawOp, filter, meta);
      } else if (filter.value !== undefined) {
        applyFilterCondition([query], column, rawOp || 'contains', filter.value, meta);
      } else {
        for (const [nestedOp, nestedVal] of Object.entries(filter)) {
          applyFilterCondition([query], column, nestedOp, nestedVal, meta);
        }
      }
    } else {
      applyFilterCondition([query], column, 'eq', filter, meta);
    }
  }

  return query;
}

/**
 * Extracts and applies column filters from an HTTP request or filter object to query builders
 * (used by REST Resources and API routes)
 *
 * @param {Object} query - Main QueryBuilder
 * @param {Object} [countQuery] - Optional Count QueryBuilder
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {import('express').Request|Object} reqOrQuery - Express request or query object
 * @returns {{ query: Object, countQuery: Object }} Mutated query instances
 */
function applyColumnFilters(query, countQuery, model, reqOrQuery) {
  const q = query;
  const c = countQuery;
  const targets = [q, c].filter(Boolean);

  const rawQuery = (reqOrQuery && typeof reqOrQuery === 'object' && 'query' in reqOrQuery)
    ? reqOrQuery.query
    : (reqOrQuery || {});

  if (!rawQuery || typeof rawQuery !== 'object') {
    return { query: q, countQuery: c };
  }

  const hasColumns = model && model.columns && typeof model.columns.has === 'function';

  // 1. Process dedicated filter object: ?filter[col]=... or ?filter[col][op]=... or ?filter={ col: { op, value } }
  if (rawQuery.filter && typeof rawQuery.filter === 'object') {
    for (const [col, colFilter] of Object.entries(rawQuery.filter)) {
      if (hasColumns && !model.columns.has(col)) continue;
      const meta = hasColumns ? model.columns.get(col) : null;

      if (colFilter && typeof colFilter === 'object' && !Array.isArray(colFilter)) {
        const rawColOp = colFilter.op || colFilter.operator;
        const normColOp = rawColOp ? normalizeOperator(rawColOp) : null;
        if (normColOp === 'is_null' || normColOp === 'is_not_null') {
          applyFilterCondition(targets, col, normColOp, colFilter.value !== undefined ? colFilter.value : true, meta);
        } else if (colFilter.op !== undefined && colFilter.value !== undefined) {
          applyFilterCondition(targets, col, colFilter.op, colFilter.value, meta);
        } else if (colFilter.from !== undefined || colFilter.to !== undefined) {
          applyFilterCondition(targets, col, colFilter.op || 'between', colFilter, meta);
        } else {
          for (const [op, val] of Object.entries(colFilter)) {
            applyFilterCondition(targets, col, op, val, meta);
          }
        }
      } else if (colFilter !== undefined && colFilter !== '') {
        applyFilterCondition(targets, col, 'eq', colFilter, meta);
      }
    }
  }

  // 2. Process top-level query parameters: ?price[gte]=100 or ?status=active
  for (const [key, value] of Object.entries(rawQuery)) {
    if (RESERVED_QUERY_KEYS.has(key) || key === 'filter') {
      continue;
    }
    if (hasColumns && !model.columns.has(key)) {
      continue;
    }
    const meta = hasColumns ? model.columns.get(key) : null;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [op, val] of Object.entries(value)) {
        applyFilterCondition(targets, key, op, val, meta);
      }
    } else if (value !== undefined && value !== '') {
      applyFilterCondition(targets, key, 'eq', value, meta);
    }
  }

  return { query: q, countQuery: c };
}

module.exports = {
  RESERVED_QUERY_KEYS,
  normalizeOperator,
  applyFilterCondition,
  buildFilteredQuery,
  applyColumnFilters,
};
