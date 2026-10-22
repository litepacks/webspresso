'use strict';

const {
  ServiceRegistry,
  createServiceRegistry,
  defineService,
  composeMiddleware,
} = require('../../src/services');
const { WebspressoError, NotFoundError } = require('../../core/errors');

describe('Services Middleware & Lifecycle Hooks', () => {
  describe('1. composeMiddleware Engine', () => {
    it('executes middlewares in strict onion order (first in, last out)', async () => {
      const order = [];

      const m1 = async (context, next) => {
        order.push('m1_enter');
        const res = await next();
        order.push('m1_exit');
        return res;
      };

      const m2 = async (context, next) => {
        order.push('m2_enter');
        const res = await next();
        order.push('m2_exit');
        return res;
      };

      const composed = composeMiddleware([m1, m2]);
      const result = await composed({}, async () => {
        order.push('handler');
        return 'done';
      });

      expect(result).toBe('done');
      expect(order).toEqual(['m1_enter', 'm2_enter', 'handler', 'm2_exit', 'm1_exit']);
    });

    it('supports 3-arg middleware signature (input, ctx, next)', async () => {
      const m = async (input, ctx, next) => {
        input.enriched = true;
        ctx.tag = 'tagged';
        return await next();
      };

      const context = { input: { val: 1 }, ctx: {} };
      const composed = composeMiddleware([m]);

      await composed(context, async () => {
        expect(context.input.enriched).toBe(true);
        expect(context.ctx.tag).toBe('tagged');
      });
    });

    it('rejects if next() is called multiple times', async () => {
      const badMiddleware = async (context, next) => {
        await next();
        await next();
      };

      const composed = composeMiddleware([badMiddleware]);
      await expect(composed({}, async () => 'ok')).rejects.toThrow('next() called multiple times');
    });

    it('throws TypeError if middlewares is not an array', () => {
      expect(() => composeMiddleware('invalid')).toThrow(TypeError);
    });
  });

  describe('2. Global Registry Middlewares (registry.use)', () => {
    it('wraps execution and can modify input, observe context, and transform result', async () => {
      const registry = new ServiceRegistry();

      registry.use(async ({ name, input, ctx }, next) => {
        input.amount += 10; // add surcharge
        const res = await next();
        return {
          ...res,
          interceptedBy: 'global-mw',
          serviceName: name,
        };
      });

      registry.register('checkout.calculate', {
        handler: async (input) => ({ total: input.amount }),
      });

      const result = await registry.execute('checkout.calculate', { amount: 50 });

      expect(result).toEqual({
        total: 60,
        interceptedBy: 'global-mw',
        serviceName: 'checkout.calculate',
      });
    });

    it('can short-circuit execution without invoking handler (e.g. mock / test mode)', async () => {
      const registry = new ServiceRegistry();
      let handlerCalled = false;

      registry.use(async ({ options }, next) => {
        if (options.mock) {
          return { mocked: true };
        }
        return await next();
      });

      registry.register('external.payment', {
        handler: async () => {
          handlerCalled = true;
          return { paid: true };
        },
      });

      const res = await registry.execute('external.payment', {}, {}, { mock: true });
      expect(res).toEqual({ mocked: true });
      expect(handlerCalled).toBe(false);

      const realRes = await registry.execute('external.payment', {});
      expect(realRes).toEqual({ paid: true });
      expect(handlerCalled).toBe(true);
    });
  });

  describe('3. Service-Level Middlewares (defineService({ middleware }))', () => {
    it('executes service-specific middleware chained after global middlewares', async () => {
      const registry = new ServiceRegistry();
      const trace = [];

      registry.use(async (ctx, next) => {
        trace.push('global_before');
        const res = await next();
        trace.push('global_after');
        return res;
      });

      const service = defineService({
        middleware: [
          async (ctx, next) => {
            trace.push('service_mw_before');
            const res = await next();
            trace.push('service_mw_after');
            return res;
          },
        ],
        handler: async (input) => {
          trace.push('handler');
          return input.x * 2;
        },
      });

      registry.register('math.double', service);

      const res = await registry.execute('math.double', { x: 5 });
      expect(res).toBe(10);
      expect(trace).toEqual([
        'global_before',
        'service_mw_before',
        'handler',
        'service_mw_after',
        'global_after',
      ]);
    });
  });

  describe('4. Pre-execution Hooks (before)', () => {
    it('executes global before hooks and transforms input', async () => {
      const registry = new ServiceRegistry();

      registry.before(async ({ name, input }) => {
        if (typeof input.title === 'string') {
          return { ...input, title: input.title.trim().toUpperCase() };
        }
      });

      registry.register('article.create', {
        handler: async (input) => input,
      });

      const res = await registry.execute('article.create', { title: '  hello world  ' });
      expect(res.title).toBe('HELLO WORLD');
    });

    it('executes service-level before hook using concise (input, ctx) signature', async () => {
      const registry = new ServiceRegistry();

      registry.register(
        'user.sanitize',
        defineService({
          before: async (input, ctx) => {
            return { ...input, tenantId: ctx.tenantId || 'default' };
          },
          handler: async (input) => input,
        })
      );

      const res = await registry.execute('user.sanitize', { username: 'john' }, { tenantId: 'tenant-42' });
      expect(res).toEqual({ username: 'john', tenantId: 'tenant-42' });
    });
  });

  describe('5. Post-execution Hooks (after)', () => {
    it('executes global after hooks and can transform result', async () => {
      const registry = new ServiceRegistry();

      registry.after(async ({ name, result, duration }) => {
        expect(typeof duration).toBe('number');
        return {
          ...result,
          wrappedByAfter: true,
        };
      });

      registry.register('item.get', {
        handler: async () => ({ id: 101 }),
      });

      const res = await registry.execute('item.get', {});
      expect(res).toEqual({ id: 101, wrappedByAfter: true });
    });

    it('executes service-level after hook using concise (result, input, ctx) signature', async () => {
      const registry = new ServiceRegistry();

      registry.register(
        'price.format',
        defineService({
          after: async (result, input, ctx) => {
            return `$${result.toFixed(2)}`;
          },
          handler: async ({ amount }) => amount,
        })
      );

      const formatted = await registry.execute('price.format', { amount: 19.5 });
      expect(formatted).toBe('$19.50');
    });
  });

  describe('6. Error Interception & Recovery Hooks (onError)', () => {
    it('intercepts errors via global onError hook and can recover gracefully', async () => {
      const registry = new ServiceRegistry();

      registry.onError(async ({ name, error, duration }) => {
        if (error.message.includes('Simulated failure')) {
          return {
            recover: true,
            result: { fallback: true, originalService: name },
          };
        }
      });

      registry.register('flaky.operation', {
        handler: async () => {
          throw new Error('Simulated failure occurred');
        },
      });

      const result = await registry.execute('flaky.operation', {});
      expect(result).toEqual({ fallback: true, originalService: 'flaky.operation' });
    });

    it('allows service-level onError hook to transform or rethrow errors', async () => {
      const registry = new ServiceRegistry();

      registry.register(
        'secure.data',
        defineService({
          onError: async (error) => {
            throw new WebspressoError('Custom masked error', { cause: error });
          },
          handler: async () => {
            throw new Error('Internal database connection leaked credentials');
          },
        })
      );

      await expect(registry.execute('secure.data', {})).rejects.toThrow('Custom masked error');
    });
  });

  describe('7. EventDispatcher Integration (service:before, service:after, service:error)', () => {
    it('emits lifecycle events when an event dispatcher is attached', async () => {
      const emittedEvents = [];
      const fakeEvents = {
        emit: (eventName, payload) => {
          emittedEvents.push({ eventName, payload });
        },
      };

      const registry = createServiceRegistry({
        events: fakeEvents,
      });

      registry.register('analytics.track', {
        handler: async (input) => ({ tracked: true, event: input.event }),
      });

      const result = await registry.execute('analytics.track', { event: 'signup' });
      expect(result).toEqual({ tracked: true, event: 'signup' });

      expect(emittedEvents.length).toBe(2);
      expect(emittedEvents[0].eventName).toBe('service:before');
      expect(emittedEvents[0].payload.name).toBe('analytics.track');
      expect(emittedEvents[0].payload.input).toEqual({ event: 'signup' });

      expect(emittedEvents[1].eventName).toBe('service:after');
      expect(emittedEvents[1].payload.name).toBe('analytics.track');
      expect(emittedEvents[1].payload.result).toEqual({ tracked: true, event: 'signup' });
      expect(typeof emittedEvents[1].payload.duration).toBe('number');
    });

    it('emits service:error event on execution failure', async () => {
      const emittedEvents = [];
      const fakeEvents = {
        emit: (eventName, payload) => {
          emittedEvents.push({ eventName, payload });
        },
      };

      const registry = createServiceRegistry({
        events: fakeEvents,
      });

      registry.register('fail.task', {
        handler: async () => {
          throw new Error('Task crashed');
        },
      });

      await expect(registry.execute('fail.task', {})).rejects.toThrow('Task crashed');

      expect(emittedEvents.length).toBe(2);
      expect(emittedEvents[0].eventName).toBe('service:before');
      expect(emittedEvents[1].eventName).toBe('service:error');
      expect(emittedEvents[1].payload.name).toBe('fail.task');
      expect(emittedEvents[1].payload.error.message).toBe('Task crashed');
    });
  });
});
