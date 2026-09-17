'use strict';

const path = require('path');
const fs = require('fs');

describe('Polar Billing & Rate Limiting Branch Coverage', () => {
  describe('plugins/rate-limit/index.js deep branch coverage', () => {
    const { rateLimitPlugin } = require('../../plugins/rate-limit/index.js');

    it('exercises rateLimit named middleware factory and global limiter with skip paths', async () => {
      let globalMiddleware;
      const mockCtx = {
        middlewares: {},
        app: {
          use: vi.fn((mw) => {
            globalMiddleware = mw;
          }),
        },
      };

      const plugin = rateLimitPlugin({
        global: true,
        globalSkipPaths: ['/custom-skip'],
        globalOverrides: {
          windowMs: 5000,
          skip: (req) => req.path === '/explicit-user-skip',
        },
      });

      plugin.register(mockCtx);
      expect(typeof mockCtx.middlewares.rateLimit).toBe('function');

      // 1. Invoke named middleware factory
      const namedLimiter = mockCtx.middlewares.rateLimit({ windowMs: 10000, max: 5 });
      expect(typeof namedLimiter).toBe('function');

      const req1 = { ip: '127.0.0.1', headers: {} };
      const res1 = { setHeader: vi.fn(), getHeader: vi.fn() };
      const next1 = vi.fn();
      await namedLimiter(req1, res1, next1);
      expect(next1).toHaveBeenCalled();

      // 2. Invoke global limiter with health, favicon, custom skip, user skip, and standard path
      expect(typeof globalMiddleware).toBe('function');

      const paths = ['/health', '/robots.txt', '/favicon.ico', '/custom-skip/test', '/explicit-user-skip', '/normal-route'];
      for (const p of paths) {
        const next = vi.fn();
        await globalMiddleware({ ip: '127.0.0.1', path: p, headers: {} }, res1, next);
        expect(next).toHaveBeenCalled();
      }
    });
  });

  describe('plugins/polar/index.js SDK method invocations', () => {
    const polarPlugin = require('../../plugins/polar/index.js');

    it('exercises SDK proxy methods', async () => {
      const p = polarPlugin({
        enabled: true,
        accessToken: 'test_token',
        sandbox: true,
        plans: { pro: 'plan_123' },
      });

      // polarApiRequest with fetch mock (zero network delay)
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ detail: 'Invalid token' }),
      });
      await expect(p.api.polarApiRequest('/v1/customer-portal/subscriptions')).rejects.toThrow(/Polar API 401/);
      fetchSpy.mockRestore();

      // polarSyncMiddleware
      const mw = p.api.polarSyncMiddleware({ strict: false });
      expect(typeof mw).toBe('function');
      const nextSync = vi.fn();
      await mw({ user: null }, {}, nextSync);
      expect(nextSync).toHaveBeenCalled();
    });
  });

  describe('src/file-router.js dynamic route registration and hook branches', () => {
    const { mountPages } = require('../../src/file-router.js');

    it('registers dynamic file routes and runs SSR hooks', async () => {
      const mockApp = {
        get: vi.fn(),
        post: vi.fn(),
      };

      const mockNunjucks = {
        render: vi.fn((tpl, ctx) => `<html>${tpl}</html>`),
        renderString: vi.fn((body, ctx) => `<html>String</html>`),
      };

      const tmpPages = path.join(__dirname, '../../tmp/test-router-dynamic');
      fs.mkdirSync(path.join(tmpPages, 'api'), { recursive: true });

      fs.writeFileSync(
        path.join(tmpPages, '[slug].njk'),
        '<h1>Dynamic Page {{ slug }}</h1>'
      );
      fs.writeFileSync(
        path.join(tmpPages, '[slug].js'),
        'module.exports = { load: async (req) => ({ slug: req.params.slug }) };'
      );
      fs.writeFileSync(
        path.join(tmpPages, 'api/[id].get.js'),
        'module.exports = { handler: async (req, res) => res.json({ id: req.params.id }) };'
      );

      const result = mountPages(mockApp, {
        pagesDir: tmpPages,
        apiDir: path.join(tmpPages, 'api'),
        nunjucks: mockNunjucks,
        silent: true,
      });

      expect(typeof result.registerDynamicFileRoutes).toBe('function');
      result.registerDynamicFileRoutes();
      expect(result.routeMetadata.length).toBeGreaterThanOrEqual(2);

      fs.rmSync(tmpPages, { recursive: true, force: true });
    });

    it('exercises SSR streaming mode and frontmatter string rendering in file-router', async () => {
      const handlers = {};
      const mockApp = {
        get: vi.fn((route, ...mws) => {
          handlers[`GET ${route}`] = mws[mws.length - 1];
        }),
        post: vi.fn(),
      };

      const mockNunjucks = {
        render: vi.fn((tpl, ctx) => `<html>${tpl}</html>`),
        renderString: vi.fn((body, ctx) => `<html>String: ${body}</html>`),
      };

      const tmpPages = path.join(__dirname, '../../tmp/test-router-stream');
      fs.mkdirSync(tmpPages, { recursive: true });

      fs.writeFileSync(
        path.join(tmpPages, 'stream.njk'),
        '<h1>Streaming Page</h1>'
      );
      fs.writeFileSync(
        path.join(tmpPages, 'stream.js'),
        'module.exports = { load: async (ctx) => { ctx.defer = { slowData: Promise.resolve("done") }; return {}; } };'
      );

      mountPages(mockApp, {
        pagesDir: tmpPages,
        nunjucks: mockNunjucks,
        config: { stream: true },
        silent: true,
      });

      const handler = handlers['GET /stream'];
      expect(typeof handler).toBe('function');

      const mockReq = {
        path: '/stream',
        query: {},
        params: {},
        headers: {},
        get: () => '',
        cookies: {},
      };
      const mockRes = {
        setHeader: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await handler(mockReq, mockRes, (err) => {
        if (err) throw err;
      });

      fs.rmSync(tmpPages, { recursive: true, force: true });
    });
  });

  describe('plugins/redirect/index.js trailing slash and query preservation branch coverage', () => {
    const { redirectPlugin } = require('../../plugins/redirect/index.js');

    it('exercises trailing slash modes, external rules, and query preservation', () => {
      // Empty rules
      const emptyPlugin = redirectPlugin({ rules: [] });
      const mockEmptyCtx = { app: { use: vi.fn() } };
      emptyPlugin.register(mockEmptyCtx);
      expect(mockEmptyCtx.app.use).not.toHaveBeenCalled();

      // Configured rules with add/strip slash and preserve query
      const plugin = redirectPlugin({
        trailingSlash: 'add',
        preserveQuery: true,
        rules: [
          { from: '/old-path', to: '/new-path', status: 301 },
          { from: '/wildcard', to: '/all-methods', methods: '*' },
          { from: '/invalid-status', to: '/target', status: 999 },
          { from: '/external-blocked', to: 'https://example.com' },
        ],
      });

      let redirectMw;
      const mockCtx = {
        app: {
          use: vi.fn((mw) => {
            redirectMw = mw;
          }),
        },
      };

      plugin.register(mockCtx);
      expect(mockCtx.app.use).toHaveBeenCalled();

      // Test redirect with query preservation
      const res = { redirect: vi.fn() };
      const req = {
        path: '/old-path/',
        url: '/old-path/?param=value',
        originalUrl: '/old-path/?param=value',
        method: 'GET',
      };
      redirectMw(req, res, vi.fn());
      expect(res.redirect).toHaveBeenCalledWith(301, '/new-path?param=value');

      // Test non-matching route
      const nextNonMatch = vi.fn();
      redirectMw({ path: '/unrelated', method: 'GET' }, {}, nextNonMatch);
      expect(nextNonMatch).toHaveBeenCalled();
    });
  });

  describe('plugins/realtime/index.js deep lifecycle branch coverage', () => {
    const { realtimePlugin, createWebSocketAdapter } = require('../../plugins/realtime/index.js');

    it('exercises client lifecycle across setup, register with onDispose, browserReady, and destroy', () => {
      const adapter = createWebSocketAdapter({ url: 'ws://localhost:3000' });
      const plugin = realtimePlugin({ adapter });

      expect(plugin.api.getClient()).toBeNull();

      // 1. First setup creates clientInstance
      const mockApp = {};
      const cleanup = plugin.setup(mockApp);
      expect(mockApp.realtime).toBeDefined();
      expect(plugin.api.getClient()).toBe(mockApp.realtime);

      // 2. Second setup reuses clientInstance
      const mockApp2 = {};
      plugin.setup(mockApp2);
      expect(mockApp2.realtime).toBe(mockApp.realtime);

      // 3. Register reuses clientInstance and sets onDispose
      let disposeHook = null;
      plugin.register({
        app: {},
        onDispose: (cb) => {
          disposeHook = cb;
        },
      });
      expect(disposeHook).toBeDefined();

      // 4. browserReady
      plugin.browserReady();

      // 5. onDispose hook execution
      disposeHook();

      // 6. cleanup function
      cleanup();

      // 7. destroy resets clientInstance
      plugin.destroy();
      expect(plugin.api.getClient()).toBeNull();
    });
  });

  describe('plugins/polar/src/rate-limit.js resolver branch coverage', () => {
    const {
      resolvePolarRateLimiters,
      loadIpKeyGenerator,
      getDefaultRateLimits,
    } = require('../../plugins/polar/src/rate-limit.js');

    it('exercises resolvePolarRateLimiters with all routes, overrides, and skip configs', () => {
      const mockLimiterFactory = vi.fn((opts) => `limiter:${JSON.stringify(opts)}`);
      const ctx = {
        middlewares: {
          rateLimit: mockLimiterFactory,
        },
      };

      // 1. All routes with specific overrides
      const config = {
        rateLimit: {
          webhook: { max: 50 },
          checkout: false, // skipped
          portal: { windowMs: 30000 },
          status: { max: 10 },
        },
      };

      const limiters = resolvePolarRateLimiters(ctx, config);
      expect(limiters.webhook).toBeDefined();
      expect(limiters.checkout).toBeUndefined();
      expect(limiters.portal).toBeDefined();
      expect(limiters.status).toBeDefined();

      // 2. rateLimit: true (all default limits)
      const allDefaultLimiters = resolvePolarRateLimiters(ctx, { rateLimit: true });
      expect(allDefaultLimiters.webhook).toBeDefined();
      expect(allDefaultLimiters.checkout).toBeDefined();
      expect(allDefaultLimiters.portal).toBeDefined();
      expect(allDefaultLimiters.status).toBeDefined();

      // 3. Helper functions
      expect(loadIpKeyGenerator()).toBeDefined();
      expect(getDefaultRateLimits()).toBeDefined();
    });
  });

  describe('plugins/polar/src/user-resolver.js and nunjucks-filters.js branch coverage', () => {
    const {
      normalizePolarEventData,
      collectPolarMetadata,
      isProSubscriptionStatus,
      userHasProTier,
      parsePolarTimestamp,
      normalizePolarTimestamp,
      listPolarSubscriptions,
      pickBestActiveSubscription,
      buildCheckoutMetadata,
      resolveUserFromPolarData,
    } = require('../../plugins/polar/src/user-resolver.js');
    const {
      dateLabel,
      createSafeTruncateFilter,
      registerNunjucksFilters,
    } = require('../../plugins/polar/src/nunjucks-filters.js');

    it('exercises user-resolver normalize, collect metadata, and timestamp helpers', () => {
      expect(normalizePolarEventData(null)).toEqual({});
      expect(normalizePolarEventData(123)).toEqual({});

      const eventData = {
        id: 'evt_1',
        checkout: { customer: { id: 'c_1' }, metadata: { tier: 'pro' } },
      };
      const { normalized, metadata } = collectPolarMetadata(eventData);
      expect(normalized.customer.id).toBe('c_1');
      expect(metadata.tier).toBe('pro');

      expect(isProSubscriptionStatus('ACTIVE')).toBe(true);
      expect(isProSubscriptionStatus('trialing')).toBe(true);
      expect(isProSubscriptionStatus('incomplete')).toBe(false);

      const mockConfig = {
        fields: { tier: 'tier_col' },
        proTiers: ['pro', 'vip'],
      };
      expect(userHasProTier(null, mockConfig)).toBe(false);
      expect(userHasProTier({ tier_col: 'pro' }, mockConfig)).toBe(true);
      expect(userHasProTier({ tier_col: 'free' }, mockConfig)).toBe(false);

      expect(parsePolarTimestamp(null)).toBeNull();
      expect(parsePolarTimestamp(new Date('invalid'))).toBeNull();
      const validD = new Date('2026-09-16T12:00:00Z');
      expect(parsePolarTimestamp(validD)).toBe(validD);
      expect(normalizePolarTimestamp('2026-09-16T12:00:00Z')).toBe('2026-09-16T12:00:00.000Z');
      expect(normalizePolarTimestamp('invalid-date')).toBeNull();
    });

    it('exercises listPolarSubscriptions and pickBestActiveSubscription', () => {
      expect(listPolarSubscriptions(null)).toEqual([]);
      expect(listPolarSubscriptions({ items: [{ id: '1' }] })).toEqual([{ id: '1' }]);
      expect(listPolarSubscriptions({ results: [{ id: '2' }] })).toEqual([{ id: '2' }]);
      expect(listPolarSubscriptions({ other: 123 })).toEqual([]);

      const mockConfig = {
        proTiers: ['pro'],
        tierMapping: { pro: ['plan_pro'] },
        plans: { plan_pro: 'prod_123' },
      };

      expect(pickBestActiveSubscription([], mockConfig)).toBeNull();
      expect(pickBestActiveSubscription([{ status: 'canceled' }], mockConfig)).toBeNull();

      const matched = pickBestActiveSubscription(
        [
          { status: 'active', product_id: 'prod_other' },
          { status: 'active', product_id: 'prod_123' },
        ],
        mockConfig
      );
      expect(matched.product_id).toBe('prod_123');
    });

    it('exercises buildCheckoutMetadata and resolveUserFromPolarData fallbacks', async () => {
      const mockConfig = {
        userTable: 'users',
        fields: {
          id: 'id',
          publicId: 'public_id',
          email: 'email',
          polarCustomerId: 'polar_cust_id',
        },
      };

      const user = { id: 42, public_id: 'usr_pub', username: 'john' };
      const meta = buildCheckoutMetadata(user, mockConfig, { custom_field: 'value', empty_field: '' });
      expect(meta.user_id).toBe('42');
      expect(meta.public_id).toBe('usr_pub');
      expect(meta.username).toBe('john');
      expect(meta.custom_field).toBe('value');
      expect(meta.empty_field).toBeUndefined();

      // resolveUserFromPolarData
      expect(await resolveUserFromPolarData(null, {}, mockConfig)).toBeNull();
      expect(await resolveUserFromPolarData({}, null, mockConfig)).toBeNull();

      const mockDb = vi.fn((table) => ({
        where: vi.fn((field, val) => ({
          first: vi.fn(async () => {
            if (field === 'id' && (val === '42' || val === 42)) return { id: 42, name: 'MatchedById' };
            if (field === 'public_id' && val === 'usr_pub') return { id: 42, name: 'MatchedByPub' };
            if (field === 'polar_cust_id' && val === 'cust_123') return { id: 42, name: 'MatchedByCust' };
            return null;
          }),
        })),
        whereRaw: vi.fn((sql, bindings) => ({
          first: vi.fn(async () => {
            if (bindings[1] === 'john@example.com') return { id: 42, name: 'MatchedByEmail' };
            return null;
          }),
        })),
      }));

      // 1. By metadata.user_id
      const u1 = await resolveUserFromPolarData({ metadata: { user_id: '42' } }, mockDb, mockConfig);
      expect(u1.name).toBe('MatchedById');

      // 2. By metadata.public_id
      const u2 = await resolveUserFromPolarData({ metadata: { public_id: 'usr_pub' } }, mockDb, mockConfig);
      expect(u2.name).toBe('MatchedByPub');

      // 3. By customer.email
      const u3 = await resolveUserFromPolarData({ customer: { email: 'john@example.com' } }, mockDb, mockConfig);
      expect(u3.name).toBe('MatchedByEmail');

      // 4. By customer_id
      const u4 = await resolveUserFromPolarData({ customer_id: 'cust_123' }, mockDb, mockConfig);
      expect(u4.name).toBe('MatchedByCust');
    });

    it('exercises nunjucks filters defaultTruncate and date parsing', () => {
      expect(dateLabel('invalid')).toBe('invalid');
      expect(dateLabel('2026-09-16 12:00:00')).toBe('2026-09-16');

      // register filters without existing truncate filter
      const filters = {};
      const mockEnv = {
        addFilter: (name, fn) => {
          filters[name] = fn;
        },
        getFilter: () => null,
      };
      registerNunjucksFilters(mockEnv);
      expect(typeof filters.truncate).toBe('function');
      expect(filters.truncate('Short', 10)).toBe('Short');
      expect(filters.truncate('Very Long Text Goes Here', 5)).toBe('Very …');
      expect(filters.truncate(new Date('2026-09-16T12:00:00Z'), 10)).toBe('2026-09-16');
    });

    it('exercises polar rate-limit.js and polar plugin route registration branches', () => {
      const {
        DEFAULT_RATE_LIMITS,
        getDefaultRateLimits,
        resolvePolarRateLimiters,
      } = require('../../plugins/polar/src/rate-limit.js');
      const polarPlugin = require('../../plugins/polar/index.js');
      const { rateLimitPlugin } = require('../../plugins/rate-limit/index.js');

      // 1. DEFAULT_RATE_LIMITS getter & cached defaults
      expect(DEFAULT_RATE_LIMITS).toBeDefined();
      expect(getDefaultRateLimits()).toBeDefined();

      // 2. resolvePolarRateLimiters with disabled and route overrides
      expect(resolvePolarRateLimiters({}, { rateLimit: false })).toEqual({});
      expect(resolvePolarRateLimiters({}, { rateLimit: { enabled: false } })).toEqual({});

      const mockFactory = vi.fn((opts) => opts);
      const limiters = resolvePolarRateLimiters(
        { middlewares: { rateLimit: mockFactory } },
        {
          rateLimit: {
            checkout: false,
            portal: { limit: 25 },
          },
        }
      );
      expect(limiters.checkout).toBeUndefined();
      expect(limiters.portal).toBeDefined();
      expect(limiters.portal.limit).toBe(25);

      // 3. rateLimitPlugin api.createLimiterOptions
      const rlPlugin = rateLimitPlugin();
      const opts = rlPlugin.api.createLimiterOptions({ limit: 50, windowMs: 10000 });
      expect(opts.limit).toBe(50);
      expect(opts.windowMs).toBe(10000);

      // 4. polarPlugin onRoutesReady with db: null warning
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const pInstance = polarPlugin({ enabled: true, db: null });
      pInstance.onRoutesReady({ db: null, addRoute: vi.fn() });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[polar] Skipping routes: no database'));
      warnSpy.mockRestore();

      // 5. polarPlugin register when disabled
      const pDisabled = polarPlugin({ enabled: false });
      pDisabled.register({ app: { use: vi.fn() } });
      pDisabled.onRoutesReady({ addRoute: vi.fn() });
    });
  });
});


