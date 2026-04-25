/**
 * OrmCacheLayer + modelCacheStrategy (auto / smart edge cases)
 */
const { OrmCacheLayer, modelCacheStrategy, isTransactionKnex } = require('../../../core/orm/cache/layer');

function mockProvider() {
  const store = new Map();
  const tagIndex = new Map();
  return {
    get: (k) => store.get(k),
    set: (k, v, { tags = [] } = {}) => {
      store.set(k, v);
      for (const t of tags) {
        if (!tagIndex.has(t)) tagIndex.set(t, new Set());
        tagIndex.get(t).add(k);
      }
    },
    invalidateTags: (tags) => {
      for (const t of tags) {
        const keys = tagIndex.get(t);
        if (keys) {
          for (const k of keys) store.delete(k);
          tagIndex.delete(t);
        }
      }
    },
    clear: () => {
      store.clear();
      tagIndex.clear();
    },
    getSizeStats: () => ({ entries: store.size, tags: tagIndex.size }),
  };
}

describe('modelCacheStrategy', () => {
  const m = (cache) => ({ name: 'X', table: 'x', cache });

  it('null / false / undefined on model', () => {
    expect(modelCacheStrategy(m(false), 'auto')).toBeNull();
    expect(modelCacheStrategy(m(null), 'smart')).toBeNull();
    expect(modelCacheStrategy(m(undefined), 'auto')).toBeNull();
  });

  it('true inherits defaultStrategy', () => {
    expect(modelCacheStrategy(m(true), 'auto')).toBe('auto');
    expect(modelCacheStrategy(m(true), 'smart')).toBe('smart');
  });

  it('string auto/smart', () => {
    expect(modelCacheStrategy(m('auto'), 'smart')).toBe('auto');
    expect(modelCacheStrategy(m('smart'), 'auto')).toBe('smart');
  });

  it('object.strategy wins over default (non-smart → auto)', () => {
    expect(modelCacheStrategy(m({ strategy: 'auto' }), 'smart')).toBe('auto');
    expect(modelCacheStrategy(m({ strategy: 'smart' }), 'auto')).toBe('smart');
  });
});

describe('isTransactionKnex', () => {
  it('detects knex.isTransaction', () => {
    expect(isTransactionKnex({ isTransaction: true })).toBe(true);
    expect(isTransactionKnex({ isTransaction: false })).toBe(false);
    expect(isTransactionKnex({})).toBe(false);
    expect(isTransactionKnex(null)).toBe(false);
  });
});

describe('OrmCacheLayer', () => {
  it('buildReadTags: auto is only model + table (same tags for pk vs collection)', () => {
    const layer = new OrmCacheLayer(mockProvider(), { defaultStrategy: 'auto' });
    const model = { name: 'U', table: 'users' };
    const t1 = layer.buildReadTags(model, 'auto', 'pk', 1);
    const t2 = layer.buildReadTags(model, 'auto', 'collection', null);
    expect(t1).toEqual(t2);
    expect(t1).toEqual(['model:U', 'table:users']);
  });

  it('buildReadTags: smart distinguishes pk with value', () => {
    const layer = new OrmCacheLayer(mockProvider());
    const model = { name: 'U', table: 'users' };
    expect(layer.buildReadTags(model, 'smart', 'pk', 5)).toContain('pk:U:5');
    expect(layer.buildReadTags(model, 'smart', 'collection', null)).toContain('q:U');
  });

  it('tagsForMutation: auto always invalidates model + table', () => {
    const layer = new OrmCacheLayer(mockProvider());
    const model = { name: 'A', table: 'a' };
    expect(layer.tagsForMutation(model, 'auto', 'create', {})).toEqual(['model:A', 'table:a']);
    expect(layer.tagsForMutation(model, 'auto', 'update', { id: 1 })).toEqual(['model:A', 'table:a']);
  });

  it('tagsForMutation: smart create only q: tag', () => {
    const layer = new OrmCacheLayer(mockProvider());
    const model = { name: 'A', table: 'a', primaryKey: 'id' };
    expect(layer.tagsForMutation(model, 'smart', 'create', {})).toEqual(['q:A']);
  });

  it('tagsForMutation: smart update without id falls back to full model', () => {
    const layer = new OrmCacheLayer(mockProvider());
    const model = { name: 'A', table: 'a', primaryKey: 'id' };
    expect(layer.tagsForMutation(model, 'smart', 'update', {})).toEqual(['model:A', 'table:a']);
  });

  it('shouldBypassRead: no strategy', () => {
    const layer = new OrmCacheLayer(mockProvider());
    const model = { name: 'X', table: 'x', cache: false };
    expect(layer.shouldBypassRead(model, {})).toBe(true);
  });

  it('wrapRead: does not set cache when shouldCache is false (e.g. null row)', async () => {
    const p = mockProvider();
    const layer = new OrmCacheLayer(p);
    const model = { name: 'X', table: 'x', cache: 'auto' };
    const key = 'k1';
    const tags = ['model:X', 'table:x'];
    const exec = async () => null;
    const r1 = await layer.wrapRead(model, {}, {}, key, tags, exec, (row) => row != null);
    const r2 = await layer.wrapRead(model, {}, {}, key, tags, exec, (row) => row != null);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    const m = layer.getMetrics();
    expect(m.sets).toBe(0);
    expect(m.misses).toBe(2);
  });

  it('scheduleInvalidate: without trx calls invalidate immediately', () => {
    const p = mockProvider();
    const layer = new OrmCacheLayer(p);
    p.set('a', 1, { tags: ['t1'] });
    layer.scheduleInvalidate(null, ['t1']);
    expect(p.get('a')).toBeUndefined();
  });

  it('scheduleInvalidate: with executionPromise defers until resolve', async () => {
    const p = mockProvider();
    const layer = new OrmCacheLayer(p);
    p.set('a', 1, { tags: ['t1'] });
    let resolve;
    const executionPromise = new Promise((r) => {
      resolve = r;
    });
    const trx = { executionPromise };
    layer.scheduleInvalidate(trx, ['t1']);
    expect(p.get('a')).toBe(1);
    resolve();
    await executionPromise;
    expect(p.get('a')).toBeUndefined();
  });

  it('invalidateTags: ignores empty and falsy', () => {
    const p = mockProvider();
    const layer = new OrmCacheLayer(p);
    layer.invalidateTags([]);
    layer.invalidateTags(['', null, 'real']);
    expect(layer.metrics.invalidations).toBe(1);
  });

  it('getMetrics: hitRate is null when no lookups', () => {
    const layer = new OrmCacheLayer(mockProvider());
    const m = layer.getMetrics();
    expect(m.hitRate).toBeNull();
  });
});
