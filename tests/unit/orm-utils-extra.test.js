/**
 * Extra coverage for core/orm/utils.js
 */
const {
  deepClone,
  omitHiddenColumns,
  sanitizeForOutput,
  ensureArray,
  snakeToCamel,
  camelToSnake,
} = require('../../core/orm/utils');

describe('core/orm/utils (extra)', () => {
  describe('deepClone', () => {
    it('clones nested objects and arrays', () => {
      const src = { a: 1, b: { c: [1, 2] } };
      const c = deepClone(src);
      expect(c).toEqual(src);
      expect(c).not.toBe(src);
      expect(c.b).not.toBe(src.b);
    });

    it('clones Date instances', () => {
      const d = new Date('2021-06-15T12:00:00.000Z');
      const c = deepClone({ d });
      expect(c.d).not.toBe(d);
      expect(c.d.getTime()).toBe(d.getTime());
    });

    it('returns primitives as-is', () => {
      expect(deepClone(null)).toBeNull();
      expect(deepClone(3)).toBe(3);
      expect(deepClone('x')).toBe('x');
    });
  });

  describe('omitHiddenColumns / sanitizeForOutput', () => {
    it('omitHiddenColumns handles null and no hidden', () => {
      expect(omitHiddenColumns(null, {})).toBeNull();
      expect(omitHiddenColumns({ x: 1 }, {})).toEqual({ x: 1 });
      expect(omitHiddenColumns({ x: 1 }, { hidden: [] })).toEqual({ x: 1 });
    });

    it('sanitizeForOutput strips hidden on array or object', () => {
      const model = { hidden: ['password'] };
      expect(sanitizeForOutput({ id: 1, password: 'p' }, model)).toEqual({ id: 1 });
      expect(sanitizeForOutput(
        [
          { id: 1, password: 'a' },
          { id: 2, password: 'b' },
        ],
        model,
      )).toEqual([{ id: 1 }, { id: 2 }]);
      expect(sanitizeForOutput({ id: 1 }, { hidden: undefined })).toEqual({ id: 1 });
    });
  });

  describe('ensureArray', () => {
    it('wraps non-array values', () => {
      expect(ensureArray(undefined)).toEqual([]);
      expect(ensureArray(null)).toEqual([]);
      expect(ensureArray('one')).toEqual(['one']);
      expect(ensureArray([1, 2])).toEqual([1, 2]);
    });
  });

  describe('snakeToCamel / camelToSnake', () => {
    it('converts case', () => {
      expect(snakeToCamel('foo_bar_baz')).toBe('fooBarBaz');
      expect(camelToSnake('fooBarBaz')).toBe('foo_bar_baz');
    });
  });
});
