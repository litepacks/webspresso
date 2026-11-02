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
const { getAmbientTransaction } = require('./transaction');
const { validateQueryComplexity } = require('./complexity');
const { buildSearchClause } = require('./search');

/**
 * Create a new query builder
 * @param {import('./types').ModelDefinition} model - Model definition
 * @param {import('knex').Knex|import('knex').Knex.Transaction} knex - Knex instance or transaction
 * @param {import('./types').ScopeContext} [initialContext] - Initial scope context
 * @returns {QueryBuilder}
 */
const { applyHiddenSerialization } = require('./hidden');

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
    this.scopeContext = initialContext ? { ...initialContext } : createScopeContext();
    this.cacheLayer = cacheLayer;
    this.jsonColumns = getJsonColumns(model);

    /** @type {import('./types').QueryState} */
    this.state = {
      wheres: [],
      orderBys: [],
      groupBys: [],
      havings: [],
      distinct: false,
      distinctColumns: [],
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
   * Set DISTINCT on the query
   * @param {...string} [columns] - Optional specific columns for distinct
   * @returns {this}
   */
  distinct(...columns) {
    this.state.distinct = true;
    const flat = columns.flat().filter(Boolean);
    if (flat.length > 0) {
      this.state.distinctColumns.push(...flat);
    }
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
      for (const col of Object.keys(columnOrConditions)) {
        this.state.wheres.push({
          column: col,
          operator: '=',
          value: columnOrConditions[col],
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
   * Add a WHERE NOT clause (col != val or multiple columns)
   * @param {string|Object} column - Column name or object of { col: val }
   * @param {*} [value] - Value to compare against
   * @returns {this}
   */
  whereNot(column, value) {
    if (typeof column === 'object' && column !== null) {
      for (const [col, val] of Object.entries(column)) {
        this.where(col, '!=', val);
      }
      return this;
    }
    return this.where(column, '!=', value);
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
   * Add an OR WHERE NULL clause
   * @param {string} column - Column name
   * @returns {this}
   */
  orWhereNull(column) {
    this.state.wheres.push({
      column,
      operator: 'is null',
      value: null,
      boolean: 'or',
    });
    return this;
  }

  /**
   * Add an OR WHERE NOT NULL clause
   * @param {string} column - Column name
   * @returns {this}
   */
  orWhereNotNull(column) {
    this.state.wheres.push({
      column,
      operator: 'is not null',
      value: null,
      boolean: 'or',
    });
    return this;
  }

  /**
   * Add an OR WHERE IN clause
   * @param {string} column - Column name
   * @param {Array} values - Values array
   * @returns {this}
   */
  orWhereIn(column, values) {
    this.state.wheres.push({
      column,
      operator: 'in',
      value: values,
      boolean: 'or',
    });
    return this;
  }

  /**
   * Add an OR WHERE NOT IN clause
   * @param {string} column - Column name
   * @param {Array} values - Values array
   * @returns {this}
   */
  orWhereNotIn(column, values) {
    this.state.wheres.push({
      column,
      operator: 'not in',
      value: values,
      boolean: 'or',
    });
    return this;
  }

  /**
   * Add an OR WHERE NOT clause
   * @param {string|Object} column - Column name or object of { col: val }
   * @param {*} [value] - Value to compare against
   * @returns {this}
   */
  orWhereNot(column, value) {
    const startIndex = this.state.wheres.length;
    this.whereNot(column, value);
    for (let i = startIndex; i < this.state.wheres.length; i++) {
      this.state.wheres[i].boolean = 'or';
    }
    return this;
  }

  /**
   * Add a WHERE BETWEEN clause
   * @param {string} column - Column name
   * @param {[any, any]|Array} range - [min, max] values
   * @returns {this}
   */
  whereBetween(column, range) {
    this.state.wheres.push({
      column,
      operator: 'between',
      value: range,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add an OR WHERE BETWEEN clause
   * @param {string} column - Column name
   * @param {[any, any]|Array} range - [min, max] values
   * @returns {this}
   */
  orWhereBetween(column, range) {
    this.state.wheres.push({
      column,
      operator: 'between',
      value: range,
      boolean: 'or',
    });
    return this;
  }

  /**
   * Add a WHERE NOT BETWEEN clause
   * @param {string} column - Column name
   * @param {[any, any]|Array} range - [min, max] values
   * @returns {this}
   */
  whereNotBetween(column, range) {
    this.state.wheres.push({
      column,
      operator: 'not between',
      value: range,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add an OR WHERE NOT BETWEEN clause
   * @param {string} column - Column name
   * @param {[any, any]|Array} range - [min, max] values
   * @returns {this}
   */
  orWhereNotBetween(column, range) {
    this.state.wheres.push({
      column,
      operator: 'not between',
      value: range,
      boolean: 'or',
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
   * Add a raw ORDER BY clause
   * @param {string} sql - Raw SQL expression
   * @param {Array} [bindings=[]] - Parameter bindings
   * @returns {this}
   */
  orderByRaw(sql, bindings = []) {
    this.state.orderBys.push({ raw: true, sql, bindings });
    return this;
  }

  /**
   * Add a GROUP BY clause
   * @param {...string} columns - Column names to group by
   * @returns {this}
   */
  groupBy(...columns) {
    const flat = columns.flat().filter(Boolean);
    if (flat.length > 0) {
      this.state.groupBys.push({ columns: flat });
    }
    return this;
  }

  /**
   * Add a raw GROUP BY clause
   * @param {string} sql - Raw SQL expression
   * @param {Array} [bindings=[]] - Parameter bindings
   * @returns {this}
   */
  groupByRaw(sql, bindings = []) {
    this.state.groupBys.push({ raw: true, sql, bindings });
    return this;
  }

  /**
   * Add a HAVING clause
   * @param {string} column - Column name or aggregate expression
   * @param {string|*} [operatorOrValue] - Operator or value
   * @param {*} [value] - Value (if operator provided)
   * @returns {this}
   */
  having(column, operatorOrValue, value) {
    if (value !== undefined) {
      this.state.havings.push({
        column,
        operator: operatorOrValue,
        value,
        boolean: 'and',
      });
      return this;
    }
    this.state.havings.push({
      column,
      operator: '=',
      value: operatorOrValue,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add an OR HAVING clause
   * @param {string} column
   * @param {string|*} [operatorOrValue]
   * @param {*} [value]
   * @returns {this}
   */
  orHaving(column, operatorOrValue, value) {
    const startIndex = this.state.havings.length;
    this.having(column, operatorOrValue, value);
    for (let i = startIndex; i < this.state.havings.length; i++) {
      this.state.havings[i].boolean = 'or';
    }
    return this;
  }

  /**
   * Add a raw HAVING clause
   * @param {string} sql - Raw SQL expression
   * @param {Array} [bindings=[]] - Parameter bindings
   * @returns {this}
   */
  havingRaw(sql, bindings = []) {
    this.state.havings.push({
      raw: true,
      sql,
      bindings,
      boolean: 'and',
    });
    return this;
  }

  /**
   * Add an OR raw HAVING clause
   * @param {string} sql - Raw SQL expression
   * @param {Array} [bindings=[]] - Parameter bindings
   * @returns {this}
   */
  orHavingRaw(sql, bindings = []) {
    this.state.havings.push({
      raw: true,
      sql,
      bindings,
      boolean: 'or',
    });
    return this;
  }

  /**
   * Full-Text / Keyword Search across columns
   * Supports SQLite, PostgreSQL, and MySQL with dialect-aware FTS and tokenized LIKE fallback
   * @param {string} term - Search query string
   * @param {string|string[]} [columns] - Columns to search (defaults to model.searchable)
   * @param {Object} [options] - Search options
   * @param {'auto'|'fts'|'like'} [options.mode='auto'] - Search mode
   * @param {string} [options.language='english'] - PostgreSQL text search language
   * @param {boolean} [options.matchAllWords=true] - Require all words to match (AND)
   * @param {boolean} [options.exact=false] - Match exact phrase
   * @param {boolean} [options.rank=false] - Order by relevance rank (Postgres)
   * @param {string} [options.ftsTable] - Separate SQLite FTS virtual table name
   * @returns {this}
   */
  search(term, columns, options = {}) {
    const activeKnex = this.getActiveKnex();
    const clause = buildSearchClause({
      knex: activeKnex,
      model: this.model,
      term,
      columns,
      options,
    });

    if (!clause) {
      return this;
    }

    this.state.wheres.push({
      raw: true,
      sql: clause.sql,
      bindings: clause.bindings,
      boolean: clause.boolean || 'and',
    });

    if (clause.rankClause) {
      this.orderByRaw(clause.rankClause.sql, clause.rankClause.bindings);
    }

    return this;
  }

  /**
   * Add an OR Full-Text / Keyword Search clause
   * @param {string} term - Search query string
   * @param {string|string[]} [columns] - Columns to search
   * @param {Object} [options] - Search options
   * @returns {this}
   */
  orSearch(term, columns, options = {}) {
    return this.search(term, columns, { ...options, boolean: 'or' });
  }

  /**
   * Set LIMIT
   * @param {number} limit - Limit value
   * @returns {this}
   */
  limit(limit) {
    const validated = validateQueryComplexity(this.model, { limit });
    this.state.limitValue = validated.limit;
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
    const flat = relations.flat();
    const validated = validateQueryComplexity(this.model, { includes: [...this.state.withs, ...flat] });
    this.state.withs = validated.includes;
    return this;
  }

  /**
   * Add relations to eager load (alias for with)
   * @param {...string} relations - Relation names or nested paths (e.g. 'author.profile')
   * @returns {this}
   */
  include(...relations) {
    return this.with(...relations);
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
   * Set authenticated user context for RLS
   * @param {Object|null} user - User object
   * @returns {this}
   */
  forUser(user) {
    this.scopeContext.user = user;
    return this;
  }

  /**
   * Bypass Row Level Security on this query
   * @returns {this}
   */
  withoutRls() {
    this.scopeContext.rlsDisabled = true;
    return this;
  }

  /**
   * Apply custom scope context
   * @param {Object} customContext
   * @returns {this}
   */
  withContext(customContext) {
    Object.assign(this.scopeContext, customContext);
    return this;
  }

  /**
   * Explicitly set action mode for RLS
   * @param {'read'|'update'|'delete'|'create'} action
   * @returns {this}
   */
  asAction(action) {
    this.action = action;
    return this;
  }

  /**
   * Resolve active Knex instance (explicit or ambient transaction)
   * @returns {import('knex').Knex|import('knex').Knex.Transaction}
   */
  getActiveKnex() {
    if (this.knex && (this.knex.isTransaction || typeof this.knex.commit === 'function')) {
      if (typeof this.knex.isCompleted === 'function' && this.knex.isCompleted()) {
        const ambientTrx = getAmbientTransaction();
        if (ambientTrx) return ambientTrx;
        return this.knex;
      }
      return this.knex;
    }
    const ambientTrx = getAmbientTransaction();
    if (ambientTrx) {
      return ambientTrx;
    }
    return this.knex;
  }

  /**
   * Transaction handle for lifecycle hooks (matches repository pattern)
   * @returns {import('knex').Knex.Transaction|null}
   */
  _hookTrx() {
    const active = this.getActiveKnex();
    if (!active) return null;
    if (active.isTransaction || typeof active.commit === 'function') {
      if (typeof active.isCompleted === 'function' && active.isCompleted()) {
        return null;
      }
      return active;
    }
    return null;
  }

  /**
   * Build the Knex query
   * @param {Object} [options]
   * @param {boolean} [options.includeLimitOffset=true] - When false, omit LIMIT/OFFSET (for aggregates / pagination)
   * @returns {import('knex').Knex.QueryBuilder}
   */
  toKnex(options = {}) {
    const {
      includeLimitOffset = true,
      includeOrderBy = true,
      includeSelect = true,
      action = this.action || 'read',
      mutationData = null,
    } = options;
    const activeKnex = this.getActiveKnex();
    let qb = activeKnex(this.model.table);

    // Apply global scopes (soft delete, multi-tenant, RLS)
    qb = applyScopes(qb, this.scopeContext, this.model, action, mutationData);

    // Apply selects
    if (includeSelect && this.state.selects.length > 0) {
      qb = qb.select(this.state.selects);
    }

    // Apply distinct
    if (this.state.distinct) {
      if (this.state.distinctColumns && this.state.distinctColumns.length > 0) {
        qb = qb.distinct(...this.state.distinctColumns);
      } else {
        qb = qb.distinct();
      }
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
        case 'between':
          qb = where.boolean === 'or'
            ? qb.orWhereBetween(where.column, where.value)
            : qb.whereBetween(where.column, where.value);
          break;
        case 'not between':
          qb = where.boolean === 'or'
            ? qb.orWhereNotBetween(where.column, where.value)
            : qb.whereNotBetween(where.column, where.value);
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

    // Apply group by
    if (this.state.groupBys && this.state.groupBys.length > 0) {
      for (const groupBy of this.state.groupBys) {
        if (groupBy.raw) {
          qb = qb.groupByRaw(groupBy.sql, groupBy.bindings);
        } else {
          qb = qb.groupBy(...groupBy.columns);
        }
      }
    }

    // Apply havings
    if (this.state.havings && this.state.havings.length > 0) {
      for (const having of this.state.havings) {
        if (having.raw) {
          qb = having.boolean === 'or'
            ? qb.orHavingRaw(having.sql, having.bindings)
            : qb.havingRaw(having.sql, having.bindings);
        } else {
          const method = having.boolean === 'or' ? 'orHaving' : 'having';
          qb = qb[method](having.column, having.operator, having.value);
        }
      }
    }

    // Apply order by
    if (includeOrderBy) {
      for (const orderBy of this.state.orderBys) {
        if (orderBy.raw) {
          qb = qb.orderByRaw(orderBy.sql, orderBy.bindings);
        } else {
          qb = qb.orderBy(orderBy.column, orderBy.direction);
        }
      }
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
   * Compile the query to a SQL string and parameter bindings
   * @param {Object} [options]
   * @returns {{ sql: string, bindings: Array<any>, method: string }}
   */
  toSQL(options = {}) {
    return this.toKnex(options).toSQL();
  }

  /**
   * Execute query and return first result
   * @returns {Promise<Object|null>}
   */
  async first() {
    const shouldEmit = (
      ModelEvents.hasListeners(this.model.name, Hooks.BEFORE_FIND) ||
      ModelEvents.hasListeners(this.model.name, Hooks.AFTER_FIND)
    );
    const ctx = shouldEmit ? createEventContext(this.model.name, 'find', this._hookTrx()) : null;
    const self = this;

    async function loadFromDb() {
      if (shouldEmit) {
        await ModelEvents.emitAsync(self.model.name, Hooks.BEFORE_FIND, {}, ctx);
        if (ctx.isCancelled) {
          throw new HookCancellationError(ctx.cancelReason, self.model.name, Hooks.BEFORE_FIND);
        }
      }

      const qb = self.toKnex().first();
      const result = await qb;
      if (!result) return null;

      if (self.jsonColumns.size > 0) {
        deserializeJsonFields(result, self.jsonColumns);
      }

      const withs = self.getWiths();
      if (withs.length > 0) {
        await loadRelations([result], ensureArray(withs), self.model, self.getActiveKnex(), self.scopeContext);
      }

      if (shouldEmit) {
        ModelEvents.emit(self.model.name, Hooks.AFTER_FIND, result, ctx);
      }
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
    const shouldEmit = (
      ModelEvents.hasListeners(this.model.name, Hooks.BEFORE_FIND) ||
      ModelEvents.hasListeners(this.model.name, Hooks.AFTER_FIND)
    );
    const ctx = shouldEmit ? createEventContext(this.model.name, 'find', this._hookTrx()) : null;
    const self = this;

    async function loadFromDb() {
      if (shouldEmit) {
        await ModelEvents.emitAsync(self.model.name, Hooks.BEFORE_FIND, {}, ctx);
        if (ctx.isCancelled) {
          throw new HookCancellationError(ctx.cancelReason, self.model.name, Hooks.BEFORE_FIND);
        }
      }

      const results = await self.toKnex();

      if (self.jsonColumns.size > 0) {
        for (const record of results) {
          deserializeJsonFields(record, self.jsonColumns);
        }
      }

      const withs = self.getWiths();
      if (withs.length > 0 && results.length > 0) {
        await loadRelations(results, ensureArray(withs), self.model, self.getActiveKnex(), self.scopeContext);
      }

      if (shouldEmit) {
        for (const record of results) {
          ModelEvents.emit(self.model.name, Hooks.AFTER_FIND, record, ctx);
        }
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
   * Alias for list()
   * @returns {Promise<Object[]>}
   */
  async find() {
    return this.list();
  }

  /**
   * Execute query and return count
   * @returns {Promise<number>}
   */
  async count() {
    const self = this;

    async function loadFromDb() {
      const baseKnex = self
        .toKnex({ includeLimitOffset: false, includeOrderBy: false, includeSelect: false });

      if (self.state.groupBys && self.state.groupBys.length > 0) {
        const result = await self.knex.from(baseKnex.as('grouped_subquery')).count('* as count').first();
        return parseInt(result?.count || 0, 10);
      }

      const result = await baseKnex
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
    // Object form: paginate({ page, perPage }) or paginate({ page, limit })
    if (page && typeof page === 'object') {
      const opts = page;
      page = opts.page ?? 1;
      perPage = opts.perPage ?? opts.limit ?? 15;
    }
    const validated = validateQueryComplexity(this.model, { perPage });
    perPage = validated.perPage;
    page = Math.max(1, parseInt(page, 10) || 1);

    const shouldEmit = (
      ModelEvents.hasListeners(this.model.name, Hooks.BEFORE_FIND) ||
      ModelEvents.hasListeners(this.model.name, Hooks.AFTER_FIND)
    );
    const ctx = shouldEmit ? createEventContext(this.model.name, 'find', this._hookTrx()) : null;
    const self = this;

    async function loadFromDb() {
      if (shouldEmit) {
        await ModelEvents.emitAsync(self.model.name, Hooks.BEFORE_FIND, {}, ctx);
        if (ctx.isCancelled) {
          throw new HookCancellationError(ctx.cancelReason, self.model.name, Hooks.BEFORE_FIND);
        }
      }

      const offset = (page - 1) * perPage;

      // Execute count query (without ORDER BY, LIMIT, OFFSET, or SELECT projections)
      // and data query (with pagination) in parallel to halve database latency
      const baseCountKnex = self
        .toKnex({ includeLimitOffset: false, includeOrderBy: false, includeSelect: false });

      const countPromise = (self.state.groupBys && self.state.groupBys.length > 0)
        ? self.knex.from(baseCountKnex.as('grouped_subquery')).count('* as count').first()
        : baseCountKnex.count('* as count').first();

      const dataPromise = self
        .toKnex({ includeLimitOffset: false })
        .limit(perPage)
        .offset(offset);

      const [countResult, rawData] = await Promise.all([countPromise, dataPromise]);
      const total = parseInt(countResult?.count || 0, 10);
      const data = total === 0 ? [] : rawData;

      if (data.length > 0 && self.jsonColumns.size > 0) {
        for (const record of data) {
          deserializeJsonFields(record, self.jsonColumns);
        }
      }

      const withs = self.getWiths();
      if (withs.length > 0 && data.length > 0) {
        await loadRelations(data, ensureArray(withs), self.model, self.getActiveKnex(), self.scopeContext);
      }

      if (shouldEmit && data.length > 0) {
        for (const record of data) {
          ModelEvents.emit(self.model.name, Hooks.AFTER_FIND, record, ctx);
        }
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
    const n = await this.toKnex({ action: 'delete' }).delete();
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
    const { checkUpdateRls } = require('./scopes');
    checkUpdateRls(data, this.scopeContext, this.model);
    const serialized = serializeJsonFields(data, this.jsonColumns);
    const n = await this.toKnex({ action: 'update', mutationData: data }).update(serialized);
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
    cloned.action = this.action;
    cloned.state = {
      wheres: this.state.wheres.map(w => ({ ...w })),
      orderBys: this.state.orderBys.map(o => ({ ...o })),
      groupBys: this.state.groupBys.map(g => ({
        ...g,
        columns: g.columns ? [...g.columns] : undefined,
        bindings: g.bindings ? [...g.bindings] : undefined,
      })),
      havings: this.state.havings.map(h => ({
        ...h,
        bindings: h.bindings ? [...h.bindings] : undefined,
      })),
      distinct: this.state.distinct,
      distinctColumns: [...(this.state.distinctColumns || [])],
      selects: [...this.state.selects],
      withs: [...this.state.withs],
      limitValue: this.state.limitValue,
      offsetValue: this.state.offsetValue,
      scopeContext: cloned.scopeContext,
    };
    return cloned;
  }
}

// Results returned to callers serialize without the model's hidden columns (see ./hidden)
for (const method of ['first', 'list', 'paginate']) {
  const original = QueryBuilder.prototype[method];
  QueryBuilder.prototype[method] = async function hiddenAwareResult(...args) {
    return applyHiddenSerialization(this.model, await original.apply(this, args));
  };
}

module.exports = {
  createQueryBuilder,
  QueryBuilder,
};
