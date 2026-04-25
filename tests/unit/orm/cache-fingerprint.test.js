/**
 * ORM cache fingerprint helpers (hashKey, serializeWheres, stableValue, scopeFingerprint)
 */
const {
  stableValue,
  scopeFingerprint,
  serializeWheres,
  hashKey,
} = require('../../../core/orm/cache/fingerprint');

const baseModel = () => ({
  name: 'Widget',
  table: 'widgets',
  primaryKey: 'id',
});

const baseScope = () => ({
  tenantId: null,
  withTrashed: false,
  onlyTrashed: false,
});

describe('stableValue', () => {
  it('sorts object keys for stable JSON', () => {
    expect(stableValue({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
  });

  it('recurses into nested objects and arrays', () => {
    expect(stableValue({ x: [{ z: 1, y: 2 }] })).toEqual({ x: [{ y: 2, z: 1 }] });
  });
});

describe('scopeFingerprint', () => {
  it('captures tenant and trash flags', () => {
    expect(scopeFingerprint({ tenantId: 't1', withTrashed: true, onlyTrashed: false })).toEqual({
      tenantId: 't1',
      withTrashed: true,
      onlyTrashed: false,
    });
  });
});

describe('serializeWheres', () => {
  it('preserves raw fragments with sql/bindings', () => {
    const wheres = [
      { raw: true, sql: 'id = ?', bindings: [1], boolean: 'and' },
    ];
    expect(serializeWheres(wheres)).toEqual([
      { raw: true, sql: 'id = ?', bindings: [1], boolean: 'and' },
    ]);
  });

  it('serializes column wheres', () => {
    expect(
      serializeWheres([{ column: 'id', operator: '=', value: 2, boolean: 'and' }])
    ).toEqual([{ column: 'id', operator: '=', value: 2, boolean: 'and' }]);
  });
});

describe('hashKey', () => {
  it('returns 40-char hex and is deterministic', () => {
    const m = baseModel();
    const s = baseScope();
    const a = hashKey(m, s, { op: 'findAll', select: [] });
    const b = hashKey(m, s, { op: 'findAll', select: [] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{40}$/);
  });

  it('differs when model or payload changes', () => {
    const m1 = baseModel();
    const m2 = { ...baseModel(), name: 'Other' };
    const s = baseScope();
    const k1 = hashKey(m1, s, { op: 'x' });
    const k2 = hashKey(m2, s, { op: 'x' });
    expect(k1).not.toBe(k2);
  });

  it('differs when scope tenant changes', () => {
    const m = baseModel();
    const k1 = hashKey(m, baseScope(), { op: 'findAll' });
    const k2 = hashKey(m, { ...baseScope(), tenantId: 'a' }, { op: 'findAll' });
    expect(k1).not.toBe(k2);
  });
});
