/**
 * Audit middleware pure helpers
 */
const {
  stringifyId,
  extractResourceIdFromJsonBody,
  buildMetadata,
} = require('../../../plugins/audit-log/middleware');

describe('audit-log middleware helpers', () => {
  describe('stringifyId', () => {
    it('handles nullish', () => {
      expect(stringifyId(null)).toBeNull();
      expect(stringifyId(undefined)).toBeNull();
    });

    it('stringifies bigint and primitives', () => {
      expect(stringifyId(1n)).toBe('1');
      expect(stringifyId(42)).toBe('42');
    });
  });

  describe('extractResourceIdFromJsonBody', () => {
    it('returns id from create response body', () => {
      expect(
        extractResourceIdFromJsonBody({ data: { id: 99 } }, 'create'),
      ).toBe('99');
      expect(
        extractResourceIdFromJsonBody({ data: { id: 5n } }, 'create'),
      ).toBe('5');
    });

    it('returns null for non-create or missing data', () => {
      expect(extractResourceIdFromJsonBody({ data: { id: 1 } }, 'update')).toBeNull();
      expect(extractResourceIdFromJsonBody(null, 'create')).toBeNull();
      expect(extractResourceIdFromJsonBody('x', 'create')).toBeNull();
    });
  });

  describe('buildMetadata', () => {
    it('returns changedFields for update with body keys', () => {
      expect(
        buildMetadata('update', { body: { name: 'a', email: 'b' } }),
      ).toEqual({ changedFields: ['name', 'email'] });
    });

    it('returns null for empty body or non-update', () => {
      expect(buildMetadata('update', { body: {} })).toBeNull();
      expect(buildMetadata('delete', { body: { x: 1 } })).toBeNull();
      expect(buildMetadata('update', { body: [] })).toBeNull();
    });
  });
});
