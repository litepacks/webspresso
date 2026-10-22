const {
  ServiceRegistry,
  createServiceRegistry,
  createCoreApp,
} = require('../../index');

describe('Services Ambient Transaction Safety & Ergonomics', () => {
  describe('ctx.service.call and ctx.service.execute delegation', () => {
    it('should safely delegate ctx.service.call without triggering Function.prototype.call thisArg trap', async () => {
      const registry = new ServiceRegistry();

      registry.register('child.multiply', {
        async handler({ a, b }) {
          return a * b;
        },
      });

      registry.register('parent.calc', {
        async handler(input, ctx) {
          // If Function.prototype.call were invoked, 'child.multiply' would be thisArg,
          // and { a: 6, b: 7 } would be the first parameter (subName), breaking service resolution.
          const resFromCall = await ctx.service.call('child.multiply', { a: 6, b: 7 });
          const resFromExecute = await ctx.service.execute('child.multiply', { a: 3, b: 4 });
          const resFromDirect = await ctx.service('child.multiply', { a: 2, b: 5 });

          return { resFromCall, resFromExecute, resFromDirect };
        },
      });

      const result = await registry.call('parent.calc');
      expect(result.resFromCall).toBe(42);
      expect(result.resFromExecute).toBe(12);
      expect(result.resFromDirect).toBe(10);
    });

    it('should support .call and .execute on app.service and context.service', async () => {
      const app = createCoreApp();

      app.serviceRegistry.register('math.add', {
        async handler({ x, y }) {
          return x + y;
        },
      });

      expect(typeof app.service.call).toBe('function');
      expect(typeof app.service.execute).toBe('function');

      const appCallRes = await app.service.call('math.add', { x: 10, y: 20 });
      const appExecRes = await app.service.execute('math.add', { x: 5, y: 15 });
      expect(appCallRes).toBe(30);
      expect(appExecRes).toBe(20);

      const ctx = app.createContext();
      expect(typeof ctx.service.call).toBe('function');
      expect(typeof ctx.service.execute).toBe('function');

      const ctxCallRes = await ctx.service.call('math.add', { x: 1, y: 2 });
      const ctxExecRes = await ctx.service.execute('math.add', { x: 3, y: 4 });
      expect(ctxCallRes).toBe(3);
      expect(ctxExecRes).toBe(7);

      await app.close();
    });
  });

  describe('Null-safe Repository and Query Wrapping in Ambient Transactions', () => {
    it('should safely return null/undefined for unknown models without throwing TypeError on .model', async () => {
      const registry = new ServiceRegistry();
      let capturedNullRepo = false;
      let capturedUndefinedRepo = false;

      const mockTrx = { id: 'trx-99' };
      const mockDb = {
        transaction: async (cb) => cb(mockTrx),
        getRepository: (name) => {
          if (name === 'NullModel') return null;
          if (name === 'UndefinedModel') return undefined;
          return { model: { name, table: 'test' } };
        },
      };

      registry.register('safe.repo.access', {
        transaction: true,
        async handler(input, ctx) {
          // Accessing an undefined model inside transaction must not throw TypeError: Cannot read properties of undefined (reading 'model')
          const nullRepo = ctx.db.getRepository('NullModel');
          const undefRepo = ctx.db.getRepository('UndefinedModel');
          const validRepo = ctx.db.getRepository('ValidModel');

          capturedNullRepo = (nullRepo === null);
          capturedUndefinedRepo = (undefRepo === undefined || undefRepo === null);

          return {
            hasValidRepo: Boolean(validRepo && validRepo.model),
            validModelName: validRepo?.model?.name,
          };
        },
      });

      const res = await registry.call('safe.repo.access', {}, { db: mockDb });
      expect(capturedNullRepo).toBe(true);
      expect(capturedUndefinedRepo).toBe(true);
      expect(res.hasValidRepo).toBe(true);
      expect(res.validModelName).toBe('ValidModel');
    });

    it('should forward txCtx.db.query to query builder with transaction and cache layer', async () => {
      const registry = new ServiceRegistry();

      const mockTrx = { isTrx: true };
      const mockModel = { name: 'Item', table: 'items' };
      let queryTrxUsed = null;

      const mockDb = {
        transaction: async (cb) => cb(mockTrx),
        getRepository: (name) => ({
          model: mockModel,
          cacheLayer: { id: 'test-cache' },
        }),
        query: (name) => ({ raw: true }),
      };

      registry.register('query.tx.test', {
        transaction: true,
        async handler(input, ctx) {
          expect(typeof ctx.db.query).toBe('function');
          const qb = ctx.db.query('Item');
          // Verify query builder received trx as its knex instance
          queryTrxUsed = qb.knex;
          return { success: true };
        },
      });

      await registry.call('query.tx.test', {}, { db: mockDb });
      expect(queryTrxUsed).toBe(mockTrx);
    });

    it('should support .call and .execute inside transactional context (txCtx.service)', async () => {
      const registry = new ServiceRegistry();
      const mockTrx = { id: 'root-tx' };
      const mockDb = {
        transaction: async (cb) => cb(mockTrx),
        getRepository: () => ({ model: { name: 'Test' } }),
      };

      registry.register('inner.work', {
        async handler({ msg }, ctx) {
          return { msg, insideTx: ctx.trx === mockTrx };
        },
      });

      registry.register('outer.work', {
        transaction: true,
        async handler(input, ctx) {
          // Inside txCtx.service
          expect(typeof ctx.service.call).toBe('function');
          expect(typeof ctx.service.execute).toBe('function');

          const r1 = await ctx.service.call('inner.work', { msg: 'called' });
          const r2 = await ctx.service.execute('inner.work', { msg: 'executed' });

          return { r1, r2 };
        },
      });

      const res = await registry.call('outer.work', {}, { db: mockDb });
      expect(res.r1.msg).toBe('called');
      expect(res.r1.insideTx).toBe(true);
      expect(res.r2.msg).toBe('executed');
      expect(res.r2.insideTx).toBe(true);
    });
  });
});
