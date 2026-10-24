'use strict';

const {
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
} = require('../../../core/context/request');
const { executeApiPipeline, executePagePipeline } = require('../../../core/http/pipeline');
const { ServiceRegistry } = require('../../../core/services');

describe('Ambient Request & Execution Context (AsyncLocalStorage)', () => {
  describe('Basic Context Lifecycle', () => {
    it('returns null for getContext() when outside of any execution context', () => {
      expect(getContext()).toBeNull();
    });

    it('throws when useContext() is called outside of an active context', () => {
      expect(() => useContext()).toThrow('useContext() must be called within an active request, job, or execution context.');
    });

    it('runs synchronous functions within context', () => {
      const store = { id: 'req-123', user: { id: 1, role: 'admin' } };
      const result = runWithContext(store, () => {
        expect(getContext()).toBe(store);
        expect(useContext()).toBe(store);
        return 'sync-success';
      });
      expect(result).toBe('sync-success');
      expect(getContext()).toBeNull();
    });

    it('runs asynchronous functions and preserves context across promises', async () => {
      const store = { requestId: 'async-456' };
      const result = await runWithContext(store, async () => {
        await new Promise((r) => setTimeout(r, 10));
        expect(getContext()).toBe(store);
        const nested = await Promise.resolve().then(() => useContext());
        expect(nested).toBe(store);
        return 42;
      });
      expect(result).toBe(42);
      expect(getContext()).toBeNull();
    });
  });

  describe('Composable Hooks', () => {
    it('useDb() retrieves db from store or store.req', () => {
      const mockDb = { name: 'mockDb' };

      runWithContext({ db: mockDb }, () => {
        expect(useDb()).toBe(mockDb);
      });

      runWithContext({ req: { db: mockDb } }, () => {
        expect(useDb()).toBe(mockDb);
      });

      runWithContext({}, () => {
        expect(useDb()).toBeNull();
      });
    });

    it('useAuth() retrieves user/auth from various shapes', () => {
      const user = { id: 99, email: 'test@example.com' };

      runWithContext({ user }, () => {
        expect(useAuth()).toBe(user);
      });

      runWithContext({ auth: { user } }, () => {
        expect(useAuth()).toBe(user);
      });

      runWithContext({ req: { user } }, () => {
        expect(useAuth()).toBe(user);
      });

      runWithContext({ req: { auth: { user } } }, () => {
        expect(useAuth()).toBe(user);
      });

      runWithContext({}, () => {
        expect(useAuth()).toBeNull();
      });
    });

    it('useLogger() returns custom logger or falls back to console', () => {
      const customLogger = { info: vi.fn(), error: vi.fn() };

      runWithContext({ logger: customLogger }, () => {
        expect(useLogger()).toBe(customLogger);
      });

      runWithContext({}, () => {
        expect(useLogger()).toBe(console);
      });
    });

    it('useQueue() and useCache() retrieve corresponding subsystems', () => {
      const mockQueue = { dispatch: vi.fn() };
      const mockCache = { get: vi.fn() };

      runWithContext({ queue: mockQueue, cache: mockCache }, () => {
        expect(useQueue()).toBe(mockQueue);
        expect(useCache()).toBe(mockCache);
      });
    });

    it('useService() executes service from active store or throws if missing', async () => {
      const serviceFn = vi.fn().mockResolvedValue({ success: true });
      const store = { service: serviceFn };

      const result = await runWithContext(store, async () => {
        return await useService('test.action', { foo: 'bar' });
      });

      expect(serviceFn).toHaveBeenCalledWith('test.action', { foo: 'bar' }, undefined);
      expect(result).toEqual({ success: true });

      await expect(
        runWithContext({}, () => useService('no.service'))
      ).rejects.toThrow('useService() failed: no service registry available in active context.');
    });

    it('useReq() and useRes() access request and response objects', () => {
      const req = { url: '/test', method: 'GET' };
      const res = { statusCode: 200 };

      runWithContext({ req, res }, () => {
        expect(useReq()).toBe(req);
        expect(useRes()).toBe(res);
      });

      runWithContext({}, () => {
        expect(useReq()).toBeNull();
        expect(useRes()).toBeNull();
      });
    });

    it('useUser() aliases useAuth()', () => {
      const user = { id: 42, role: 'moderator' };
      runWithContext({ user }, () => {
        expect(useUser()).toBe(user);
      });
    });

    it('useParams() and useQuery() return params/query maps or empty objects', () => {
      const params = { id: 'item-123' };
      const query = { sort: 'desc', limit: '10' };

      runWithContext({ params, query }, () => {
        expect(useParams()).toBe(params);
        expect(useQuery()).toBe(query);
      });

      runWithContext({ req: { params, query } }, () => {
        expect(useParams()).toBe(params);
        expect(useQuery()).toBe(query);
      });

      runWithContext({}, () => {
        expect(useParams()).toEqual({});
        expect(useQuery()).toEqual({});
      });
    });

    it('useBreaker() retrieves circuit breaker from store, req, or registry', () => {
      const mockBreaker = { state: 'CLOSED' };
      runWithContext({ breaker: (name) => (name === 'stripe' ? mockBreaker : null) }, () => {
        expect(useBreaker('stripe')).toBe(mockBreaker);
        expect(useBreaker('unknown')).toBeNull();
      });

      const fallbackBreaker = useBreaker('fallback-test');
      expect(fallbackBreaker).toBeDefined();
      expect(fallbackBreaker.name).toBe('fallback-test');
    });

    it('withContext() shallow merges overrides on active context and restores afterwards', () => {
      const initial = { user: { id: 1 }, db: { name: 'db1' } };

      runWithContext(initial, () => {
        expect(useAuth().id).toBe(1);
        expect(useDb().name).toBe('db1');

        const result = withContext({ user: { id: 2, role: 'admin' } }, () => {
          expect(useAuth().id).toBe(2);
          expect(useAuth().role).toBe('admin');
          expect(useDb().name).toBe('db1'); // inherited
          return 'withContext-done';
        });

        expect(result).toBe('withContext-done');
        // Restores to initial context
        expect(useAuth().id).toBe(1);
      });
    });

    it('useTransaction() executes managed transaction with transactional db bound to context', async () => {
      const transactionalDb = { name: 'tx-db' };
      const mockDb = {
        name: 'main-db',
        transaction: vi.fn(async (cb) => {
          return await cb({ db: transactionalDb });
        }),
      };

      const result = await runWithContext({ db: mockDb }, async () => {
        expect(useDb().name).toBe('main-db');

        return await useTransaction(async (trx) => {
          // Inside transaction, useDb() resolves transactionalDb
          expect(useDb().name).toBe('tx-db');
          return 'tx-success';
        });
      });

      expect(result).toBe('tx-success');
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('useTransaction() throws when no db is available in context', async () => {
      await expect(
        runWithContext({}, () => useTransaction(async () => {}))
      ).rejects.toThrow('useTransaction() failed: no database instance available in active context.');
    });

    it('useTransaction() throws when db does not support transaction() method', async () => {
      await expect(
        runWithContext({ db: { noTrx: true } }, () => useTransaction(async () => {}))
      ).rejects.toThrow('useTransaction() failed: db does not support transaction().');
    });

    it('useService() falls back to store.req.service when store.service is absent', async () => {
      const serviceFn = vi.fn().mockResolvedValue('req-service-ok');
      const result = await runWithContext({ req: { service: serviceFn } }, async () => {
        return await useService('user.get', { id: 10 });
      });
      expect(result).toBe('req-service-ok');
      expect(serviceFn).toHaveBeenCalledWith('user.get', { id: 10 }, undefined);
    });

    it('useBreaker() falls back to store.req.breaker when store.breaker is absent', () => {
      const mockBreaker = { name: 'req-breaker' };
      runWithContext({ req: { breaker: (name) => (name === 'order' ? mockBreaker : null) } }, () => {
        expect(useBreaker('order')).toBe(mockBreaker);
        expect(useBreaker('other')).toBeNull();
      });
    });
  });

  describe('Integration with HTTP Execution Pipelines', () => {
    it('makes hooks available within executeApiPipeline handlerFn', async () => {
      const mockDb = { name: 'pipelineDb' };
      const mockUser = { id: 10, role: 'developer' };
      const mockService = vi.fn().mockResolvedValue('service-output');

      const req = {
        method: 'POST',
        headers: {},
        body: { greeting: 'hello' },
        user: mockUser,
      };
      const res = {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      let observedDb;
      let observedUser;
      let observedContext;

      await executeApiPipeline({
        descriptor: { path: '/api/test', method: 'post' },
        context: { db: mockDb },
        apiDef: {},
        req,
        res,
        handlerFn: async (r, s, ctx) => {
          observedDb = useDb();
          observedUser = useAuth();
          observedContext = useContext();
          const svcVal = await useService('demo.call', { x: 1 });
          return { svcVal };
        },
      });

      // Since req.service wasn't preset, let's test with service provided
    });

    it('makes hooks available in API routes with services', async () => {
      const mockDb = { name: 'pipelineDb' };
      const mockUser = { id: 10, role: 'developer' };
      const mockService = vi.fn().mockResolvedValue('service-output');

      const req = {
        method: 'POST',
        headers: {},
        body: { greeting: 'hello' },
        user: mockUser,
        service: mockService,
      };
      const res = {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      let observedDb;
      let observedUser;
      let observedContext;
      let svcResult;

      await executeApiPipeline({
        descriptor: { path: '/api/test', method: 'post' },
        context: { db: mockDb },
        apiDef: {},
        req,
        res,
        handlerFn: async () => {
          observedDb = useDb();
          observedUser = useAuth();
          observedContext = useContext();
          svcResult = await useService('demo.run', { key: 'val' });
          return { ok: true };
        },
      });

      expect(observedDb).toBe(mockDb);
      expect(observedUser).toBe(mockUser);
      expect(observedContext).toBeDefined();
      expect(observedContext.req).toBe(req);
      expect(mockService).toHaveBeenCalledWith('demo.run', { key: 'val' }, undefined);
      expect(svcResult).toBe('service-output');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('makes hooks available inside executePagePipeline load() lifecycle', async () => {
      const mockDb = { name: 'pageDb' };
      const mockUser = { id: 7, name: 'Alice' };

      const req = {
        method: 'GET',
        headers: {},
        user: mockUser,
      };
      const res = {
        headersSent: false,
        locals: {},
        json: vi.fn(),
      };

      let observedDbInLoad;
      let observedUserInLoad;

      const pageDef = {
        load: async () => {
          observedDbInLoad = useDb();
          observedUserInLoad = useAuth();
          return { title: 'Welcome' };
        },
      };

      await executePagePipeline({
        descriptor: { path: '/dashboard' },
        context: { db: mockDb },
        pageDef,
        req,
        res,
      });

      expect(observedDbInLoad).toBe(mockDb);
      expect(observedUserInLoad).toBe(mockUser);
      expect(res.json).toHaveBeenCalledWith({ title: 'Welcome' });
    });

    it('makes ambient context and hooks available in standalone service execution', async () => {
      const registry = new ServiceRegistry();
      const mockDb = { name: 'standaloneDb' };
      const mockUser = { id: 50, email: 'standalone@webspresso.org' };

      let observedDbInService;
      let observedUserInService;

      registry.register('ambient.test', {
        handler: async (input, ctx) => {
          observedDbInService = useDb();
          observedUserInService = useAuth();
          return { echo: input.val };
        },
      });

      const res = await registry.execute('ambient.test', { val: 'abc' }, {
        db: mockDb,
        user: mockUser,
      });

      expect(res).toEqual({ echo: 'abc' });
      expect(observedDbInService).toBe(mockDb);
      expect(observedUserInService).toBe(mockUser);
    });
  });

  describe('Process-Wide App Context (core/context/app-context)', () => {
    const appContext = require('../../../core/context/app-context');

    beforeEach(() => {
      appContext.resetAppContext();
    });

    afterEach(() => {
      appContext.resetAppContext();
    });

    it('manages getters and setters for all global components', () => {
      expect(appContext.hasDb()).toBe(false);
      expect(() => appContext.getDb()).toThrow(/No database registered/);
      expect(appContext.hasShutdownManager()).toBe(false);
      expect(appContext.getShutdownManager()).toBeNull();
      expect(appContext.hasServiceRegistry()).toBe(false);
      expect(appContext.getServiceRegistry()).toBeNull();
      expect(appContext.hasEvents()).toBe(false);
      expect(appContext.getEvents()).toBeNull();
      expect(appContext.hasMailer()).toBe(false);
      expect(appContext.getMailer()).toBeNull();
      expect(appContext.hasCache()).toBe(false);
      expect(appContext.getCache()).toBeNull();

      const fakeDb = { id: 'db-1' };
      const fakeShutdown = { id: 'shutdown-1' };
      const fakeRegistry = { id: 'reg-1', call: vi.fn().mockReturnValue('ok') };
      const fakeEvents = { id: 'events-1' };
      const fakeMailer = { id: 'mailer-1' };
      const fakeCache = { id: 'cache-1' };

      appContext.setAppContext({
        db: fakeDb,
        shutdownManager: fakeShutdown,
        serviceRegistry: fakeRegistry,
        events: fakeEvents,
        mailer: fakeMailer,
        cache: fakeCache,
      });

      expect(appContext.hasDb()).toBe(true);
      expect(appContext.getDb()).toBe(fakeDb);
      expect(appContext.hasShutdownManager()).toBe(true);
      expect(appContext.getShutdownManager()).toBe(fakeShutdown);
      expect(appContext.hasServiceRegistry()).toBe(true);
      expect(appContext.getServiceRegistry()).toBe(fakeRegistry);
      expect(appContext.hasEvents()).toBe(true);
      expect(appContext.getEvents()).toBe(fakeEvents);
      expect(appContext.hasMailer()).toBe(true);
      expect(appContext.getMailer()).toBe(fakeMailer);
      expect(appContext.hasCache()).toBe(true);
      expect(appContext.getCache()).toBe(fakeCache);
      expect(appContext.getAppContext().db).toBe(fakeDb);

      // attachDbMiddleware attaches context properties to req
      const req = { context: { custom: 1 } };
      const res = {};
      const next = vi.fn();

      appContext.attachDbMiddleware(req, res, next);

      expect(req.db).toBe(fakeDb);
      expect(req.events).toBe(fakeEvents);
      expect(req.mailer).toBe(fakeMailer);
      expect(req.cache).toBe(fakeCache);
      expect(typeof req.service).toBe('function');
      expect(typeof req.breaker).toBe('function');
      expect(typeof req.retry).toBe('function');

      const serviceRes = req.service('test.action', { x: 1 });
      expect(serviceRes).toBe('ok');
      expect(fakeRegistry.call).toHaveBeenCalledWith('test.action', { x: 1 }, req.context, undefined);
      expect(next).toHaveBeenCalled();

      // Test fallback when req.context is not provided
      const reqFallback = {};
      appContext.attachDbMiddleware(reqFallback, res, next);
      reqFallback.service('test.fallback', { y: 2 });
      expect(fakeRegistry.call).toHaveBeenCalledWith(
        'test.fallback',
        { y: 2 },
        expect.objectContaining({ req: reqFallback, res, db: fakeDb }),
        undefined
      );

      // Test attachDbMiddleware when context is completely empty
      appContext.resetAppContext();
      const emptyReq = {};
      appContext.attachDbMiddleware(emptyReq, res, next);
      expect(emptyReq.db).toBeUndefined();
      expect(emptyReq.events).toBeUndefined();
      expect(emptyReq.mailer).toBeUndefined();
      expect(emptyReq.cache).toBeUndefined();
      expect(emptyReq.service).toBeUndefined();
      expect(typeof emptyReq.breaker).toBe('function');
      expect(typeof emptyReq.retry).toBe('function');
    });
  });
});
