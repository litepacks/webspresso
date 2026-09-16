'use strict';

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

describe('Security & Queue Branch Coverage', () => {
  describe('plugins/rate-limit/index.js branch coverage', () => {
    const { rateLimitPlugin, loadPeer } = require('../../plugins/rate-limit/index.js');

    it('handles rateLimitPlugin registration with global enabled and custom skip paths', () => {
      const app = {
        use: vi.fn(),
      };
      const ctx = {
        app,
        middlewares: {},
      };

      const plugin = rateLimitPlugin({
        global: true,
        globalSkipPaths: ['/api/public', '/status'],
        globalOverrides: {
          limit: 50,
          skip: (req) => req.headers?.['x-skip-rate-limit'] === 'true',
        },
      });

      expect(plugin.name).toBe('rate-limit');
      plugin.register(ctx);

      expect(typeof ctx.middlewares.rateLimit).toBe('function');
      expect(app.use).toHaveBeenCalledTimes(1);

      // Verify createLimiterOptions API
      const opts1 = plugin.api.createLimiterOptions({ limit: 20 });
      expect(opts1.limit).toBe(20);

      const optsCustomKey = plugin.api.createLimiterOptions({
        keyGenerator: () => 'custom-key',
      });
      expect(optsCustomKey.keyGenerator()).toBe('custom-key');
    });

    it('exercises loadPeer and fallback verification', () => {
      const peer = loadPeer();
      expect(typeof peer.rateLimit).toBe('function');
      expect(typeof peer.ipKeyGenerator).toBe('function');
    });
  });

  describe('plugins/recaptcha/index.js branch coverage', () => {
    const recaptchaPlugin = require('../../plugins/recaptcha/index.js');

    it('validates options and throws if siteKey is missing', () => {
      expect(() => recaptchaPlugin({})).toThrow(/requires options.siteKey/);
      expect(() => recaptchaPlugin({ siteKey: '' })).toThrow(/requires options.siteKey/);
    });

    it('registers v2 and v3 template helpers and middleware on ctx', async () => {
      const origSecret = process.env.RECAPTCHA_SECRET_KEY;
      delete process.env.RECAPTCHA_SECRET_KEY;

      const pluginV2 = recaptchaPlugin({ siteKey: 'site-key-123' });
      expect(() => pluginV2.api.createMiddleware()).toThrow(/set RECAPTCHA_SECRET_KEY/);

      process.env.RECAPTCHA_SECRET_KEY = 'secret-key-env';

      const helpers = {};
      const ctx = {
        middlewares: {},
        addHelper: (name, fn) => {
          helpers[name] = fn;
        },
      };

      pluginV2.register(ctx);
      expect(typeof ctx.middlewares.recaptcha).toBe('function');
      expect(helpers.recaptchaScript()).toContain('https://www.google.com/recaptcha/api.js');
      expect(helpers.recaptchaWidget()).toContain('data-sitekey="site-key-123"');

      // V3 plugin
      const pluginV3 = recaptchaPlugin({
        siteKey: 'site-key-v3',
        version: 'v3',
        defaultV3Action: 'login',
        secretKey: 'custom-secret',
      });
      const helpersV3 = {};
      const ctxV3 = {
        middlewares: {},
        addHelper: (name, fn) => {
          helpersV3[name] = fn;
        },
      };
      pluginV3.register(ctxV3);
      expect(helpersV3.recaptchaScript()).toContain('render=site-key-v3');
      expect(helpersV3.recaptchaV3Token()).toContain("grecaptcha.execute('site-key-v3'");

      // Test verifyRequest without req.body
      const req = { ip: '127.0.0.1' };
      // Will fail network call but exercises verifyRequest branch
      await pluginV3.api.verifyRequest(req, { bodyField: 'token' }).catch(() => {});

      if (origSecret) process.env.RECAPTCHA_SECRET_KEY = origSecret;
      else delete process.env.RECAPTCHA_SECRET_KEY;
    });
  });

  describe('plugins/realtime/index.js branch coverage', () => {
    const { realtimePlugin, realtime, createWebSocketAdapter } = require('../../plugins/realtime/index.js');

    it('exercises realtime plugin lifecycle: setup, register, browserReady, destroy', () => {
      const mockAdapter = {
        name: 'mock',
        connect: vi.fn(),
        disconnect: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        publish: vi.fn(),
      };
      const plugin = realtimePlugin({ adapter: mockAdapter });
      const app = {};
      const disposeFn = plugin.setup(app);
      expect(app.realtime).toBeDefined();
      expect(plugin.api.getClient()).toBe(app.realtime);

      plugin.browserReady(app);

      let disposed = false;
      const ctx = {
        app: {},
        onDispose: (fn) => {
          fn();
          disposed = true;
        },
      };
      plugin.register(ctx);
      expect(disposed).toBe(true);

      disposeFn();
      plugin.destroy(app);
      expect(plugin.api.getClient()).toBeNull();

      // Standalone realtime() factory
      const rt = realtime({ adapter: mockAdapter });
      expect(rt).toBeDefined();
      expect(rt.plugin).toBeDefined();
    });
  });

  describe('plugins/xlsx/index.js branch coverage', () => {
    const { xlsxPlugin, xlsx } = require('../../plugins/xlsx/index.js');

    it('registers xlsx plugin on ctx, registers services and app middleware', () => {
      const mockServiceRegistry = {
        has: vi.fn(() => false),
        register: vi.fn(),
      };
      const app = {
        serviceRegistry: mockServiceRegistry,
        use: vi.fn(),
        get: vi.fn(),
      };
      const ctx = {
        app,
        middlewares: {},
      };

      const plugin = xlsxPlugin({ enabled: true });
      plugin.register(ctx);

      expect(ctx.xlsx).toBe(xlsx);
      expect(app.xlsx).toBe(xlsx);
      expect(mockServiceRegistry.register).toHaveBeenCalled();
      expect(typeof ctx.middlewares.xlsx).toBe('function');
      expect(app.use).toHaveBeenCalled();

      // Disabled plugin
      const disabledPlugin = xlsxPlugin({ enabled: false });
      const ctxDisabled = { app: { use: vi.fn() } };
      disabledPlugin.register(ctxDisabled);
      expect(ctxDisabled.xlsx).toBeUndefined();
    });
  });

  describe('plugins/polar/src/nunjucks-filters.js and rate-limit.js', () => {
    const {
      dateLabel,
      createSafeTruncateFilter,
      registerNunjucksFilters,
    } = require('../../plugins/polar/src/nunjucks-filters.js');
    const {
      polarIpKey,
      polarUserOrIpKey,
      buildDefaultRateLimits,
      getDefaultRateLimits,
      resolvePolarRateLimiters,
      DEFAULT_RATE_LIMITS,
    } = require('../../plugins/polar/src/rate-limit.js');

    it('exercises dateLabel, createSafeTruncateFilter, and registerNunjucksFilters', () => {
      expect(dateLabel(null)).toBe('');
      expect(dateLabel(new Date('2026-05-10T12:00:00Z'))).toBe('2026-05-10');
      expect(dateLabel(new Date('invalid'))).toBe('');
      expect(dateLabel('2026-04-01T00:00:00Z')).toBe('2026-04-01');
      expect(dateLabel('not-a-date')).toBe('not-a-date');

      const mockTruncate = (str, len) => str.slice(0, len);
      const safeTruncate = createSafeTruncateFilter(mockTruncate);
      expect(safeTruncate(null, 5)).toBe('');
      expect(safeTruncate(new Date('2026-01-01'), 10)).toBe('2026-01-01');
      expect(safeTruncate({ a: 1 }, 10)).toBe('{"a":1}');

      const mockNunjucksEnv = {
        addFilter: vi.fn(),
        getFilter: vi.fn((name) => (name === 'truncate' ? mockTruncate : null)),
      };
      registerNunjucksFilters(mockNunjucksEnv);
      expect(mockNunjucksEnv.addFilter).toHaveBeenCalledWith('dateLabel', expect.any(Function));
      expect(mockNunjucksEnv.addFilter).toHaveBeenCalledWith('truncate', expect.any(Function), true);

      const mockEnvNoExisting = {
        addFilter: vi.fn(),
      };
      registerNunjucksFilters(mockEnvNoExisting);
      expect(mockEnvNoExisting.addFilter).toHaveBeenCalledWith('dateLabel', expect.any(Function));
    });

    it('exercises polar rate limit helpers and resolver', () => {
      const dummyIpKeyGen = (ip) => `ip:${ip}`;
      const ipKeyFn = polarIpKey(dummyIpKeyGen, 'polar:test');
      expect(ipKeyFn({ ip: '127.0.0.1' })).toBe('polar:test:ip:127.0.0.1');

      const userOrIpFn = polarUserOrIpKey(dummyIpKeyGen, 'polar:test');
      expect(userOrIpFn({ user: { id: 'u_123' }, ip: '127.0.0.1' })).toBe('polar:test:u_123');
      expect(userOrIpFn({ ip: '127.0.0.1' })).toBe('polar:test:ip:127.0.0.1');

      const defaults = buildDefaultRateLimits(dummyIpKeyGen);
      expect(defaults.webhook.limit).toBe(120);
      expect(defaults.checkout.limit).toBe(5);

      expect(DEFAULT_RATE_LIMITS).toBeDefined();

      // resolvePolarRateLimiters disabled
      expect(resolvePolarRateLimiters({}, { rateLimit: false })).toEqual({});
      expect(resolvePolarRateLimiters({}, { rateLimit: { enabled: false } })).toEqual({});

      // resolvePolarRateLimiters without rateLimitPlugin in ctx
      const emptyCtx = { middlewares: {} };
      expect(resolvePolarRateLimiters(emptyCtx, { rateLimit: true })).toEqual({});

      // resolvePolarRateLimiters with valid middleware factory
      const validCtx = {
        middlewares: {
          rateLimit: vi.fn((opts) => opts),
        },
      };
      const limiters = resolvePolarRateLimiters(validCtx, {
        rateLimit: {
          webhook: false,
          checkout: { limit: 2 },
        },
      });
      expect(limiters.webhook).toBeUndefined();
      expect(limiters.checkout).toBeDefined();
      expect(limiters.portal).toBeDefined();
    });
  });

  describe('src/services/builtins/file-manager.js branch coverage', () => {
    const { createFileManagerServices } = require('../../src/services/builtins/file-manager.js');

    it('exercises fileManager built-in services', async () => {
      const services = createFileManagerServices();
      expect(services['fileManager.list']).toBeDefined();
      expect(services['fileManager.mkdir']).toBeDefined();
      expect(services['fileManager.rename']).toBeDefined();
      expect(services['fileManager.delete']).toBeDefined();
      expect(services['fileManager.move']).toBeDefined();
      expect(services['fileManager.upload']).toBeDefined();

      // Upload with invalid buffer
      await expect(
        services['fileManager.upload'].handler({
          buffer: 12345,
        })
      ).rejects.toThrow(/Invalid buffer provided/);

      // Upload with empty buffer
      await expect(
        services['fileManager.upload'].handler({
          buffer: Buffer.alloc(0),
        })
      ).rejects.toThrow(/No file content provided/);

      // Upload with non-existent filePath
      await expect(
        services['fileManager.upload'].handler({
          filePath: '/path/does/not/exist.txt',
        })
      ).rejects.toThrow(/Source file not found/);

      // Upload with string buffer
      const tmpDir = path.join(__dirname, '../../tmp/test-fm-upload');
      fs.mkdirSync(tmpDir, { recursive: true });
      const uploaded = await services['fileManager.upload'].handler({
        baseDir: tmpDir,
        buffer: 'Hello World',
        originalName: 'test.txt',
        mimeType: 'text/plain',
      });
      expect(uploaded.name).toBe('test.txt');

      // Upload with base64
      const b64Uploaded = await services['fileManager.upload'].handler({
        baseDir: tmpDir,
        base64: 'data:text/plain;base64,SGVsbG8gV29ybGQ=',
        originalName: 'b64.txt',
      });
      expect(b64Uploaded.name).toBe('b64.txt');

      // List files
      const list = await services['fileManager.list'].handler({
        baseDir: tmpDir,
        sort: 'name',
        order: 'asc',
      });
      expect(list.items.length).toBeGreaterThanOrEqual(1);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('src/pages/page-loader.js and define-page.js branch coverage', () => {
    const { createPageHandler } = require('../../src/pages/page-loader.js');
    const { definePage } = require('../../src/pages/define-page.js');

    it('exercises definePage helper and validation', () => {
      const page = definePage({
        load: async () => ({ title: 'Test' }),
        render: async (data) => `<h1>${data.title}</h1>`,
      });
      expect(page.__isWebspressoPage).toBe(true);
      expect(typeof page.load).toBe('function');
    });

    it('exercises page loader render, head, redirect, error, and JSON fallback', async () => {
      const fixturesDir = path.join(__dirname, '../../tmp/test-pages-fixtures');
      fs.mkdirSync(fixturesDir, { recursive: true });

      const pageCustomFile = path.join(fixturesDir, 'page-custom.js');
      fs.writeFileSync(
        pageCustomFile,
        `module.exports = {
          load: async (ctx) => ({ user: 'Ahmet' }),
          head: async (data) => ({ title: 'Welcome ' + data.user }),
          render: async (data) => '<div>' + data.user + '</div>',
        };`
      );

      const pageRedirectFile = path.join(fixturesDir, 'page-redirect.js');
      fs.writeFileSync(
        pageRedirectFile,
        `module.exports = {
          load: async (ctx) => ctx.redirect('/login', 302),
        };`
      );

      const pageJsonFile = path.join(fixturesDir, 'page-json.js');
      fs.writeFileSync(
        pageJsonFile,
        `module.exports = {
          load: async () => ({ status: 'ok' }),
        };`
      );

      const pageErrFile = path.join(fixturesDir, 'page-err.js');
      fs.writeFileSync(
        pageErrFile,
        `module.exports = {
          load: async (ctx) => ctx.error(403, 'Forbidden action'),
        };`
      );

      const mockContext = {
        nunjucks: null,
        middlewares: {},
      };

      const createMockReq = (opts = {}) => ({
        query: opts.query || {},
        params: opts.params || {},
        headers: opts.headers || {},
        get: (h) => (opts.headers && opts.headers[h.toLowerCase()]) || null,
      });

      // 1. Custom render
      const handler1 = createPageHandler({
        file: pageCustomFile,
        source: 'page-custom.js',
        path: '/custom-render',
      }, mockContext);

      const res1 = {
        setHeader: vi.fn(),
        send: vi.fn(),
      };
      await handler1(createMockReq(), res1, vi.fn());
      expect(res1.send).toHaveBeenCalledWith('<div>Ahmet</div>');

      // 2. Redirect from load
      const handler2 = createPageHandler({
        file: pageRedirectFile,
        source: 'page-redirect.js',
        path: '/redirect-page',
      }, mockContext);
      const res2 = {
        redirect: vi.fn(),
        headersSent: false,
      };
      await handler2(createMockReq(), res2, vi.fn());
      expect(res2.redirect).toHaveBeenCalledWith(302, '/login');

      // 3. Fallback JSON
      const handler3 = createPageHandler({
        file: pageJsonFile,
        source: 'page-json.js',
        path: '/json-page',
      }, mockContext);
      const res3 = {
        json: vi.fn(),
        setHeader: vi.fn(),
      };
      await handler3(createMockReq(), res3, vi.fn());
      expect(res3.json).toHaveBeenCalledWith({ status: 'ok' });

      // 4. Error helper inside load
      const handler4 = createPageHandler({
        file: pageErrFile,
        source: 'page-err.js',
        path: '/err-page',
      }, mockContext);
      const nextFn = vi.fn();
      await handler4(createMockReq(), { setHeader: vi.fn() }, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));

      fs.rmSync(fixturesDir, { recursive: true, force: true });
    });
  });

  describe('src/api/api-loader.js and define-api.js branch coverage', () => {
    const { createApiHandler } = require('../../src/api/api-loader.js');
    const { defineApi } = require('../../src/api/define-api.js');
    const { z } = require('zod');

    it('exercises defineApi helper', () => {
      const api = defineApi({
        schema: ({ z: zod }) => ({
          body: zod.object({ name: zod.string() }),
        }),
        handler: async (req, res) => res.json({ ok: true }),
      });
      expect(api.__isWebspressoApi).toBe(true);
      expect(typeof api.handler).toBe('function');
    });

    it('exercises API validation error, middleware execution, and auto-response', async () => {
      const fixturesDir = path.join(__dirname, '../../tmp/test-api-fixtures');
      fs.mkdirSync(fixturesDir, { recursive: true });

      const apiFile = path.join(fixturesDir, 'api-test.post.js');
      fs.writeFileSync(
        apiFile,
        `const { z } = require('zod');
        module.exports = {
          schema: {
            body: z.object({ age: z.number().min(18) }),
          },
          middleware: [
            (req, res, next) => {
              req.passedMiddleware = true;
              next();
            },
          ],
          handler: async (req) => ({ age: req.input.body.age, ok: true }),
        };`
      );

      const mockApiContext = {
        middlewares: {},
      };

      const handler = createApiHandler({
        file: apiFile,
        source: 'api-test.post.js',
        path: '/api/test',
        method: 'post',
      }, mockApiContext);

      // Validation failure (ZodError)
      const res400 = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      await handler({ body: { age: 15 }, params: {}, query: {} }, res400, vi.fn());
      expect(res400.status).toHaveBeenCalledWith(400);
      expect(res400.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation Error' }));

      // Successful call with auto-response return value
      const res200 = {
        headersSent: false,
        json: vi.fn(),
        send: vi.fn(),
      };
      const req200 = { body: { age: 25 }, params: {}, query: {} };
      await handler(req200, res200, vi.fn());
      expect(req200.passedMiddleware).toBe(true);
      expect(res200.json).toHaveBeenCalledWith({ age: 25, ok: true });

      fs.rmSync(fixturesDir, { recursive: true, force: true });
    });
  });

  describe('src/discovery/file-route-parser.js branch coverage', () => {
    const {
      parseFileRoute,
      isPrivateOrIgnored,
      normalizePrefix,
      transformDynamicSegment,
      scanDirSafely,
    } = require('../../src/discovery/file-route-parser.js');

    it('exercises isPrivateOrIgnored and normalizePrefix', () => {
      expect(isPrivateOrIgnored(null)).toBe(true);
      expect(isPrivateOrIgnored('.git')).toBe(true);
      expect(isPrivateOrIgnored('_components')).toBe(true);
      expect(isPrivateOrIgnored('index.js.swp')).toBe(true);
      expect(isPrivateOrIgnored('index.js')).toBe(false);

      expect(normalizePrefix('')).toBe('');
      expect(normalizePrefix('/')).toBe('');
      expect(normalizePrefix('api/v1/')).toBe('/api/v1');
      expect(normalizePrefix('/api/v1')).toBe('/api/v1');
    });

    it('exercises transformDynamicSegment', () => {
      expect(transformDynamicSegment(null)).toBe('');
      expect(transformDynamicSegment('[id]')).toBe(':id');
      expect(transformDynamicSegment('[...slug]')).toBe('*slug');
      expect(transformDynamicSegment('users')).toBe('users');
    });

    it('exercises parseFileRoute for various filenames, invalid methods, and private segments', () => {
      expect(parseFileRoute('')).toEqual({ path: '', method: '', isValid: false, isPrivate: false });
      expect(parseFileRoute('_private/route.js')).toEqual({ path: '', method: '', isValid: false, isPrivate: true });

      const parsedGet = parseFileRoute('users/[id].get.js', { prefix: '/api' });
      expect(parsedGet.isValid).toBe(true);
      expect(parsedGet.path).toBe('/api/users/:id');
      expect(parsedGet.method).toBe('GET');

      const parsedInvalidMethod = parseFileRoute('users.invalidmethod.js');
      expect(parsedInvalidMethod.isValid).toBe(false);
      expect(parsedInvalidMethod.invalidMethod).toBe(true);

      const parsedIndex = parseFileRoute('blog/index.js');
      expect(parsedIndex.path).toBe('/blog');
    });
  });

  describe('src/services/validator.js branch coverage', () => {
    const {
      descriptorToZod,
      compileServiceSchema,
      formatZodErrors,
      validateServiceInput,
    } = require('../../src/services/validator.js');
    const { z } = require('zod');

    it('exercises descriptorToZod for all built-in type keywords', () => {
      expect(descriptorToZod('text').safeParse('hello').success).toBe(true);
      expect(descriptorToZod('int').safeParse(42).success).toBe(true);
      expect(descriptorToZod('bool').safeParse(true).success).toBe(true);
      expect(descriptorToZod('email').safeParse('test@example.com').success).toBe(true);
      expect(descriptorToZod('uuid').safeParse('123e4567-e89b-12d3-a456-426614174000').success).toBe(true);
      expect(descriptorToZod('nanoid').safeParse('V1StGXR8_Z5jdHi6B-myT').success).toBe(true);
      expect(descriptorToZod('array').safeParse([1, 2, 3]).success).toBe(true);
      expect(descriptorToZod('object').safeParse({ a: 1 }).success).toBe(true);
      expect(descriptorToZod('date').safeParse(new Date()).success).toBe(true);
      expect(descriptorToZod('function').safeParse(() => {}).success).toBe(true);
      expect(descriptorToZod('any').safeParse(123).success).toBe(true);
      expect(descriptorToZod('string?').safeParse(undefined).success).toBe(true);
    });

    it('exercises compileServiceSchema with object descriptors and functions', () => {
      expect(compileServiceSchema(null)).toBeNull();
      expect(compileServiceSchema({})).toBeNull();

      const schemaObj = compileServiceSchema({
        name: 'string',
        age: { type: 'int', optional: true },
        customValidator: (val) => val > 0,
      });
      expect(schemaObj instanceof z.ZodType).toBe(true);

      const fnCompiler = compileServiceSchema(({ z: zod }) => zod.object({ count: zod.number() }));
      expect(fnCompiler instanceof z.ZodType).toBe(true);
    });

    it('exercises validateServiceInput with sync, async, and custom validator functions', async () => {
      // Direct pass-through if no schema
      expect(validateServiceInput(null, { a: 1 }, 'test')).toEqual({ a: 1 });

      // Sync Zod schema
      const res = validateServiceInput({ name: 'string' }, { name: 'Ahmet' }, 'test.user');
      expect(res.name).toBe('Ahmet');

      // Async custom validator function
      const asyncCustomSchema = async (input) => {
        if (!input.token) return false;
        return { ...input, verified: true };
      };
      const asyncResult = await validateServiceInput(asyncCustomSchema, { token: 'abc' }, 'test.auth');
      expect(asyncResult.verified).toBe(true);

      await expect(
        validateServiceInput(asyncCustomSchema, { token: '' }, 'test.auth')
      ).rejects.toThrow(/custom validation rejected input/);
    });
  });

  describe('plugins/orm-cache-admin/api-handlers.js branch coverage', () => {
    const { createOrmCacheAdminHandlers } = require('../../plugins/orm-cache-admin/api-handlers.js');

    it('exercises requireCache 503 fallback when db.cache is missing', async () => {
      const handlers = createOrmCacheAdminHandlers({ db: {} });
      const res503 = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      await handlers.getStats({}, res503);
      expect(res503.status).toHaveBeenCalledWith(503);
      expect(res503.json).toHaveBeenCalledWith({ error: 'ORM cache is not enabled on this database' });
    });

    it('exercises getStats, postPurge, postInvalidate, and postResetMetrics', async () => {
      const mockCache = {
        getMetrics: vi.fn(() => ({ hits: 10, misses: 2 })),
        purge: vi.fn(),
        invalidateTags: vi.fn(),
        invalidateModel: vi.fn(),
        resetMetrics: vi.fn(),
      };
      const handlers = createOrmCacheAdminHandlers({ db: { cache: mockCache } });

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      // getStats
      await handlers.getStats({}, res);
      expect(res.json).toHaveBeenCalledWith({ hits: 10, misses: 2 });

      // postPurge
      await handlers.postPurge({}, res);
      expect(mockCache.purge).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true });

      // postInvalidate with tags
      await handlers.postInvalidate({ body: { tags: ['tag1', 'tag2'] } }, res);
      expect(mockCache.invalidateTags).toHaveBeenCalledWith(['tag1', 'tag2']);

      // postInvalidate with model
      await handlers.postInvalidate({ body: { model: 'User' } }, res);
      expect(mockCache.invalidateModel).toHaveBeenCalledWith('User');

      // postInvalidate invalid
      await handlers.postInvalidate({ body: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);

      // postResetMetrics
      await handlers.postResetMetrics({}, res);
      expect(mockCache.resetMetrics).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('plugins/mcp/transports/stdio.js and sse.js branch coverage', () => {
    const {
      startStdioTransport,
      redirectConsoleToStderr,
      restoreConsole,
    } = require('../../plugins/mcp/transports/stdio.js');
    const { mountSseTransport } = require('../../plugins/mcp/transports/sse.js');
    const { PassThrough } = require('stream');

    it('exercises stdio transport line parser, error handling, and console redirects', async () => {
      redirectConsoleToStderr();
      console.log('test log');
      console.info('test info');
      restoreConsole();

      const input = new PassThrough();
      const output = new PassThrough();
      let outputData = '';
      output.on('data', (chunk) => {
        outputData += chunk.toString();
      });

      const mockServer = {
        handleMessage: vi.fn(async (msg) => ({ jsonrpc: '2.0', id: msg.id, result: 'pong' })),
      };

      const transport = startStdioTransport(mockServer, {
        input,
        output,
        redirectStderr: false,
      });

      // Write valid line
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
      // Write invalid line
      input.write('invalid json\n');
      // Write empty line
      input.write('   \n');

      await new Promise((r) => setTimeout(r, 50));
      expect(outputData).toContain('pong');
      expect(outputData).toContain('Parse error');

      transport.close();
    });

    it('exercises SSE transport routes, messages endpoint, and direct POST endpoint', async () => {
      const routes = {};
      const mockApp = {
        get: vi.fn((path, ...fns) => {
          routes[`GET ${path}`] = fns[fns.length - 1];
        }),
        post: vi.fn((path, ...fns) => {
          routes[`POST ${path}`] = fns[fns.length - 1];
        }),
      };

      const mockServer = {
        handleMessage: vi.fn(async (msg) => ({ jsonrpc: '2.0', id: msg.id, result: 'ok' })),
      };

      const { sessions } = mountSseTransport({
        app: mockApp,
        server: mockServer,
        path: '/_mcp///',
      });

      // 1. Trigger GET /_mcp/sse
      const sseHandler = routes['GET /_mcp/sse'];
      expect(sseHandler).toBeDefined();

      const mockReq = new EventEmitter();
      const mockRes = new EventEmitter();
      mockRes.compress = vi.fn();
      mockRes.writeHead = vi.fn();
      mockRes.flushHeaders = vi.fn();
      mockRes.write = vi.fn();
      mockRes.flush = vi.fn();

      sseHandler(mockReq, mockRes);
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      expect(sessions.size).toBe(1);

      const sessionId = [...sessions.keys()][0];
      const session = sessions.get(sessionId);
      session.send({ event: 'ping' });
      expect(mockRes.write).toHaveBeenCalled();

      // 2. Trigger POST /_mcp/messages
      const msgHandler = routes['POST /_mcp/messages'];
      const resMsg = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        send: vi.fn(),
      };

      // Missing sessionId
      await msgHandler({ query: {} }, resMsg);
      expect(resMsg.status).toHaveBeenCalledWith(400);

      // Session not found
      await msgHandler({ query: { sessionId: 'unknown' } }, resMsg);
      expect(resMsg.status).toHaveBeenCalledWith(404);

      // Valid session message
      await msgHandler(
        { query: { sessionId }, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } },
        resMsg
      );
      expect(resMsg.status).toHaveBeenCalledWith(202);

      // 3. Trigger direct POST /_mcp
      const directPostHandler = routes['POST /_mcp'];
      const resDirect = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        end: vi.fn(),
      };
      await directPostHandler({ body: { jsonrpc: '2.0', id: 3, method: 'tools/call' } }, resDirect);
      expect(resDirect.json).toHaveBeenCalledWith(expect.objectContaining({ result: 'ok' }));

      // Clean up session via close event
      mockReq.emit('close');
      expect(sessions.size).toBe(0);
    });
  });
});
