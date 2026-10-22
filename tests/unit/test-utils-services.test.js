const {
  createMockServiceContext,
  createMockServiceRegistry,
  defineMockService,
} = require('../utils/services');

describe('Test Utilities - Services & Context Mocks (Step 6)', () => {
  describe('createMockServiceContext', () => {
    it('creates context with mock db, logger, queue, events, and service', async () => {
      const ctx = createMockServiceContext({
        user: { id: 1, role: 'admin' },
      });

      expect(ctx.user).toEqual({ id: 1, role: 'admin' });
      expect(ctx.db).toBeDefined();
      expect(typeof ctx.db.getRepository).toBe('function');
      expect(typeof ctx.service).toBe('function');
      expect(typeof ctx.logger.info).toBe('function');
      expect(typeof ctx.queue.dispatch).toBe('function');
      expect(typeof ctx.events.emit).toBe('function');

      const defaultResult = await ctx.service('any.service', { foo: 'bar' });
      expect(defaultResult).toEqual({ ok: true, name: 'any.service', input: { foo: 'bar' } });
    });

    it('supports mocking specific child services via mockService()', async () => {
      const ctx = createMockServiceContext();

      ctx.mockService('auth.verify', { valid: true, userId: 42 });
      ctx.mockService('tax.calculate', (input) => ({ tax: input.amount * 0.2 }));

      const authRes = await ctx.service('auth.verify', { token: 'xyz' });
      expect(authRes).toEqual({ valid: true, userId: 42 });

      const taxRes = await ctx.service('tax.calculate', { amount: 100 });
      expect(taxRes).toEqual({ tax: 20 });
    });
  });

  describe('createMockServiceRegistry', () => {
    it('registers initial services and executes them via call()', async () => {
      const registry = createMockServiceRegistry({
        'math.add': async (input) => input.a + input.b,
        'user.get': {
          async handler(input) {
            return { id: input.id, name: 'Alice' };
          },
        },
      });

      const addResult = await registry.call('math.add', { a: 10, b: 20 }, {});
      expect(addResult).toBe(30);

      const userResult = await registry.call('user.get', { id: 1 }, {});
      expect(userResult).toEqual({ id: 1, name: 'Alice' });

      // Verifies registry.call tracking
      expect(registry.call).toHaveBeenCalledTimes(2);
    });
  });

  describe('defineMockService', () => {
    it('standardizes function handler into registration pair', () => {
      const pair = defineMockService('order.cancel', async () => 'cancelled');
      expect(pair.name).toBe('order.cancel');
      expect(typeof pair.def.handler).toBe('function');
    });
  });
});
