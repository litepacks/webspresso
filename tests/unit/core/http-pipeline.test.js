'use strict';

const {
  validateRequestInput,
  createPipelineRunner,
  runMiddlewares,
  enrichRouteError,
  executeApiPipeline,
  executePagePipeline,
} = require('../../../core/http/pipeline');
const { HttpAdapter } = require('../../../core/http/adapter');
const { ExpressHttpAdapter, createExpressHttpAdapter } = require('../../../core/http/express-adapter');
const { z, ZodError } = require('zod');
const { ServiceRegistry } = require('../../../core/services');

describe('HTTP Pipeline & Adapters Layer (core/http)', () => {
  describe('1. validateRequestInput', () => {
    it('initializes req.input with empty properties when compiledSchema is null', () => {
      const req = { body: { a: 1 } };
      validateRequestInput(req, null);
      expect(req.input).toEqual({
        body: undefined,
        params: undefined,
        query: undefined,
        headers: undefined,
      });
    });

    it('parses valid body, params, query, and headers against Zod schema', () => {
      const req = {
        body: { title: 'Test Note', count: '5' },
        params: { id: '42' },
        query: { sort: 'desc' },
        headers: { 'x-trace': 'trace-123' },
      };

      const schema = {
        body: z.object({
          title: z.string(),
          count: z.coerce.number(),
        }),
        params: z.object({
          id: z.coerce.number(),
        }),
        query: z.object({
          sort: z.string(),
        }),
        headers: z.object({
          'x-trace': z.string(),
        }),
      };

      validateRequestInput(req, schema);

      expect(req.input.body).toEqual({ title: 'Test Note', count: 5 });
      expect(req.input.params).toEqual({ id: 42 });
      expect(req.input.query).toEqual({ sort: 'desc' });
      expect(req.input.headers).toEqual({ 'x-trace': 'trace-123' });
    });

    it('passes unparsed properties when schema section has no .parse function', () => {
      const req = {
        body: { direct: true },
        params: { slug: 'webspresso' },
        query: { page: 1 },
      };

      const schema = {
        body: null,
        params: undefined,
      };

      validateRequestInput(req, schema);

      expect(req.input.body).toEqual({ direct: true });
      expect(req.input.params).toEqual({ slug: 'webspresso' });
      expect(req.input.query).toEqual({ page: 1 });
    });

    it('throws ZodError on validation failure', () => {
      const req = {
        body: { title: 123 }, // expected string
      };

      const schema = {
        body: z.object({ title: z.string() }),
      };

      expect(() => validateRequestInput(req, schema)).toThrow(ZodError);
    });
  });

  describe('2. runMiddlewares', () => {
    it('executes a sequence of Express-style middlewares in order', async () => {
      const executionOrder = [];
      const mw1 = (req, res, next) => {
        executionOrder.push('mw1');
        next();
      };
      const mw2 = (req, res, next) => {
        executionOrder.push('mw2');
        next();
      };

      const req = {};
      const res = {};

      await runMiddlewares([mw1, mw2], req, res);
      expect(executionOrder).toEqual(['mw1', 'mw2']);
    });

    it('stops execution when res.headersSent is true', async () => {
      const executionOrder = [];
      const mw1 = (req, res, next) => {
        executionOrder.push('mw1');
        res.headersSent = true;
        next();
      };
      const mw2 = (req, res, next) => {
        executionOrder.push('mw2');
        next();
      };

      const req = {};
      const res = { headersSent: false };

      await runMiddlewares([mw1, mw2], req, res);
      expect(executionOrder).toEqual(['mw1']);
    });

    it('propagates middleware errors passed to next(err)', async () => {
      const failingMw = (req, res, next) => {
        next(new Error('middleware-failure'));
      };

      await expect(
        runMiddlewares([failingMw], {}, {})
      ).rejects.toThrow('middleware-failure');
    });

    it('catches and propagates synchronously thrown errors inside middleware', async () => {
      const syncThrowMw = () => {
        throw new Error('sync-throw');
      };

      await expect(
        runMiddlewares([syncThrowMw], {}, {})
      ).rejects.toThrow('sync-throw');
    });

    it('gracefully ignores non-array or non-function middleware elements', async () => {
      await expect(runMiddlewares(null, {}, {})).resolves.toBeUndefined();
      await expect(runMiddlewares([null, undefined, 'not-a-fn'], {}, {})).resolves.toBeUndefined();
    });

    it('restores original res.end after middleware completion without leaking monkey patches', async () => {
      const originalEnd = () => {};
      const res = { end: originalEnd };
      const mw = (req, r, next) => {
        expect(r.end).not.toBe(originalEnd);
        next();
      };

      await runMiddlewares([mw], {}, res);
      expect(res.end).toBe(originalEnd);
    });

    it('supports modern 2-arg async middleware (req, res) auto-advancing on promise resolution', async () => {
      const req = {};
      const res = {};
      const mw1 = async (r) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        r.user = { id: 101, name: 'Alice' };
      };
      const mw2 = async (r) => {
        r.role = 'admin';
      };

      await runMiddlewares([mw1, mw2], req, res);
      expect(req.user).toEqual({ id: 101, name: 'Alice' });
      expect(req.role).toBe('admin');
    });

    it('catches and propagates errors thrown inside async middleware without hanging', async () => {
      const asyncThrowMw = async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('async-rejection-error');
      };

      await expect(
        runMiddlewares([asyncThrowMw], {}, {})
      ).rejects.toThrow('async-rejection-error');
    });

    it('catches and propagates errors when 3-arg async middleware rejects', async () => {
      const asyncRejectMw = async (req, res, next) => {
        await new Promise((_, reject) => setTimeout(() => reject(new Error('async-3arg-error')), 5));
        next();
      };

      await expect(
        runMiddlewares([asyncRejectMw], {}, {})
      ).rejects.toThrow('async-3arg-error');
    });

    it('supports 2-arg synchronous middlewares auto-advancing', async () => {
      const req = {};
      const sync2ArgMw = (r) => {
        r.syncTagged = true;
      };

      await runMiddlewares([sync2ArgMw], req, {});
      expect(req.syncTagged).toBe(true);
    });

    it('stops execution when res.writableEnded or res.finished is true', async () => {
      const executed = [];
      const mw1 = (req, res, next) => {
        executed.push('mw1');
        res.writableEnded = true;
        next();
      };
      const mw2 = (req, res, next) => {
        executed.push('mw2');
        next();
      };

      await runMiddlewares([mw1, mw2], {}, { writableEnded: false });
      expect(executed).toEqual(['mw1']);
    });

    it('terminates middleware chain cleanly when async middleware ends response early without next()', async () => {
      const executed = [];
      let endCalled = false;
      const res = {
        headersSent: false,
        end() {
          this.headersSent = true;
          endCalled = true;
        },
      };

      const mw1 = async (req, r) => {
        executed.push('mw1');
        r.end();
      };
      const mw2 = (req, r, next) => {
        executed.push('mw2');
        next();
      };

      await runMiddlewares([mw1, mw2], {}, res);
      expect(executed).toEqual(['mw1']);
      expect(endCalled).toBe(true);
    });
  });

  describe('2.5. createPipelineRunner', () => {
    it('creates a reusable pipeline runner function', async () => {
      const req = {};
      const runner = createPipelineRunner([
        async (r) => { r.step1 = true; },
        (r, res, next) => { r.step2 = true; next(); },
      ]);

      expect(typeof runner).toBe('function');
      await runner(req, {});
      expect(req.step1).toBe(true);
      expect(req.step2).toBe(true);
    });
  });

  describe('3. enrichRouteError', () => {
    it('decorates an error with route metadata', () => {
      const err = new Error('Database connection failed');
      const descriptor = { path: '/api/users/:id', method: 'GET', file: '/pages/api/users/[id].get.js' };
      const req = { url: '/api/users/42', method: 'GET' };

      enrichRouteError(err, descriptor, req);

      expect(err.route).toBe('/api/users/:id');
      expect(err.method).toBe('GET');
      expect(err.file).toBe('/pages/api/users/[id].get.js');
      expect(err.source).toBe('/pages/api/users/[id].get.js');
    });

    it('handles null error gracefully', () => {
      expect(() => enrichRouteError(null, {}, {})).not.toThrow();
    });
  });

  describe('4. executeApiPipeline', () => {
    it('executes API endpoint and sends response via res.json', async () => {
      const req = { method: 'POST', body: { name: 'Alice' } };
      const res = {
        headersSent: false,
        json: vi.fn(),
      };

      await executeApiPipeline({
        descriptor: { path: '/api/users' },
        context: {},
        apiDef: {},
        handlerFn: async (r) => ({ created: true, name: r.body.name }),
        compiledSchema: null,
        middlewares: [],
        req,
        res,
      });

      expect(res.json).toHaveBeenCalledWith({ created: true, name: 'Alice' });
    });

    it('handles validation error and returns HTTP 400 with formatted issues', async () => {
      const req = {
        method: 'POST',
        body: { age: 'not-a-number' },
      };
      const res = {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      const schema = {
        body: z.object({ age: z.number() }),
      };

      await executeApiPipeline({
        descriptor: { path: '/api/age' },
        context: {},
        apiDef: {},
        handlerFn: async () => ({ ok: true }),
        compiledSchema: schema,
        middlewares: [],
        req,
        res,
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 400,
          error: 'Validation Error',
          message: 'Validation Error',
          code: 'VALIDATION_ERROR',
          issues: expect.any(Array),
        })
      );
    });

    it('injects req.service and executes registered services inside API handlers', async () => {
      const registry = new ServiceRegistry();
      registry.register('calculator.add', {
        handler: async ({ a, b }) => a + b,
      });

      const req = { method: 'POST' };
      const res = {
        headersSent: false,
        json: vi.fn(),
      };

      await executeApiPipeline({
        descriptor: { path: '/api/calc' },
        context: { serviceRegistry: registry },
        apiDef: {},
        handlerFn: async (r) => {
          const sum = await r.service('calculator.add', { a: 10, b: 25 });
          return { sum };
        },
        compiledSchema: null,
        middlewares: [],
        req,
        res,
      });

      expect(res.json).toHaveBeenCalledWith({ sum: 35 });
    });

    it('lazily pre-computes and caches descriptor._routeDir for zero repeated path operations', async () => {
      const descriptor = { path: '/api/notes', file: '/project/pages/api/notes.get.js' };
      const req = { method: 'GET' };
      const res = {
        headersSent: false,
        json: vi.fn(),
      };

      await executeApiPipeline({
        descriptor,
        context: {},
        apiDef: {},
        handlerFn: async () => ({ ok: true }),
        compiledSchema: null,
        middlewares: [],
        req,
        res,
      });

      expect(descriptor._routeDir).toBe('/project/pages/api');
    });

    it('returns raw result when res object is not provided or has no json method', async () => {
      const req = { method: 'GET' };
      const result = await executeApiPipeline({
        descriptor: { path: '/api/raw' },
        context: {},
        apiDef: {},
        handlerFn: async () => ({ raw: 'data' }),
        compiledSchema: null,
        middlewares: [],
        req,
        res: null,
      });

      expect(result).toEqual({ raw: 'data' });
    });

    it('automatically enriches thrown errors with route descriptor metadata', async () => {
      const descriptor = { path: '/api/failing', method: 'POST', file: '/pages/api/failing.post.js' };
      const req = { method: 'POST' };

      await expect(
        executeApiPipeline({
          descriptor,
          context: {},
          apiDef: {},
          handlerFn: async () => {
            throw new Error('handler-explosion');
          },
          compiledSchema: null,
          middlewares: [],
          req,
          res: null,
        })
      ).rejects.toMatchObject({
        message: 'handler-explosion',
        route: '/api/failing',
        method: 'POST',
        file: '/pages/api/failing.post.js',
      });
    });
  });

  describe('5. executePagePipeline', () => {
    it('executes load() and returns JSON fallback when no Nunjucks template is present', async () => {
      const req = { method: 'GET', params: { id: '5' } };
      const res = {
        headersSent: false,
        json: vi.fn(),
      };

      const pageDef = {
        load: async ({ req }) => ({ itemId: req.params.id, name: 'Item 5' }),
      };

      await executePagePipeline({
        descriptor: { path: '/items/:id' },
        context: {},
        pageDef,
        hasNjkTemplate: false,
        req,
        res,
      });

      expect(res.json).toHaveBeenCalledWith({ itemId: '5', name: 'Item 5' });
    });

    it('handles redirection in load() without rendering further', async () => {
      const req = { method: 'GET' };
      const res = {
        headersSent: false,
        redirect: vi.fn(),
        json: vi.fn(),
      };

      const pageDef = {
        load: async ({ redirect }) => {
          return redirect('/login', 302);
        },
      };

      await executePagePipeline({
        descriptor: { path: '/protected' },
        context: {},
        pageDef,
        hasNjkTemplate: false,
        req,
        res,
      });

      expect(res.redirect).toHaveBeenCalledWith(302, '/login');
      expect(res.json).not.toHaveBeenCalled();
    });

    it('renders companion Nunjucks template with templateData', async () => {
      const mockNunjucks = {
        render: vi.fn((templatePath, data, callback) => {
          callback(null, `<h1>${data.title}</h1>`);
        }),
      };

      const req = { method: 'GET', params: {}, query: {} };
      const res = {
        headersSent: false,
        setHeader: vi.fn(),
        send: vi.fn(),
      };

      const pageDef = {
        load: async () => ({ title: 'Welcome Home' }),
        head: async () => ({ title: 'Home Page' }),
      };

      await executePagePipeline({
        descriptor: { path: '/' },
        context: {},
        nunjucks: mockNunjucks,
        pageDef,
        hasNjkTemplate: true,
        njkCandidate: 'pages/index.njk',
        req,
        res,
      });

      expect(mockNunjucks.render).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(res.send).toHaveBeenCalledWith('<h1>Welcome Home</h1>');
    });

    it('handles string fallback when loadedData is a string', async () => {
      const req = { method: 'GET' };
      const res = {
        headersSent: false,
        send: vi.fn(),
      };

      const pageDef = {
        load: async () => 'raw-text-output',
      };

      await executePagePipeline({
        descriptor: { path: '/text' },
        context: {},
        pageDef,
        hasNjkTemplate: false,
        req,
        res,
      });

      expect(res.send).toHaveBeenCalledWith('raw-text-output');
    });

    it('renders custom HTML via pageDef.render() when defined', async () => {
      const req = { method: 'GET' };
      const res = {
        headersSent: false,
        setHeader: vi.fn(),
        send: vi.fn(),
      };

      const pageDef = {
        load: async () => ({ user: 'John' }),
        render: async (data) => `<div>Hello ${data.user}</div>`,
      };

      await executePagePipeline({
        descriptor: { path: '/custom-render' },
        context: {},
        pageDef,
        hasNjkTemplate: false,
        req,
        res,
      });

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(res.send).toHaveBeenCalledWith('<div>Hello John</div>');
    });

    it('propagates nunjucks rendering errors', async () => {
      const mockNunjucks = {
        render: vi.fn((templatePath, data, callback) => {
          callback(new Error('Nunjucks template syntax error'));
        }),
      };

      const req = { method: 'GET' };
      const res = { headersSent: false };

      await expect(
        executePagePipeline({
          descriptor: { path: '/err-page' },
          context: {},
          nunjucks: mockNunjucks,
          pageDef: { load: async () => ({}) },
          hasNjkTemplate: true,
          njkCandidate: 'pages/error.njk',
          req,
          res,
        })
      ).rejects.toThrow('Nunjucks template syntax error');
    });

    it('dispatches Early Hints when earlyHints option is configured', async () => {
      const req = { method: 'GET' };
      const res = {
        headersSent: false,
        writeEarlyHints: vi.fn(),
      };

      const pageDef = {
        earlyHints: ['</style.css>; rel=preload; as=style'],
        load: async () => ({ ok: true }),
      };

      await executePagePipeline({
        descriptor: { path: '/hints' },
        context: {},
        pageDef,
        hasNjkTemplate: false,
        req,
        res,
      });

      expect(res.writeEarlyHints).toHaveBeenCalled();
    });

    it('injects streaming helpers (renderStream, streamText, streamJson) into pageCtx', async () => {
      const req = { method: 'GET' };
      const res = { headersSent: false };
      let injectedHelpers = {};

      const pageDef = {
        load: async (ctx) => {
          injectedHelpers = {
            hasRenderStream: typeof ctx.renderStream === 'function',
            hasStreamText: typeof ctx.streamText === 'function',
            hasStreamJson: typeof ctx.streamJson === 'function',
          };
          return { ok: true };
        },
      };

      await executePagePipeline({
        descriptor: { path: '/stream-helpers' },
        context: {},
        pageDef,
        hasNjkTemplate: false,
        req,
        res,
      });

      expect(injectedHelpers.hasRenderStream).toBe(true);
      expect(injectedHelpers.hasStreamText).toBe(true);
      expect(injectedHelpers.hasStreamJson).toBe(true);
    });

    it('automatically triggers streaming when load() returns defer slots', async () => {
      const req = { method: 'GET' };
      const writtenChunks = [];
      const res = {
        headersSent: false,
        locals: {},
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
        write: (chunk) => writtenChunks.push(chunk.toString()),
        end: vi.fn(),
        send: vi.fn(),
        on: vi.fn(),
      };

      const mockNunjucks = {
        render: vi.fn((tpl, ctx, cb) => {
          const html = '<main>shell</main>';
          if (typeof cb === 'function') return cb(null, html);
          return html;
        }),
      };

      const pageDef = {
        load: async () => ({
          defer: {
            stats: Promise.resolve({ count: 42 }),
          },
        }),
      };

      await executePagePipeline({
        descriptor: { path: '/auto-stream' },
        context: {},
        nunjucks: mockNunjucks,
        pageDef,
        hasNjkTemplate: true,
        njkCandidate: 'pages/auto-stream.njk',
        req,
        res,
      });

      expect(res.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
      expect(writtenChunks.length).toBeGreaterThan(0);
    });
  });

  describe('6. HttpAdapter & ExpressHttpAdapter', () => {
    it('HttpAdapter base class throws "must be implemented by subclass" for abstract methods', () => {
      const adapter = new HttpAdapter();
      expect(() => adapter.use()).toThrow(/must be implemented by subclass/);
      expect(() => adapter.route('get', '/test')).toThrow(/must be implemented by subclass/);
      expect(() => adapter.get('/test', () => {})).toThrow(/must be implemented by subclass/);
      expect(() => adapter.post('/test', () => {})).toThrow(/must be implemented by subclass/);
      expect(() => adapter.put('/test', () => {})).toThrow(/must be implemented by subclass/);
      expect(() => adapter.delete('/test', () => {})).toThrow(/must be implemented by subclass/);
      expect(() => adapter.patch('/test', () => {})).toThrow(/must be implemented by subclass/);
      expect(() => adapter.all('/test', () => {})).toThrow(/must be implemented by subclass/);
      expect(() => adapter.listen(3000)).toThrow(/must be implemented by subclass/);
      expect(adapter.getApp()).toBeNull();
    });

    it('ExpressHttpAdapter delegates routing methods to underlying Express app', () => {
      const mockExpressApp = {
        use: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
        all: vi.fn(),
        listen: vi.fn((port, cb) => {
          if (cb) cb();
          return { server: true };
        }),
        disable: vi.fn(),
      };

      const adapter = createExpressHttpAdapter(mockExpressApp);
      expect(adapter).toBeInstanceOf(ExpressHttpAdapter);
      expect(adapter.getApp()).toBe(mockExpressApp);

      const handler = () => {};
      adapter.use(handler);
      expect(mockExpressApp.use).toHaveBeenCalledWith(handler);

      adapter.get('/api/users', handler);
      expect(mockExpressApp.get).toHaveBeenCalledWith('/api/users', handler);

      adapter.post('/api/users', handler);
      expect(mockExpressApp.post).toHaveBeenCalledWith('/api/users', handler);

      adapter.put('/api/users/:id', handler);
      expect(mockExpressApp.put).toHaveBeenCalledWith('/api/users/:id', handler);

      adapter.patch('/api/users/:id', handler);
      expect(mockExpressApp.patch).toHaveBeenCalledWith('/api/users/:id', handler);

      adapter.delete('/api/users/:id', handler);
      expect(mockExpressApp.delete).toHaveBeenCalledWith('/api/users/:id', handler);

      adapter.all('/api/*', handler);
      expect(mockExpressApp.all).toHaveBeenCalledWith('/api/*', handler);

      const cb = vi.fn();
      adapter.listen(4000, cb);
      expect(mockExpressApp.listen).toHaveBeenCalledWith(4000, cb);
      expect(cb).toHaveBeenCalled();
    });

    it('ExpressHttpAdapter throws descriptive errors when underlying app lacks required methods', () => {
      const brokenAdapter = new ExpressHttpAdapter({});
      expect(() => brokenAdapter.use(() => {})).toThrow(/does not support \.use\(\)/);
      expect(() => brokenAdapter.get('/test', () => {})).toThrow(/unsupported HTTP method "get"/);
      expect(() => brokenAdapter.route(null, '/test', () => {})).toThrow(/unsupported HTTP method "null"/);
      expect(() => brokenAdapter.listen(3000)).toThrow(/does not support \.listen\(\)/);
    });
  });
});
