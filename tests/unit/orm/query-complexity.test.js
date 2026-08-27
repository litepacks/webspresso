/**
 * Unit Tests for ORM Query Complexity & DoS Protection (core/orm/complexity.js)
 */

const { z } = require('zod');
const {
  defineModel,
  createSchemaHelpers,
  clearRegistry,
  validateQueryComplexity,
  resolveQueryLimits,
  QueryComplexityError,
  DEFAULT_QUERY_LIMITS,
} = require('../../../core/orm');

const zdb = createSchemaHelpers(z);

describe('ORM Query Complexity & DoS Protection', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('provides sensible default query limits', () => {
    expect(DEFAULT_QUERY_LIMITS.maxLimit).toBe(100);
    expect(DEFAULT_QUERY_LIMITS.defaultLimit).toBe(15);
    expect(DEFAULT_QUERY_LIMITS.maxIncludes).toBe(5);
    expect(DEFAULT_QUERY_LIMITS.maxFilterConditions).toBe(25);
  });

  it('clamps excessive limits and includes in non-strict mode', () => {
    const validated = validateQueryComplexity(null, {
      limit: 10000,
      includes: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'],
    });

    expect(validated.limit).toBe(100);
    expect(validated.perPage).toBe(100);
    expect(validated.includes).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });

  it('throws QueryComplexityError in strict mode when limits are exceeded', () => {
    expect(() => {
      validateQueryComplexity(null, {
        limit: 500,
        strict: true,
      });
    }).toThrow(QueryComplexityError);

    expect(() => {
      validateQueryComplexity(null, {
        includes: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
        strict: true,
      });
    }).toThrow(QueryComplexityError);

    expect(() => {
      validateQueryComplexity(null, {
        filterCount: 50,
        strict: true,
      });
    }).toThrow(QueryComplexityError);
  });

  it('respects custom model queryLimits in defineModel', () => {
    const CustomModel = defineModel({
      name: 'CustomModel',
      table: 'custom_table',
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(),
      }),
      queryLimits: {
        maxLimit: 30,
        defaultLimit: 10,
        maxIncludes: 2,
        maxFilterConditions: 5,
      },
    });

    const limits = resolveQueryLimits(CustomModel);
    expect(limits.maxLimit).toBe(30);
    expect(limits.defaultLimit).toBe(10);
    expect(limits.maxIncludes).toBe(2);
    expect(limits.maxFilterConditions).toBe(5);

    const validated = validateQueryComplexity(CustomModel, {
      perPage: 500,
      includes: ['a', 'b', 'c', 'd'],
    });

    expect(validated.perPage).toBe(30);
    expect(validated.includes).toEqual(['a', 'b']);
  });
});
