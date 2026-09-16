'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');

describe('Template Helpers & Injector Branch Coverage', () => {
  describe('src/helpers.js branch coverage', () => {
    const { createHelpers, configureAssets, getScriptInjector } = require('../../src/helpers.js');

    it('exercises injectHead, injectBody, and devToolbar with custom options', () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const mockReq = {
        path: '/',
        query: {},
        headers: {},
        cookies: {},
      };
      const mockRes = {
        locals: { nonce: 'csp-nonce-123' },
      };

      const fsy = createHelpers({
        req: mockReq,
        res: mockRes,
        baseUrl: 'http://localhost:3000',
        locale: 'en',
      });

      const injector = getScriptInjector();
      injector.addStyle('body { color: blue; }');
      injector.addHead('<script>console.log("head");</script>');
      injector.addBody('<script>console.log("body");</script>');

      // 1. injectHead with string nonce and object nonce
      const head1 = fsy.injectHead('custom-nonce-str');
      expect(typeof head1).toBe('string');
      expect(head1).toContain('webspresso-injected-styles');
      expect(head1).toContain('nonce="custom-nonce-str"');

      const head2 = fsy.injectHead({ nonce: 'custom-nonce-obj' });
      expect(typeof head2).toBe('string');
      expect(head2).toContain('nonce="custom-nonce-obj"');

      const head3 = fsy.injectHead(); // nonce from this.nonce() (mockRes.locals.nonce)
      expect(typeof head3).toBe('string');
      expect(head3).toContain('nonce="csp-nonce-123"');

      // 2. injectBody with string nonce and object nonce
      const body1 = fsy.injectBody('custom-nonce-str');
      expect(typeof body1).toBe('string');

      const body2 = fsy.injectBody({ nonce: 'custom-nonce-obj' });
      expect(typeof body2).toBe('string');

      const body3 = fsy.injectBody();
      expect(typeof body3).toBe('string');

      // 3. devToolbar in dev mode
      const toolbarHtml = fsy.devToolbar({
        plugins: [{ name: 'CustomPlugin', path: '/_custom', icon: '⚡' }],
        customLinks: [{ name: 'Docs', path: '/docs', icon: '📖' }],
      });
      expect(toolbarHtml).toContain('id="webspresso-dev-toolbar"');
      expect(toolbarHtml).toContain('CustomPlugin');
      expect(toolbarHtml).toContain('Docs');

      // 4. devToolbar in prod mode
      process.env.NODE_ENV = 'production';
      const toolbarProd = fsy.devToolbar();
      expect(toolbarProd).toBe('');

      // 5. asset, css, js, img helpers with query version and prefix
      configureAssets({
        version: '1.2.3',
        prefix: 'https://cdn.example.com',
      });
      expect(fsy.asset('/assets/app.js')).toBe('https://cdn.example.com/assets/app.js?v=1.2.3');
      expect(fsy.css('/assets/style.css')).toContain('https://cdn.example.com/assets/style.css?v=1.2.3');
      expect(fsy.js('/assets/app.js')).toContain('https://cdn.example.com/assets/app.js?v=1.2.3');
      expect(fsy.img('/assets/logo.png', 'Logo')).toContain('https://cdn.example.com/assets/logo.png?v=1.2.3');

      // Reset asset config
      configureAssets({});
      process.env.NODE_ENV = origEnv;
    });
  });

  describe('src/plugin-manager.js branch coverage', () => {
    const { createPluginManager, getPluginManager } = require('../../src/plugin-manager.js');

    it('exercises onReady, getPluginAPI, getDisposers, and dispose error handling', async () => {
      const pm = createPluginManager();

      const mockPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        api: { doWork: vi.fn(() => 42) },
        register: (ctx) => {
          ctx.onDispose(() => {
            // successful disposer
          });
          ctx.onDispose(() => {
            throw new Error('Disposer exploded');
          });
        },
        onReady: vi.fn(async (ctx) => {
          expect(ctx.app).toBeDefined();
        }),
      };

      await pm.register([mockPlugin], { app: {}, middlewares: {} });
      expect(pm.hasPlugin('test-plugin')).toBe(true);
      expect(pm.getPlugin('test-plugin')).toBe(mockPlugin);
      expect(pm.getPluginAPI('test-plugin').doWork).toBeDefined();
      expect(pm.getPluginNames()).toContain('test-plugin');

      // onReady hook execution
      await pm.onReady({ app: {} });
      expect(mockPlugin.onReady).toHaveBeenCalled();

      // getDisposers & dispose execution
      const disposers = pm.getDisposers();
      expect(disposers.length).toBe(2);

      // Warning logged on disposer failure without uncaught error
      await pm.dispose();
      expect(pm.getDisposers().length).toBe(0);

      // Global singleton
      expect(getPluginManager()).toBeDefined();
    });
  });

  describe('src/server.js app shutdown and listen lifecycle branches', () => {
    const { createApp } = require('../../src/server.js');

    it('exercises shutdown helpers and listen adapter wrapping', async () => {
      const { app, shutdownManager } = createApp({
        pagesDir: path.join(__dirname, '../fixtures/basic-app/pages'),
        logging: false,
        server: {
          shutdown: { enabled: true, timeout: 1000 },
        },
      });

      expect(app.shutdownManager).toBe(shutdownManager);
      expect(app.isShuttingDown).toBe(false);

      const shutdownCallback = vi.fn();
      app.onShutdown(shutdownCallback);
      app.enableShutdownHooks();
      app.disableShutdownHooks();

      // Mock listen
      const mockHttpServer = new http.Server();
      const origListen = app.listen;
      const server = app.listen(0);
      expect(server).toBeDefined();

      await new Promise((r) => server.close(r));
    });
  });

  describe('plugins/polar/src/routes.js branch coverage', () => {
    const {
      createInjectDb,
      createStatusHandler,
      createRequireAuth,
    } = require('../../plugins/polar/src/routes.js');

    it('exercises createInjectDb middleware', () => {
      const mockDb = { name: 'knex-mock' };
      const mw = createInjectDb(mockDb);
      const req = {};
      const next = vi.fn();
      mw(req, {}, next);
      expect(req.db).toBe(mockDb);
      expect(next).toHaveBeenCalled();
    });

    it('exercises createStatusHandler for unauthorized, free, and pro tiers', async () => {
      const config = {
        userTable: 'users',
        freeTierName: 'free',
        proTiers: ['pro', 'premium'],
        fields: {
          id: 'id',
          publicId: 'public_id',
          tier: 'tier',
          polarStatus: 'polar_status',
          polarCustomerId: 'polar_customer_id',
          polarSubscriptionId: 'polar_subscription_id',
          polarCurrentPeriodEnd: 'polar_period_end',
          polarCancelAtPeriodEnd: 'polar_cancel',
        },
      };

      const handler = createStatusHandler(config);

      // 1. Unauthorized
      const res401 = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      await handler({ user: null }, res401, vi.fn());
      expect(res401.status).toHaveBeenCalledWith(401);

      // 2. Free tier user
      const resFree = {
        json: vi.fn(),
      };
      await handler(
        {
          user: {
            id: 1,
            public_id: 'usr_free',
            tier: 'free',
            polar_status: 'none',
          },
        },
        resFree,
        vi.fn()
      );
      expect(resFree.json).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          tier: 'free',
          isPro: false,
        })
      );

      // 3. Pro tier user
      const resPro = {
        json: vi.fn(),
      };
      await handler(
        {
          user: {
            id: 2,
            public_id: 'usr_pro',
            tier: 'pro',
            polar_status: 'active',
            polar_cancel: 1,
          },
        },
        resPro,
        vi.fn()
      );
      expect(resPro.json).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 2,
          tier: 'pro',
          isPro: true,
          polarCancelAtPeriodEnd: true,
        })
      );
    });

    it('exercises createRequireAuth middleware variants', () => {
      const config = {
        urls: { login: '/login' },
      };

      // 1. Custom requireAuth function
      const customAuth = vi.fn((req, res, next) => next());
      const mwCustom = createRequireAuth({ requireAuth: customAuth }, {});
      expect(mwCustom).toBe(customAuth);

      // 2. Middleware from ctx.middlewares.auth
      const authFactory = vi.fn((opts) => (req, res, next) => {
        req.authOptions = opts;
        next();
      });
      const mwFactory = createRequireAuth(config, { middlewares: { auth: authFactory } });
      const reqApi = { path: '/api/billing', headers: {}, is: () => false };
      const nextApi = vi.fn();
      mwFactory(reqApi, {}, nextApi);
      expect(reqApi.authOptions.api).toBe(true);

      // 3. Default fallback: user present
      const mwDefault = createRequireAuth(config, {});
      const reqUser = { user: { id: 1 }, path: '/dashboard', headers: {}, is: () => false };
      const nextUser = vi.fn();
      mwDefault(reqUser, {}, nextUser);
      expect(nextUser).toHaveBeenCalled();

      // 4. Default fallback: API unauthorized (401)
      const reqNoUserApi = { path: '/api/checkout', headers: { accept: 'application/json' }, is: () => true };
      const res401 = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      mwDefault(reqNoUserApi, res401, vi.fn());
      expect(res401.status).toHaveBeenCalledWith(401);

      // 5. Default fallback: Web unauthorized (redirect to login)
      const reqNoUserWeb = { path: '/billing/portal', headers: {}, is: () => false };
      const resRedirect = {
        redirect: vi.fn(),
      };
      mwDefault(reqNoUserWeb, resRedirect, vi.fn());
      expect(resRedirect.redirect).toHaveBeenCalledWith('/login');
    });
  });

  describe('src/plugin-manager.js semver, matchPattern, and lifecycle edge branches', () => {
    const {
      PluginManager,
      createPluginManager,
      semver,
      matchPattern,
    } = require('../../src/plugin-manager.js');

    it('exercises semver parsing, comparison, and satisfies ranges', () => {
      expect(semver.parse(null)).toBeNull();
      expect(semver.parse('invalid')).toBeNull();
      expect(semver.parse('1.2.3-beta.1')).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: 'beta.1',
      });

      expect(semver.compare('1.0.0', 'invalid')).toBe(0);
      expect(semver.compare('1.2.0', '1.1.0')).toBe(1);
      expect(semver.compare('1.1.0', '1.2.0')).toBe(-1);
      expect(semver.compare('1.1.1', '1.1.2')).toBe(-1);
      expect(semver.compare('1.1.2', '1.1.1')).toBe(1);
      expect(semver.compare('1.0.0', '1.0.0')).toBe(0);

      expect(semver.satisfies('1.2.3', '*')).toBe(true);
      expect(semver.satisfies('invalid', '^1.0.0')).toBe(false);
      expect(semver.satisfies('1.2.3', '^1.0.0')).toBe(true);
      expect(semver.satisfies('2.0.0', '^1.0.0')).toBe(false);
      expect(semver.satisfies('0.1.2', '^0.1.0')).toBe(true);
      expect(semver.satisfies('0.2.0', '^0.1.0')).toBe(false);
      expect(semver.satisfies('1.2.3', '~1.2.0')).toBe(true);
      expect(semver.satisfies('1.3.0', '~1.2.0')).toBe(false);
      expect(semver.satisfies('2.0.0', '>=1.0.0')).toBe(true);
      expect(semver.satisfies('0.9.0', '>=1.0.0')).toBe(false);
      expect(semver.satisfies('2.0.0', '>1.0.0')).toBe(true);
      expect(semver.satisfies('1.0.0', '>1.0.0')).toBe(false);
      expect(semver.satisfies('1.0.0', '<=1.0.0')).toBe(true);
      expect(semver.satisfies('1.1.0', '<=1.0.0')).toBe(false);
      expect(semver.satisfies('0.9.0', '<1.0.0')).toBe(true);
      expect(semver.satisfies('1.0.0', '<1.0.0')).toBe(false);
      expect(semver.satisfies('1.0.0', '1.0.0')).toBe(true);
      expect(semver.satisfies('1.0.0', '2.0.0')).toBe(false);
    });

    it('exercises matchPattern glob matcher', () => {
      expect(matchPattern('/path/file.js', '*')).toBe(true);
      expect(matchPattern('/path/file.js', '**')).toBe(true);
      expect(matchPattern('file.js', '*.js')).toBe(true);
      expect(matchPattern('file.txt', '*.js')).toBe(false);
      expect(matchPattern('a/b/c.js', '**/*.js')).toBe(true);
      expect(matchPattern('cat', 'c?t')).toBe(true);
    });

    it('exercises circular dependencies and plugin error handling in setup and register', async () => {
      const pm = new PluginManager();

      // Circular dependencies
      const pA = { name: 'A', dependencies: ['B'] };
      const pB = { name: 'B', dependencies: ['A'] };
      const sorted = pm._resolveDependencyOrder([pA, pB]);
      expect(sorted.length).toBe(0);

      // Duplicate plugin name and missing name
      const duplicateOrder = pm._resolveDependencyOrder([
        { name: 'X' },
        { name: 'X' },
        { /* no name */ },
      ]);
      expect(duplicateOrder.length).toBe(1);

      // Plugin setup/register throwing errors
      const failingPlugin = {
        name: 'failing',
        setup: () => {
          throw new Error('Setup boom');
        },
        register: () => {
          throw new Error('Register boom');
        },
      };
      await pm.register([failingPlugin], { app: {} });
      expect(pm.hasPlugin('failing')).toBe(false);

      // Plugin with missing dependency & semver mismatch warnings
      const pmDep = new PluginManager();
      const depPlugin = {
        name: 'consumer',
        dependencies: {
          'missing-dep': '^1.0.0',
          'mismatched-dep': '^2.0.0',
        },
      };
      const mismatched = { name: 'mismatched-dep', version: '1.0.0' };
      await pmDep.register([mismatched, depPlugin], { app: {} });
      expect(pmDep.hasPlugin('consumer')).toBe(true);
    });
  });

  describe('plugins/realtime and plugins/polar lifecycle branch coverage', () => {
    const { realtimePlugin, createWebSocketAdapter } = require('../../plugins/realtime/index.js');
    const polarPlugin = require('../../plugins/polar/index.js');

    it('exercises realtimePlugin setup, register, browserReady, and destroy', () => {
      const adapter = createWebSocketAdapter({ url: 'ws://localhost:3000' });
      const plugin = realtimePlugin({ adapter });

      // setup
      const mockApp = {};
      const cleanup = plugin.setup(mockApp);
      expect(mockApp.realtime).toBeDefined();
      expect(typeof cleanup).toBe('function');
      cleanup();

      // register without onDispose
      const mockCtx = { app: {} };
      plugin.register(mockCtx);
      expect(mockCtx.app.realtime).toBeDefined();

      plugin.browserReady();
      plugin.destroy();
    });

    it('exercises polarPlugin disabled mode, syncMiddleware, and SDK methods', async () => {
      // Disabled mode
      const disabledPlugin = polarPlugin({ enabled: false });
      const mockCtx = {
        app: { use: vi.fn() },
        addRoute: vi.fn(),
      };
      disabledPlugin.register(mockCtx);
      disabledPlugin.onRoutesReady(mockCtx);
      expect(mockCtx.app.use).not.toHaveBeenCalled();
      expect(mockCtx.addRoute).not.toHaveBeenCalled();

      // Enabled plugin with SDK methods
      const activePlugin = polarPlugin({
        enabled: true,
        accessToken: 'pol_token_123',
        sandbox: true,
        plans: { pro: 'plan_pro' },
        syncMiddleware: true,
      });

      const mockApp = { use: vi.fn() };
      activePlugin.register({ app: mockApp, nunjucksEnv: { addFilter: vi.fn() } });
      expect(mockApp.use).toHaveBeenCalled();

      const cfg = activePlugin.api.getConfig();
      expect(cfg.accessToken).toBe('pol_token_123');
      expect(cfg.sandbox).toBe(true);

      expect(typeof activePlugin.api.isProSubscriptionStatus).toBe('function');
      expect(activePlugin.api.isProSubscriptionStatus('active')).toBe(true);
      expect(activePlugin.api.isProSubscriptionStatus('canceled')).toBe(false);
    });
  });
});

