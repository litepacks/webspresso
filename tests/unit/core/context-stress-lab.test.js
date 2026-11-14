'use strict';

/**
 * Webspresso - Core Context Stress Lab
 * Stress-tests AsyncLocalStorage isolation across 150 concurrent async flows,
 * deep withContext() nesting, useTransaction() proxy with real SQLite, and appContext lifecycle.
 */

const {
  setAppContext,
  getAppContext,
  getDb,
  hasDb,
  hasShutdownManager,
  hasServiceRegistry,
  hasEvents,
  hasMailer,
  hasCache,
  resetAppContext,
  runWithContext,
  withContext,
  getContext,
  useContext,
  useDb,
  useAuth,
  useUser,
  useLogger,
  useReq,
  useRes,
  useParams,
  useQuery,
  useService,
  useQueue,
  useCache,
  useBreaker,
  useTransaction,
} = require('../../../core/context');
const { createDatabase, defineModel, zdb, clearRegistry } = require('../../../core/orm');

describe('Core Context Stress Lab (AsyncLocalStorage, Nesting, useTransaction, AppContext)', () => {
  afterEach(() => {
    resetAppContext();
    clearRegistry();
  });

  it('1. maintains 100% AsyncLocalStorage isolation across 150 concurrent multi-hop async requests', async () => {
    const flows = Array.from({ length: 150 }, (_, i) => {
      const reqId = `req-${i}`;
      const userObj = { id: i + 1, tenant: `t-${i % 7}` };
      const reqObj = {
        id: reqId,
        params: { id: String(i) },
        query: { page: String((i % 5) + 1) },
      };
      const resObj = { locals: { trace: reqId } };
      const loggerObj = { tag: `log-${i}`, info: () => {} };
      const cacheObj = { ns: `cache-${i}` };
      const queueObj = { ns: `queue-${i}` };

      return runWithContext(
        {
          req: reqObj,
          res: resObj,
          auth: { user: userObj },
          logger: loggerObj,
          cache: cacheObj,
          queue: queueObj,
          service: async (name, input) => `${reqId}:${name}:${input.v}`,
        },
        async () => {
          // Hop 1: microtask
          await Promise.resolve();
          expect(useReq().id).toBe(reqId);
          expect(useRes().locals.trace).toBe(reqId);
          expect(useUser()).toEqual(userObj);
          expect(useAuth()).toEqual(userObj);

          // Hop 2: macrotask timer with jitter
          await new Promise((resolve) => setTimeout(resolve, i % 6));
          expect(useParams().id).toBe(String(i));
          expect(useQuery().page).toBe(String((i % 5) + 1));
          expect(useLogger().tag).toBe(`log-${i}`);
          expect(useCache().ns).toBe(`cache-${i}`);
          expect(useQueue().ns).toBe(`queue-${i}`);

          // Hop 3: nested withContext override + verification after inner exit
          const svcRes = await withContext({ user: { id: i + 1000, impersonated: true } }, async () => {
            await new Promise((r) => queueMicrotask(r));
            expect(useUser().impersonated).toBe(true);
            expect(useParams().id).toBe(String(i)); // Inherited from parent
            return useService('audit.log', { v: i });
          });

          // Parent context must remain intact after withContext exits
          expect(useUser()).toEqual(userObj);
          expect(svcRes).toBe(`${reqId}:audit.log:${i}`);
          return reqId;
        }
      );
    });

    const settled = await Promise.all(flows);
    expect(settled).toHaveLength(150);
    for (let i = 0; i < 150; i++) {
      expect(settled[i]).toBe(`req-${i}`);
    }
    expect(getContext()).toBeNull();
  });

  it('2. preserves parent context across 25-level deep withContext() nesting and inner rejections', async () => {
    await runWithContext({ base: 'root', params: { rootId: 'r0' }, user: { id: 0 } }, async () => {
      async function descend(depth) {
        if (depth === 25) {
          expect(useContext().base).toBe('root');
          expect(useContext().level).toBe(24);
          expect(useUser().id).toBe(24);
          throw new Error('leaf-abort');
        }

        await expect(
          withContext({ level: depth, user: { id: depth } }, async () => {
            await Promise.resolve();
            expect(useUser().id).toBe(depth);
            return descend(depth + 1);
          })
        ).rejects.toThrow('leaf-abort');

        // After inner rejection, outer depth's context must still be intact
        const expectedParentId = depth === 0 ? 0 : depth - 1;
        expect(useUser().id).toBe(expectedParentId);
      }

      await descend(0);
      expect(useUser().id).toBe(0);
      expect(useContext().level).toBeUndefined();
    });
  });

  it('3. binds transactional DB proxy in useTransaction() on real SQLite and rolls back cleanly on error', async () => {
    clearRegistry();
    const db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: false,
    });

    const Ledger = defineModel({
      name: 'StressLedger',
      table: 'stress_ledgers',
      schema: {
        id: zdb.id(),
        account: zdb.string(),
        amount: zdb.integer(),
      },
    });
    db.registerModel(Ledger);

    await db.knex.schema.createTable('stress_ledgers', (t) => {
      t.increments('id').primary();
      t.string('account').notNullable();
      t.integer('amount').notNullable();
    });

    try {
      await runWithContext({ db }, async () => {
        // 1. Failing transaction must roll back all writes
        await expect(
          useTransaction(async () => {
            const txDb = useDb();
            expect(txDb).not.toBe(db);
            expect(typeof txDb.raw).toBe('function');
            expect(txDb.knex).toBeDefined();

            const repo = txDb.getRepository('StressLedger');
            await repo.create({ account: 'A', amount: 100 });
            await repo.create({ account: 'B', amount: -100 });
            throw new Error('tx-abort');
          })
        ).rejects.toThrow('tx-abort');

        // Outer useDb() must still be the base db and have 0 rows
        expect(useDb()).toBe(db);
        expect(await useDb().getRepository('StressLedger').find()).toHaveLength(0);

        // 2. Successful transaction must commit atomically
        const saved = await useTransaction(async () => {
          const repo = useDb().getRepository('StressLedger');
          const r1 = await repo.create({ account: 'A', amount: 250 });
          const r2 = await repo.create({ account: 'B', amount: 750 });
          return [r1, r2];
        });

        expect(saved).toHaveLength(2);
        expect(await useDb().getRepository('StressLedger').find()).toHaveLength(2);
      });
    } finally {
      await db.destroy();
    }
  });

  it('4. enforces outside-context guards and breaker/service fallback resolution', async () => {
    expect(getContext()).toBeNull();
    expect(() => useContext()).toThrow(/must be called within an active/i);
    await expect(useService('missing.svc')).rejects.toThrow(/no service registry available/i);
    await expect(useTransaction(async () => {})).rejects.toThrow(/no database instance available/i);

    // Custom breaker resolver in context takes priority
    const customBreaker = { name: 'custom-b', exec: () => 'ok' };
    await runWithContext({ breaker: () => customBreaker }, async () => {
      expect(useBreaker('anything')).toBe(customBreaker);
    });

    // Outside context, useBreaker falls back to circuitBreakerRegistry
    const fallbackBreaker = useBreaker('stress-fallback-breaker');
    expect(fallbackBreaker).toBeDefined();
  });

  it('5. manages process-wide appContext set/has/get/reset cycles cleanly', () => {
    resetAppContext();
    expect(hasDb()).toBe(false);
    expect(hasShutdownManager()).toBe(false);
    expect(hasServiceRegistry()).toBe(false);
    expect(hasEvents()).toBe(false);
    expect(hasMailer()).toBe(false);
    expect(hasCache()).toBe(false);
    expect(() => getDb()).toThrow(/No database registered/i);

    for (let i = 0; i < 20; i++) {
      const fakeDb = { tag: `db-${i}` };
      setAppContext({
        db: fakeDb,
        shutdownManager: { id: i },
        serviceRegistry: { id: i },
        events: { id: i },
        mailer: { id: i },
        cache: { id: i },
      });

      expect(hasDb()).toBe(true);
      expect(getDb()).toBe(fakeDb);
      expect(hasShutdownManager()).toBe(true);
      expect(hasServiceRegistry()).toBe(true);
      expect(hasEvents()).toBe(true);
      expect(hasMailer()).toBe(true);
      expect(hasCache()).toBe(true);
      expect(getAppContext().db).toBe(fakeDb);

      resetAppContext();
      expect(hasDb()).toBe(false);
    }
  });
});

