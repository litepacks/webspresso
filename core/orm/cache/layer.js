/**
 * ORM cache orchestration: metrics, strategy, read wrapper, invalidation helpers
 * @module core/orm/cache/layer
 */

const { hashKey, serializeWheres } = require('./fingerprint');

/**
 * @param {*} knex
 */
function isTransactionKnex(knex) {
  return !!(knex && knex.isTransaction);
}

/**
 * @param {import('../model').ModelDefinition} model
 * @returns {'auto'|'smart'|null}
 */
function modelCacheStrategy(model, defaultStrategy) {
  const c = model.cache;
  if (c === false || c === undefined || c === null) return null;
  if (c === true) return defaultStrategy;
  if (c === 'auto' || c === 'smart') return c;
  if (typeof c === 'object' && c.strategy) {
    return c.strategy === 'smart' ? 'smart' : 'auto';
  }
  return defaultStrategy;
}

function cloneForCache(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

class OrmCacheLayer {
  /**
   * @param {import('./types').CacheProvider} provider
   * @param {object} [options]
   * @param {'auto'|'smart'} [options.defaultStrategy='auto']
   */
  constructor(provider, options = {}) {
    this.provider = provider;
    this.providerKind = options.providerKind || 'memory';
    this.defaultStrategy = options.defaultStrategy || 'auto';
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0,
      bypassed: 0,
    };
  }

  /**
   * @param {import('../model').ModelDefinition} model
   */
  strategyFor(model) {
    return modelCacheStrategy(model, this.defaultStrategy);
  }

  /**
   * @param {import('../model').ModelDefinition} model
   * @param {*} knex
   */
  shouldBypassRead(model, knex) {
    if (!this.provider) return true;
    if (!this.strategyFor(model)) return true;
    if (isTransactionKnex(knex)) return true;
    return false;
  }

  resetMetrics() {
    this.metrics.hits = 0;
    this.metrics.misses = 0;
    this.metrics.sets = 0;
    this.metrics.invalidations = 0;
    this.metrics.bypassed = 0;
  }

  getMetrics() {
    const { entries, tags } = this.provider.getSizeStats();
    const { hits, misses, sets, invalidations, bypassed } = this.metrics;
    const lookups = hits + misses;
    const hitRate = lookups > 0 ? hits / lookups : null;
    return {
      hits,
      misses,
      sets,
      invalidations,
      bypassed,
      hitRate,
      approxKeys: entries,
      approxTags: tags,
      enabled: true,
      providerKind: this.providerKind,
    };
  }

  invalidateTags(tags) {
    const uniq = [...new Set(tags.filter(Boolean))];
    if (uniq.length === 0) return;
    this.provider.invalidateTags(uniq);
    this.metrics.invalidations += 1;
  }

  purge() {
    this.provider.clear();
  }

  /**
   * @param {import('../model').ModelDefinition} model
   * @param {import('../types').ScopeContext} scopeContext
   * @param {string} fingerprintKey
   * @param {string[]} tags
   * @param {() => Promise<*>} executor
   * @param {(*)=>boolean} [shouldCache]
   */
  async wrapRead(model, knex, scopeContext, fingerprintKey, tags, executor, shouldCache = () => true) {
    if (this.shouldBypassRead(model, knex)) {
      this.metrics.bypassed += 1;
      return executor();
    }

    const cached = this.provider.get(fingerprintKey);
    if (cached !== undefined) {
      this.metrics.hits += 1;
      return cloneForCache(cached);
    }

    this.metrics.misses += 1;
    const result = await executor();

    if (shouldCache(result)) {
      this.provider.set(fingerprintKey, cloneForCache(result), { tags });
      this.metrics.sets += 1;
    }

    return result;
  }

  /**
   * Deferred invalidation after Knex transaction commit
   * @param {*} ctxTrx - createEventContext trx
   * @param {string[]} tags
   */
  scheduleInvalidate(ctxTrx, tags) {
    const uniq = [...new Set(tags.filter(Boolean))];
    if (uniq.length === 0) return;

    if (!ctxTrx) {
      this.invalidateTags(uniq);
      return;
    }

    const p = ctxTrx.executionPromise;
    if (p && typeof p.then === 'function') {
      p.then(() => {
        this.invalidateTags(uniq);
      }).catch(() => {});
    } else {
      this.invalidateTags(uniq);
    }
  }

  /**
   * Build tags for a read operation
   * @param {import('../model').ModelDefinition} model
   * @param {'auto'|'smart'} strategy
   * @param {'pk'|'collection'} kind
   * @param {string|number|null} [pkValue]
   */
  buildReadTags(model, strategy, kind, pkValue) {
    const base = [`model:${model.name}`, `table:${model.table}`];
    if (strategy === 'auto') return base;
    if (kind === 'pk' && pkValue != null) {
      return [...base, `pk:${model.name}:${pkValue}`];
    }
    return [...base, `q:${model.name}`];
  }

  /**
   * Classify query builder state for smart caching
   * @param {import('../model').ModelDefinition} model
   * @param {import('../types').QueryState} state
   * @param {'first'|'list'|'count'|'paginate'} op
   */
  classifyQueryBuilder(model, state, op) {
    const hasRaw = state.wheres.some((w) => w.raw);
    if (hasRaw) return { cacheable: false, kind: 'collection' };

    if (state.withs.length > 0) return { cacheable: true, kind: 'collection' };

    if (op === 'count' || op === 'paginate' || op === 'list') {
      return { cacheable: true, kind: 'collection' };
    }

    // first()
    if (state.wheres.length !== 1) return { cacheable: true, kind: 'collection' };

    const w = state.wheres[0];
    if (w.raw || w.boolean === 'or') return { cacheable: true, kind: 'collection' };
    if (w.column !== model.primaryKey || w.operator !== '=') {
      return { cacheable: true, kind: 'collection' };
    }

    return { cacheable: true, kind: 'pk', pkValue: w.value };
  }

  /**
   * @param {import('../model').ModelDefinition} model
   * @param {import('../types').ScopeContext} scopeContext
   * @param {import('../types').QueryState} state
   * @param {'first'|'list'|'count'|'paginate'} op
   * @param {object} [extra] e.g. { page, perPage } for paginate
   */
  queryBuilderFingerprint(model, scopeContext, state, op, extra = {}) {
    return hashKey(model, scopeContext, {
      op,
      selects: [...state.selects].sort(),
      wheres: serializeWheres(state.wheres),
      orderBys: state.orderBys,
      limit: state.limitValue,
      offset: state.offsetValue,
      withs: [...state.withs].sort(),
      extra,
    });
  }

  /**
   * @param {import('../model').ModelDefinition} model
   * @param {import('../types').ScopeContext} scopeContext
   * @param {string|number} id
   * @param {string[]} [select]
   * @param {string[]} [withs]
   */
  findByIdFingerprint(model, scopeContext, id, select = [], withs = []) {
    return hashKey(model, scopeContext, {
      op: 'findById',
      id: String(id),
      select: [...select].sort(),
      withs: [...withs].sort(),
    });
  }

  /**
   * @param {import('../model').ModelDefinition} model
   * @param {import('../types').ScopeContext} scopeContext
   * @param {Record<string, *>} conditions
   * @param {string[]} [select]
   * @param {string[]} [withs]
   */
  findOneFingerprint(model, scopeContext, conditions, select = [], withs = []) {
    return hashKey(model, scopeContext, {
      op: 'findOne',
      conditions: Object.keys(conditions)
        .sort()
        .reduce((acc, k) => {
          acc[k] = conditions[k];
          return acc;
        }, {}),
      select: [...select].sort(),
      withs: [...withs].sort(),
    });
  }

  /**
   * @param {import('../model').ModelDefinition} model
   * @param {import('../types').ScopeContext} scopeContext
   * @param {string[]} [select]
   */
  findAllFingerprint(model, scopeContext, select = []) {
    return hashKey(model, scopeContext, {
      op: 'findAll',
      select: [...select].sort(),
    });
  }

  /**
   * Conservative invalidation for a model (auto-equivalent)
   * @param {import('../model').ModelDefinition} model
   */
  invalidateModelAll(model) {
    this.invalidateTags([`model:${model.name}`, `table:${model.table}`]);
  }

  /**
   * Smart / auto write tags
   * @param {import('../model').ModelDefinition} model
   * @param {'auto'|'smart'} strategy
   * @param {'create'|'update'|'delete'|'restore'} op
   * @param {*} [record] for pk
   */
  tagsForMutation(model, strategy, op, record) {
    const name = model.name;
    const table = model.table;
    if (strategy === 'auto') {
      return [`model:${name}`, `table:${table}`];
    }
    // smart: avoid invalidating `model:` / `table:` on every row write (would flush all PK rows)
    if (op === 'create') {
      return [`q:${name}`];
    }
    const id = record && record[model.primaryKey];
    if (id == null) return [`model:${name}`, `table:${table}`];
    return [`pk:${name}:${id}`, `q:${name}`];
  }
}

module.exports = {
  OrmCacheLayer,
  modelCacheStrategy,
  isTransactionKnex,
};
