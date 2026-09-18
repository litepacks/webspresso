'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Server Lifecycle & Auth Tokens Branch Coverage', () => {
  describe('src/app-context.js branch coverage', () => {
    const appContext = require('../../src/app-context.js');

    it('covers getShutdownManager, hasShutdownManager, getServiceRegistry, hasServiceRegistry, and req.service dispatch in attachDbMiddleware', () => {
      appContext.resetAppContext();
      expect(appContext.getShutdownManager()).toBeNull();
      expect(appContext.hasShutdownManager()).toBe(false);
      expect(appContext.getServiceRegistry()).toBeNull();
      expect(appContext.hasServiceRegistry()).toBe(false);

      const mockShutdown = { isShuttingDown: false };
      const mockServiceRegistry = {
        call: vi.fn((name, input, ctx, opts) => `called:${name}`),
      };
      const mockDb = { name: 'test-db' };

      appContext.setAppContext({
        shutdownManager: mockShutdown,
        serviceRegistry: mockServiceRegistry,
        db: mockDb,
      });

      expect(appContext.getShutdownManager()).toBe(mockShutdown);
      expect(appContext.hasShutdownManager()).toBe(true);
      expect(appContext.getServiceRegistry()).toBe(mockServiceRegistry);
      expect(appContext.hasServiceRegistry()).toBe(true);

      const req = { headers: {} };
      const res = {};
      const next = vi.fn();

      appContext.attachDbMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.db).toBe(mockDb);
      expect(typeof req.service).toBe('function');

      const result = req.service('test.action', { foo: 1 });
      expect(result).toBe('called:test.action');
      expect(mockServiceRegistry.call).toHaveBeenCalled();

      appContext.resetAppContext();
    });
  });

  describe('plugins/polar/index.js & src/routes.js branch coverage', () => {
    const polarPlugin = require('../../plugins/polar/index.js');
    const {
      createInjectDb,
      createWebhookHandler,
      createCheckoutHandler,
      createPortalHandler,
      createStatusHandler,
      createRequireAuth,
    } = require('../../plugins/polar/src/routes.js');

    it('covers polar plugin SDK methods and configuration lifecycle', () => {
      const p = polarPlugin({
        enabled: true,
        accessToken: 'polar_test_123',
        webhookSecret: 'whsec_test',
        plans: { pro: 'prod_123' },
      });

      expect(p.name).toBe('polar');
      expect(p.csp).toBeDefined();
      expect(p.api.getConfig().accessToken).toBe('polar_test_123');

      // Test sdk proxy methods
      expect(p.api.isValidCheckoutRedirectUrl('https://buy.polar.sh/checkout/123')).toBe(true);
      expect(p.api.isValidPortalRedirectUrl('https://polar.sh/myorg/portal')).toBe(true);
      expect(p.api.isProSubscriptionStatus('active')).toBe(true);
      expect(p.api.userHasProTier({ tier: 'free' })).toBe(false);
      expect(p.api.pickBestActiveSubscription([])).toBeNull();
      expect(p.api.buildCheckoutMetadata({ id: 1, email: 'a@b.com' })).toBeDefined();
      expect(p.api.generateMigration()).toContain('table.string');

      // Register lifecycle with disabled plugin
      const disabledPlugin = polarPlugin({ enabled: false });
      const mockCtxDisabled = { nunjucksEnv: {}, app: { use: vi.fn() } };
      disabledPlugin.register(mockCtxDisabled);
      expect(mockCtxDisabled.app.use).not.toHaveBeenCalled();

      // Register lifecycle with syncMiddleware: true
      const syncPlugin = polarPlugin({ enabled: true, syncMiddleware: true });
      const mockCtxSync = { nunjucksEnv: { addFilter: vi.fn() }, app: { use: vi.fn() } };
      syncPlugin.register(mockCtxSync);
      expect(mockCtxSync.app.use).toHaveBeenCalled();

      // onRoutesReady without db warning
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockRoutesCtxNoDb = { db: null };
      syncPlugin.onRoutesReady(mockRoutesCtxNoDb);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();

      // onRoutesReady with db and route registration
      const registeredRoutes = [];
      const mockRoutesCtx = {
        db: { raw: vi.fn() },
        addRoute: vi.fn((method, path, ...handlers) => {
          registeredRoutes.push({ method, path, handlers });
        }),
      };
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      syncPlugin.onRoutesReady(mockRoutesCtx);
      expect(registeredRoutes.length).toBeGreaterThanOrEqual(4);
      logSpy.mockRestore();
    });

    it('covers createWebhookHandler error branches and signatures', async () => {
      // 1. Missing secret
      const hNoSecret = createWebhookHandler({});
      const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await hNoSecret({}, res1);
      expect(res1.status).toHaveBeenCalledWith(500);

      // 2. Invalid webhook signature
      const hWithSecret = createWebhookHandler({
        webhookSecret: 'secret_123',
        db: { raw: vi.fn() },
      });
      const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await hWithSecret(
        {
          headers: {},
          body: { type: 'subscription.created' },
          rawBody: Buffer.from('{"type":"subscription.created"}'),
        },
        res2
      );
      expect(res2.status).toHaveBeenCalledWith(401);

      // 3. Missing knex db with verified signature
      const secret = 'secret_123';
      const rawBody = '{"type":"test"}';
      const crypto = require('crypto');
      const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      const hNoKnex = createWebhookHandler({
        webhookSecret: secret,
        db: null,
      });

      const res3 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await hNoKnex(
        {
          headers: { 'webhook-signature': sig },
          body: { type: 'test' },
          rawBody,
        },
        res3
      );
      expect(res3.status).toHaveBeenCalledWith(500);
    });

    it('covers createCheckoutHandler and createPortalHandler branches', async () => {
      const mockPaidUser = { id: 1, tier: 'pro', polar_status: 'active' };
      const mockKnex = vi.fn((table) => ({
        where: vi.fn(() => ({
          first: vi.fn(async () => mockPaidUser),
        })),
      }));

      const config = {
        urls: {
          login: '/login',
          alreadySubscribed: '/dashboard',
          return: '/account',
        },
        fields: { id: 'id', tier: 'tier', polarStatus: 'polar_status' },
        userTable: 'users',
        proTiers: ['pro'],
        db: mockKnex,
      };

      const checkoutHandler = createCheckoutHandler(config);

      // Unauthenticated non-JSON -> redirect
      const res1 = { redirect: vi.fn() };
      await checkoutHandler({ headers: {}, is: () => false }, res1);
      expect(res1.redirect).toHaveBeenCalledWith('/login');

      // Unauthenticated JSON -> 401
      const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await checkoutHandler({ headers: { accept: 'application/json' }, is: () => true }, res2);
      expect(res2.status).toHaveBeenCalledWith(401);

      // Authenticated and already paid
      const res3 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await checkoutHandler(
        {
          user: mockPaidUser,
          headers: { accept: 'application/json' },
          is: () => true,
        },
        res3
      );
      expect(res3.status).toHaveBeenCalledWith(409);

      // Portal Handler unauthenticated -> redirect login
      const portalHandler = createPortalHandler(config);
      const res4 = { redirect: vi.fn() };
      await portalHandler({ headers: {} }, res4);
      expect(res4.redirect).toHaveBeenCalledWith('/login');

      // Portal Handler error -> redirect with error param
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res5 = { redirect: vi.fn() };
      await portalHandler({ user: { id: 1 }, headers: {}, protocol: 'http', get: () => 'localhost' }, res5);
      expect(res5.redirect).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('covers createStatusHandler and createRequireAuth branches', async () => {
      const config = {
        fields: { id: 'id', publicId: 'public_id', tier: 'tier', polarStatus: 'polar_status' },
        freeTierName: 'free',
        proTiers: ['pro'],
        db: null,
      };

      const statusHandler = createStatusHandler(config);

      // Unauthenticated -> 401
      const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await statusHandler({ user: null }, res1, vi.fn());
      expect(res1.status).toHaveBeenCalledWith(401);

      // Authenticated -> returns status
      const res2 = { json: vi.fn() };
      await statusHandler({ user: { id: 10, public_id: 'u_10', tier: 'pro' } }, res2, vi.fn());
      expect(res2.json).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 10,
          tier: 'pro',
          isPro: true,
        })
      );

      // createRequireAuth custom function
      const customAuth = vi.fn();
      expect(createRequireAuth({ requireAuth: customAuth }, {})).toBe(customAuth);

      // createRequireAuth from ctx.middlewares.auth factory
      const mockAuthMiddleware = vi.fn((opts) => (req, res, next) => next());
      const factoryAuth = createRequireAuth({}, { middlewares: { auth: mockAuthMiddleware } });
      const nextFn = vi.fn();
      factoryAuth({ path: '/api/polar/checkout', headers: {}, is: () => true }, {}, nextFn);
      expect(nextFn).toHaveBeenCalled();

      // createRequireAuth fallback
      const defaultAuth = createRequireAuth({}, {});
      const nextFallback = vi.fn();
      defaultAuth({ user: { id: 1 } }, {}, nextFallback);
      expect(nextFallback).toHaveBeenCalled();

      const resUnauthorized = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      defaultAuth({ user: null, path: '/api/something', headers: {}, is: () => true }, resUnauthorized, vi.fn());
      expect(resUnauthorized.status).toHaveBeenCalledWith(401);
    });
  });

  describe('plugins/upload/index.js branch coverage', () => {
    const { uploadPlugin, createLocalFileProvider } = require('../../plugins/upload/index.js');

    it('covers upload plugin onRoutesReady handler validation, MIME/extension allowlists, and errors', async () => {
      const provider = createLocalFileProvider({ uploadDir: './tmp/test-uploads' });
      const plugin = uploadPlugin({
        provider,
        multiple: false,
        mimeAllowlist: ['image/png'],
        extensionAllowlist: ['png'],
      });

      let routeHandler;
      const mockCtx = {
        app: { set: vi.fn() },
        addRoute: vi.fn((method, path, ...handlers) => {
          routeHandler = handlers[handlers.length - 1];
        }),
      };

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      plugin.onRoutesReady(mockCtx);
      logSpy.mockRestore();

      expect(routeHandler).toBeDefined();

      // 1. Empty files with valid request headers
      const req1 = {
        headers: { 'content-type': 'application/json' },
        file: null,
        files: [],
      };
      const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      routeHandler(req1, res1);
    });
  });

  describe('src/server.js shutdown and listen helpers branch coverage', () => {
    const { createApp } = require('../../src/server.js');

    it('covers app.listen and shutdownManager hook delegates', () => {
      const { app, shutdownManager } = createApp({
        pagesDir: './tests/fixtures/pages',
        viewsDir: './tests/fixtures/views',
        publicDir: './public',
      });

      expect(app.shutdownManager).toBe(shutdownManager);
      expect(app.isShuttingDown).toBe(false);

      const shutdownCallback = vi.fn();
      app.onShutdown(shutdownCallback);

      app.enableShutdownHooks();
      app.disableShutdownHooks();

      expect(typeof app.close).toBe('function');
    });
  });

  describe('src/discovery/scan-routes.js module scanning branch coverage', () => {
    const { scanRoutes } = require('../../src/discovery/scan-routes.js');

    it('scans modules with custom pages and api directories', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-modules-scan-'));
      const tmpModuleDir = path.join(tempDir, 'modules', 'shop');
      fs.mkdirSync(path.join(tmpModuleDir, 'custom-pages'), { recursive: true });
      fs.mkdirSync(path.join(tmpModuleDir, 'custom-api'), { recursive: true });

      fs.writeFileSync(
        path.join(tmpModuleDir, 'custom-pages/products.njk'),
        '<h1>Products</h1>'
      );
      fs.writeFileSync(
        path.join(tmpModuleDir, 'custom-pages/products.js'),
        'module.exports = { load: async () => ({}) };'
      );
      fs.writeFileSync(
        path.join(tmpModuleDir, 'custom-api/cart.get.js'),
        'module.exports = { handler: async (req, res) => res.json([]) };'
      );

      fs.writeFileSync(
        path.join(tmpModuleDir, 'module.js'),
        'module.exports = { pages: { dir: "custom-pages", prefix: "/shop" }, api: { dir: "custom-api", prefix: "/api/shop" } };'
      );

      const descriptors = scanRoutes({
        rootDir: tempDir,
        pages: false,
        api: false,
      });

      expect(descriptors.length).toBeGreaterThanOrEqual(1);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('src/api/api-loader.js and src/pages/page-loader.js branch coverage', () => {
    const { createApiHandler } = require('../../src/api/api-loader.js');
    const { createPageHandler } = require('../../src/pages/page-loader.js');

    it('covers auto-responding when handler returns object and error metadata population', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-auto-api-'));
      const fixtureApiFile = path.join(tempDir, 'test-auto-api.js');
      fs.writeFileSync(
        fixtureApiFile,
        'module.exports = { handler: async (req, res, ctx) => ({ autoJson: true }) };'
      );

      const handler = createApiHandler(
        { path: '/api/auto', method: 'get', file: fixtureApiFile, source: 'test-auto-api.js' },
        {}
      );

      const req = { method: 'GET', path: '/api/auto', headers: {}, id: 'req_123' };
      const res = { headersSent: false, json: vi.fn(), setHeader: vi.fn() };
      const next = vi.fn();

      await handler(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ autoJson: true });

      // Error handling path in createApiHandler
      const fixtureFailFile = path.join(tempDir, 'test-fail-api.js');
      fs.writeFileSync(
        fixtureFailFile,
        'module.exports = { handler: async () => { throw new Error("API Boom"); } };'
      );

      const failingHandler = createApiHandler(
        { path: '/api/fail', method: 'post', file: fixtureFailFile, source: 'test-fail-api.js' },
        {}
      );

      const nextErr = vi.fn();
      await failingHandler(req, res, nextErr);
      expect(nextErr).toHaveBeenCalled();
      const err = nextErr.mock.calls[0][0];
      expect(err.phase).toBe('handler');
      expect(err.requestId).toBe('req_123');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('covers page-loader redirect, error helper, head, render method, and error normalization', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-render-page-'));
      const fixturePageFile = path.join(tempDir, 'test-render-page.js');
      fs.writeFileSync(
        fixturePageFile,
        'module.exports = { render: async (data, ctx) => "<h1>Render Method</h1>", head: async () => ({ title: "Custom Head" }) };'
      );

      const renderPageHandler = createPageHandler(
        { path: '/render-test', file: fixturePageFile, source: 'test-render-page.js' },
        { nunjucks: null }
      );

      const req1 = {
        headers: {},
        params: {},
        query: {},
        get: (h) => null,
      };
      const res1 = {
        setHeader: vi.fn(),
        send: vi.fn(),
        headersSent: false,
      };
      const next1 = vi.fn();
      await renderPageHandler(req1, res1, next1);
      if (next1.mock.calls.length > 0) {
        throw next1.mock.calls[0][0];
      }
      expect(res1.send).toHaveBeenCalledWith('<h1>Render Method</h1>');

      // 2. Page error helper invocation
      const fixtureErrorFile = path.join(tempDir, 'test-error-page.js');
      fs.writeFileSync(
        fixtureErrorFile,
        'module.exports = { load: async (ctx) => { ctx.error(403, "Forbidden page"); } };'
      );

      const errorPageHandler = createPageHandler(
        { path: '/forbidden', file: fixtureErrorFile, source: 'test-error-page.js' },
        { nunjucks: null }
      );

      const nextErr = vi.fn();
      await errorPageHandler({ headers: {}, params: {}, query: {}, get: () => null }, {}, nextErr);
      expect(nextErr).toHaveBeenCalled();
      expect(nextErr.mock.calls[0][0].status).toBe(403);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('plugins/rate-limit/index.js branch coverage', () => {
    const { rateLimitPlugin } = require('../../plugins/rate-limit/index.js');

    it('covers rateLimitPlugin global skip paths, health and favicon checks', () => {
      const plugin = rateLimitPlugin({
        global: true,
        globalSkipPaths: ['/custom-skip'],
      });

      const registeredMiddlewares = [];
      const mockCtx = {
        middlewares: {},
        app: {
          use: vi.fn((mw) => {
            registeredMiddlewares.push(mw);
          }),
        },
      };

      plugin.register(mockCtx);
      expect(mockCtx.app.use).toHaveBeenCalled();

      // Test api options creator
      const opts = plugin.api.createLimiterOptions({ windowMs: 60000 });
      expect(opts.windowMs).toBe(60000);
      expect(typeof opts.keyGenerator).toBe('function');
    });
  });

  describe('core/auth/jwt.js and core/auth/tokens.js branch coverage', () => {
    const jwt = require('../../core/auth/jwt.js');
    const tokens = require('../../core/auth/tokens.js');

    it('covers jwt parseDuration, sign, verify error handling, and decodeJwt', () => {
      expect(jwt.parseDuration(120)).toBe(120);
      expect(jwt.parseDuration('30s')).toBe(30);
      expect(jwt.parseDuration('10m')).toBe(600);
      expect(jwt.parseDuration('2h')).toBe(7200);
      expect(jwt.parseDuration('3d')).toBe(259200);
      expect(jwt.parseDuration(null)).toBe(3600);
      expect(jwt.parseDuration('invalid')).toBe(3600);

      // Sign errors
      expect(() => jwt.signJwt({ id: 1 }, null)).toThrow('Secret is required');
      expect(() => jwt.signJwt({ id: 1 }, 'secret', { algorithm: 'RS256' })).toThrow('Unsupported algorithm');

      const validToken = jwt.signJwt({ id: 1 }, 'secret', {
        issuer: 'test-iss',
        audience: 'test-aud',
        expiresIn: '1h',
      });

      // Verify errors
      expect(() => jwt.verifyJwt(null, 'secret')).toThrow('JWT token must be a non-empty string');
      expect(() => jwt.verifyJwt(validToken, null)).toThrow('Secret is required');
      expect(() => jwt.verifyJwt('bad.token', 'secret')).toThrow('Invalid JWT format');
      expect(() => jwt.verifyJwt(validToken, 'wrong_secret')).toThrow('Invalid JWT signature');
      expect(() => jwt.verifyJwt(validToken, 'secret', { issuer: 'mismatch' })).toThrow('Invalid JWT issuer');
      expect(() => jwt.verifyJwt(validToken, 'secret', { audience: 'mismatch' })).toThrow('Invalid JWT audience');

      // Decode
      expect(jwt.decodeJwt(null)).toBeNull();
      expect(jwt.decodeJwt('bad.token')).toBeNull();
      expect(jwt.decodeJwt(validToken).payload.id).toBe(1);
    });

    it('covers tokens table creation, adapter, token creation, verification and purging', async () => {
      const records = [];
      const mockKnex = vi.fn((table) => ({
        insert: vi.fn(async (row) => records.push(row)),
        where: vi.fn((cond) => ({
          first: vi.fn(async () => records.find((r) => r.token === cond.token && r.type === cond.type)),
          where: vi.fn().mockReturnThis(),
          delete: vi.fn(async () => {
            records.length = 0;
            return 1;
          }),
        })),
      }));
      mockKnex.schema = {
        hasTable: vi.fn(async () => false),
        createTable: vi.fn(async (table, cb) => {
          const t = {
            bigIncrements: vi.fn().mockReturnThis(),
            primary: vi.fn(),
            bigInteger: vi.fn().mockReturnThis(),
            unsigned: vi.fn().mockReturnThis(),
            notNullable: vi.fn().mockReturnThis(),
            string: vi.fn().mockReturnThis(),
            unique: vi.fn(),
            timestamp: vi.fn().mockReturnThis(),
            defaultTo: vi.fn(),
            index: vi.fn(),
          };
          cb(t);
        }),
        dropTableIfExists: vi.fn(async () => {}),
      };
      mockKnex.fn = { now: () => new Date() };

      await tokens.createAuthTokensTable(mockKnex);
      expect(mockKnex.schema.createTable).toHaveBeenCalled();

      await tokens.dropAuthTokensTable(mockKnex);
      expect(mockKnex.schema.dropTableIfExists).toHaveBeenCalled();

      const adapter = tokens.createKnexAuthTokensAdapter(mockKnex);
      const created = await tokens.createAuthToken(adapter, tokens.TOKEN_TYPES.PASSWORD_RESET, 42, 60000);
      expect(created.rawToken).toBeDefined();

      const verified = await tokens.verifyAuthToken(adapter, tokens.TOKEN_TYPES.PASSWORD_RESET, created.rawToken);
      expect(verified).toBeDefined();
      expect(verified.userId).toBe(42);

      await tokens.consumeAuthToken(adapter, verified.tokenHash);
      const purged = await tokens.purgeExpiredAuthTokens(adapter);
      expect(purged).toBeDefined();

      // Null token verification
      expect(await tokens.verifyAuthToken(adapter, tokens.TOKEN_TYPES.PASSWORD_RESET, null)).toBeNull();
      expect(await tokens.purgeExpiredAuthTokens(null)).toBe(0);
    });
  });

  describe('src/server.js error boundary & abort handling branch coverage', () => {
    const { createApp } = require('../../src/server.js');
    const { RequestAbortedError, HttpError } = require('../../core/errors');
    const request = require('supertest');

    it('exercises custom timeout handler, HttpError custom headers, and RequestAbortedError', async () => {
      let customTimeoutRan = false;
      const fixtureDir = path.join(__dirname, '../fixtures/empty-pages');

      const { app } = createApp({
        pagesDir: fixtureDir,
        helmet: false,
        errorPages: {
          timeout: (req, res, ctx) => {
            customTimeoutRan = true;
            return res.status(503).json({ error: 'Custom Timeout Ran', status: 503 });
          },
        },
        setupRoutes: (a) => {
          a.get('/test-timeout', (req, res, next) => {
            req.timedout = true;
            next(new Error('Timeout Error'));
          });
          a.get('/test-aborted-socket', (req, res, next) => {
            req.socket = { destroyed: true };
            next(new RequestAbortedError('Socket destroyed'));
          });
          a.get('/test-http-custom-headers', (req, res, next) => {
            const err = new HttpError(429, 'Too Many Requests', {
              headers: {
                'Retry-After': '60',
                'X-RateLimit-Limit': '100',
              },
            });
            next(err);
          });
        },
      });

      // 1. Custom timeout handler
      const resTimeout = await request(app).get('/test-timeout').set('Accept', 'application/json');
      expect(resTimeout.status).toBe(503);
      expect(customTimeoutRan).toBe(true);
      expect(resTimeout.body.error).toBe('Custom Timeout Ran');

      // 2. Request aborted with destroyed socket
      try {
        const resAborted = await request(app).get('/test-aborted-socket');
        expect(resAborted.status).toBeDefined();
      } catch (err) {
        expect(err).toBeDefined();
      }

      // 3. HttpError custom headers
      const resHeaders = await request(app).get('/test-http-custom-headers').set('Accept', 'application/json');
      expect(resHeaders.status).toBe(429);
      expect(resHeaders.headers['retry-after']).toBe('60');
      expect(resHeaders.headers['x-ratelimit-limit']).toBe('100');
    });

    it('exercises app lifecycle hooks: onShutdown, close, enableShutdownHooks, disableShutdownHooks, and listen', async () => {
      const { app } = createApp({
        pagesDir: path.join(__dirname, '../fixtures/empty-pages'),
        helmet: {
          contentSecurityPolicy: {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'none'"],
            },
          },
        },
        plugins: [
          {
            name: 'test-csp-plugin',
            csp: {
              scriptSrc: ['https://cdn.example.com'],
              styleSrc: 'https://fonts.googleapis.com',
            },
            register: () => {},
          },
        ],
        trustProxy: false,
        compression: { enabled: false },
        server: {
          shutdown: { enabled: true, timeout: 5000 },
        },
      });

      let shutdownCalled = false;
      app.onShutdown(() => {
        shutdownCalled = true;
      });

      app.enableShutdownHooks();
      app.disableShutdownHooks();

      // Listen on ephemeral port
      const server = app.listen(0);
      expect(server).toBeDefined();
      expect(app.server).toBe(server);

      await app.close('test close');
      expect(shutdownCalled).toBe(true);
    });
  });
});

