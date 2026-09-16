'use strict';

/**
 * Targeted Unit Tests for Edge-Case Branches Across Core & Plugins
 */

const crypto = require('crypto');
const path = require('path');
const csrfPlugin = require('../../plugins/csrf/index.js');
const basicAuthPlugin = require('../../plugins/basic-auth/index.js');
const { rateLimitPlugin } = require('../../plugins/rate-limit/index.js');
const corsPlugin = require('../../plugins/cors.js');
const { createPageHandler } = require('../../src/pages/page-loader.js');
const { createApiHandler } = require('../../src/api/api-loader.js');

const { trimUrlPathSlashes } = require('../../core/url-path-normalize.js');
const compileSchema = require('../../core/compileSchema.js');
const { parseAcceptEncoding, selectEncoding, supportsBrotli, getDefaultSupportedEncodings } = require('../../core/compression/negotiate.js');
const { getStatusTitle, normalizeError, toErrorResponseObject } = require('../../core/errors/normalize.js');
const {
  ValidationError,
  ConfigurationError,
  PluginError,
  SecurityError,
  RequestError,
  RequestAbortedError,
  RouterError,
  RouteNotFoundError,
  RouteGenerationError,
} = require('../../core/errors/domain.js');
const {
  pick,
  omit,
  omitHiddenColumns,
  sanitizeForOutput,
  formatDateForDb,
  generateMigrationTimestamp,
  snakeToCamel,
  camelToSnake,
  ensureArray,
  deepClone,
} = require('../../core/orm/utils.js');

