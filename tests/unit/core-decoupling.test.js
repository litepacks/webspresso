const { execSync } = require('child_process');
const path = require('path');
const { createCoreApp, CoreApp } = require('../../core/app');
const { createApp } = require('../../src/server');
const { defineService } = require('../../src/services');
const { UnauthorizedError, ForbiddenError, InvalidServiceInputError } = require('../../core/errors');

describe('Core Decoupling & Framework Independence', () => {
  describe('Zero-Express Transitive Dependency in Core', () => {
    it('requiring core does not load Express into require.cache', () => {
      const script = `
        const core = require('${path.resolve(__dirname, '../../core')}');
        const expressKeys = Object.keys(require.cache).filter(k => k.includes('node_modules/express'));
        if (expressKeys.length > 0) {
          console.error('Express detected in require.cache:', expressKeys);
          process.exit(1);
        }
        process.exit(0);
      `;
      expect(() => {
        execSync(`node -e "${script.replace(/\n/g, ' ')}"`, { stdio: 'pipe' });
      }).not.toThrow();
    });

    it('CoreApp and createCoreApp are exported by both core/index and root index', () => {
      const rootExports = require('../../index');
      const coreExports = require('../../core/index');

      expect(typeof rootExports.createCoreApp).toBe('function');
      expect(typeof rootExports.CoreApp).toBe('function');
      expect(typeof coreExports.createCoreApp).toBe('function');
      expect(typeof coreExports.CoreApp).toBe('function');
      expect(rootExports.createCoreApp).toBe(coreExports.createCoreApp);
    });
  });

  describe('Pure Service Execution Without HTTP', () => {
    it('executes services with validation, auth, and context without HTTP server or fake req/res', async () => {
      const core = createCoreApp({
        servicesDir: null, // do not auto-scan for isolated test
      });

      // Register an admin-only math service
      core.services.register('math.add', defineService({
        schema: ({ z }) => ({
          input: z.object({ a: z.number(), b: z.number() }),
          output: z.object({ sum: z.number() }),
        }),
        auth: 'admin',
        handler: async (input, ctx) => {
          return { sum: input.a + input.b };
        },
      }));

      // 1. Unauthenticated call fails with UnauthorizedError
      await expect(core.service('math.add', { a: 2, b: 3 })).rejects.toThrow(UnauthorizedError);

      // 2. Non-admin role fails with ForbiddenError
      await expect(
        core.service('math.add', { a: 2, b: 3 }, { user: { id: 1, role: 'user' } })
      ).rejects.toThrow(ForbiddenError);

      // 3. Invalid schema fails with InvalidServiceInputError
      await expect(
        core.service('math.add', { a: 'not-a-number', b: 3 }, { user: { id: 1, role: 'admin' } })
      ).rejects.toThrow(InvalidServiceInputError);

      // 4. Authorized and valid call succeeds
      const result = await core.service(
        'math.add',
        { a: 5, b: 7 },
        { user: { id: 1, role: 'admin' } }
      );
      expect(result).toEqual({ sum: 12 });
    });

    it('supports nested service calls passing context automatically', async () => {
      const core = createCoreApp();

      core.services.register('user.format-name', defineService({
        handler: async (input) => `${input.firstName} ${input.lastName.toUpperCase()}`,
      }));

      core.services.register('user.greet', defineService({
        handler: async (input, ctx) => {
          const formatted = await ctx.service('user.format-name', input);
          return `Hello, ${formatted}! Caller: ${ctx.user?.name || 'anonymous'}`;
        },
      }));

      const greeting = await core.service(
        'user.greet',
        { firstName: 'Ada', lastName: 'Lovelace' },
        { user: { name: 'AdminTester' } }
      );

      expect(greeting).toBe('Hello, Ada LOVELACE! Caller: AdminTester');
    });

    it('integrates circuit breakers without HTTP middleware', async () => {
      const core = createCoreApp();

      let attempts = 0;
      core.services.register('flaky.external', defineService({
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 1000,
        },
        handler: async () => {
          attempts++;
          throw new Error('Remote API Down');
        },
      }));

      // Failure 1
      await expect(core.service('flaky.external')).rejects.toThrow('Remote API Down');
      // Failure 2 -> trips breaker
      await expect(core.service('flaky.external')).rejects.toThrow('Remote API Down');
      // Breaker OPEN -> fails fast with CircuitBreakerOpenError
      await expect(core.service('flaky.external')).rejects.toThrow(/circuit breaker.*open/i);
      expect(attempts).toBe(2); // didn't invoke handler a 3rd time
    });
  });

  describe('Context Identity & Shared State', () => {
    it('preserves prototype linkage and does not drop properties via shallow copying', () => {
      const core = createCoreApp();
      const parentUser = { id: 42, role: 'admin', profile: { name: 'Grace' } };

      const ctx = core.createContext({
        user: parentUser,
        customFlag: true,
      });

      // Prototype linkage to core subsystems
      expect(ctx.services).toBe(core.services);
      expect(ctx.events).toBe(core.events);
      expect(ctx.cache).toBe(core.cache);
      expect(ctx.breakers).toBe(core.breakers);

      // User state is accessible and mutable
      expect(ctx.user.profile.name).toBe('Grace');
      parentUser.profile.name = 'Hopper';
      expect(ctx.user.profile.name).toBe('Hopper');
      expect(ctx.customFlag).toBe(true);
    });
  });

  describe('Instance Isolation', () => {
    it('keeps two core and app instances completely independent', async () => {
      const coreA = createCoreApp();
      const coreB = createCoreApp();

      coreA.services.register('test.service', defineService({
        handler: async () => 'from-A',
      }));

      expect(coreA.services.has('test.service')).toBe(true);
      expect(coreB.services.has('test.service')).toBe(false);

      // Check shutdown isolation
      let shutDownA = false;
      let shutDownB = false;

      coreA.shutdown.register(() => { shutDownA = true; });
      coreB.shutdown.register(() => { shutDownB = true; });

      await coreA.close('test');
      expect(shutDownA).toBe(true);
      expect(shutDownB).toBe(false);
    });
  });

  describe('Backward Compatibility with Express createApp()', () => {
    it('createApp() returns functional Express app with app.use, app.get, app.service', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        servicesDir: null,
      });

      expect(typeof app.use).toBe('function');
      expect(typeof app.get).toBe('function');
      expect(typeof app.listen).toBe('function');
      expect(typeof app.service).toBe('function');
      expect(app.core).toBeInstanceOf(CoreApp);

      // User middleware works
      const customMw = vi.fn((req, res, next) => next());
      app.use(customMw);

      // Service execution on app works
      app.serviceRegistry.register('app.ping', defineService({
        handler: async () => 'pong',
      }));

      const res = await app.service('app.ping');
      expect(res).toBe('pong');
    });

    it('supports plugins with lifecycle hooks and shutdown registration on CoreApp', async () => {
      let registered = false;
      let cleanedUp = false;

      const testPlugin = {
        name: 'test-decoupled-plugin',
        version: '1.0.0',
        register(ctx) {
          registered = true;
          expect(ctx.services).toBeDefined();
          expect(ctx.events).toBeDefined();
          expect(ctx.cache).toBeDefined();
          expect(ctx.shutdown).toBeDefined();
          ctx.shutdown.register(async () => {
            cleanedUp = true;
          });
        },
      };

      const core = createCoreApp({
        plugins: [testPlugin],
      });

      expect(registered).toBe(true);
      expect(cleanedUp).toBe(false);

      await core.close('test');
      expect(cleanedUp).toBe(true);
    });

    it('supports ambient database transaction propagation without HTTP server', async () => {
      const mockTrx = { id: 'trx_123', isTransaction: true };
      const mockDb = {
        transaction: async (callback) => {
          return await callback(mockTrx);
        },
      };

      const core = createCoreApp({
        db: mockDb,
      });

      core.services.register('finance.transfer', defineService({
        transaction: true,
        handler: async (input, ctx) => {
          expect(ctx.trx).toBe(mockTrx);
          return { transferred: true, trxId: ctx.trx.id };
        },
      }));

      const res = await core.service('finance.transfer', { amount: 100 });
      expect(res).toEqual({ transferred: true, trxId: 'trx_123' });
    });

    it('injects req.context, req.service, and propagates user/session into services during HTTP requests', async () => {
      const request = require('supertest');
      const app = createApp({
        rootDir: process.cwd(),
        servicesDir: null,
      });

      app.serviceRegistry.register('user.profile', defineService({
        handler: async (input, ctx) => {
          return {
            userName: ctx.user?.name || 'guest',
            sessionId: ctx.session?.id || null,
          };
        },
      }));

      // Custom Express route using req.service and simulating auth middleware
      app.get('/api/test-profile', (req, res, next) => {
        // simulate auth/session middleware
        req.user = { id: 7, name: 'Linus' };
        req.session = { id: 'sess_abc' };
        // req.context was initialized early, but user/session are updated:
        req.context.user = req.user;
        req.context.session = req.session;

        req.service('user.profile', {})
          .then(data => res.json(data))
          .catch(next);
      });

      const response = await request(app)
        .get('/api/test-profile')
        .expect(200);

      expect(response.body).toEqual({
        userName: 'Linus',
        sessionId: 'sess_abc',
      });
    });

    it('provides ctx.http adapter to plugins for framework-agnostic route and middleware registration', () => {
      let capturedHttp = null;
      const pluginWithHttp = {
        name: 'test-http-contract-plugin',
        version: '1.0.0',
        register(ctx) {
          capturedHttp = ctx.http;
          expect(typeof ctx.http.use).toBe('function');
          expect(typeof ctx.http.route).toBe('function');
          expect(typeof ctx.http.get).toBe('function');
          expect(typeof ctx.http.post).toBe('function');
        },
      };

      const app = createApp({
        rootDir: process.cwd(),
        servicesDir: null,
        plugins: [pluginWithHttp],
      });

      expect(capturedHttp).toBeDefined();
      expect(app.http).toBe(capturedHttp);
    });
  });

  describe('HTTP Layer & Auth Boundary Abstractions (Step 1, 2, 3)', () => {
    it('executes API pipeline directly using executeApiPipeline', async () => {
      const { executeApiPipeline } = require('../../core/http');
      const { z } = require('zod');

      const fakeReq = {
        method: 'POST',
        headers: {},
        body: { count: 42 },
        params: {},
        query: {},
      };
      const fakeRes = {
        headersSent: false,
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(data) { this.sentData = data; return this; },
      };

      const apiDef = {
        handler: async (req, res, ctx) => {
          return { doubled: ctx.input.body.count * 2 };
        },
      };

      const result = await executeApiPipeline({
        descriptor: { path: '/api/double', method: 'POST' },
        context: {},
        apiDef,
        handlerFn: apiDef.handler,
        compiledSchema: { body: z.object({ count: z.number() }) },
        middlewares: [],
        req: fakeReq,
        res: fakeRes,
      });

      expect(result).toEqual({ doubled: 84 });
      expect(fakeRes.sentData).toEqual({ doubled: 84 });
    });

    it('authenticates request via authenticateRequest without Express session or cookie middleware', async () => {
      const { authenticateRequest } = require('../../core/auth/authenticate');
      const { AuthManager } = require('../../core/auth/manager');

      const authManager = new AuthManager({
        secret: 'test-jwt-secret-key-32-chars-long!',
        users: {
          findById: async (id) => ({ id, email: 'tester@example.com', role: 'admin' }),
        },
      });

      // Generate a valid JWT token
      const token = authManager.generateUserToken({ id: 101, email: 'tester@example.com' });

      const req = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };

      const user = await authenticateRequest(req, null, authManager);
      expect(user).toBeDefined();
      expect(user.id).toBe(101);
      expect(user.email).toBe('tester@example.com');
      expect(req.user.id).toBe(101);
      expect(req.token).toBe(token);
    });
  });
});
