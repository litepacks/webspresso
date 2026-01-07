/**
 * Webspresso ORM - Query Builder
 * Fluent query builder wrapping Knex
 * @module core/orm/query-builder
 */

const { applyScopes, createScopeContext } = require('./scopes');

/**
 * Create a new query builder
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {import('knex').Knex|import('knex').Knex.Transaction} knex - Knex instance or transaction
 * @param {import('./types').ScopeContext} [initialContext] - Initial scope context
 * @returns {QueryBuilder}
 */
function createQueryBuilder(model, knex, initialContext) {
  return new QueryBuilder(model, knex, initialContext);
}

/**
 * QueryBuilder class
 * Provides a fluent interface for building SQL queries
 */
class QueryBuilder {
  /**
   * @param {import('./types').ModelDefinition} model
   * @param {import('knex').Knex|import('knex').Knex.Transaction} knex
   * @param {import('./types').ScopeContext} [initialContext]
   */
  constructor(model, knex, initialContext) {
    this.model = model;
    this.knex = knex;
    this.scopeContext = initialContext || createScopeContext();
    
    /** @type {import('./types').QueryState} */
    this.state = {
      wheres: [],
      orderBys: [],
      selects: [],
      withs: [],
      limitValue: undefined,
      offsetValue: undefined,
      scopeContext: this.scopeContext,
    };
  }

  /**
   * Select specific columns
   * @param {...string} columns - Columns to select
   * @returns {this}
   */
  select(...columns) {
    this.state.selects.push(...columns.flat());
    return this;
  }

