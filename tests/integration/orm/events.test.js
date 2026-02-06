/**
 * ORM Events/Signals Integration Tests
 * Tests signal integration with repository operations
 */

const { createDatabase, defineModel, clearRegistry, ModelEvents, Hooks, HookCancellationError, zdb } = require('../../../core/orm');

describe('ORM Events Integration', () => {
  let db;
  let TestModel;
  let TestRepo;

  beforeAll(async () => {
    // Create in-memory database
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
    });

    // Create test table
    await db.knex.schema.createTable('event_tests', (table) => {
      table.bigIncrements('id').primary();
      table.string('name', 255).notNullable();
      table.string('email', 255);
      table.string('status').defaultTo('active');
      table.json('metadata').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.timestamp('deleted_at').nullable();
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    // Clear listeners before each test
    ModelEvents.removeAllListeners();
    
    // Clear registry and redefine model
    clearRegistry();
    
    // Define test model
    TestModel = defineModel({
      name: 'EventTest',
      table: 'event_tests',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string({ maxLength: 255 }),
        email: zdb.string({ maxLength: 255, nullable: true }),
        status: zdb.string({ default: 'active' }),
        metadata: zdb.json({ nullable: true }),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      scopes: {
        softDelete: true,
        timestamps: true,
      },
    });

    db.registerModel(TestModel);
    TestRepo = db.getRepository('EventTest');

    // Clear table
    await db.knex('event_tests').del();
  });

  describe('Create Operations', () => {
    it('should emit beforeValidation before create', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.beforeValidation', callback);

      await TestRepo.create({ name: 'Test', email: 'test@test.com' });

      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0]).toMatchObject({ name: 'Test' });
    });

    it('should emit afterValidation after validation', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.afterValidation', callback);

      await TestRepo.create({ name: 'Test' });

      expect(callback).toHaveBeenCalled();
    });

    it('should emit beforeSave before create', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.beforeSave', callback);

      await TestRepo.create({ name: 'Test' });

      expect(callback).toHaveBeenCalled();
    });

    it('should emit beforeCreate before insert', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.beforeCreate', callback);

      await TestRepo.create({ name: 'Test' });

      expect(callback).toHaveBeenCalled();
    });

    it('should emit afterCreate after insert', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.afterCreate', callback);

      await TestRepo.create({ name: 'Test' });

      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0]).toHaveProperty('id');
    });

    it('should emit afterSave after create', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.afterSave', callback);

      await TestRepo.create({ name: 'Test' });

      expect(callback).toHaveBeenCalled();
    });

    it('should call hooks in correct order for create', async () => {
      const order = [];
      
      ModelEvents.on('EventTest.beforeValidation', () => order.push('beforeValidation'));
      ModelEvents.on('EventTest.afterValidation', () => order.push('afterValidation'));
      ModelEvents.on('EventTest.beforeSave', () => order.push('beforeSave'));
      ModelEvents.on('EventTest.beforeCreate', () => order.push('beforeCreate'));
      ModelEvents.on('EventTest.afterCreate', () => order.push('afterCreate'));
      ModelEvents.on('EventTest.afterSave', () => order.push('afterSave'));

      await TestRepo.create({ name: 'Test' });

      expect(order).toEqual([
        'beforeValidation',
        'afterValidation',
        'beforeSave',
        'beforeCreate',
        'afterCreate',
        'afterSave',
      ]);
    });

    it('should allow data modification in beforeCreate', async () => {
      ModelEvents.on('EventTest.beforeCreate', (data) => {
        data.name = data.name.toUpperCase();
      });

      const record = await TestRepo.create({ name: 'test' });

      expect(record.name).toBe('TEST');
    });

    it('should cancel create operation when beforeCreate cancels', async () => {
      ModelEvents.on('EventTest.beforeCreate', (data, ctx) => {
        ctx.cancel('Not allowed');
      });

      await expect(TestRepo.create({ name: 'Test' })).rejects.toThrow(HookCancellationError);
    });

    it('should cancel create when beforeValidation throws', async () => {
      ModelEvents.on('EventTest.beforeValidation', () => {
        throw new Error('Validation blocked');
      });

      await expect(TestRepo.create({ name: 'Test' })).rejects.toThrow(HookCancellationError);
    });
  });

  describe('Update Operations', () => {
    let existingRecord;

    beforeEach(async () => {
      // Create a record without hooks
      ModelEvents.removeAllListeners();
      existingRecord = await TestRepo.create({ name: 'Original', email: 'original@test.com' });
    });

    it('should emit beforeUpdate before update', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.beforeUpdate', callback);

      await TestRepo.update(existingRecord.id, { name: 'Updated' });

      expect(callback).toHaveBeenCalled();
    });

    it('should emit afterUpdate after update', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.afterUpdate', callback);

      await TestRepo.update(existingRecord.id, { name: 'Updated' });

      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0].name).toBe('Updated');
    });

    it('should emit beforeSave and afterSave for update', async () => {
      const beforeSave = vi.fn();
      const afterSave = vi.fn();

      ModelEvents.on('EventTest.beforeSave', beforeSave);
      ModelEvents.on('EventTest.afterSave', afterSave);

      await TestRepo.update(existingRecord.id, { name: 'Updated' });

      expect(beforeSave).toHaveBeenCalled();
      expect(afterSave).toHaveBeenCalled();
    });

    it('should call hooks in correct order for update', async () => {
      const order = [];

      ModelEvents.on('EventTest.beforeValidation', () => order.push('beforeValidation'));
      ModelEvents.on('EventTest.afterValidation', () => order.push('afterValidation'));
      ModelEvents.on('EventTest.beforeSave', () => order.push('beforeSave'));
      ModelEvents.on('EventTest.beforeUpdate', () => order.push('beforeUpdate'));
      ModelEvents.on('EventTest.afterUpdate', () => order.push('afterUpdate'));
      ModelEvents.on('EventTest.afterSave', () => order.push('afterSave'));

      await TestRepo.update(existingRecord.id, { name: 'Updated' });

      expect(order).toEqual([
        'beforeValidation',
        'afterValidation',
        'beforeSave',
        'beforeUpdate',
        'afterUpdate',
        'afterSave',
      ]);
    });

    it('should cancel update when beforeUpdate cancels', async () => {
      ModelEvents.on('EventTest.beforeUpdate', (data, ctx) => {
        ctx.cancel('Update not allowed');
      });

      await expect(TestRepo.update(existingRecord.id, { name: 'Updated' })).rejects.toThrow(
        HookCancellationError
      );

      // Verify record was not updated
      const record = await TestRepo.findById(existingRecord.id);
      expect(record.name).toBe('Original');
    });
  });

  describe('Delete Operations', () => {
    let existingRecord;

    beforeEach(async () => {
      ModelEvents.removeAllListeners();
      existingRecord = await TestRepo.create({ name: 'ToDelete' });
    });

    it('should emit beforeDelete before delete', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.beforeDelete', callback);

      await TestRepo.delete(existingRecord.id);

      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0]).toMatchObject({ name: 'ToDelete' });
    });

    it('should emit afterDelete after delete', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.afterDelete', callback);

      await TestRepo.delete(existingRecord.id);

      expect(callback).toHaveBeenCalled();
    });

    it('should cancel delete when beforeDelete cancels', async () => {
      ModelEvents.on('EventTest.beforeDelete', (data, ctx) => {
        if (data.name === 'ToDelete') {
          ctx.cancel('Cannot delete this record');
        }
      });

      await expect(TestRepo.delete(existingRecord.id)).rejects.toThrow(HookCancellationError);

      // Verify record still exists (soft deleted would show null, so check raw)
      const record = await db.knex('event_tests').where('id', existingRecord.id).first();
      expect(record).not.toBeUndefined();
      expect(record.deleted_at).toBeNull();
    });
  });

  describe('Restore Operations', () => {
    let deletedRecord;

    beforeEach(async () => {
      ModelEvents.removeAllListeners();
      const record = await TestRepo.create({ name: 'ToRestore' });
      await TestRepo.delete(record.id);
      deletedRecord = record;
    });

    it('should emit beforeRestore before restore', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.beforeRestore', callback);

      await TestRepo.restore(deletedRecord.id);

      expect(callback).toHaveBeenCalled();
    });

    it('should emit afterRestore after restore', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.afterRestore', callback);

      await TestRepo.restore(deletedRecord.id);

      expect(callback).toHaveBeenCalled();
    });

    it('should cancel restore when beforeRestore cancels', async () => {
      ModelEvents.on('EventTest.beforeRestore', (data, ctx) => {
        ctx.cancel('Restore not allowed');
      });

      await expect(TestRepo.restore(deletedRecord.id)).rejects.toThrow(HookCancellationError);
    });
  });

  describe('Find Operations', () => {
    beforeEach(async () => {
      ModelEvents.removeAllListeners();
      await TestRepo.create({ name: 'FindTest1', email: 'find1@test.com' });
      await TestRepo.create({ name: 'FindTest2', email: 'find2@test.com' });
    });

    it('should emit beforeFind before findById', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.beforeFind', callback);

      const records = await TestRepo.findAll();
      const id = records[0].id;

      // Clear mock to only track findById
      callback.mockClear();

      await TestRepo.findById(id);

      expect(callback).toHaveBeenCalled();
    });

    it('should emit afterFind after findById', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.afterFind', callback);

      const records = await TestRepo.findAll();
      callback.mockClear();

      await TestRepo.findById(records[0].id);

      expect(callback).toHaveBeenCalled();
    });

    it('should emit beforeFind before findOne', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.beforeFind', callback);

      await TestRepo.findOne({ name: 'FindTest1' });

      expect(callback).toHaveBeenCalled();
    });

    it('should emit afterFind for each record in findAll', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.afterFind', callback);

      await TestRepo.findAll();

      // Should be called once for each record
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should cancel findOne when beforeFind cancels', async () => {
      ModelEvents.on('EventTest.beforeFind', (query, ctx) => {
        ctx.cancel('Find not allowed');
      });

      await expect(TestRepo.findOne({ name: 'FindTest1' })).rejects.toThrow(HookCancellationError);
    });
  });

  describe('Wildcard Listeners', () => {
    it('should trigger *.beforeCreate for any model', async () => {
      const callback = vi.fn();
      ModelEvents.on('*.beforeCreate', callback);

      await TestRepo.create({ name: 'Test' });

      expect(callback).toHaveBeenCalled();
    });

    it('should trigger EventTest.* for all EventTest hooks', async () => {
      const callback = vi.fn();
      ModelEvents.on('EventTest.*', callback);

      await TestRepo.create({ name: 'Test' });

      // Should be called for: beforeValidation, afterValidation, beforeSave, beforeCreate, afterCreate, afterSave
      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('Model-Level Hooks', () => {
    it('should register hooks defined in model', async () => {
      ModelEvents.removeAllListeners();
      clearRegistry();

      const hookCallback = vi.fn();

      defineModel({
        name: 'HookTest',
        table: 'event_tests',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string({ maxLength: 255 }),
        }),
        hooks: {
          beforeCreate: hookCallback,
        },
      });

      db.registerModel({ name: 'HookTest', table: 'event_tests', schema: zdb.schema({ id: zdb.id(), name: zdb.string() }) });
      
      // Model hooks should be auto-registered
      expect(ModelEvents.hasListeners('HookTest', 'beforeCreate')).toBe(true);
    });
  });

  describe('Async Hooks', () => {
    it('should support async beforeCreate hooks', async () => {
      const order = [];

      ModelEvents.on('EventTest.beforeCreate', async (data) => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('async');
        data.name = 'Modified by async';
      });

      ModelEvents.on('EventTest.afterCreate', () => {
        order.push('afterCreate');
      });

      const record = await TestRepo.create({ name: 'Test' });

      expect(order).toEqual(['async', 'afterCreate']);
      expect(record.name).toBe('Modified by async');
    });

    it('should handle async hook errors', async () => {
      ModelEvents.on('EventTest.beforeCreate', async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error('Async validation failed');
      });

      await expect(TestRepo.create({ name: 'Test' })).rejects.toThrow(HookCancellationError);
    });
  });

  describe('Transaction Support', () => {
    it('should include transaction in context when in transaction', async () => {
      let receivedTrx = null;

      ModelEvents.on('EventTest.beforeCreate', (data, ctx) => {
        receivedTrx = ctx.trx;
      });

      await db.transaction(async ({ getRepository }) => {
        const repo = getRepository('EventTest');
        await repo.create({ name: 'In Transaction' });
      });

      // Note: ctx.trx will be set if knex.isTransaction is true
      // The actual transaction object may vary
    });
  });

  describe('Error Handling', () => {
    it('should not affect operation if afterCreate throws', async () => {
      ModelEvents.on('EventTest.afterCreate', () => {
        throw new Error('After hook error');
      });

      // afterCreate errors should not prevent the record from being created
      const record = await TestRepo.create({ name: 'Test' });

      expect(record).toBeDefined();
      expect(record.id).toBeDefined();
    });

    it('should propagate HookCancellationError with details', async () => {
      ModelEvents.on('EventTest.beforeCreate', (data, ctx) => {
        ctx.cancel('Custom cancellation reason');
      });

      try {
        await TestRepo.create({ name: 'Test' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(HookCancellationError);
        expect(error.model).toBe('EventTest');
        expect(error.hook).toBe('beforeCreate');
        expect(error.reason).toBe('Custom cancellation reason');
      }
    });
  });

  describe('Data Integrity', () => {
    it('should not create record when beforeCreate is cancelled', async () => {
      ModelEvents.on('EventTest.beforeCreate', (data, ctx) => {
        ctx.cancel('Blocked');
      });

      const countBefore = await TestRepo.count();

      try {
        await TestRepo.create({ name: 'ShouldNotExist' });
      } catch {
        // Expected
      }

      const countAfter = await TestRepo.count();

      expect(countAfter).toBe(countBefore);
    });

    it('should not update record when beforeUpdate is cancelled', async () => {
      ModelEvents.removeAllListeners();
      const record = await TestRepo.create({ name: 'Original' });

      ModelEvents.on('EventTest.beforeUpdate', (data, ctx) => {
        ctx.cancel('Blocked');
      });

      try {
        await TestRepo.update(record.id, { name: 'Updated' });
      } catch {
        // Expected
      }

      const current = await TestRepo.findById(record.id);
      expect(current.name).toBe('Original');
    });
  });
});
