const z = require('zod');
const {
  defineModel,
  getSoftDeleteColumn,
  getCreatedAtColumn,
  getUpdatedAtColumn,
  applyInsertTimestamps,
  applyUpdateTimestamps,
} = require('../../../core/orm');

describe('Model Column Metadata Pre-caching (soft delete & timestamps)', () => {
  it('pre-computes snake_case column names on model definition', () => {
    const model = defineModel({
      name: 'SnakeModel',
      table: 'snakes',
      schema: z.object({
        id: z.number().optional(),
        title: z.string(),
        created_at: z.date().optional(),
        updated_at: z.date().optional(),
        deleted_at: z.date().optional(),
      }),
      timestamps: true,
      softDelete: true,
    });

    expect(model._deletedCol).toBe('deleted_at');
    expect(model._createdCol).toBe('created_at');
    expect(model._updatedCol).toBe('updated_at');

    expect(getSoftDeleteColumn(model)).toBe('deleted_at');
    expect(getCreatedAtColumn(model)).toBe('created_at');
    expect(getUpdatedAtColumn(model)).toBe('updated_at');
  });

  it('pre-computes camelCase column names on model definition', () => {
    const model = defineModel({
      name: 'CamelModel',
      table: 'camels',
      schema: z.object({
        id: z.number().optional(),
        title: z.string(),
        createdAt: z.date().optional(),
        updatedAt: z.date().optional(),
        deletedAt: z.date().optional(),
      }),
      timestamps: true,
      softDelete: true,
    });

    expect(model._deletedCol).toBe('deletedAt');
    expect(model._createdCol).toBe('createdAt');
    expect(model._updatedCol).toBe('updatedAt');

    expect(getSoftDeleteColumn(model)).toBe('deletedAt');
    expect(getCreatedAtColumn(model)).toBe('createdAt');
    expect(getUpdatedAtColumn(model)).toBe('updatedAt');
  });

  it('lazily caches columns on arbitrary objects passed to getSoftDeleteColumn', () => {
    const dummyModel = {
      columns: new Map([['deletedAt', { type: 'datetime' }]]),
    };
    expect(dummyModel._deletedCol).toBeUndefined();

    const col = getSoftDeleteColumn(dummyModel);
    expect(col).toBe('deletedAt');
    expect(dummyModel._deletedCol).toBe('deletedAt');

    // Second call reads directly from _deletedCol
    expect(getSoftDeleteColumn(dummyModel)).toBe('deletedAt');
  });

  it('applyInsertTimestamps applies timestamps using cached columns', () => {
    const model = defineModel({
      name: 'TimestampModel',
      table: 'items',
      schema: z.object({
        id: z.number().optional(),
        title: z.string(),
      }),
      timestamps: true,
    });

    const inserted = applyInsertTimestamps({ title: 'Test' }, model);
    expect(inserted[model._createdCol]).toBeInstanceOf(Date);
    expect(inserted[model._updatedCol]).toBeInstanceOf(Date);
  });

  it('applyUpdateTimestamps applies updated timestamp using cached column', () => {
    const model = defineModel({
      name: 'UpdateModel',
      table: 'items',
      schema: z.object({
        id: z.number().optional(),
        title: z.string(),
      }),
      timestamps: true,
    });

    const updated = applyUpdateTimestamps({ title: 'Test 2' }, model);
    expect(updated[model._updatedCol]).toBeInstanceOf(Date);
  });
});
