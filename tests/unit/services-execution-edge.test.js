const {
  ServiceRegistry,
  createServiceRegistry,
  WebspressoError,
} = require('../../index');

describe('Services Execution & Lifecycle Edge Cases (Section 2 Hardened)', () => {
  describe('Timeout Handling', () => {
    it('should abort and throw SERVICE_TIMEOUT when handler exceeds configured timeout', async () => {
      const registry = new ServiceRegistry();

      registry.register('slow.service', {
        timeout: '40ms',
        async handler() {
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { ok: true };
        },
      });

      await expect(registry.call('slow.service')).rejects.toThrow(
        /Service 'slow.service' timed out after 40ms/
      );

      try {
        await registry.call('slow.service');
      } catch (err) {
        expect(err.code).toBe('SERVICE_TIMEOUT');
        expect(err.statusCode).toBe(504);
        expect(err.service).toBe('slow.service');
      }
    });

    it('should complete normally when execution is faster than timeout', async () => {
      const registry = new ServiceRegistry();

      registry.register('fast.service', {
        timeout: '2s',
        async handler({ val }) {
          return { doubled: val * 2 };
        },
      });

      const res = await registry.call('fast.service', { val: 5 });
      expect(res.doubled).toBe(10);
    });

    it('should allow overriding timeout per-call via options', async () => {
      const registry = new ServiceRegistry();

      registry.register('configurable.service', {
        async handler() {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'done';
        },
      });

      await expect(
        registry.call('configurable.service', {}, {}, { timeout: 30 })
      ).rejects.toThrow(/timed out after 30ms/);
    });
  });

  describe('Database Transaction Boundary (transaction: true)', () => {
    it('should wrap handler in db.transaction when transaction: true is declared', async () => {
      const registry = new ServiceRegistry();
      let committed = false;
      let rolledBack = false;

      const mockTrx = {
        name: 'mock-trx-123',
      };

      const mockDb = {
        transaction: async (cb) => {
          try {
            const res = await cb(mockTrx);
            committed = true;
            return res;
          } catch (e) {
            rolledBack = true;
            throw e;
          }
        },
      };

      registry.register('user.createWithWallet', {
        transaction: true,
        async handler({ name }, ctx) {
          expect(ctx.trx).toBe(mockTrx);
          expect(ctx.db).toBe(mockTrx);
          return { id: 1, name };
        },
      });

      const res = await registry.call('user.createWithWallet', { name: 'Alice' }, { db: mockDb });
      expect(res.id).toBe(1);
      expect(committed).toBe(true);
      expect(rolledBack).toBe(false);
    });

    it('should automatically roll back transaction when handler throws an error', async () => {
      const registry = new ServiceRegistry();
      let rolledBack = false;

      const mockDb = {
        transaction: async (cb) => {
          try {
            return await cb({});
          } catch (e) {
            rolledBack = true;
            throw e;
          }
        },
      };

      registry.register('failing.tx', {
        transaction: true,
        async handler() {
          throw new Error('Balance insufficient');
        },
      });

      await expect(registry.call('failing.tx', {}, { db: mockDb })).rejects.toThrow('Balance insufficient');
      expect(rolledBack).toBe(true);
    });

    it('should reuse existing parent ctx.trx in nested services without creating nested transactions', async () => {
      const registry = new ServiceRegistry();
      let txCreationCount = 0;

      const parentTrx = { id: 'parent-trx' };
      const mockDb = {
        transaction: async (cb) => {
          txCreationCount++;
          return await cb(parentTrx);
        },
      };

      registry.register('parent.op', {
        transaction: true,
        async handler(input, ctx) {
          return await ctx.service('child.op', input);
        },
      });

      registry.register('child.op', {
        transaction: true,
        async handler(input, ctx) {
          expect(ctx.trx).toBe(parentTrx);
          return { childExecuted: true };
        },
      });

      const res = await registry.call('parent.op', {}, { db: mockDb });
      expect(res.childExecuted).toBe(true);
      expect(txCreationCount).toBe(1); // Only 1 root transaction created!
    });
  });

  describe('Concurrency & Call Stack Branching Isolation', () => {
    it('should safely execute parallel sibling calls without call stack collisions', async () => {
      const registry = new ServiceRegistry();
      let sharedCount = 0;

      registry.register('shared.worker', {
        async handler({ id }) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          sharedCount++;
          return { id, sharedCount };
        },
      });

      registry.register('branch.a', {
        async handler(input, ctx) {
          return await ctx.service('shared.worker', { id: 'a' });
        },
      });

      registry.register('branch.b', {
        async handler(input, ctx) {
          return await ctx.service('shared.worker', { id: 'b' });
        },
      });

      const rootCtx = { logger: null };

      // Parallel execution from the same root context
      const [resA, resB] = await Promise.all([
        registry.call('branch.a', {}, rootCtx),
        registry.call('branch.b', {}, rootCtx),
      ]);

      expect(resA.id).toBe('a');
      expect(resB.id).toBe('b');
      expect(sharedCount).toBe(2);
    });

    it('should still accurately detect actual recursion cycles', async () => {
      const registry = new ServiceRegistry();

      registry.register('cycle.a', {
        async handler(input, ctx) {
          return await ctx.service('cycle.b', input);
        },
      });

      registry.register('cycle.b', {
        async handler(input, ctx) {
          return await ctx.service('cycle.a', input);
        },
      });

      await expect(registry.call('cycle.a')).rejects.toThrow(
        /Circular service call detected:\s*cycle\.a -> cycle\.b -> cycle\.a/
      );
    });
  });
});
