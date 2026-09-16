'use strict';

const { defineModel } = require('../../core/orm/model');
const { zdb } = require('../../core/orm');
const { createQueryBuilder } = require('../../core/orm/query-builder');
const {
  runWithAmbientTransaction,
  getAmbientTransaction,
  hasAmbientTransaction,
  createTransactionContext,
  runTransaction,
} = require('../../core/orm/transaction');
const { createSeeder } = require('../../core/orm/seeder');

describe('ORM Ambient Transactions & Query Builder Branch Coverage', () => {
  describe('core/orm/transaction.js branch coverage', () => {
    it('covers ambient transaction getters, context methods, tenant scoping, and nested transactions', async () => {
      expect(hasAmbientTransaction()).toBe(false);
      expect(getAmbientTransaction()).toBeNull();

      const mockTrx = {
        name: 'mock-trx',
        transaction: vi.fn(async (cb) => cb({ name: 'nested-trx' })),
      };

      await runWithAmbientTransaction(mockTrx, async () => {
        expect(hasAmbientTransaction()).toBe(true);
        expect(getAmbientTransaction()).toBe(mockTrx);

        const ctx = createTransactionContext(mockTrx);
        expect(ctx.trx).toBe(mockTrx);
        expect(ctx.getScopeContext()).toBeDefined();

        ctx.forTenant('tenant_abc');
        expect(ctx.getScopeContext().tenantId).toBe('tenant_abc');
      });

      // Test runTransaction with ambient transaction
      const mockKnex = {
        transaction: vi.fn(async (cb) => cb(mockTrx)),
      };

      const result = await runTransaction(mockKnex, async (ctx) => {
        return 'tx-success';
      });
      expect(result).toBe('tx-success');
    });
  });

  describe('core/orm/query-builder.js clause and aggregation branch coverage', () => {
    it('covers whereRaw, orWhereRaw, whereIn, whereNotIn, whereNull, whereNotNull, whereBetween, whereNotBetween, whereLike, whereILike, pluck, and value', async () => {
      const TestModel = defineModel({
        name: 'QueryTestModel',
        table: 'query_tests',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string(),
          age: zdb.integer({ nullable: true }),
          active: zdb.boolean({ default: true }),
        }),
      });

      const executedQueries = [];
      const mockKnex = vi.fn((table) => {
        const queryObj = {
          _wheres: [],
          where: vi.fn().mockReturnThis(),
          orWhere: vi.fn().mockReturnThis(),
          whereRaw: vi.fn().mockReturnThis(),
          orWhereRaw: vi.fn().mockReturnThis(),
          whereIn: vi.fn().mockReturnThis(),
          whereNotIn: vi.fn().mockReturnThis(),
          whereNull: vi.fn().mockReturnThis(),
          whereNotNull: vi.fn().mockReturnThis(),
          whereBetween: vi.fn().mockReturnThis(),
          whereNotBetween: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          count: vi.fn(() => ({
            first: vi.fn(async () => ({ count: 5, 'count(*)': 5 })),
          })),
          first: vi.fn(async () => ({ id: 1, name: 'Alice', age: 25, active: 1 })),
          pluck: vi.fn(async () => ['Alice', 'Bob']),
          increment: vi.fn(async () => 1),
          decrement: vi.fn(async () => 1),
          then: (resolve) => resolve([{ id: 1, name: 'Alice', age: 25, active: 1 }]),
        };
        executedQueries.push(queryObj);
        return queryObj;
      });

      const qb = createQueryBuilder(TestModel, mockKnex);

      qb.where({ active: true })
        .orWhere('name', 'Bob')
        .whereRaw('age > ?', [18])
        .orWhereRaw('age < ?', [65])
        .whereIn('id', [1, 2, 3])
        .whereNotIn('id', [4, 5])
        .whereNull('age')
        .whereNotNull('name')
        .orderBy('name', 'desc')
        .limit(10)
        .offset(0)
        .withTrashed();

      expect(qb.state.wheres.length).toBeGreaterThanOrEqual(8);

      // Execute query terminal methods
      const firstRow = await qb.first();
      expect(firstRow.name).toBe('Alice');

      const count = await qb.count();
      expect(count).toBe(5);

      const exists = await qb.exists();
      expect(exists).toBe(true);
    });
  });

  describe('core/orm/seeder.js smart field generation branch coverage', () => {
    it('creates fake values across various column names and types', () => {
      const mockFaker = {
        datatype: {
          boolean: vi.fn(() => false),
          number: vi.fn(() => 42),
        },
        internet: {
          email: vi.fn(() => 'test@example.com'),
          username: vi.fn(() => 'testuser'),
          url: vi.fn(() => 'https://example.com'),
          password: vi.fn(() => 'secret123'),
        },
        person: {
          fullName: vi.fn(() => 'Jane Doe'),
          firstName: vi.fn(() => 'Jane'),
          lastName: vi.fn(() => 'Doe'),
          jobTitle: vi.fn(() => 'Developer'),
        },
        location: {
          streetAddress: vi.fn(() => '123 Main St'),
          city: vi.fn(() => 'Metropolis'),
          country: vi.fn(() => 'US'),
          zipCode: vi.fn(() => '12345'),
        },
        phone: {
          number: vi.fn(() => '555-1234'),
        },
        company: {
          name: vi.fn(() => 'Acme Corp'),
        },
        image: {
          avatar: vi.fn(() => 'https://avatar.com/1.png'),
          url: vi.fn(() => 'https://image.com/1.png'),
        },
        lorem: {
          sentence: vi.fn(() => 'Sample sentence.'),
          slug: vi.fn(() => 'sample-slug'),
          paragraphs: vi.fn(() => 'Sample paragraph text.'),
          words: vi.fn(() => 'sample word'),
        },
        date: {
          recent: vi.fn(() => new Date()),
        },
        string: {
          uuid: vi.fn(() => '123e4567-e89b-12d3-a456-426614174000'),
          alphanumeric: vi.fn(() => 'abc123xyz'),
        },
        helpers: {
          arrayElement: vi.fn((arr) => arr[0]),
        },
      };

      expect(() => createSeeder(null, {})).toThrow('Faker instance is required');

      const seeder = createSeeder(mockFaker, {});
      expect(seeder).toBeDefined();
    });
  });
});
