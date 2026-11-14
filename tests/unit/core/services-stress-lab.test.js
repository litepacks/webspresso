'use strict';

/**
 * Webspresso - Core Services Stress Lab
 * Stress-tests 100-call concurrent execution with Zod & RBAC guards, branch-safe parallel
 * nested service calls & cycle detection, memoize stampede + tag invalidation,
 * ambient ACID transaction propagation on SQLite, and timeout/retry/circuitBreaker/masking.
 */

const {
  createServiceRegistry,
  defineService,
  stableCacheKey,
  maskSensitiveData,
  ValidationError,
} = require('../../../core/services');
const { UnauthorizedError, ForbiddenError } = require('../../../core/errors');
const { createDatabase, defineModel, zdb, clearRegistry } = require('../../../core/orm');

describe('Core Services Stress Lab (Concurrency, Cycles, Memoize, Transactions, Resilience)', () => {
  afterEach(() => {
    clearRegistry();
  });

  it('1. handles 100 concurrent invocations with Zod validation and RBAC auth guards', async () => {
    const registry = createServiceRegistry();

    registry.register('order.approve', defineService({
      auth: ['admin', 'manager'],
      schema: ({ z }) => z.object({ orderId: z.number().int().positive(), amount: z.number().positive() }),
      handler: async (input, ctx) => ({
        approved: true,
        orderId: input.orderId,
        by: ctx.user.id,
      }),
    }));

    const tasks = [];
    for (let i = 0; i < 100; i++) {
      const mode = i % 4;
      if (mode === 0) {
        tasks.push(
          registry.call('order.approve', { orderId: i + 1, amount: 50 }, { user: { id: `u-${i}`, role: 'admin' } })
            .then((res) => ({ mode, i, ok: true, res }))
        );
      } else if (mode === 1) {
        // Invalid input -> ValidationError
        tasks.push(
          registry.call('order.approve', { orderId: -5, amount: 50 }, { user: { id: `u-${i}`, role: 'admin' } })
            .catch((err) => ({ mode, i, ok: false, err }))
        );
      } else if (mode === 2) {
        // Missing user -> UnauthorizedError
        tasks.push(
          registry.call('order.approve', { orderId: i + 1, amount: 50 }, {})
            .catch((err) => ({ mode, i, ok: false, err }))
        );
      } else {
        // Wrong role -> ForbiddenError
        tasks.push(
          registry.call('order.approve', { orderId: i + 1, amount: 50 }, { user: { id: `u-${i}`, role: 'viewer' } })
            .catch((err) => ({ mode, i, ok: false, err }))
        );
      }
    }

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(100);
    for (const r of results) {
      if (r.mode === 0) {
        expect(r.ok).toBe(true);
        expect(r.res.approved).toBe(true);
        expect(r.res.by).toBe(`u-${r.i}`);
      } else if (r.mode === 1) {
        expect(r.err).toBeInstanceOf(ValidationError);
      } else if (r.mode === 2) {
        expect(r.err).toBeInstanceOf(UnauthorizedError);
      } else {
        expect(r.err).toBeInstanceOf(ForbiddenError);
      }
    }
  });

  it('2. detects circular service calls while allowing 30 concurrent parallel fan-out branches', async () => {
    const registry = createServiceRegistry();

    registry.register('cycle.a', defineService({
      handler: async (_input, ctx) => ctx.service('cycle.b', {}),
    }));
    registry.register('cycle.b', defineService({
      handler: async (_input, ctx) => ctx.service('cycle.a', {}),
    }));

    await expect(registry.call('cycle.a', {})).rejects.toThrow(/circular/i);

    // Parallel diamond fan-out must NOT trigger false circular call detection
    registry.register('leaf.x', defineService({
      handler: async (input) => {
        await new Promise((r) => setTimeout(r, input.v % 4));
        return input.v * 2;
      },
    }));
    registry.register('leaf.y', defineService({
      handler: async (input) => {
        await new Promise((r) => setTimeout(r, (input.v + 1) % 4));
        return input.v * 3;
      },
    }));
    registry.register('fanout.root', defineService({
      handler: async (input, ctx) => {
        const [x, y] = await Promise.all([
          ctx.service('leaf.x', { v: input.v }),
          ctx.service('leaf.y', { v: input.v }),
        ]);
        return x + y;
      },
    }));

    const fanouts = await Promise.all(
      Array.from({ length: 30 }, (_, i) => registry.call('fanout.root', { v: i }))
    );
    expect(fanouts).toEqual(Array.from({ length: 30 }, (_, i) => i * 5));
  });

  it('3. coalesces 50 concurrent memoized calls (stampede protection), invalidates by tag, and hashes exotic keys', async () => {
    const registry = createServiceRegistry();
    let execCount = 0;

    registry.register('report.summary', defineService({
      cache: {
        ttl: '5m',
        tags: (input) => [`org:${input.orgId}`],
      },
      handler: async (input) => {
        execCount++;
        await new Promise((r) => setTimeout(r, 10));
        return { orgId: input.orgId, run: execCount };
      },
    }));

    // 50 concurrent callers with identical input -> single execution
    const burst = await Promise.all(
      Array.from({ length: 50 }, () => registry.call('report.summary', { orgId: 7 }))
    );
    expect(execCount).toBe(1);
    for (const item of burst) {
      expect(item).toEqual({ orgId: 7, run: 1 });
    }

    // Tag invalidation forces fresh execution
    await registry.invalidateTag('org:7');
    const afterInvalidation = await registry.call('report.summary', { orgId: 7 });
    expect(execCount).toBe(2);
    expect(afterInvalidation).toEqual({ orgId: 7, run: 2 });

    // stableCacheKey handles key order, BigInt, Buffer, Date, RegExp, and circular refs
    expect(stableCacheKey({ b: 2, a: 1 })).toBe(stableCacheKey({ a: 1, b: 2 }));
    const circ = { n: 1n, buf: Buffer.from('ab'), dt: new Date(0), re: /x/i };
    circ.self = circ;
    expect(stableCacheKey(circ)).toContain('[Circular]');
  });

  it('4. propagates ambient ACID transactions across nested services and rolls back on failure', async () => {
    clearRegistry();
    const db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: false,
    });

    const Account = defineModel({
      name: 'SvcAccount',
      table: 'svc_accounts',
      schema: { id: zdb.id(), owner: zdb.string(), balance: zdb.integer() },
    });
    db.registerModel(Account);

    await db.knex.schema.createTable('svc_accounts', (t) => {
      t.increments('id').primary();
      t.string('owner').notNullable();
      t.integer('balance').notNullable();
    });

    const registry = createServiceRegistry({ db });

    registry.register('acct.credit', defineService({
      transaction: true,
      handler: async (input, ctx) => {
        return ctx.db.getRepository('SvcAccount').create({ owner: input.owner, balance: input.amount });
      },
    }));

    registry.register('acct.transfer', defineService({
      transaction: true,
      handler: async (input, ctx) => {
        await ctx.service('acct.credit', { owner: input.from, amount: -input.amount });
        if (input.failSecond) {
          throw new Error('transfer-aborted');
        }
        await ctx.service('acct.credit', { owner: input.to, amount: input.amount });
        return ctx.db.getRepository('SvcAccount').find();
      },
    }));

    try {
      // Failing nested service must roll back parent & child writes
      await expect(
        registry.call('acct.transfer', { from: 'Alice', to: 'Bob', amount: 100, failSecond: true }, { db })
      ).rejects.toThrow('transfer-aborted');

      expect(await db.getRepository('SvcAccount').find()).toHaveLength(0);

      // Successful nested service commits both atomically
      const rows = await registry.call(
        'acct.transfer',
        { from: 'Alice', to: 'Bob', amount: 100, failSecond: false },
        { db }
      );
      expect(rows).toHaveLength(2);
    } finally {
      await db.destroy();
    }
  });

  it('5. enforces timeout, retry recovery, circuitBreaker opening, middleware order, and sensitive masking', async () => {
    const registry = createServiceRegistry();
    const mwTrace = [];

    registry.use(async (_ctx, next) => {
      mwTrace.push('global-before');
      const res = await next();
      mwTrace.push('global-after');
      return res;
    });

    // Timeout enforcement
    registry.register('slow.op', defineService({
      timeout: 20,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 80));
        return 'late';
      },
    }));
    await expect(registry.call('slow.op', {})).rejects.toThrow(/timed out/i);

    // Retry recovery on transient failure
    let attempts = 0;
    registry.register('flaky.op', defineService({
      retry: { attempts: 3, delay: 5 },
      middleware: [
        async (_ctx, next) => {
          mwTrace.push('local-before');
          const res = await next();
          mwTrace.push('local-after');
          return res;
        },
      ],
      handler: async () => {
        attempts++;
        if (attempts < 3) {
          const err = new Error('transient');
          err.code = 'ECONNRESET';
          throw err;
        }
        return 'recovered';
      },
    }));

    expect(await registry.call('flaky.op', {})).toBe('recovered');
    expect(attempts).toBe(3);
    expect(mwTrace).toContain('global-before');
    expect(mwTrace).toContain('local-before');

    // CircuitBreaker opens after threshold failures
    registry.register('breaker.op', defineService({
      circuitBreaker: { failureThreshold: 2, resetTimeout: 5000 },
      handler: async () => {
        throw new Error('downstream-down');
      },
    }));

    await expect(registry.call('breaker.op', {})).rejects.toThrow('downstream-down');
    await expect(registry.call('breaker.op', {})).rejects.toThrow('downstream-down');
    await expect(registry.call('breaker.op', {})).rejects.toThrow(/circuit|open/i);

    // Sensitive data masking
    const masked = maskSensitiveData(
      { user: 'ada', password: '123', nested: { apiKey: 'secret-k', customPin: '9999' } },
      ['customPin']
    );
    expect(masked.user).toBe('ada');
    expect(masked.password).toBe('[REDACTED]');
    expect(masked.nested.apiKey).toBe('[REDACTED]');
    expect(masked.nested.customPin).toBe('[REDACTED]');
  });
});
