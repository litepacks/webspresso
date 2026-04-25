/**
 * OrmCacheLayer.classifyQueryBuilder — shapes that are / are not pk-cacheable for first()
 */
const { OrmCacheLayer } = require('../../../core/orm/cache/layer');

function mockProvider() {
  return {
    get: () => undefined,
    set: () => {},
    invalidateTags: () => {},
    clear: () => {},
    getSizeStats: () => ({ entries: 0, tags: 0 }),
  };
}

const model = { name: 'W', table: 'w', primaryKey: 'id' };

/**
 * @param {object} [partial]
 */
function state(partial = {}) {
  return {
    wheres: [],
    withs: [],
    selects: [],
    orderBys: [],
    limitValue: null,
    offsetValue: null,
    ...partial,
  };
}

describe('OrmCacheLayer.classifyQueryBuilder', () => {
  const layer = new OrmCacheLayer(mockProvider(), { defaultStrategy: 'auto' });

  it('whereRaw (any raw) → not cacheable', () => {
    const st = state({
      wheres: [{ raw: true, sql: 'x = 1' }],
    });
    expect(layer.classifyQueryBuilder(model, st, 'first')).toEqual({
      cacheable: false,
      kind: 'collection',
    });
  });

  it('eager withs → collection (cacheable)', () => {
    const st = state({ withs: ['profile'] });
    expect(layer.classifyQueryBuilder(model, st, 'first')).toEqual({
      cacheable: true,
      kind: 'collection',
    });
  });

  it('list / count / paginate → collection', () => {
    const st = state();
    expect(layer.classifyQueryBuilder(model, st, 'list').kind).toBe('collection');
    expect(layer.classifyQueryBuilder(model, st, 'count').kind).toBe('collection');
    expect(layer.classifyQueryBuilder(model, st, 'paginate').kind).toBe('collection');
  });

  it('first with no where → collection', () => {
    expect(layer.classifyQueryBuilder(model, state({ wheres: [] }), 'first').kind).toBe('collection');
  });

  it('first with two wheres → collection', () => {
    const st = state({
      wheres: [
        { column: 'id', operator: '=', value: 1, boolean: 'and' },
        { column: 'name', operator: '=', value: 'a', boolean: 'and' },
      ],
    });
    expect(layer.classifyQueryBuilder(model, st, 'first').kind).toBe('collection');
  });

  it('first with OR group → collection', () => {
    const st = state({
      wheres: [{ column: 'id', operator: '=', value: 1, boolean: 'or' }],
    });
    expect(layer.classifyQueryBuilder(model, st, 'first').kind).toBe('collection');
  });

  it('first with non-pk column → collection', () => {
    const st = state({
      wheres: [{ column: 'name', operator: '=', value: 'x', boolean: 'and' }],
    });
    expect(layer.classifyQueryBuilder(model, st, 'first').kind).toBe('collection');
  });

  it('first with id <> value → collection', () => {
    const st = state({
      wheres: [{ column: 'id', operator: '!=', value: 1, boolean: 'and' }],
    });
    expect(layer.classifyQueryBuilder(model, st, 'first').kind).toBe('collection');
  });

  it('first with single id = → pk with pkValue', () => {
    const st = state({
      wheres: [{ column: 'id', operator: '=', value: 42, boolean: 'and' }],
    });
    expect(layer.classifyQueryBuilder(model, st, 'first')).toEqual({
      cacheable: true,
      kind: 'pk',
      pkValue: 42,
    });
  });
});

describe('OrmCacheLayer query fingerprints', () => {
  const layer = new OrmCacheLayer(mockProvider());
  const m = model;
  const sc = { tenantId: null, withTrashed: false, onlyTrashed: false };
  const st = state();

  it('queryBuilderFingerprint changes with op and extra (paginate)', () => {
    const a = layer.queryBuilderFingerprint(m, sc, st, 'count');
    const b = layer.queryBuilderFingerprint(m, sc, st, 'paginate', { page: 1, perPage: 5 });
    expect(a).not.toBe(b);
  });

  it('findByIdFingerprint stringifies id', () => {
    const a = layer.findByIdFingerprint(m, sc, 7);
    const b = layer.findByIdFingerprint(m, sc, '7');
    expect(a).toBe(b);
  });

  it('findAllFingerprint is stable for select order', () => {
    const a = layer.findAllFingerprint(m, sc, ['name', 'id']);
    const b = layer.findAllFingerprint(m, sc, ['id', 'name']);
    expect(a).toBe(b);
  });

  it('findOneFingerprint is stable for condition key order', () => {
    const a = layer.findOneFingerprint(m, sc, { b: 1, a: 2 });
    const b = layer.findOneFingerprint(m, sc, { a: 2, b: 1 });
    expect(a).toBe(b);
  });
});