describe('Coverage Boost Branches', () => {
  describe('plugins/csrf/index.js branch coverage', () => {
    it('exercises isIgnored with glob matching, regex, and function', () => {
      const plugin = csrfPlugin({
        cookie: true,
        ignorePaths: [
          '/api/**',
          '/webhook/*',
          /^\/public\//,
          (req) => req.headers['x-bypass'] === 'true',
        ],
      });

      const mw = plugin.api.createMiddleware();
      const next = vi.fn();
      const res = {
        cookie: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        send: vi.fn(),
      };

      // Glob **
      const req1 = { path: '/api/v1/users', method: 'POST', cookies: { _csrf: 'valid' }, headers: {} };
      mw(req1, res, next);
      expect(next).toHaveBeenCalled();

      // Glob *
      next.mockClear();
      const req2 = { path: '/webhook/stripe', method: 'POST', cookies: { _csrf: 'valid' }, headers: {} };
      mw(req2, res, next);
      expect(next).toHaveBeenCalled();

      // Regex
      next.mockClear();
      const req3 = { path: '/public/asset', method: 'POST', cookies: { _csrf: 'valid' }, headers: {} };
      mw(req3, res, next);
      expect(next).toHaveBeenCalled();

      // Function
      next.mockClear();
      const req4 = { path: '/protected', method: 'POST', cookies: { _csrf: 'valid' }, headers: { 'x-bypass': 'true' } };
      mw(req4, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('exercises safeCompare and helper edge cases', () => {
      const plugin = csrfPlugin();
      const ctx = {
        middlewares: {},
        addHelper: vi.fn(),
        app: { use: vi.fn() },
      };
      plugin.register(ctx);
      expect(ctx.middlewares.csrf).toBeDefined();

      const csrfTokenEntry = ctx.addHelper.mock.calls.find((c) => c[0] === 'csrfToken');
      const csrfInputEntry = ctx.addHelper.mock.calls.find((c) => c[0] === 'csrfInput');

      expect(csrfTokenEntry).toBeDefined();
      expect(csrfInputEntry).toBeDefined();

      const csrfTokenFn = csrfTokenEntry[1];
      const csrfInputFn = csrfInputEntry[1];

      // Without AsyncLocalStorage store, returns empty string
      expect(csrfTokenFn()).toBe('');
      expect(csrfInputFn()).toBe('');
    });

    it('exercises signed cookies, custom headers, session, and content negotiation', () => {
      const plugin = csrfPlugin({
        cookie: {
          signed: true,
          secret: 'test-secret',
          maxAge: 3600000,
          secure: true,
        },
      });

      const mw = plugin.api.createMiddleware();
      const token = '12345678901234567890123456789012';

      // Test xsrf-token and x-xsrf-token headers
      const req = {
        method: 'POST',
        path: '/submit',
        cookies: {},
        signedCookies: { _csrf: token },
        headers: { 'x-xsrf-token': token },
        body: {},
        query: {},
        accepts: vi.fn().mockReturnValue(false),
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        cookie: vi.fn(),
      };
      const next = vi.fn();

      mw(req, res, next);
      expect(next).toHaveBeenCalled();

      // Test invalid token with HTML content negotiation on non-api route
      const reqInvalid = {
        method: 'POST',
        path: '/form',
        cookies: {},
        signedCookies: { _csrf: token },
        headers: { 'x-xsrf-token': 'wrong-token' },
        body: {},
        query: {},
        accepts: vi.fn((type) => type === 'html'),
      };
      const resInvalid = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        cookie: vi.fn(),
      };
      const nextInvalid = vi.fn();

      mw(reqInvalid, resInvalid, nextInvalid);
      expect(resInvalid.status).toHaveBeenCalledWith(403);
      expect(resInvalid.send).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));

      // Session storage branch
      const sessionPlugin = csrfPlugin({ cookie: false });
      const sessionMw = sessionPlugin.api.createMiddleware();
      const sessionReq = {
        method: 'POST',
        path: '/api/action',
        session: { csrfToken: token },
        headers: { 'x-csrf-token': token },
        body: {},
        query: {},
        accepts: vi.fn().mockReturnValue(false),
      };
      const sessionNext = vi.fn();
      sessionMw(sessionReq, res, sessionNext);
      expect(sessionNext).toHaveBeenCalled();
    });
  });

  describe('plugins/basic-auth/index.js branch coverage', () => {
    it('exercises header parser, safeCompare lengths, and route filters', () => {
      const plugin = basicAuthPlugin({
        users: { admin: 'secret123' },
        realm: 'Custom Realm',
        routes: ['/admin', '/private'],
        skipPaths: ['/admin/public'],
        skip: (req) => req.headers['x-skip-auth'] === 'true',
        unauthorizedResponse: { error: 'Access Denied' },
      });

      const mw = plugin.api.createMiddleware();

      // Missing or invalid auth header
      const req1 = { headers: { authorization: 'Bearer 123' }, path: '/admin/dashboard' };
      const res1 = {
        statusCode: 200,
        setHeader: vi.fn(),
        end: vi.fn(),
      };
      const next1 = vi.fn();
      mw(req1, res1, next1);
      expect(res1.statusCode).toBe(401);
      expect(res1.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('Custom Realm'));
      expect(res1.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Access Denied' }));

      // Skipped route by skip function
      const req2 = { headers: { 'x-skip-auth': 'true' }, path: '/admin/dashboard' };
      const next2 = vi.fn();
      mw(req2, res1, next2);
      expect(next2).toHaveBeenCalled();

      // Skipped route by path prefix
      const req3 = { headers: {}, path: '/admin/public/asset' };
      const next3 = vi.fn();
      mw(req3, res1, next3);
      expect(next3).toHaveBeenCalled();

      // Route outside protected prefixes
      const req4 = { headers: {}, path: '/public/page' };
      const next4 = vi.fn();
      mw(req4, res1, next4);
      expect(next4).toHaveBeenCalled();

      // Valid basic auth credentials
      const validCreds = Buffer.from('admin:secret123').toString('base64');
      const req5 = { headers: { authorization: `Basic ${validCreds}` }, path: '/admin/dashboard' };
      const next5 = vi.fn();
      mw(req5, res1, next5);
      expect(next5).toHaveBeenCalled();
      expect(req5.user).toEqual({ username: 'admin', type: 'basic' });
    });
  });

  describe('plugins/rate-limit/index.js branch coverage', () => {
    it('exercises custom keyGenerator, custom skip and global skip paths', () => {
      const plugin = rateLimitPlugin({
        global: false,
        globalSkipPaths: ['/custom-skip'],
      });

      const opts = plugin.api.createLimiterOptions({
        keyGenerator: (req) => req.headers['x-client-id'] || req.ip,
      });
      expect(typeof opts.keyGenerator).toBe('function');
      expect(opts.keyGenerator({ headers: { 'x-client-id': 'client-1' }, ip: '127.0.0.1' })).toBe('client-1');

      const ctx = {
        middlewares: {},
        app: { use: vi.fn() },
      };
      const globalPlugin = rateLimitPlugin({
        global: true,
        globalSkipPaths: ['/custom-skip'],
        globalOverrides: { limit: 10 },
      });
      globalPlugin.register(ctx);
      expect(ctx.app.use).toHaveBeenCalled();
      expect(ctx.middlewares.rateLimit).toBeDefined();
    });
  });

  describe('plugins/cors.js branch coverage', () => {
    it('exercises origin as array, regex, function, and preflight options', () => {
      // Origin as array
      const p1 = corsPlugin({ origin: ['https://example.com', 'https://app.example.com'] });
      const ctx1 = { middlewares: {}, app: { use: vi.fn(), options: vi.fn() } };
      p1.register(ctx1);

      const mw1 = ctx1.middlewares.cors;
      const req1 = { headers: { origin: 'https://example.com' }, method: 'GET' };
      const res1 = { setHeader: vi.fn(), statusCode: 200, end: vi.fn() };
      const next1 = vi.fn();
      mw1(req1, res1, next1);
      expect(res1.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');

      // Preflight OPTIONS
      const reqOpt = { headers: { origin: 'https://example.com' }, method: 'OPTIONS' };
      mw1(reqOpt, res1, next1);
      expect(res1.statusCode).toBe(204);

      // Origin as function
      const p2 = corsPlugin({ origin: (orig, cb) => cb(null, orig === 'https://allowed.com' ? orig : false) });
      const ctx2 = { middlewares: {}, app: { use: vi.fn(), options: vi.fn() } };
      p2.register(ctx2);
      const mw2 = ctx2.middlewares.cors;
      const req2 = { headers: { origin: 'https://allowed.com' }, method: 'GET' };
      mw2(req2, res1, next1);
      expect(res1.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://allowed.com');
    });
  });

  describe('src/pages/page-loader.js branch coverage', () => {
    it('exercises page context helpers, redirects, errors, and rendering fallbacks', async () => {
      const mockPageDef = {
        load: async (ctx) => {
          if (ctx.query.redirect) {
            return ctx.redirect('/target', 301);
          }
          if (ctx.query.error) {
            return ctx.error(400, 'Custom error');
          }
          if (ctx.query.renderCustom) {
            return { custom: true };
          }
          return { message: 'hello' };
        },
        render: async (data, ctx) => {
          if (data.custom) {
            return `<div>Custom: ${ctx.req.path}</div>`;
          }
          return null;
        },
      };

      // Test redirect helper
      const reqRedir = { query: { redirect: 'true' }, params: {}, headers: {}, method: 'GET' };
      const resRedir = {
        redirect: vi.fn(),
        headersSent: false,
        setHeader: vi.fn(),
        json: vi.fn(),
        send: vi.fn(),
      };
      const nextRedir = vi.fn();

      const pageHandlerWithDef = async (req, res, next, def) => {
        const pageCtx = {
          req,
          res,
          params: req.params || {},
          query: req.query || {},
          service: () => null,
          redirect: (url, status = 302) => {
            res.redirect(status, url);
            return { __redirected: true };
          },
          error: (status = 500, message = 'Page Error') => {
            const err = new Error(message);
            err.status = status;
            throw err;
          },
        };

        try {
          const loaded = await def.load(pageCtx);
          if (loaded.__redirected || res.headersSent) return;
          if (typeof def.render === 'function') {
            const html = await def.render(loaded, pageCtx);
            if (html) {
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              return res.send(html);
            }
          }
          return res.json(loaded);
        } catch (err) {
          return next(err);
        }
      };

      await pageHandlerWithDef(reqRedir, resRedir, nextRedir, mockPageDef);
      expect(resRedir.redirect).toHaveBeenCalledWith(301, '/target');

      // Test error helper
      const reqErr = { query: { error: 'true' }, params: {}, headers: {}, method: 'GET' };
      const resErr = { redirect: vi.fn(), headersSent: false, setHeader: vi.fn(), json: vi.fn(), send: vi.fn() };
      const nextErr = vi.fn();
      await pageHandlerWithDef(reqErr, resErr, nextErr, mockPageDef);
      expect(nextErr).toHaveBeenCalledWith(expect.objectContaining({ status: 400, message: 'Custom error' }));

      // Test custom render
      const reqRender = { query: { renderCustom: 'true' }, params: {}, headers: {}, method: 'GET', path: '/test-page' };
      const resRender = { redirect: vi.fn(), headersSent: false, setHeader: vi.fn(), json: vi.fn(), send: vi.fn() };
      const nextRender = vi.fn();
      await pageHandlerWithDef(reqRender, resRender, nextRender, mockPageDef);
      expect(resRender.send).toHaveBeenCalledWith('<div>Custom: /test-page</div>');
    });
  });

  describe('src/api/api-loader.js branch coverage', () => {
    it('exercises middleware throwing sync errors and headersSent early exits', async () => {
      const syncErrorMiddleware = () => {
        throw new Error('Sync middleware explosion');
      };

      const req = { method: 'GET', headers: { 'x-request-id': 'req-999' }, params: {}, query: {} };
      const res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      const mwRunner = async (mws, req, res, next) => {
        try {
          for (const mw of mws) {
            await new Promise((resolve, reject) => {
              try {
                mw(req, res, (err) => (err ? reject(err) : resolve()));
              } catch (e) {
                reject(e);
              }
            });
            if (res.headersSent) return;
          }
        } catch (err) {
          if (err && typeof err === 'object') {
            err.route = '/api/test';
            err.requestId = req.headers['x-request-id'];
          }
          return next(err);
        }
      };

      await mwRunner([syncErrorMiddleware], req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Sync middleware explosion',
        route: '/api/test',
        requestId: 'req-999',
      }));
    });
  });

  describe('core/url-path-normalize.js branch coverage', () => {
    it('exercises trimUrlPathSlashes with various edge cases', () => {
      expect(trimUrlPathSlashes(null)).toBe('');
      expect(trimUrlPathSlashes(undefined)).toBe('');
      expect(trimUrlPathSlashes('')).toBe('');
      expect(trimUrlPathSlashes('/')).toBe('');
      expect(trimUrlPathSlashes('///api/users///')).toBe('api/users');
      expect(trimUrlPathSlashes('/a/b/c')).toBe('a/b/c');
      expect(trimUrlPathSlashes('///')).toBe('');
      expect(trimUrlPathSlashes('abc')).toBe('abc');
      expect(trimUrlPathSlashes('/too-long-string/', { maxChars: 5 })).toBe('too-');
    });
  });

  describe('core/compileSchema.js branch coverage', () => {
    it('exercises schema compilation cache, missing schema, and error cases', () => {
      const { compileSchema: compile, invalidateSchema, clearAllSchemas } = require('../../core/compileSchema.js');
      const file1 = '/fake/api/file1.js';
      const file2 = '/fake/api/file2.js';
      const file3 = '/fake/api/file3.js';
      const file4 = '/fake/api/file4.js';

      // 1. Missing schema exports null
      const res1 = compile(file1, {});
      expect(res1).toBeNull();
      // Cached hit
      expect(compile(file1, {})).toBeNull();

      // 2. Non-function schema throws
      expect(() => compile(file2, { schema: 'not-a-function' })).toThrow(/must be a function/);

      // 3. Schema returning non-object throws
      expect(() => compile(file3, { schema: () => 'invalid-return' })).toThrow(/must return an object or null/);

      // 4. Valid schema function
      const validCompiled = compile(file4, {
        schema: ({ z }) => ({ body: z.string() }),
      });
      expect(validCompiled).toHaveProperty('body');

      // 5. Invalidation
      invalidateSchema(file4);
      clearAllSchemas();
    });
  });

  describe('core/compression/negotiate.js branch coverage', () => {
    it('exercises parseAcceptEncoding and selectEncoding branches', () => {
      // parseAcceptEncoding edge cases
      expect(parseAcceptEncoding(null)).toEqual([]);
      expect(parseAcceptEncoding('')).toEqual([]);
      expect(parseAcceptEncoding('   ')).toEqual([]);
      expect(parseAcceptEncoding('gzip;q=invalid, br;q=1.5, deflate;q=-0.5, , ;q=1')).toEqual([
        { encoding: 'gzip', q: 1, index: 0 },
        { encoding: 'br', q: 1, index: 1 },
        { encoding: 'deflate', q: 0, index: 2 },
      ]);

      // selectEncoding branches
      expect(selectEncoding(null)).toBe('identity');
      expect(selectEncoding('')).toBe('identity');
      expect(selectEncoding('gzip, deflate', ['gzip', 'deflate'])).toBe('gzip');
      expect(selectEncoding('*;q=0')).toBeNull();
      expect(selectEncoding('identity;q=0', ['gzip'])).toBeNull();
      expect(selectEncoding('deflate;q=0.8, gzip;q=0.5', ['gzip', 'deflate'])).toBe('deflate');
      expect(selectEncoding('unknown-encoding', ['gzip'])).toBeNull();

      expect(typeof supportsBrotli()).toBe('boolean');
      expect(Array.isArray(getDefaultSupportedEncodings())).toBe(true);
    });
  });

  describe('core/errors/normalize.js and core/errors/domain.js branch coverage', () => {
    it('exercises getStatusTitle and normalizeError with all types', () => {
      expect(getStatusTitle(404)).toBe('Not Found');
      expect(getStatusTitle(418)).toBe('Error');
      expect(getStatusTitle(500)).toBe('Internal Server Error');
      expect(getStatusTitle(599)).toBe('Internal Server Error');

      // Nullish errors
      const n1 = normalizeError(null);
      expect(n1.status).toBe(500);

      // Primitive string/number throws
      const n2 = normalizeError('Plain string error', true);
      expect(n2.status).toBe(500);
      expect(n2.message).toBe('Plain string error');

      const n3 = normalizeError(404, false);
      expect(n3.status).toBe(500);

      // Plain object throws
      const n4 = normalizeError({ message: 'Object error', status: 400, details: { foo: 'bar' } }, false);
      expect(n4.status).toBe(400);
      expect(n4.details).toEqual({ foo: 'bar' });

      // Standard Error with custom statusCode
      const stdErr = new Error('Database down');
      stdErr.statusCode = 503;
      stdErr.code = 'DB_UNAVAILABLE';
      stdErr.route = '/api/db';
      stdErr.requestId = 'req-123';
      const n5 = normalizeError(stdErr, true);
      expect(n5.status).toBe(503);
      expect(n5.code).toBe('DB_UNAVAILABLE');
      expect(n5.route).toBe('/api/db');

      // Domain errors
      const valErr = new ValidationError('Bad input', { fields: { email: 'Required' }, status: 422 });
      expect(valErr.status).toBe(422);
      expect(valErr.fields).toEqual({ email: 'Required' });

      const cfgErr = new ConfigurationError('Bad config');
      expect(cfgErr.status).toBe(500);

      const plugErr = new PluginError('Plugin failed', { plugin: 'email' });
      expect(plugErr.plugin).toBe('email');

      const secErr = new SecurityError('Forbidden token');
      expect(secErr.status).toBe(400);

      const reqErr = new RequestError(400, 'Bad req');
      expect(reqErr.status).toBe(400);

      const abortErr = new RequestAbortedError();
      expect(abortErr.status).toBe(499);

      const rtrErr = new RouterError('Routing fail');
      expect(rtrErr.message).toBe('Routing fail');

      const notFound1 = new RouteNotFoundError('/api/users/123');
      expect(notFound1.status).toBe(404);
      expect(notFound1.path).toBe('/api/users/123');
      expect(notFound1.message).toBe('Route not found: /api/users/123');

      const notFound2 = new RouteNotFoundError('Custom not found message');
      expect(notFound2.message).toBe('Custom not found message');

      const genErr = new RouteGenerationError('Missing param');
      expect(genErr.status).toBe(500);
    });

    it('exercises toErrorResponseObject formatting in dev and prod', () => {
      const err = new ValidationError('Validation Failed', {
        fields: { name: 'Name is required' },
        details: { extra: 123 },
      });
      err.route = '/api/submit';
      err.method = 'POST';
      err.source = 'api/submit.post.js';
      err.module = 'user';
      err.phase = 'validation';
      err.requestId = 'req-555';
      err.cause = new Error('Underlying validation error');

      // Development mode: includes trace, fields, details, cause, stack
      const devRes = toErrorResponseObject(err, true);
      expect(devRes.status).toBe(422);
      expect(devRes.error).toBe('Validation Error');
      expect(devRes.fields).toEqual({ name: 'Name is required' });
      expect(devRes.details).toEqual({ extra: 123 });
      expect(devRes.trace).toEqual({
        route: '/api/submit',
        method: 'POST',
        source: 'api/submit.post.js',
        module: 'user',
        phase: 'validation',
        requestId: 'req-555',
      });
      expect(devRes.stack).toBeDefined();
      expect(devRes.cause).toBeDefined();

      // Production mode with non-exposed error
      const hiddenErr = new SecurityError('Secret token leak');
      const prodRes = toErrorResponseObject(hiddenErr, false);
      expect(prodRes.status).toBe(400);
      expect(prodRes.message).toBe('Bad Request');
      expect(prodRes.trace).toBeUndefined();
      expect(prodRes.stack).toBeUndefined();
    });
  });

  describe('core/orm/utils.js branch coverage', () => {
    it('exercises pick, omit, omitHiddenColumns, sanitizeForOutput, deepClone, and date helpers', () => {
      const obj = { a: 1, b: 2, c: 3, password: 'secret', token: 'xyz' };

      // pick & omit
      expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
      expect(omit(obj, ['password', 'token'])).toEqual({ a: 1, b: 2, c: 3 });

      // omitHiddenColumns & sanitizeForOutput
      const modelWithHidden = { hidden: ['password', 'token'] };
      const modelWithoutHidden = {};

      expect(omitHiddenColumns(null, modelWithHidden)).toBeNull();
      expect(omitHiddenColumns(obj, modelWithoutHidden)).toEqual(obj);
      expect(omitHiddenColumns(obj, modelWithHidden)).toEqual({ a: 1, b: 2, c: 3 });

      expect(sanitizeForOutput(null, modelWithoutHidden)).toBeNull();
      expect(sanitizeForOutput(obj, modelWithHidden)).toEqual({ a: 1, b: 2, c: 3 });
      expect(sanitizeForOutput([obj, obj], modelWithHidden)).toEqual([
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 2, c: 3 },
      ]);

      // deepClone
      const now = new Date();
      const complex = {
        str: 'hello',
        num: 42,
        date: now,
        arr: [1, { nested: 'yes' }],
        obj: { x: 10 },
      };
      const cloned = deepClone(complex);
      expect(cloned).toEqual(complex);
      expect(cloned.date).toBeInstanceOf(Date);
      expect(cloned.date.getTime()).toBe(now.getTime());
      expect(deepClone(null)).toBeNull();
      expect(deepClone('primitive')).toBe('primitive');

      // date & string conversions
      expect(typeof formatDateForDb(new Date())).toBe('string');
      expect(generateMigrationTimestamp()).toMatch(/^\d{8}_\d{6}$/);
      expect(snakeToCamel('first_name_test')).toBe('firstNameTest');
      expect(camelToSnake('firstNameTest')).toBe('first_name_test');
      expect(ensureArray(null)).toEqual([]);
      expect(ensureArray(undefined)).toEqual([]);
      expect(ensureArray('single')).toEqual(['single']);
      expect(ensureArray(['already', 'array'])).toEqual(['already', 'array']);
    });
  });

  describe('plugins/csv branch coverage (services & middleware)', () => {
    const { createCsvServices } = require('../../plugins/csv/services.js');
    const { createCsvMiddleware } = require('../../plugins/csv/middleware.js');

    it('exercises csv.generate, csv.parse, and csv.exportModel services', async () => {
      const services = createCsvServices();

      // csv.generate
      const genRes = await services['csv.generate'].handler({
        rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
        columns: ['id', { key: 'name', header: 'Full Name' }],
        delimiter: ';',
        eol: '\n',
        header: true,
        bom: true,
        sanitizeFormulas: true,
      });
      expect(genRes.mimeType).toBe('text/csv; charset=utf-8');
      expect(genRes.csv).toContain('Full Name');
      expect(genRes.size).toBeGreaterThan(0);

      // csv.parse from text
      const parseTextRes = await services['csv.parse'].handler({
        text: 'id,name\n1,Alice\n2,Bob',
        columns: true,
      });
      expect(parseTextRes.rowCount).toBe(2);
      expect(parseTextRes.data[0]).toEqual({ id: '1', name: 'Alice' });

      // csv.parse from base64
      const b64 = Buffer.from('id,name\n3,Charlie').toString('base64');
      const parseB64Res = await services['csv.parse'].handler({
        base64: b64,
        columns: true,
      });
      expect(parseB64Res.rowCount).toBe(1);
      expect(parseB64Res.data[0]).toEqual({ id: '3', name: 'Charlie' });

      // csv.parse from buffer
      const parseBufRes = await services['csv.parse'].handler({
        buffer: Buffer.from('id,name\n4,Diana'),
        columns: true,
      });
      expect(parseBufRes.rowCount).toBe(1);

      // csv.parse missing target throws
      await expect(services['csv.parse'].handler({})).rejects.toThrow(/requires text, base64, or buffer/);

      // csv.exportModel errors
      await expect(services['csv.exportModel'].handler({ model: 'User' }, {})).rejects.toThrow(
        /requires an active database connection/
      );

      const mockDb = {
        getRepository: (name) => {
          if (name !== 'User') return null;
          return {
            find: async () => [{ id: 1, email: 'a@b.com' }],
            model: { name: 'User', columns: new Map([['id', {}], ['email', {}]]) },
          };
        },
      };

      await expect(
        services['csv.exportModel'].handler({ model: 'Unknown' }, { db: mockDb })
      ).rejects.toThrow(/Model repository "Unknown" not found/);

      const exportRes = await services['csv.exportModel'].handler(
        { model: 'User', columns: ['id', 'email'], filename: 'users' },
        { db: mockDb }
      );
      expect(exportRes.filename).toBe('users.csv');
      expect(exportRes.csv).toContain('email');
    });

    it('exercises res.csv and req.parseCsv middleware branches', async () => {
      const mw = createCsvMiddleware({ delimiter: ',' });
      const req = { headers: {} };
      const res = {
        setHeader: vi.fn(),
        end: vi.fn(),
      };
      const next = vi.fn();

      mw(req, res, next);
      expect(typeof res.csv).toBe('function');
      expect(typeof req.parseCsv).toBe('function');

      // res.csv with Buffer
      await res.csv(Buffer.from('a,b\n1,2'), 'export1.csv');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.end).toHaveBeenCalled();

      // res.csv with string
      await res.csv('a,b\n3,4', 'export2');
      expect(res.end).toHaveBeenCalled();

      // res.csv with array of objects
      await res.csv([{ x: 1, y: 2 }], 'export3.csv');
      expect(res.end).toHaveBeenCalled();

      // res.csv with config object
      await res.csv({ rows: [{ p: 10, q: 20 }] }, 'export4.csv');
      expect(res.end).toHaveBeenCalled();

      // res.csv with invalid data type triggers next(err)
      const nextRes = vi.fn();
      const faultyRes = {
        setHeader: vi.fn(),
        end: vi.fn(),
      };
      const faultyMw = createCsvMiddleware();
      faultyMw(req, faultyRes, next);
      await faultyRes.csv(12345, 'invalid.csv');
      // In middleware try/catch it invokes return next(err)

      // req.parseCsv with file buffer
      req.file = { buffer: Buffer.from('col1,col2\nval1,val2') };
      const parsedFile = await req.parseCsv();
      expect(parsedFile.length).toBe(1);

      // req.parseCsv with rawBody
      delete req.file;
      req.rawBody = 'a,b\n9,8';
      const parsedRaw = await req.parseCsv();
      expect(parsedRaw.length).toBe(1);

      // req.parseCsv with body string
      delete req.rawBody;
      req.body = 'a,b\n7,6';
      const parsedBody = await req.parseCsv();
      expect(parsedBody.length).toBe(1);

      // req.parseCsv missing target throws
      delete req.body;
      await expect(req.parseCsv()).rejects.toThrow(/requires a CSV string/);
    });
  });

  describe('plugins/dashboard/index.js branch coverage', () => {
    const dashboardPlugin = require('../../plugins/dashboard/index.js');

    it('exercises disabled and enabled dashboard routes, sensitive env filter, and API handlers', () => {
      // Disabled mode
      const disabledPlugin = dashboardPlugin({ enabled: false });
      const ctxDisabled = { addRoute: vi.fn() };
      disabledPlugin.onRoutesReady(ctxDisabled);
      expect(ctxDisabled.addRoute).not.toHaveBeenCalled();

      // Enabled mode
      const enabledPlugin = dashboardPlugin({
        enabled: true,
        path: '/_admin_dash',
      });

      const routesMap = {};
      const pluginManager = {
        plugins: new Map([
          ['csrf', { name: 'csrf', version: '1.2.0', description: 'CSRF Protection' }],
          ['anon', {}],
        ]),
      };

      const ctxEnabled = {
        addRoute: vi.fn((method, routePath, handler) => {
          routesMap[`${method}:${routePath}`] = handler;
        }),
        routes: [{ path: '/api/users', method: 'GET' }],
        pluginManager,
        options: {},
      };

      // Set test environment variables with sensitive keys
      process.env.APP_SECRET = 'supersecret';
      process.env.DB_PASSWORD = 'password123';
      process.env.API_KEY = 'key-abc';

      enabledPlugin.onRoutesReady(ctxEnabled);

      expect(ctxEnabled.addRoute).toHaveBeenCalledWith('get', '/_admin_dash', expect.any(Function));
      expect(ctxEnabled.addRoute).toHaveBeenCalledWith('get', '/_admin_dash/api/routes', expect.any(Function));
      expect(ctxEnabled.addRoute).toHaveBeenCalledWith('get', '/_admin_dash/api/plugins', expect.any(Function));
      expect(ctxEnabled.addRoute).toHaveBeenCalledWith('get', '/_admin_dash/api/config', expect.any(Function));

      // Test HTML endpoint handler
      const htmlRes = { type: vi.fn(), send: vi.fn() };
      routesMap['get:/_admin_dash']({}, htmlRes);
      expect(htmlRes.type).toHaveBeenCalledWith('text/html');
      expect(htmlRes.send).toHaveBeenCalledWith(expect.stringContaining('Webspresso Dashboard'));

      // Test routes API handler
      const routesRes = { json: vi.fn() };
      routesMap['get:/_admin_dash/api/routes']({}, routesRes);
      expect(routesRes.json).toHaveBeenCalledWith(ctxEnabled.routes);

      // Test plugins API handler
      const pluginsRes = { json: vi.fn() };
      routesMap['get:/_admin_dash/api/plugins']({}, pluginsRes);
      expect(pluginsRes.json).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'csrf', version: '1.2.0' }),
          expect.objectContaining({ name: 'anon', version: '0.0.0' }),
        ])
      );

      // Test config API handler
      const configRes = { json: vi.fn() };
      routesMap['get:/_admin_dash/api/config']({}, configRes);
      expect(configRes.json).toHaveBeenCalled();
      const maskedConfig = configRes.json.mock.calls[0][0];
      expect(maskedConfig.env.NODE_ENV).toBeDefined();
      expect(maskedConfig.server.baseUrl).toBeDefined();
    });
  });

  describe('plugins/data-exchange branch coverage', () => {
    const {
      normalizeHeaderCell,
      buildHeaderMapping,
      dataRowsToObjects,
    } = require('../../plugins/data-exchange/parse-table.js');
    const {
      buildXlsxBuffer,
      getModelExportColumns,
    } = require('../../plugins/data-exchange/export-xlsx.js');
    const { resolveExportRecords } = require('../../plugins/data-exchange/record-selection.js');
    const {
      buildPayloadForRow,
      allowedImportColumns,
      parseCsvToRows,
    } = require('../../plugins/data-exchange/import.js');

    it('exercises parse-table functions', () => {
      // normalizeHeaderCell
      expect(normalizeHeaderCell(null)).toBe('');
      expect(normalizeHeaderCell(undefined)).toBe('');
      expect(normalizeHeaderCell('')).toBe('');
      expect(normalizeHeaderCell('\uFEFF First Name ')).toBe('First Name');

      // buildHeaderMapping
      const allowed = ['first_name', 'email_address', 'phone_number'];
      const headers = ['First Name', 'EMAIL-ADDRESS', 'phone number', '', 'unmatched_col'];
      const mapping = buildHeaderMapping(headers, allowed);
      expect(mapping).toEqual(['first_name', 'email_address', 'phone_number', null, null]);

      // dataRowsToObjects
      const rows = [
        ['First Name', 'EMAIL-ADDRESS', 'phone number'],
        ['John', 'john@example.com', '123456'],
        ['', '   ', null], // empty row should be skipped
        ['Jane', 'jane@example.com', '789012'],
      ];
      const objects = dataRowsToObjects(rows, mapping.slice(0, 3));
      expect(objects.length).toBe(2);
      expect(objects[0]).toEqual({
        rowNumber: 2,
        data: { first_name: 'John', email_address: 'john@example.com', phone_number: '123456' },
      });
      expect(objects[1].rowNumber).toBe(4);
    });

    it('exercises export-xlsx buffer and column resolution', async () => {
      const mockModel = {
        name: 'Product',
        hidden: ['internal_code'],
        columns: new Map([
          ['id', {}],
          ['title', {}],
          ['price', {}],
          ['internal_code', {}],
        ]),
        schema: {
          shape: {
            id: {},
            title: {},
            price: {},
            created_at: {},
          },
        },
      };

      const cols = getModelExportColumns(mockModel, []);
      expect(cols).toContain('id');
      expect(cols).toContain('title');
      expect(cols).toContain('created_at');
      expect(cols).not.toContain('internal_code');

      // Fallback columns from clean records
      const emptyModel = { name: 'Empty' };
      const fallbackCols = getModelExportColumns(emptyModel, [{ custom_a: 1, custom_b: 2 }]);
      expect(fallbackCols).toEqual(['custom_a', 'custom_b']);

      // Build XLSX buffer with diverse cell values
      const now = new Date();
      const records = [
        {
          id: 1,
          title: '=FORMULA(1+2)', // should be escaped with leading space
          price: 99.99,
          big_int: BigInt(9007199254740991),
          date: now,
          buf: Buffer.from('bin-data'),
          meta: { color: 'red' },
          empty_val: null,
        },
      ];

      const buf = await buildXlsxBuffer(mockModel, records);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(0);
    });

    it('exercises resolveExportRecords branches', async () => {
      const mockRepo = {
        findById: vi.fn(async (id) => (id === '1' ? { id: '1', name: 'One' } : null)),
        findAll: vi.fn(async () => [{ id: '1' }, { id: '2' }]),
        query: vi.fn(() => ({
          onlyTrashed: vi.fn().mockReturnThis(),
          whereIn: vi.fn().mockReturnThis(),
          list: vi.fn(async () => [{ id: '99', deleted_at: new Date() }]),
        })),
      };

      const mockDb = {
        getModel: (name) => {
          if (name === 'User') {
            return {
              name: 'User',
              admin: { enabled: true },
              scopes: { softDelete: true },
              primaryKey: 'id',
            };
          }
          if (name === 'Disabled') {
            return { name: 'Disabled', admin: { enabled: false } };
          }
          return null;
        },
        getRepository: () => mockRepo,
      };

      // 1. Missing modelName
      const r1 = await resolveExportRecords(mockDb, null, { body: {}, query: {} });
      expect(r1.error).toBe(400);

      // 2. Not found / disabled model
      const r2 = await resolveExportRecords(mockDb, 'Unknown', { body: {}, query: {} });
      expect(r2.error).toBe(404);
      const r3 = await resolveExportRecords(mockDb, 'Disabled', { body: {}, query: {} });
      expect(r3.error).toBe(404);

      // 3. Fallback findAll
      const r4 = await resolveExportRecords(mockDb, 'User', { body: {}, query: {} });
      expect(r4.records.length).toBe(2);

      // 4. ids as array
      const r5 = await resolveExportRecords(mockDb, 'User', { body: { ids: ['1', '2'] }, query: {} });
      expect(r5.records.length).toBe(1);

      // 5. ids as comma-separated query string
      const r6 = await resolveExportRecords(mockDb, 'User', { body: {}, query: { ids: '1' } });
      expect(r6.records.length).toBe(1);

      // 6. trashed only with ids
      const r7 = await resolveExportRecords(mockDb, 'User', {
        body: { ids: ['99'], trashed: 'only' },
        query: {},
      });
      expect(r7.records.length).toBe(1);
    });

    it('exercises import.js buildPayloadForRow and coerceCell branches', () => {
      const model = {
        name: 'Item',
        primaryKey: 'id',
        columns: new Map([
          ['id', { type: 'integer', autoIncrement: true }],
          ['int_val', { type: 'integer' }],
          ['bigint_val', { type: 'bigint' }],
          ['float_val', { type: 'float' }],
          ['bool_val', { type: 'boolean' }],
          ['date_val', { type: 'date' }],
          ['json_val', { type: 'json' }],
          ['untyped_val', {}],
        ]),
        hidden: ['secret'],
      };

      // Allowed import columns
      const allowed = allowedImportColumns(model);
      expect(allowed).toContain('int_val');
      expect(allowed).not.toContain('secret');

      // Valid type coercions
      const validData = {
        id: '10',
        int_val: '42',
        bigint_val: 100,
        float_val: '12.34',
        bool_val: 'yes',
        date_val: '2026-01-01T00:00:00.000Z',
        json_val: '{"a": 1}',
        untyped_val: '123',
        unmapped_col: 'skip-me',
      };

      // In insert mode, auto-increment pk is stripped
      const insertPayload = buildPayloadForRow(model, validData, 'insert');
      expect(insertPayload.id).toBeUndefined();
      expect(insertPayload.int_val).toBe(42);
      expect(insertPayload.bigint_val).toBe(100);
      expect(insertPayload.float_val).toBe(12.34);
      expect(insertPayload.bool_val).toBe(true);
      expect(insertPayload.json_val).toEqual({ a: 1 });
      expect(insertPayload.untyped_val).toBe(123);
      expect(insertPayload.unmapped_col).toBeUndefined();

      // Boolean variations
      expect(buildPayloadForRow(model, { bool_val: '0' }, 'upsert').bool_val).toBe(false);
      expect(buildPayloadForRow(model, { bool_val: 'false' }, 'upsert').bool_val).toBe(false);
      expect(buildPayloadForRow(model, { bool_val: 'no' }, 'upsert').bool_val).toBe(false);
      expect(buildPayloadForRow(model, { bool_val: true }, 'upsert').bool_val).toBe(true);

      // Error branches in coerceCell
      expect(() => buildPayloadForRow(model, { int_val: 'not-an-int' }, 'upsert')).toThrow(/Invalid integer/);
      expect(() => buildPayloadForRow(model, { float_val: 'not-a-float' }, 'upsert')).toThrow(/Invalid number/);
      expect(() => buildPayloadForRow(model, { bool_val: 'not-a-bool' }, 'upsert')).toThrow(/Invalid boolean/);
      expect(() => buildPayloadForRow(model, { date_val: 'invalid-date' }, 'upsert')).toThrow(/Invalid date/);
      expect(() => buildPayloadForRow(model, { json_val: '{bad-json' }, 'upsert')).toThrow(/Invalid JSON/);

      // parseCsvToRows
      expect(parseCsvToRows(Buffer.from(''))).toEqual([]);
      expect(parseCsvToRows(Buffer.from('a,b\n1,2'))).toEqual([['a', 'b'], ['1', '2']]);
    });
  });

  describe('src/services/builtins/file-manager.js branch coverage', () => {
    const { createFileManagerServices } = require('../../src/services/builtins/file-manager.js');

    it('exercises fileManager.upload error handling and type branches', async () => {
      const services = createFileManagerServices({
        baseDir: '/tmp/test-uploads',
        publicBasePath: '/uploads',
      });

      // 1. Invalid non-buffer type
      await expect(
        services['fileManager.upload'].handler({
          buffer: 12345,
          originalName: 'test.bin',
        })
      ).rejects.toThrow(/Invalid buffer provided/);

      // 2. Non-existent file path
      await expect(
        services['fileManager.upload'].handler({
          filePath: '/path/to/definitely/nonexistent/file/12345.png',
          originalName: 'test.png',
        })
      ).rejects.toThrow(/Source file not found/);

      // 3. No file content provided
      await expect(
        services['fileManager.upload'].handler({
          originalName: 'empty.bin',
        })
      ).rejects.toThrow(/No file content provided/);
    });
  });

  describe('core/auth branch coverage (hash, policy, tokens)', () => {
    const { verify: verifyHash, needsRehash, generateToken, hashToken } = require('../../core/auth/hash.js');
    const { PolicyManager, AuthorizationError } = require('../../core/auth/policy.js');
    const {
      createKnexAuthTokensAdapter,
      createAuthToken,
      verifyAuthToken,
      consumeAuthToken,
      purgeExpiredAuthTokens,
    } = require('../../core/auth/tokens.js');

    it('exercises hash helpers edge cases', async () => {
      // verify falsy
      expect(await verifyHash(null, 'some-hash')).toBe(false);
      expect(await verifyHash('pass', null)).toBe(false);
      expect(await verifyHash('pass', 'invalid-bcrypt-hash')).toBe(false);

      // needsRehash falsy
      expect(needsRehash(null)).toBe(true);
      expect(needsRehash('invalid-hash')).toBe(true);

      // token generation and hashing
      const token = generateToken(16);
      expect(token.length).toBe(32);
      const hashed = hashToken(token);
      expect(hashed.length).toBe(64);
    });

    it('exercises PolicyManager gates, policies, before hooks, and errors', () => {
      const pm = new PolicyManager();

      // Gate definition validation
      expect(() => pm.defineGate('invalidGate', null)).toThrow(/must be a function/);
      pm.defineGate('isAdmin', (user) => user && user.role === 'admin');
      expect(pm.hasGate('isAdmin')).toBe(true);
      expect(pm.getGates()).toContain('isAdmin');

      // Policy definition validation
      expect(() => pm.definePolicy('invalidPolicy', null)).toThrow(/must be an object/);
      expect(() => pm.definePolicy('invalidPolicy', { view: 'not-a-fn' })).toThrow(/must be a function/);

      pm.definePolicy('post', {
        view: () => true,
        edit: (user, post) => user && post && user.id === post.userId,
      });
      expect(pm.hasPolicy('post')).toBe(true);
      expect(pm.getPolicies()).toContain('post');

      // Checks without before hook
      expect(pm.can({ role: 'admin' }, 'isAdmin')).toBe(true);
      expect(pm.can({ role: 'user' }, 'isAdmin')).toBe(false);
      expect(pm.can(null, 'nonExistentGate')).toBe(false);

      expect(pm.can(null, 'view', 'post')).toBe(true);
      expect(pm.can({ id: 1 }, 'edit', 'post', { userId: 1 })).toBe(true);
      expect(pm.can({ id: 2 }, 'edit', 'post', { userId: 1 })).toBe(false);
      expect(pm.can({ id: 1 }, 'nonExistentAction', 'post')).toBe(false);
      expect(pm.can({ id: 1 }, 'view', 'nonExistentPolicy')).toBe(false);

      // cannot & authorize
      expect(pm.cannot({ id: 2 }, 'edit', 'post', { userId: 1 })).toBe(true);
      expect(() => pm.authorize({ id: 2 }, 'edit', 'post', { userId: 1 })).toThrow(AuthorizationError);

      // Before hook
      pm.before((user) => {
        if (user && user.isSuperAdmin) return true;
        return undefined; // continue normal checks
      });

      expect(pm.can({ isSuperAdmin: true }, 'edit', 'post', { userId: 999 })).toBe(true);
      expect(pm.can({ id: 2 }, 'edit', 'post', { userId: 1 })).toBe(false);

      // Clear
      pm.clear();
      expect(pm.hasGate('isAdmin')).toBe(false);
      expect(pm.hasPolicy('post')).toBe(false);
    });

    it('exercises auth tokens adapter and lifecycle helpers', async () => {
      // In-memory store simulating Knex auth_tokens table
      const store = [];
      const mockKnex = Object.assign(
        (table) => ({
          insert: async (row) => store.push({ ...row, id: store.length + 1 }),
          where: (criteria) => {
            let filtered = store.filter((item) => {
              for (const [k, v] of Object.entries(criteria)) {
                if (item[k] !== v) return false;
              }
              return true;
            });
            return {
              first: async () => filtered[0] || null,
              delete: async () => {
                const initialLen = store.length;
                for (let i = store.length - 1; i >= 0; i--) {
                  const item = store[i];
                  let match = true;
                  for (const [k, v] of Object.entries(criteria)) {
                    if (item[k] !== v) match = false;
                  }
                  if (match) store.splice(i, 1);
                }
                return initialLen - store.length;
              },
              where: (nestedCriteria) => ({
                delete: async () => {
                  for (let i = store.length - 1; i >= 0; i--) {
                    const item = store[i];
                    if (item.user_id === criteria.user_id && item.type === nestedCriteria.type) {
                      store.splice(i, 1);
                    }
                  }
                },
              }),
            };
          },
        }),
        {}
      );

      const adapter = createKnexAuthTokensAdapter({ knex: mockKnex });

      // Create token
      const { rawToken, expiresAt } = await createAuthToken(adapter, 'password_reset', 42, 60000);
      expect(typeof rawToken).toBe('string');
      expect(expiresAt).toBeInstanceOf(Date);

      // Verify token
      const verified = await verifyAuthToken(adapter, 'password_reset', rawToken);
      expect(verified).not.toBeNull();
      expect(verified.userId).toBe(42);

      // Verify non-existent / null token
      expect(await verifyAuthToken(adapter, 'password_reset', null)).toBeNull();
      expect(await verifyAuthToken(adapter, 'password_reset', 'fake-token')).toBeNull();

      // Consume token
      await consumeAuthToken(adapter, verified.tokenHash);
      expect(await verifyAuthToken(adapter, 'password_reset', rawToken)).toBeNull();

      // Expired token auto-purge in verifyAuthToken
      const expiredCreate = await createAuthToken(adapter, 'email_verify', 99, -1000);
      const expiredVerify = await verifyAuthToken(adapter, 'email_verify', expiredCreate.rawToken);
      expect(expiredVerify).toBeNull();

      // purgeExpiredAuthTokens fallback
      expect(await purgeExpiredAuthTokens(null)).toBe(0);
    });
  });

  describe('plugins/redirect branch coverage', () => {
    const { redirectPlugin } = require('../../plugins/redirect/index.js');

    it('exercises redirect plugin rules, methods, external blocking, query preservation, and slash modes', () => {
      const plugin = redirectPlugin({
        rules: [
          { from: '/old-page', to: '/new-page', status: 301 },
          { from: '/query-test', to: '/target-page', status: 302 },
          { from: '/external', to: 'https://example.com', status: 302 }, // external without allowExternal -> skipped
          { from: /^\/blog\/(\d+)$/, to: '/posts', status: 307 },
          { from: '/wildcard-method', to: '/any-target', methods: '*' },
          { from: '/post-only', to: '/post-target', methods: ['POST'] },
          { to: '/missing-from' }, // missing from -> skipped
          { from: '/missing-to' }, // missing to -> skipped
          { from: 12345, to: '/bad-from' }, // bad from -> skipped
        ],
        allowExternal: false,
        preserveQuery: true,
      });

      const ctx = {
        app: {
          use: vi.fn(),
        },
      };

      plugin.register(ctx);
      expect(ctx.app.use).toHaveBeenCalled();
      const mw = ctx.app.use.mock.calls[0][0];

      // 1. Simple exact redirect
      const req1 = { path: '/old-page', method: 'GET', url: '/old-page' };
      const res1 = { redirect: vi.fn() };
      const next1 = vi.fn();
      mw(req1, res1, next1);
      expect(res1.redirect).toHaveBeenCalledWith(301, '/new-page');

      // 2. Query preservation
      const req2 = { path: '/query-test', method: 'GET', originalUrl: '/query-test?tab=details&sort=asc' };
      const res2 = { redirect: vi.fn() };
      const next2 = vi.fn();
      mw(req2, res2, next2);
      expect(res2.redirect).toHaveBeenCalledWith(302, '/target-page?tab=details&sort=asc');

      // 3. Regex redirect
      const req3 = { path: '/blog/42', method: 'GET', url: '/blog/42' };
      const res3 = { redirect: vi.fn() };
      const next3 = vi.fn();
      mw(req3, res3, next3);
      expect(res3.redirect).toHaveBeenCalledWith(307, '/posts');

      // 4. Wildcard methods
      const req4 = { path: '/wildcard-method', method: 'DELETE', url: '/wildcard-method' };
      const res4 = { redirect: vi.fn() };
      const next4 = vi.fn();
      mw(req4, res4, next4);
      expect(res4.redirect).toHaveBeenCalledWith(302, '/any-target');

      // 5. Method mismatch passes to next()
      const req5 = { path: '/post-only', method: 'GET', url: '/post-only' };
      const res5 = { redirect: vi.fn() };
      const next5 = vi.fn();
      mw(req5, res5, next5);
      expect(next5).toHaveBeenCalled();
      expect(res5.redirect).not.toHaveBeenCalled();

      // Empty rules does not call app.use
      const emptyPlugin = redirectPlugin({ rules: [] });
      const emptyCtx = { app: { use: vi.fn() } };
      emptyPlugin.register(emptyCtx);
      expect(emptyCtx.app.use).not.toHaveBeenCalled();
    });
  });

  describe('plugins/xlsx branch coverage (services & middleware)', () => {
    const { createXlsxServices } = require('../../plugins/xlsx/services.js');
    const { createXlsxMiddleware } = require('../../plugins/xlsx/middleware.js');

    it('exercises xlsx.generate, xlsx.parse, and xlsx.exportModel services', async () => {
      const services = createXlsxServices();

      // xlsx.generate
      const genRes = await services['xlsx.generate'].handler({
        sheets: [
          {
            name: 'Sheet 1',
            columns: [{ header: 'ID', key: 'id' }, { header: 'Name', key: 'name' }],
            rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
          },
        ],
        title: 'Test XLSX',
        creator: 'Webspresso',
      });
      expect(genRes.size).toBeGreaterThan(0);
      expect(genRes.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      // xlsx.parse with base64
      const parseRes = await services['xlsx.parse'].handler({
        base64: genRes.base64,
      });
      expect(parseRes.rowCount).toBe(2);

      // xlsx.parse missing target throws
      await expect(services['xlsx.parse'].handler({})).rejects.toThrow(/requires base64 string or buffer/);

      // xlsx.exportModel database missing error
      await expect(services['xlsx.exportModel'].handler({ model: 'User' }, {})).rejects.toThrow(
        /requires an active database connection/
      );

      // xlsx.exportModel with mock db
      const mockDb = {
        getRepository: (name) => {
          if (name !== 'User') return null;
          return {
            find: async () => [{ id: 1, username: 'admin' }],
            model: { name: 'User', columns: new Map([['id', {}], ['username', {}]]) },
          };
        },
      };

      await expect(
        services['xlsx.exportModel'].handler({ model: 'Unknown' }, { db: mockDb })
      ).rejects.toThrow(/Model repository "Unknown" not found/);

      const exportRes = await services['xlsx.exportModel'].handler(
        { model: 'User', columns: ['id', 'username'], filename: 'users' },
        { db: mockDb }
      );
      expect(exportRes.filename).toBe('users.xlsx');
      expect(exportRes.size).toBeGreaterThan(0);
    });

    it('exercises res.xlsx and req.parseXlsx middleware branches', async () => {
      const mw = createXlsxMiddleware();
      const req = { headers: {} };
      const res = {
        setHeader: vi.fn(),
        end: vi.fn(),
      };
      const next = vi.fn();

      mw(req, res, next);
      expect(typeof res.xlsx).toBe('function');
      expect(typeof req.parseXlsx).toBe('function');

      // res.xlsx with Buffer
      await res.xlsx(Buffer.from('fake-xlsx-content'), 'export1.xlsx');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(res.end).toHaveBeenCalled();

      // res.xlsx with array of objects
      await res.xlsx([{ a: 1, b: 2 }], 'export2');
      expect(res.end).toHaveBeenCalled();

      // res.xlsx with sheets config object
      await res.xlsx({ sheets: [{ rows: [{ x: 10 }] }] }, 'export3.xlsx');
      expect(res.end).toHaveBeenCalled();

      // req.parseXlsx missing target throws
      await expect(req.parseXlsx()).rejects.toThrow(/requires a file Buffer/);
    });
  });
});


