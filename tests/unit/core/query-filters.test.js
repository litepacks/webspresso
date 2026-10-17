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
    expect(RESERVED_QUERY_KEYS.has('limit')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('offset')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('sort')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('order')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('include')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('trashed')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('fields')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('select')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('search')).toBe(true);
    expect(RESERVED_QUERY_KEYS.has('q')).toBe(true);
  });

  describe('normalizeOperator', () => {
    it('normalizes all supported operator aliases to canonical forms', () => {
      expect(normalizeOperator('equals')).toBe('eq');
      expect(normalizeOperator('=')).toBe('eq');
      expect(normalizeOperator('eq')).toBe('eq');
      expect(normalizeOperator('EQ')).toBe('eq');

      expect(normalizeOperator('ne')).toBe('ne');
      expect(normalizeOperator('!=')).toBe('ne');
      expect(normalizeOperator('<>')).toBe('ne');
      expect(normalizeOperator('not_equals')).toBe('ne');
      expect(normalizeOperator('notequals')).toBe('ne');

      expect(normalizeOperator('gt')).toBe('gt');
      expect(normalizeOperator('>')).toBe('gt');

      expect(normalizeOperator('gte')).toBe('gte');
      expect(normalizeOperator('>=')).toBe('gte');

      expect(normalizeOperator('lt')).toBe('lt');
      expect(normalizeOperator('<')).toBe('lt');

      expect(normalizeOperator('lte')).toBe('lte');
      expect(normalizeOperator('<=')).toBe('lte');

      expect(normalizeOperator('in')).toBe('in');
      expect(normalizeOperator('nin')).toBe('notin');
      expect(normalizeOperator('notin')).toBe('notin');
      expect(normalizeOperator('not_in')).toBe('notin');

      expect(normalizeOperator('like')).toBe('like');
      expect(normalizeOperator('ilike')).toBe('ilike');
      expect(normalizeOperator('contains')).toBe('contains');

      expect(normalizeOperator('starts_with')).toBe('startswith');
      expect(normalizeOperator('startswith')).toBe('startswith');
      expect(normalizeOperator('ends_with')).toBe('endswith');
      expect(normalizeOperator('endswith')).toBe('endswith');

      expect(normalizeOperator('is_null')).toBe('is_null');
      expect(normalizeOperator('isnull')).toBe('is_null');
      expect(normalizeOperator('null')).toBe('is_null');

      expect(normalizeOperator('is_not_null')).toBe('is_not_null');
      expect(normalizeOperator('isnotnull')).toBe('is_not_null');
      expect(normalizeOperator('not_null')).toBe('is_not_null');
      expect(normalizeOperator('notnull')).toBe('is_not_null');

      expect(normalizeOperator('between')).toBe('between');

      // Default fallback
      expect(normalizeOperator('custom_func')).toBe('custom_func');
      expect(normalizeOperator(null)).toBe('contains');
      expect(normalizeOperator(undefined)).toBe('contains');
      expect(normalizeOperator('')).toBe('contains');
    });
  });

  describe('applyFilterCondition', () => {
    it('returns early when targets array is null or empty', () => {
      expect(() => applyFilterCondition(null, 'col', 'eq', 'val')).not.toThrow();
      expect(() => applyFilterCondition([], 'col', 'eq', 'val')).not.toThrow();
    });

    it('applies equality, inequality, and all numeric comparisons', () => {
      const q = createMockQuery();
      applyFilterCondition([q], 'name', 'eq', 'Alice');
      applyFilterCondition([q], 'status', 'ne', 'banned');
      applyFilterCondition([q], 'age', 'gt', 18);
      applyFilterCondition([q], 'points', 'gte', 100);
      applyFilterCondition([q], 'score', 'lt', 50);
      applyFilterCondition([q], 'rating', 'lte', 5);
      applyFilterCondition([q], 'other', 'unknown_op', 'xyz');

      expect(q._calls).toEqual([
        ['where', 'name', '=', 'Alice'],
        ['where', 'status', '!=', 'banned'],
        ['where', 'age', '>', 18],
        ['where', 'points', '>=', 100],
        ['where', 'score', '<', 50],
        ['where', 'rating', '<=', 5],
        ['where', 'other', '=', 'xyz'],
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

    it('applies nullability operators (is_null, is_not_null) with various truthy/falsy inputs', () => {
      const q = createMockQuery();
      applyFilterCondition([q], 'c1', 'is_null', true);
      applyFilterCondition([q], 'c2', 'is_null', 'true');
      applyFilterCondition([q], 'c3', 'is_null', '1');
      applyFilterCondition([q], 'c4', 'is_null', 1);
      applyFilterCondition([q], 'c5', 'is_null', '');
      applyFilterCondition([q], 'c6', 'is_null', null);
      applyFilterCondition([q], 'c7', 'is_null', undefined);
      // Falsy values should not apply whereNull
      applyFilterCondition([q], 'c8', 'is_null', false);
      applyFilterCondition([q], 'c9', 'is_null', 'false');
      applyFilterCondition([q], 'c10', 'is_null', 0);

      applyFilterCondition([q], 'n1', 'is_not_null', true);
      applyFilterCondition([q], 'n2', 'is_not_null', 'true');
      applyFilterCondition([q], 'n3', 'is_not_null', '1');
      applyFilterCondition([q], 'n4', 'is_not_null', 1);
      applyFilterCondition([q], 'n5', 'is_not_null', '');
      applyFilterCondition([q], 'n6', 'is_not_null', null);
      applyFilterCondition([q], 'n7', 'is_not_null', undefined);
      // Falsy values should not apply whereNotNull
      applyFilterCondition([q], 'n8', 'is_not_null', false);
      applyFilterCondition([q], 'n9', 'is_not_null', 'false');

      expect(q._calls).toEqual([
        ['whereNull', 'c1'],
        ['whereNull', 'c2'],
        ['whereNull', 'c3'],
        ['whereNull', 'c4'],
        ['whereNull', 'c5'],
        ['whereNull', 'c6'],
        ['whereNull', 'c7'],
        ['whereNotNull', 'n1'],
        ['whereNotNull', 'n2'],
        ['whereNotNull', 'n3'],
        ['whereNotNull', 'n4'],
        ['whereNotNull', 'n5'],
        ['whereNotNull', 'n6'],
        ['whereNotNull', 'n7'],
      ]);
    });

    it('applies between with { from, to }, array, comma-separated string, and single boundaries', () => {
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

      const qFromOnly = createMockQuery();
      applyFilterCondition([qFromOnly], 'start_date', 'between', { from: '2026-01-01' });
      expect(qFromOnly._calls).toEqual([
        ['where', 'start_date', '>=', '2026-01-01'],
      ]);

      const qToOnly = createMockQuery();
      applyFilterCondition([qToOnly], 'end_date', 'between', { to: '2026-12-31' });
      expect(qToOnly._calls).toEqual([
        ['where', 'end_date', '<=', '2026-12-31'],
      ]);

      const qNeither = createMockQuery();
      applyFilterCondition([qNeither], 'empty_range', 'between', {});
      expect(qNeither._calls).toEqual([]);
    });

    it('applies in and notin with array, comma-separated string, and single scalar', () => {
      const q = createMockQuery();
      applyFilterCondition([q], 'status', 'in', ['published', 'draft']);
      applyFilterCondition([q], 'tag', 'in', 'react, vue, svelte');
      applyFilterCondition([q], 'role_id', 'in', 42);

      applyFilterCondition([q], 'blocked', 'notin', ['spam', 'bot']);
      applyFilterCondition([q], 'excluded_tag', 'notin', 'legacy, deprecated');
      applyFilterCondition([q], 'excluded_id', 'notin', 99);

      expect(q._calls).toEqual([
        ['whereIn', 'status', ['published', 'draft']],
        ['whereIn', 'tag', ['react', 'vue', 'svelte']],
        ['whereIn', 'role_id', [42]],
        ['whereNotIn', 'blocked', ['spam', 'bot']],
        ['whereNotIn', 'excluded_tag', ['legacy', 'deprecated']],
        ['whereNotIn', 'excluded_id', [99]],
      ]);
    });

    it('normalizes boolean column values based on column metadata', () => {
      const q = createMockQuery();
      const meta = { type: 'boolean' };
      applyFilterCondition([q], 'is_active', 'eq', 'true', meta);
      applyFilterCondition([q], 'is_verified', 'eq', '1', meta);
      applyFilterCondition([q], 'is_admin', 'eq', '0', meta);
      applyFilterCondition([q], 'is_banned', 'eq', 'false', meta);
      applyFilterCondition([q], 'unknown_flag', 'eq', 'maybe', meta);

      expect(q._calls).toEqual([
        ['where', 'is_active', '=', true],
        ['where', 'is_verified', '=', true],
        ['where', 'is_admin', '=', false],
        ['where', 'is_banned', '=', false],
        ['where', 'unknown_flag', '=', 'maybe'],
      ]);
    });

    it('ignores inactive empty strings and empty in/notin arrays', () => {
      const q = createMockQuery();
      applyFilterCondition([q], 'empty', 'eq', '');
      applyFilterCondition([q], 'nil', 'eq', null);
      applyFilterCondition([q], 'undef', 'eq', undefined);
      applyFilterCondition([q], 'empty_in', 'in', []);
      applyFilterCondition([q], 'empty_in_str', 'in', '');
      applyFilterCondition([q], 'empty_notin', 'notin', []);
      applyFilterCondition([q], 'empty_notin_str', 'notin', '');

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

    it('handles query directly without repository wrapper and returns query when filters are empty', () => {
      const q = createMockQuery();
      expect(buildFilteredQuery(q, null)).toBe(q);
      expect(buildFilteredQuery(q, {})).toBe(q);
      expect(buildFilteredQuery(null, null)).toBeNull();
    });

    it('filters by model columns verification and supports nested operator maps and scalar values', () => {
      const q = createMockQuery();
      const model = {
        columns: new Map([
          ['title', { type: 'string' }],
          ['views', { type: 'integer' }],
          ['published', { type: 'boolean' }],
        ]),
      };

      buildFilteredQuery(q, {
        title: 'Learn Webspresso', // scalar eq
        views: { gte: 1000, lte: 5000 }, // nested ops
        published: { operator: 'eq', value: true }, // filter.operator fallback
        invalid_column: 'ignored', // not in model columns
        falsy_filter: null, // falsy ignored
      }, { model });

      expect(q._calls).toEqual([
        ['where', 'title', '=', 'Learn Webspresso'],
        ['where', 'views', '>=', 1000],
        ['where', 'views', '<=', 5000],
        ['where', 'published', '=', true],
      ]);
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

    it('handles query only without countQuery and query object input without req wrapper', () => {
      const q = createMockQuery();
      const model = {
        columns: new Map([
          ['score', { type: 'integer' }],
          ['created_at', { type: 'date' }],
        ]),
      };

      const directQuery = {
        filter: {
          score: { op: 'gt', value: 75 },
          created_at: { from: '2026-01-01', to: '2026-06-30' },
          unknown_col: 'xyz',
        },
      };

      const result = applyColumnFilters(q, null, model, directQuery);
      expect(result.query).toBe(q);
      expect(result.countQuery).toBeNull();

      expect(q._calls).toEqual([
        ['where', 'score', '>', 75],
        ['where', 'created_at', '>=', '2026-01-01'],
        ['where', 'created_at', '<=', '2026-06-30'],
      ]);
    });

    it('handles nested filter objects, top-level nested ops, and ignores reserved query params', () => {
      const q = createMockQuery();
      const model = {
        columns: new Map([
          ['rating', { type: 'integer' }],
          ['status', { type: 'string' }],
        ]),
      };

      const req = {
        query: {
          filter: {
            rating: { gte: 3, lte: 5 },
          },
          status: { ne: 'deleted' },
          perPage: 20,
          limit: 10,
          sort: 'rating',
          order: 'desc',
        },
      };

      applyColumnFilters(q, null, model, req);

      expect(q._calls).toEqual([
        ['where', 'rating', '>=', 3],
        ['where', 'rating', '<=', 5],
        ['where', 'status', '!=', 'deleted'],
      ]);
    });

    it('returns queries unmodified when query input is nullish or not an object', () => {
      const q = createMockQuery();
      const result = applyColumnFilters(q, null, null, null);
      expect(result.query).toBe(q);
      expect(result.countQuery).toBeNull();
      expect(q._calls.length).toBe(0);
    });
  });
});

