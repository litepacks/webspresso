/**
 * @vitest-environment node
 */

const {
  getJsonColumns,
  serializeJsonFields,
  deserializeJsonFields,
} = require('../../../core/orm/json-fields');

describe('json-fields', () => {
  describe('getJsonColumns', () => {
    it('returns empty set when model has no columns', () => {
      expect(getJsonColumns({})).toEqual(new Set());
    });

    it('collects only json-typed columns', () => {
      const model = {
        columns: new Map([
          ['meta', { type: 'json' }],
          ['name', { type: 'string' }],
          ['count', { type: 'integer' }],
        ]),
      };
      expect(getJsonColumns(model)).toEqual(new Set(['meta']));
    });
  });

  describe('serializeJsonFields', () => {
    it('returns same data when no json columns', () => {
      const data = { a: 1 };
      expect(serializeJsonFields(data, new Set())).toBe(data);
    });

    it('stringifies object values for json columns', () => {
      const data = { meta: { x: 1 }, name: 'a' };
      const out = serializeJsonFields(data, new Set(['meta']));
      expect(out.meta).toBe('{"x":1}');
      expect(out.name).toBe('a');
    });

    it('leaves string values as-is for json columns', () => {
      const data = { meta: '{"already":true}' };
      const out = serializeJsonFields(data, new Set(['meta']));
      expect(out.meta).toBe('{"already":true}');
    });

    it('skips null and undefined json column values', () => {
      const data = { meta: null, other: undefined };
      const out = serializeJsonFields(data, new Set(['meta', 'other']));
      expect(out.meta).toBeNull();
      expect(out.other).toBeUndefined();
    });
  });

  describe('deserializeJsonFields', () => {
    it('returns record unchanged when falsy', () => {
      expect(deserializeJsonFields(null, new Set(['a']))).toBeNull();
    });

    it('returns record when no json columns', () => {
      const record = { a: '1' };
      expect(deserializeJsonFields(record, new Set())).toBe(record);
    });

    it('parses json strings in place', () => {
      const record = { meta: '{"k":2}' };
      deserializeJsonFields(record, new Set(['meta']));
      expect(record.meta).toEqual({ k: 2 });
    });

    it('keeps original string when JSON.parse fails', () => {
      const record = { meta: 'not-json{' };
      deserializeJsonFields(record, new Set(['meta']));
      expect(record.meta).toBe('not-json{');
    });

    it('does not alter non-string values', () => {
      const record = { meta: { nested: true } };
      deserializeJsonFields(record, new Set(['meta']));
      expect(record.meta).toEqual({ nested: true });
    });

    it('skips null and undefined', () => {
      const record = { meta: null };
      deserializeJsonFields(record, new Set(['meta']));
      expect(record.meta).toBeNull();
    });
  });
});
