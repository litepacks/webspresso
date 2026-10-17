import { describe, it, expect, vi } from 'vitest';
import {
  applyFilterCondition,
  buildFilteredQuery,
  applyColumnFilters,
  normalizeOperator,
  RESERVED_QUERY_KEYS,
} from '../../../core/orm/query-filters';

function createMockQuery() {
  const calls = [];
  const q = {
    _calls: calls,
    where: vi.fn((...args) => {
      calls.push(['where', ...args]);
      return q;
    }),
    whereIn: vi.fn((...args) => {
      calls.push(['whereIn', ...args]);
      return q;
    }),
    whereNotIn: vi.fn((...args) => {
      calls.push(['whereNotIn', ...args]);
      return q;
    }),
    whereNull: vi.fn((...args) => {
      calls.push(['whereNull', ...args]);
      return q;
    }),
    whereNotNull: vi.fn((...args) => {
      calls.push(['whereNotNull', ...args]);
      return q;
    }),
    onlyTrashed: vi.fn(() => {
      calls.push(['onlyTrashed']);
      return q;
    }),
  };
  return q;
}

describe('Universal ORM Query Filter Engine (core/orm/query-filters)', () => {
  it('exports core filtering primitives and reserved query keys', () => {
    expect(typeof applyFilterCondition).toBe('function');
    expect(typeof buildFilteredQuery).toBe('function');
    expect(typeof applyColumnFilters).toBe('function');
    expect(typeof normalizeOperator).toBe('function');
    expect(RESERVED_QUERY_KEYS instanceof Set).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('page')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('perPage')).toBe(true);
  });

  describe('normalizeOperator', () => {
    it('normalizes operator aliases to canonical forms', () => {
      expect(normalizeOperator('equals')).toBe('eq');
      expect(normalizeOperator('=')).toBe('eq');
      expect(normalizeOperator('EQ')).toBe('eq');
      expect(normalizeOperator('!=')).toBe('ne');
      expect(normalizeOperator('<>')).toBe('ne');
      expect(normalizeOperator('not_equals')).toBe('ne');
      expect(normalizeOperator('starts_with')).toBe('startswith');
      expect(normalizeOperator('ends_with')).toBe('endswith');
      expect(normalizeOperator('is_null')).toBe('is_null');
      expect(normalizeOperator('isnull')).toBe('is_null');
      expect(normalizeOperator('null')).toBe('is_null');
      expect(normalizeOperator('is_not_null')).toBe('is_not_null');
      expect(normalizeOperator('notnull')).toBe('is_not_null');
      expect(normalizeOperator('between')).toBe('between');
      expect(normalizeOperator('in')).toBe('in');
      expect(normalizeOperator('nin')).toBe('notin');
      expect(normalizeOperator('not_in')).toBe('notin');
    });
  });

  describe('applyFilterCondition', () => {
    it('applies equality, inequality, and numeric comparisons', () => {
      const q = createMockQuery();
      applyFilterCondition([q], 'name', 'eq', 'Alice');
      applyFilterCondition([q], 'status', 'ne', 'banned');
      applyFilterCondition([q], 'age', 'gte', 18);
      applyFilterCondition([q], 'score', 'lt', 100);

      expect(q._calls).toEqual([
        ['where', 'name', '=', 'Alice'],
        ['where', 'status', '!=', 'banned'],
        ['where', 'age', '>=', 18],
        ['where', 'score', '<', 100],
      ]);
    });

    it('applies pattern matching operators (contains, startswith, endswith, like, ilike)', () => {
      const q = createMockQuery();
      applyFilterCondition([q], 'title', 'contains', 'book');
      applyFilterCondition([q], 'code', 'starts_with', 'PRD-');
      applyFilterCondition([q], 'file', 'ends_with', '.pdf');
      applyFilterCondition([q], 'custom', 'like', 'A%B');
      applyFilterCondition([q], 'search', 'ilike', 'test');

      expect(q._calls).toEqual([
        ['where', 'title', 'like', '%book%'],
        ['where', 'code', 'like', 'PRD-%'],
        ['where', 'file', 'like', '%.pdf'],
        ['where', 'custom', 'like', 'A%B'],
        ['where', 'search', 'ilike', 'test'],
      ]);
    });

    it('applies nullability operators (is_null, is_not_null)', () => {
      const q = createMockQuery();
      applyFilterCondition([q], 'deleted_at', 'is_null', true);
      applyFilterCondition([q], 'email_verified_at', 'is_not_null', 'true');

      expect(q._calls).toEqual([
        ['whereNull', 'deleted_at'],
        ['whereNotNull', 'email_verified_at'],
      ]);
    });

    it('applies between with { from, to }, array, and comma-separated string', () => {
      const q1 = createMockQuery();
      applyFilterCondition([q1], 'created_at', 'between', { from: '2026-01-01', to: '2026-12-31' });
      expect(q1._calls).toEqual([
        ['where', 'created_at', '>=', '2026-01-01'],
        ['where', 'created_at', '<=', '2026-12-31'],
      ]);

      const q2 = createMockQuery();
      applyFilterCondition([q2], 'price', 'between', [10, 50]);
      expect(q2._calls).toEqual([
        ['where', 'price', '>=', 10],
        ['where', 'price', '<=', 50],
      ]);

      const q3 = createMockQuery();
      applyFilterCondition([q3], 'rating', 'between', '1,5');
      expect(q3._calls).toEqual([
        ['where', 'rating', '>=', '1'],
        ['where', 'rating', '<=', '5'],
      ]);
    });

    it('normalizes boolean column values based on column metadata', () => {
      const q = createMockQuery();
      const meta = { type: 'boolean' };
      applyFilterCondition([q], 'is_active', 'eq', 'true', meta);
      applyFilterCondition([q], 'is_admin', 'eq', '0', meta);

      expect(q._calls).toEqual([
        ['where', 'is_active', '=', true],
        ['where', 'is_admin', '=', false],
      ]);
    });

    it('ignores inactive empty strings and empty in-arrays', () => {
      const q = createMockQuery();
      applyFilterCondition([q], 'empty', 'eq', '');
      applyFilterCondition([q], 'nil', 'eq', null);
      applyFilterCondition([q], 'undef', 'eq', undefined);
      applyFilterCondition([q], 'empty_in', 'in', []);

      expect(q._calls.length).toBe(0);
    });
  });

  describe('buildFilteredQuery', () => {
    it('applies filters from object and respects onlyTrashed option', () => {
      const q = createMockQuery();
      const repo = { query: () => q };

      buildFilteredQuery(repo, {
        status: { op: 'equals', value: 'active' },
        price: { op: 'between', from: 10, to: 100 },
        tag: { op: 'in', value: ['tech', 'gadgets'] },
      }, { onlyTrashed: true });

      expect(q._calls.some((c) => c[0] === 'onlyTrashed')).toBe(true);
      expect(q._calls.some((c) => c[0] === 'where' && c[1] === 'status' && c[3] === 'active')).toBe(true);
      expect(q._calls.some((c) => c[0] === 'where' && c[1] === 'price' && c[2] === '>=')).toBe(true);
      expect(q._calls.some((c) => c[0] === 'whereIn' && c[1] === 'tag')).toBe(true);
    });
  });

  describe('applyColumnFilters', () => {
    it('applies both query and countQuery targets consistently', () => {
      const q = createMockQuery();
      const c = createMockQuery();
      const model = {
        columns: new Map([
          ['id', { type: 'integer' }],
          ['category', { type: 'string' }],
          ['archived', { type: 'boolean' }],
        ]),
      };

      const req = {
        query: {
          filter: {
            category: 'books',
          },
          archived: 'false',
          page: 1, // reserved key ignored
        },
      };

      const result = applyColumnFilters(q, c, model, req);
      expect(result.query).toBe(q);
      expect(result.countQuery).toBe(c);

      expect(q._calls).toEqual([
        ['where', 'category', '=', 'books'],
        ['where', 'archived', '=', false],
      ]);
      expect(c._calls).toEqual([
        ['where', 'category', '=', 'books'],
        ['where', 'archived', '=', false],
      ]);
    });
  });
});
