const { z } = require('zod');
const { createDatabase, defineModel, clearRegistry } = require('../../../core/orm');
const {
  getAmbientTransaction,
  hasAmbientTransaction,
  runWithAmbientTransaction,
} = require('../../../core/orm/transaction');
const { createServiceRegistry } = require('../../../src/services');

describe('ORM Ambient Transaction Management', () => {
  let db;

  beforeEach(async () => {
    clearRegistry();
    db = createDatabase({
      client: 'better-sqlite3',
      connection: {
        filename: ':memory:',
      },
      useNullAsDefault: true,
      cache: false,
    });

    // Create a test schema
    await db.knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('email').notNullable();
      table.integer('balance').defaultTo(0);
      table.timestamp('created_at').defaultTo(db.knex.fn.now());
      table.timestamp('updated_at').defaultTo(db.knex.fn.now());
    });

    defineModel({
      name: 'User',
      table: 'users',
      schema: z.object({
        id: z.number().optional(),
        name: z.string(),
        email: z.string(),
        balance: z.number().default(0),
        created_at: z.date().optional(),
        updated_at: z.date().optional(),
      }),
    });
  });

  afterEach(async () => {
    if (db) {
      await db.destroy();
    }
  });

  describe('Basic Ambient Storage Lifecycle', () => {
    it('reports no active transaction outside transaction boundary', () => {
      expect(hasAmbientTransaction()).toBe(false);
      expect(getAmbientTransaction()).toBe(null);
      expect(db.hasActiveTransaction()).toBe(false);
      expect(db.getAmbientTransaction()).toBe(null);
    });

    it('exposes active transaction inside runWithAmbientTransaction', async () => {
      const mockTrx = { isMock: true };
      await runWithAmbientTransaction(mockTrx, async () => {
        expect(hasAmbientTransaction()).toBe(true);
        expect(getAmbientTransaction()).toBe(mockTrx);
        expect(db.hasActiveTransaction()).toBe(true);
        expect(db.getAmbientTransaction()).toBe(mockTrx);
      });
      expect(hasAmbientTransaction()).toBe(false);
    });
  });

  describe('db.transaction with Automatic Ambient Repository Binding', () => {
    it('automatically binds db.getRepository calls to the transaction without explicit trx passing', async () => {
      const userRepo = db.getRepository('User');

      await db.transaction(async () => {
        expect(db.hasActiveTransaction()).toBe(true);
        // Direct call to root repository instance inside transaction block
        await userRepo.create({ name: 'Alice', email: 'alice@example.com', balance: 100 });
        await userRepo.create({ name: 'Bob', email: 'bob@example.com', balance: 200 });

        const countInside = await userRepo.count();
        expect(countInside).toBe(2);
      });

      // Data is committed
      const allUsers = await userRepo.findAll();
      expect(allUsers).toHaveLength(2);
      expect(allUsers.map((u) => u.name)).toEqual(['Alice', 'Bob']);
    });

    it('rolls back repository operations when transaction block throws an error', async () => {
      const userRepo = db.getRepository('User');

      // Seed initial user outside transaction
      await userRepo.create({ name: 'Initial', email: 'initial@example.com', balance: 50 });

      let errorCaught = null;
      try {
        await db.transaction(async () => {
          // Add second user via standard repo
          await userRepo.create({ name: 'RollbackMe', email: 'rollback@example.com', balance: 150 });
          // Update initial user balance
          const initial = await userRepo.findOne({ email: 'initial@example.com' });
          await userRepo.update(initial.id, { balance: 999 });

          throw new Error('Something failed in business logic!');
        });
      } catch (err) {
        errorCaught = err;
      }

      expect(errorCaught).toBeTruthy();
      expect(errorCaught.message).toBe('Something failed in business logic!');

      // Check database state - should be completely restored to initial
      const usersAfter = await userRepo.findAll();
      expect(usersAfter).toHaveLength(1);
      expect(usersAfter[0].name).toBe('Initial');
      expect(usersAfter[0].balance).toBe(50);
    });

    it('works with query builder methods inside ambient transaction', async () => {
      const userRepo = db.getRepository('User');
      await userRepo.create({ name: 'User 1', email: 'u1@example.com', balance: 10 });
      await userRepo.create({ name: 'User 2', email: 'u2@example.com', balance: 20 });

      let thrown = false;
      try {
        await db.transaction(async () => {
          // Use QueryBuilder to update records
          await userRepo.query().where('balance', '>', 15).update({ balance: 500 });
          const user2 = await userRepo.query().where('email', 'u2@example.com').first();
          expect(user2.balance).toBe(500);

          // Force rollback
          throw new Error('QueryBuilder Rollback Test');
        });
      } catch (err) {
        thrown = true;
      }

      expect(thrown).toBe(true);
      const user2After = await userRepo.findOne({ email: 'u2@example.com' });
      expect(user2After.balance).toBe(20);
    });
  });

  describe('Services Layer Ambient Transaction Propagation', () => {
    it('automatically binds repository operations in services with transaction: true', async () => {
      const registry = createServiceRegistry();
      const userRepo = db.getRepository('User');

      registry.register('user.transfer', {
        transaction: true,
        schema: z.object({
          fromEmail: z.string(),
          toEmail: z.string(),
          amount: z.number(),
        }),
        handler: async (input, ctx) => {
          const fromUser = await userRepo.findOne({ email: input.fromEmail });
          const toUser = await userRepo.findOne({ email: input.toEmail });

          if (!fromUser || !toUser) {
            throw new Error('User not found');
          }

          if (fromUser.balance < input.amount) {
            throw new Error('Insufficient balance');
          }

          await userRepo.update(fromUser.id, { balance: fromUser.balance - input.amount });
          await userRepo.update(toUser.id, { balance: toUser.balance + input.amount });

          return { success: true };
        },
      });

      // Create two test users
      await userRepo.create({ name: 'Sender', email: 'sender@example.com', balance: 100 });
      await userRepo.create({ name: 'Receiver', email: 'receiver@example.com', balance: 50 });

      // Successful transfer
      await registry.execute('user.transfer', {
        fromEmail: 'sender@example.com',
        toEmail: 'receiver@example.com',
        amount: 40,
      }, { db });

      const senderAfter1 = await userRepo.findOne({ email: 'sender@example.com' });
      const receiverAfter1 = await userRepo.findOne({ email: 'receiver@example.com' });
      expect(senderAfter1.balance).toBe(60);
      expect(receiverAfter1.balance).toBe(90);

      // Failed transfer (insufficient funds) - should rollback
      await expect(
        registry.execute('user.transfer', {
          fromEmail: 'sender@example.com',
          toEmail: 'receiver@example.com',
          amount: 1000,
        }, { db })
      ).rejects.toThrow('Insufficient balance');

      // Verify balances are unchanged after failure
      const senderAfter2 = await userRepo.findOne({ email: 'sender@example.com' });
      const receiverAfter2 = await userRepo.findOne({ email: 'receiver@example.com' });
      expect(senderAfter2.balance).toBe(60);
      expect(receiverAfter2.balance).toBe(90);
    });

    it('propagates transaction to nested service calls without nested commit or deadlock', async () => {
      const registry = createServiceRegistry();
      const userRepo = db.getRepository('User');

      // Sub-service 1
      registry.register('user.deduct', {
        transaction: true,
        schema: z.object({
          email: z.string(),
          amount: z.number(),
        }),
        handler: async (input, ctx) => {
          const user = await userRepo.findOne({ email: input.email });
          if (user.balance < input.amount) throw new Error('Cannot deduct');
          await userRepo.update(user.id, { balance: user.balance - input.amount });
          return user.balance - input.amount;
        },
      });

      // Sub-service 2
      registry.register('user.credit', {
        transaction: true,
        schema: z.object({
          email: z.string(),
          amount: z.number(),
        }),
        handler: async (input, ctx) => {
          const user = await userRepo.findOne({ email: input.email });
          await userRepo.update(user.id, { balance: user.balance + input.amount });
          return user.balance + input.amount;
        },
      });

      // Orchestrator service calling both sub-services
      registry.register('transfer.orchestrate', {
        transaction: true,
        schema: z.object({
          from: z.string(),
          to: z.string(),
          amount: z.number(),
          failAtEnd: z.boolean().optional(),
        }),
        handler: async (input, ctx) => {
          await ctx.service('user.deduct', { email: input.from, amount: input.amount });
          await ctx.service('user.credit', { email: input.to, amount: input.amount });

          if (input.failAtEnd) {
            throw new Error('Orchestration failed at final step');
          }

          return { done: true };
        },
      });

      await userRepo.create({ name: 'U1', email: 'u1@test.com', balance: 200 });
      await userRepo.create({ name: 'U2', email: 'u2@test.com', balance: 100 });

      // Test successful orchestration
      await registry.execute('transfer.orchestrate', {
        from: 'u1@test.com',
        to: 'u2@test.com',
        amount: 50,
      }, { db });

      expect((await userRepo.findOne({ email: 'u1@test.com' })).balance).toBe(150);
      expect((await userRepo.findOne({ email: 'u2@test.com' })).balance).toBe(150);

      // Test failure at end: both sub-services should roll back!
      await expect(
        registry.execute('transfer.orchestrate', {
          from: 'u1@test.com',
          to: 'u2@test.com',
          amount: 50,
          failAtEnd: true,
        }, { db })
      ).rejects.toThrow('Orchestration failed at final step');

      // Values should remain 150 / 150
      expect((await userRepo.findOne({ email: 'u1@test.com' })).balance).toBe(150);
      expect((await userRepo.findOne({ email: 'u2@test.com' })).balance).toBe(150);
    });
  });
});
