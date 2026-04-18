/**
 * Webspresso ORM - Query Builder
 * Fluent query builder wrapping Knex
 * @module core/orm/query-builder
 */

const { applyScopes, createScopeContext } = require('./scopes');
const { loadRelations } = require('./eager-loader');
const { ensureArray } = require('./utils');
const { ModelEvents, createEventContext, Hooks, HookCancellationError } = require('./events');
const {
  getJsonColumns,
  serializeJsonFields,
  deserializeJsonFields,
} = require('./json-fields');

/**
 * Create a new query builder
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {import('knex').Knex|import('knex').Knex.Transaction} knex - Knex instance or transaction
 * @param {import('./types').ScopeContext} [initialContext] - Initial scope context
 * @returns {QueryBuilder}
 */
function createQueryBuilder(model, knex, initialContext, cacheLayer = null) {
  return new QueryBuilder(model, knex, initialContext, cacheLayer);
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
   * @param {import('./cache/layer').OrmCacheLayer|null} [cacheLayer]
   */
  constructor(model, knex, initialContext, cacheLayer = null) {
    this.model = model;
    this.knex = knex;
    this.scopeContext = initialContext || createScopeContext();
    this.cacheLayer = cacheLayer;
    this.jsonColumns = getJsonColumns(model);

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
   * Add a raw WHERE clause
   * @param {string} sql - Raw SQL expression
   * @param {Array} [bindings=[]] - Parameter bindings
   * @returns {this}
   */
  whereRaw(sql, bindings = []) {
    this.state.wheres.push({
      raw: true,
      sql,
      bindings,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add a raw OR WHERE clause
   * @param {string} sql - Raw SQL expression
   * @param {Array} [bindings=[]] - Parameter bindings
   * @returns {this}
   */
  orWhereRaw(sql, bindings = []) {
    this.state.wheres.push({
      raw: true,
      sql,
      bindings,
      boolean: 'or',
    });
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
   * Transaction handle for lifecycle hooks (matches repository pattern)
   * @returns {import('knex').Knex.Transaction|null}
   */
  _hookTrx() {
    return this.knex.isTransaction ? this.knex : null;
  }

  /**
   * Build the Knex query
   * @param {Object} [options]
   * @param {boolean} [options.includeLimitOffset=true] - When false, omit LIMIT/OFFSET (for aggregates / pagination)
   * @returns {import('knex').Knex.QueryBuilder}
   */
  toKnex(options = {}) {
    const { includeLimitOffset = true } = options;
    let qb = this.knex(this.model.table);

    // Apply global scopes
    qb = applyScopes(qb, this.scopeContext, this.model);

    // Apply selects
    if (this.state.selects.length > 0) {
      qb = qb.select(this.state.selects);
    }

    // Apply wheres
    for (const where of this.state.wheres) {
      // Handle raw where clauses
      if (where.raw) {
        qb = where.boolean === 'or'
          ? qb.orWhereRaw(where.sql, where.bindings)
          : qb.whereRaw(where.sql, where.bindings);
        continue;
      }

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

    if (includeLimitOffset) {
      // Apply limit
      if (this.state.limitValue !== undefined) {
        qb = qb.limit(this.state.limitValue);
      }

      // Apply offset
      if (this.state.offsetValue !== undefined) {
        qb = qb.offset(this.state.offsetValue);
      }
    }

    return qb;
  }

  /**
   * Execute query and return first result
   * @returns {Promise<Object|null>}
   */
  async first() {
    const ctx = createEventContext(this.model.name, 'find', this._hookTrx());
    const self = this;

    async function loadFromDb() {
      await ModelEvents.emitAsync(self.model.name, Hooks.BEFORE_FIND, {}, ctx);
      if (ctx.isCancelled) {
        throw new HookCancellationError(ctx.cancelReason, self.model.name, Hooks.BEFORE_FIND);
      }

      const qb = self.toKnex().first();
      const result = await qb;
      if (!result) return null;

      deserializeJsonFields(result, self.jsonColumns);

      const withs = self.getWiths();
      if (withs.length > 0) {
        await loadRelations([result], ensureArray(withs), self.model, self.knex, self.scopeContext);
      }

      ModelEvents.emit(self.model.name, Hooks.AFTER_FIND, result, ctx);
      return result;
    }

    if (
      self.cacheLayer &&
      self.cacheLayer.strategyFor(self.model)
    ) {
      const strat = self.cacheLayer.strategyFor(self.model);
      const classification = self.cacheLayer.classifyQueryBuilder(self.model, self.state, 'first');
      if (!classification.cacheable) {
        self.cacheLayer.metrics.bypassed += 1;
        return loadFromDb();
      }
      const kind = classification.kind === 'pk' ? 'pk' : 'collection';
      const fingerprint = self.cacheLayer.queryBuilderFingerprint(
        self.model,
        self.scopeContext,
        self.state,
        'first'
      );
      const tags = self.cacheLayer.buildReadTags(
        self.model,
        strat,
        kind,
        classification.kind === 'pk' ? classification.pkValue : null
      );
      return self.cacheLayer.wrapRead(
        self.model,
        self.knex,
        self.scopeContext,
        fingerprint,
        tags,
        loadFromDb,
        (r) => r != null
      );
    }

    return loadFromDb();
  }

  /**
   * Execute query and return all results
   * @returns {Promise<Object[]>}
   */
  async list() {
    const ctx = createEventContext(this.model.name, 'find', this._hookTrx());
    const self = this;

    async function loadFromDb() {
      await ModelEvents.emitAsync(self.model.name, Hooks.BEFORE_FIND, {}, ctx);
      if (ctx.isCancelled) {
        throw new HookCancellationError(ctx.cancelReason, self.model.name, Hooks.BEFORE_FIND);
      }

      const results = await self.toKnex();

      for (const record of results) {
        deserializeJsonFields(record, self.jsonColumns);
      }

      const withs = self.getWiths();
      if (withs.length > 0 && results.length > 0) {
        await loadRelations(results, ensureArray(withs), self.model, self.knex, self.scopeContext);
      }

      for (const record of results) {
        ModelEvents.emit(self.model.name, Hooks.AFTER_FIND, record, ctx);
      }
      return results;
    }

    if (self.cacheLayer && self.cacheLayer.strategyFor(self.model)) {
      const strat = self.cacheLayer.strategyFor(self.model);
      const classification = self.cacheLayer.classifyQueryBuilder(self.model, self.state, 'list');
      if (!classification.cacheable) {
        self.cacheLayer.metrics.bypassed += 1;
        return loadFromDb();
      }
      const fingerprint = self.cacheLayer.queryBuilderFingerprint(
        self.model,
        self.scopeContext,
        self.state,
        'list'
      );
      const tags = self.cacheLayer.buildReadTags(self.model, strat, 'collection', null);
      return self.cacheLayer.wrapRead(
        self.model,
        self.knex,
        self.scopeContext,
        fingerprint,
        tags,
        loadFromDb,
        () => true
      );
    }

    return loadFromDb();
  }

  /**
   * Alias for list()
   * @returns {Promise<Object[]>}
   */
  async get() {
    return this.list();
  }

  /**
   * Execute query and return count
   * @returns {Promise<number>}
   */
  async count() {
    const self = this;

    async function loadFromDb() {
      const result = await self
        .toKnex({ includeLimitOffset: false })
        .count('* as count')
        .first();
      return parseInt(result?.count || 0, 10);
    }

    if (self.cacheLayer && self.cacheLayer.strategyFor(self.model)) {
      const strat = self.cacheLayer.strategyFor(self.model);
      const classification = self.cacheLayer.classifyQueryBuilder(self.model, self.state, 'count');
      if (!classification.cacheable) {
        self.cacheLayer.metrics.bypassed += 1;
        return loadFromDb();
      }
      const fingerprint = self.cacheLayer.queryBuilderFingerprint(
        self.model,
        self.scopeContext,
        self.state,
        'count'
      );
      const tags = self.cacheLayer.buildReadTags(self.model, strat, 'collection', null);
      return self.cacheLayer.wrapRead(
        self.model,
        self.knex,
        self.scopeContext,
        fingerprint,
        tags,
        loadFromDb,
        () => true
      );
    }

    return loadFromDb();
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
    const ctx = createEventContext(this.model.name, 'find', this._hookTrx());
    const self = this;

    async function loadFromDb() {
      await ModelEvents.emitAsync(self.model.name, Hooks.BEFORE_FIND, {}, ctx);
      if (ctx.isCancelled) {
        throw new HookCancellationError(ctx.cancelReason, self.model.name, Hooks.BEFORE_FIND);
      }

      const base = self.toKnex({ includeLimitOffset: false });

      const countResult = await base.clone().count('* as count').first();
      const total = parseInt(countResult?.count || 0, 10);

      const offset = (page - 1) * perPage;
      const data = await base.clone().limit(perPage).offset(offset);

      for (const record of data) {
        deserializeJsonFields(record, self.jsonColumns);
      }

      const withs = self.getWiths();
      if (withs.length > 0 && data.length > 0) {
        await loadRelations(data, ensureArray(withs), self.model, self.knex, self.scopeContext);
      }

      for (const record of data) {
        ModelEvents.emit(self.model.name, Hooks.AFTER_FIND, record, ctx);
      }

      return {
        data,
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      };
    }

    if (self.cacheLayer && self.cacheLayer.strategyFor(self.model)) {
      const strat = self.cacheLayer.strategyFor(self.model);
      const classification = self.cacheLayer.classifyQueryBuilder(self.model, self.state, 'paginate');
      if (!classification.cacheable) {
        self.cacheLayer.metrics.bypassed += 1;
        return loadFromDb();
      }
      const fingerprint = self.cacheLayer.queryBuilderFingerprint(
        self.model,
        self.scopeContext,
        self.state,
        'paginate',
        { page, perPage }
      );
      const tags = self.cacheLayer.buildReadTags(self.model, strat, 'collection', null);
      return self.cacheLayer.wrapRead(
        self.model,
        self.knex,
        self.scopeContext,
        fingerprint,
        tags,
        loadFromDb,
        () => true
      );
    }

    return loadFromDb();
  }

  /**
   * Delete matching records
   * @returns {Promise<number>} Number of deleted records
   */
  async delete() {
    const n = await this.toKnex().delete();
    if (this.cacheLayer && n > 0) {
      this.cacheLayer.invalidateModelAll(this.model);
    }
    return n;
  }

  /**
   * Update matching records
   * @param {Object} data - Data to update
   * @returns {Promise<number>} Number of updated records
   */
  async update(data) {
    const serialized = serializeJsonFields(data, this.jsonColumns);
    const n = await this.toKnex().update(serialized);
    if (this.cacheLayer && n > 0) {
      this.cacheLayer.invalidateModelAll(this.model);
    }
    return n;
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
    const cloned = new QueryBuilder(this.model, this.knex, { ...this.scopeContext }, this.cacheLayer);
    cloned.jsonColumns = this.jsonColumns;
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