  /**
   * Add a WHERE clause
   * @param {string|Object} columnOrConditions - Column name or conditions object
   * @param {string|*} [operatorOrValue] - Operator or value
   * @param {*} [value] - Value (if operator provided)
   * @returns {this}
   */
  where(columnOrConditions, operatorOrValue, value) {
    // Object form: where({ column: value, ... })
    if (typeof columnOrConditions === 'object' && columnOrConditions !== null) {
      for (const [col, val] of Object.entries(columnOrConditions)) {
        this.state.wheres.push({
          column: col,
          operator: '=',
          value: val,
          boolean: 'and',
        });
      }
      return this;
    }

    // Three-argument form: where('column', '>', value)
    if (value !== undefined) {
      this.state.wheres.push({
        column: columnOrConditions,
        operator: operatorOrValue,
        value,
        boolean: 'and',
      });
      return this;
    }

    // Two-argument form: where('column', value)
    this.state.wheres.push({
      column: columnOrConditions,
      operator: '=',
      value: operatorOrValue,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add an OR WHERE clause
   * @param {string|Object} columnOrConditions
   * @param {string|*} [operatorOrValue]
   * @param {*} [value]
   * @returns {this}
   */
  orWhere(columnOrConditions, operatorOrValue, value) {
    const startIndex = this.state.wheres.length;
    this.where(columnOrConditions, operatorOrValue, value);
    
    // Mark the new clauses as OR
    for (let i = startIndex; i < this.state.wheres.length; i++) {
      this.state.wheres[i].boolean = 'or';
    }
    return this;
  }

  /**
   * Add a WHERE IN clause
   * @param {string} column - Column name
   * @param {Array} values - Values array
   * @returns {this}
   */
  whereIn(column, values) {
    this.state.wheres.push({
      column,
      operator: 'in',
      value: values,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add a WHERE NOT IN clause
   * @param {string} column - Column name
   * @param {Array} values - Values array
   * @returns {this}
   */
  whereNotIn(column, values) {
    this.state.wheres.push({
      column,
      operator: 'not in',
      value: values,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add a WHERE NULL clause
   * @param {string} column - Column name
   * @returns {this}
   */
  whereNull(column) {
    this.state.wheres.push({
      column,
      operator: 'is null',
      value: null,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add a WHERE NOT NULL clause
   * @param {string} column - Column name
   * @returns {this}
   */
  whereNotNull(column) {
    this.state.wheres.push({
      column,
      operator: 'is not null',
      value: null,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add ORDER BY clause
   * @param {string} column - Column name
   * @param {'asc'|'desc'} [direction='asc'] - Sort direction
   * @returns {this}
   */
  orderBy(column, direction = 'asc') {
    this.state.orderBys.push({ column, direction });
    return this;
  }

  /**
   * Set LIMIT
   * @param {number} limit - Limit value
   * @returns {this}
   */
  limit(limit) {
    this.state.limitValue = limit;
    return this;
  }

  /**
   * Set OFFSET
   * @param {number} offset - Offset value
   * @returns {this}
   */
  offset(offset) {
    this.state.offsetValue = offset;
    return this;
  }

  /**
   * Add relations to eager load
   * @param {...string} relations - Relation names
   * @returns {this}
   */
  with(...relations) {
    this.state.withs.push(...relations.flat());
    return this;
  }

  /**
   * Include soft-deleted records
   * @returns {this}
   */
  withTrashed() {
    this.scopeContext.withTrashed = true;
    return this;
  }

  /**
   * Only include soft-deleted records
   * @returns {this}
   */
  onlyTrashed() {
    this.scopeContext.onlyTrashed = true;
    return this;
  }

  /**
   * Set tenant context
   * @param {*} tenantId - Tenant ID
   * @returns {this}
   */
  forTenant(tenantId) {
    this.scopeContext.tenantId = tenantId;
    return this;
  }

  /**
   * Build the Knex query
   * @returns {import('knex').Knex.QueryBuilder}
   */
  toKnex() {
    let qb = this.knex(this.model.table);

    // Apply global scopes
    qb = applyScopes(qb, this.scopeContext, this.model);

    // Apply selects
    if (this.state.selects.length > 0) {
      qb = qb.select(this.state.selects);
    }

    // Apply wheres
    for (const where of this.state.wheres) {
      const method = where.boolean === 'or' ? 'orWhere' : 'where';
      
      switch (where.operator) {
        case 'in':
          qb = where.boolean === 'or' 
            ? qb.orWhereIn(where.column, where.value)
            : qb.whereIn(where.column, where.value);
          break;
        case 'not in':
          qb = where.boolean === 'or'
            ? qb.orWhereNotIn(where.column, where.value)
            : qb.whereNotIn(where.column, where.value);
          break;
        case 'is null':
          qb = where.boolean === 'or'
            ? qb.orWhereNull(where.column)
            : qb.whereNull(where.column);
          break;
        case 'is not null':
          qb = where.boolean === 'or'
            ? qb.orWhereNotNull(where.column)
            : qb.whereNotNull(where.column);
          break;
        default:
          qb = qb[method](where.column, where.operator, where.value);
      }
    }

    // Apply order by
    for (const orderBy of this.state.orderBys) {
      qb = qb.orderBy(orderBy.column, orderBy.direction);
    }

    // Apply limit
    if (this.state.limitValue !== undefined) {
      qb = qb.limit(this.state.limitValue);
    }

    // Apply offset
    if (this.state.offsetValue !== undefined) {
      qb = qb.offset(this.state.offsetValue);
    }

    return qb;
  }

  /**
   * Execute query and return first result
   * @returns {Promise<Object|null>}
   */
  async first() {
    const qb = this.toKnex().first();
    const result = await qb;
    return result || null;
  }

  /**
   * Execute query and return all results
   * @returns {Promise<Object[]>}
   */
  async list() {
    return this.toKnex();
  }

  /**
   * Execute query and return count
   * @returns {Promise<number>}
   */
  async count() {
    const result = await this.toKnex().count('* as count').first();
    return parseInt(result?.count || 0, 10);
  }

  /**
   * Check if any records exist
   * @returns {Promise<boolean>}
   */
  async exists() {
    const count = await this.count();
    return count > 0;
  }

  /**
   * Execute query with pagination
   * @param {number} [page=1] - Page number (1-indexed)
   * @param {number} [perPage=15] - Items per page
   * @returns {Promise<import('./types').PaginatedResult>}
   */
  async paginate(page = 1, perPage = 15) {
    // Clone state for count query
    const countQb = this.toKnex().clone();
    
    // Get total count
    const countResult = await countQb.count('* as count').first();
    const total = parseInt(countResult?.count || 0, 10);

    // Get paginated data
    const offset = (page - 1) * perPage;
    const data = await this.toKnex().limit(perPage).offset(offset);

    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  /**
   * Delete matching records
   * @returns {Promise<number>} Number of deleted records
   */
  async delete() {
    return this.toKnex().delete();
  }

  /**
   * Update matching records
   * @param {Object} data - Data to update
   * @returns {Promise<number>} Number of updated records
   */
  async update(data) {
    return this.toKnex().update(data);
  }

  /**
   * Get the relations to eager load
   * @returns {string[]}
   */
  getWiths() {
    return [...this.state.withs];
  }

  /**
   * Get the current scope context
   * @returns {import('./types').ScopeContext}
   */
  getScopeContext() {
    return { ...this.scopeContext };
  }

  /**
   * Clone the query builder
   * @returns {QueryBuilder}
   */
  clone() {
    const cloned = new QueryBuilder(this.model, this.knex, { ...this.scopeContext });
    cloned.state = {
      wheres: [...this.state.wheres],
      orderBys: [...this.state.orderBys],
      selects: [...this.state.selects],
      withs: [...this.state.withs],
      limitValue: this.state.limitValue,
      offsetValue: this.state.offsetValue,
      scopeContext: { ...this.state.scopeContext },
    };
    return cloned;
  }
}

module.exports = {
  createQueryBuilder,
  QueryBuilder,
};

