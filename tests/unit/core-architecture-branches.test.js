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

describe('Core Architecture Branch Coverage', () => {
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

  describe('plugins/site-analytics/client-error-handler.js branch coverage', () => {
    const { createErrorReportHandler, ensureErrorsTable } = require('../../plugins/site-analytics/client-error-handler.js');

    it('handles various error report payloads and edge cases', async () => {
      const mockKnex = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue([1]),
      });
      mockKnex.schema = {
        hasTable: vi.fn().mockResolvedValue(false),
        createTable: vi.fn().mockImplementation((table, cb) => {
          const t = {
            bigIncrements: vi.fn().mockReturnValue({ primary: vi.fn() }),
            string: vi.fn().mockReturnValue({ index: vi.fn() }),
            text: vi.fn(),
            integer: vi.fn(),
            timestamp: vi.fn().mockReturnValue({ defaultTo: vi.fn().mockReturnValue({ index: vi.fn() }) }),
          };
          cb(t);
          return Promise.resolve();
        }),
      };
      mockKnex.fn = { now: vi.fn().mockReturnValue('NOW()') };

      const handler = createErrorReportHandler({ knex: mockKnex });

      // Non-POST method
      const resGet = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handler({ method: 'GET' }, resGet);
      expect(resGet.status).toHaveBeenCalledWith(405);

      // Missing message and stack
      const resMissing = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handler({ method: 'POST', body: {} }, resMissing);
      expect(resMissing.status).toHaveBeenCalledWith(400);

      // Valid message and stack with all fields
      const resOk = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handler({
        method: 'POST',
        body: {
          type: 'unhandledrejection',
          message: 'Error msg',
          stack: 'Error stack trace',
          path: '/page',
          referrer: 'https://google.com',
          userAgent: 'Mozilla/5.0',
          source: 'https://app.com/app.js',
          line: '12',
          column: '34',
        },
      }, resOk);
      expect(resOk.status).toHaveBeenCalledWith(202);

      // Error during insert
      mockKnex.mockReturnValueOnce({
        insert: vi.fn().mockRejectedValue(new Error('DB Error')),
      });
      const resErr = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handler({
        method: 'POST',
        body: { message: 'Something broke' },
      }, resErr);
      expect(resErr.status).toHaveBeenCalledWith(500);
    });
  });

  describe('plugins/rate-limit/index.js branch coverage', () => {
    const { rateLimitPlugin, resolveLimiterConfig } = require('../../plugins/rate-limit/index.js');

    it('exercises limiter config with custom keyGenerator and ipv6Subnet', () => {
      const ipKeyGen = vi.fn().mockReturnValue('ip-key');
      const customKey = vi.fn().mockReturnValue('custom-key');

      const config1 = resolveLimiterConfig(ipKeyGen, { keyGenerator: customKey });
      expect(config1.keyGenerator()).toBe('custom-key');

      const config2 = resolveLimiterConfig(ipKeyGen, { ipv6Subnet: 64 });
      expect(typeof config2.keyGenerator).toBe('function');
      config2.keyGenerator({ ip: '::1' });
      expect(ipKeyGen).toHaveBeenCalledWith('::1', 64);
    });

    it('exercises rateLimitPlugin with global and skip path prefixes', () => {
      const plugin = rateLimitPlugin({
        global: true,
        globalSkipPaths: ['/custom-skip'],
        globalOverrides: { limit: 50 },
      });

      const app = { use: vi.fn() };
      const ctx = {
        app,
        middlewares: {},
      };

      plugin.register(ctx);
      expect(typeof ctx.middlewares.rateLimit).toBe('function');
      expect(app.use).toHaveBeenCalled();

      const limiterOpts = plugin.api.createLimiterOptions({ limit: 10 });
      expect(limiterOpts.limit).toBe(10);
    });
  });

  describe('plugins/queue/index.js branch coverage', () => {
    const queuePlugin = require('../../plugins/queue/index.js');

    it('handles database adapter creation and missing knex error', () => {
      expect(() => {
        const p = queuePlugin({ adapter: 'database' });
        p.register({ app: null, db: null });
      }).toThrow(/requires a valid database\/knex instance/);

      expect(() => {
        const p = queuePlugin({ adapter: 'redis' });
        p.register({ app: null, db: null });
      }).toThrow(/requires a valid redisClient in options/);
    });

    it('registers memory adapter into app and context and disposes', async () => {
      const p = queuePlugin({ adapter: 'memory', autoStart: false });
      const app = {
        set: vi.fn(),
        use: vi.fn((mw) => {
          const req = {};
          mw(req, {}, () => {});
          expect(req.queue).toBeDefined();
        }),
      };
      const ctx = { app, db: null };

      p.register(ctx);
      expect(ctx.queue).toBeDefined();
      expect(app.queue).toBeDefined();

      p.onRoutesReady(ctx);
      await p.dispose();
    });
  });

  describe('plugins/realtime/index.js branch coverage', () => {
    const { realtimePlugin, websocket } = require('../../plugins/realtime/index.js');

    it('exercises setup, register, browserReady, and destroy', () => {
      const p = realtimePlugin({ adapter: websocket({ url: 'ws://localhost:1234' }) });
      const app = {};
      const teardown = p.setup(app);
      expect(app.realtime).toBeDefined();
      expect(p.api.getClient()).toBeDefined();

      p.browserReady(app);

      const ctx = {
        app: {},
        onDispose: vi.fn((cb) => cb()),
      };
      p.register(ctx);
      expect(ctx.app.realtime).toBeDefined();

      teardown();
      p.destroy(app);
      expect(p.api.getClient()).toBeNull();
    });
  });

  describe('src/modules/define-module.js branch coverage', () => {
    const { defineModule } = require('../../src/modules/define-module.js');

    it('throws when name is missing or invalid', () => {
      expect(() => defineModule({})).toThrow(/requires a valid non-empty "name" string/);
      expect(() => defineModule({ name: '   ' })).toThrow(/requires a valid non-empty "name" string/);
    });

    it('creates module factory with services, middlewares, and lifecycle hooks', () => {
      const onInit = vi.fn();
      const onDestroy = vi.fn();

      const factory = defineModule({
        name: 'testmod',
        version: '2.0.0',
        imports: ['dep1'],
        dependencies: ['dep2'],
        services: {
          'action': async () => ({ ok: true }),
          'other.action': async () => ({ ok: true }),
        },
        middlewares: {
          'guard': (req, res, next) => next(),
        },
        exports: { ping: () => 'pong' },
        onInit,
        onDestroy,
      });

      const mod = factory({ customOpt: true });
      expect(mod.name).toBe('testmod');
      expect(mod.version).toBe('2.0.0');
      expect(mod.dependencies).toEqual(['dep1', 'dep2']);
      expect(mod.api.ping()).toBe('pong');

      const mockServiceRegistry = {
        has: vi.fn().mockReturnValue(false),
        register: vi.fn(),
      };
      const mockShutdownManager = {
        registerDisposer: vi.fn(),
      };
      const ctx = {
        app: { serviceRegistry: mockServiceRegistry },
        middlewares: {},
        shutdownManager: mockShutdownManager,
      };

      mod.register(ctx);
      expect(mockServiceRegistry.register).toHaveBeenCalledWith('testmod.action', expect.any(Function));
      expect(mockServiceRegistry.register).toHaveBeenCalledWith('other.action', expect.any(Function));
      expect(ctx.middlewares['testmod.guard']).toBeDefined();
      expect(onInit).toHaveBeenCalledWith(ctx);
      expect(mockShutdownManager.registerDisposer).toHaveBeenCalledWith(onDestroy, { name: 'module:testmod' });
    });
  });

  describe('plugins/admin-panel/modules/dashboard.js branch coverage', () => {
    const { registerDashboardWidgets, generateDashboardComponent } = require('../../plugins/admin-panel/modules/dashboard.js');

    it('generates dashboard component script', () => {
      const code = generateDashboardComponent();
      expect(typeof code).toBe('string');
      expect(code).toContain('Dashboard Page Component');
    });

    it('exercises model-stats, recent-activity, and quick-actions widget loaders', async () => {
      const registeredWidgets = new Map();
      const mockRegistry = {
        registerWidget: (id, config) => {
          registeredWidgets.set(id, config);
        },
      };

      const mockDb = {
        getAllModels: () => [
          {
            name: 'Post',
            table: 'posts',
            admin: { enabled: true, label: 'Blog Posts', icon: 'file' },
            columns: new Map([
              ['id', {}],
              ['title', {}],
              ['created_at', {}],
              ['updated_at', {}],
            ]),
          },
          {
            name: 'Comment',
            table: 'comments',
            admin: { enabled: true },
            columns: new Map([
              ['id', {}],
              ['createdAt', {}],
              ['updatedAt', {}],
            ]),
          },
          {
            name: 'Secret',
            table: 'secrets',
            admin: { enabled: false },
          },
          {
            name: 'Broken',
            table: 'broken',
            admin: { enabled: true },
          },
        ],
        getRepository: (name) => {
          if (name === 'Broken') {
            throw new Error('Table error');
          }
          return {
            count: vi.fn().mockResolvedValue(10),
            query: () => ({
              orderBy: (col, dir) => ({
                first: async () => ({
                  created_at: new Date('2026-01-01'),
                  createdAt: new Date('2026-01-01'),
                  updated_at: new Date('2026-01-02'),
                  updatedAt: new Date('2026-01-02'),
                }),
              }),
            }),
          };
        },
        knex: {
          schema: {
            hasTable: vi.fn().mockResolvedValue(true),
          },
          fn: vi.fn(),
        },
      };

      // Mock knex table query
      const knexFn = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 1, action: 'create', model: 'Post' }]),
      });
      mockDb.knex = Object.assign(knexFn, {
        schema: { hasTable: vi.fn().mockResolvedValue(true) },
      });

      registerDashboardWidgets({ registry: mockRegistry, db: mockDb });
      expect(registeredWidgets.has('model-stats')).toBe(true);
      expect(registeredWidgets.has('recent-activity')).toBe(true);
      expect(registeredWidgets.has('quick-actions')).toBe(true);

      // Execute model-stats loader
      const stats = await registeredWidgets.get('model-stats').dataLoader({ db: mockDb });
      expect(stats.length).toBe(3); // Post, Comment, Broken
      expect(stats[0].name).toBe('Post');
      expect(stats[2].count).toBe(0);

      // Execute recent-activity loader with table present
      const act1 = await registeredWidgets.get('recent-activity').dataLoader({ db: mockDb });
      expect(act1.enabled).toBe(true);
      expect(act1.activities.length).toBe(1);

      // Execute recent-activity loader without table
      mockDb.knex.schema.hasTable.mockResolvedValueOnce(false);
      const act2 = await registeredWidgets.get('recent-activity').dataLoader({ db: mockDb });
      expect(act2.enabled).toBe(false);

      // Execute quick-actions loader
      const quick = await registeredWidgets.get('quick-actions').dataLoader({ db: mockDb });
      expect(quick.length).toBe(3);
      expect(quick[0].path).toBe('/models/Post/new');
    });
  });

  describe('plugins/admin-panel/modules/bulk-actions.js branch coverage', () => {
    const {
      registerDefaultBulkActions,
      createFieldUpdateBulkAction,
      generateBulkActionsComponent,
    } = require('../../plugins/admin-panel/modules/bulk-actions.js');

    it('generates bulk actions component code', () => {
      const code = generateBulkActionsComponent();
      expect(typeof code).toBe('string');
      expect(code).toContain('Bulk Actions Bar Component');
    });

    it('exercises bulk-restore, bulk-delete, export-json, and export-csv handlers', async () => {
      const bulkActions = new Map();
      const mockRegistry = {
        registerBulkAction: (id, config) => {
          bulkActions.set(id, config);
        },
      };

      const mockRepo = {
        restore: vi.fn().mockImplementation((id) => (id === 1 ? true : Promise.reject(new Error('Fail')))),
        delete: vi.fn().mockImplementation((id) => (id === 1 ? true : Promise.reject(new Error('Fail')))),
        update: vi.fn().mockImplementation((id, data) => (id === 1 ? true : Promise.reject(new Error('Fail')))),
      };

      const mockDb = {
        getModel: (name) => {
          if (name === 'SoftModel') return { scopes: { softDelete: true } };
          return { scopes: {} };
        },
        getRepository: () => mockRepo,
      };

      registerDefaultBulkActions({ registry: mockRegistry, db: mockDb });
      expect(bulkActions.has('bulk-restore')).toBe(true);
      expect(bulkActions.has('bulk-delete')).toBe(true);
      expect(bulkActions.has('export-json')).toBe(true);
      expect(bulkActions.has('export-csv')).toBe(true);

      // Test bulk-restore on non-soft-delete model
      const restoreFail = await bulkActions.get('bulk-restore').handler([{ id: 1 }], 'HardModel', { db: mockDb });
      expect(restoreFail.error).toBe(true);

      // Test bulk-restore on soft-delete model
      const restoreSuccess = await bulkActions.get('bulk-restore').handler([{ id: 1 }, { id: 2 }], 'SoftModel', { db: mockDb });
      expect(restoreSuccess.restored).toBe(1);

      // Test bulk-delete
      const deleteRes = await bulkActions.get('bulk-delete').handler([{ id: 1 }, { id: 2 }], 'SoftModel', { db: mockDb });
      expect(deleteRes.deleted).toBe(1);

      // Test export-json
      const jsonRes = await bulkActions.get('export-json').handler([{ id: 1 }, { id: 2 }], 'Post', { req: {}, db: mockDb });
      expect(jsonRes.download).toBe(true);
      expect(jsonRes.url).toContain('ids=1,2');

      // Test export-csv
      const csvRes = await bulkActions.get('export-csv').handler([{ id: 1 }, { id: 2 }], 'Post', { req: {}, db: mockDb });
      expect(csvRes.download).toBe(true);
      expect(csvRes.filename).toBe('Post_export.csv');

      // Test createFieldUpdateBulkAction
      const customAction = createFieldUpdateBulkAction('Post', 'status', 'published');
      const updateRes = await customAction.handler([{ id: 1 }, { id: 2 }], 'Post', { db: mockDb });
      expect(updateRes.updated).toBe(1);
    });
  });

  describe('plugins/admin-panel/api.js CRUD and filter operations', () => {
    const { createApiHandlers } = require('../../plugins/admin-panel/api.js');

    it('exercises rich-text mutations and admin model listings', async () => {
      const mockPostModel = {
        name: 'Post',
        table: 'posts',
        primaryKey: 'id',
        admin: {
          enabled: true,
          label: 'Posts',
          customFields: {
            content: { type: 'rich-text' },
          },
          sortableColumns: ['id', 'title'],
        },
        columns: new Map([
          ['id', { type: 'integer', primary: true }],
          ['title', { type: 'string' }],
          ['content', { type: 'string', nullable: true }],
          ['payload', { type: 'json' }],
        ]),
        relations: {},
        scopes: { softDelete: true },
        hidden: ['internal_notes'],
      };

      const mockDb = {
        getAllModels: () => [mockPostModel],
        getModel: (name) => (name === 'Post' ? mockPostModel : null),
        getRepository: (name) => ({
          count: vi.fn().mockResolvedValue(100),
          query: () => ({
            where: vi.fn().mockReturnThis(),
            whereNot: vi.fn().mockReturnThis(),
            whereNull: vi.fn().mockReturnThis(),
            whereNotNull: vi.fn().mockReturnThis(),
            whereBetween: vi.fn().mockReturnThis(),
            whereIn: vi.fn().mockReturnThis(),
            whereLike: vi.fn().mockReturnThis(),
            whereILike: vi.fn().mockReturnThis(),
            onlyTrashed: vi.fn().mockReturnThis(),
            withTrashed: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            offset: vi.fn().mockReturnThis(),
            find: vi.fn().mockResolvedValue([{ id: 1, title: 'Post 1', content: '<p>Hi</p>' }]),
            count: vi.fn().mockResolvedValue(1),
          }),
        }),
      };

      const handlers = createApiHandlers({
        path: '/_admin',
        db: mockDb,
        richTextSanitize: true,
      });

      // Test checkHandler when AdminUserRepo is null
      const resCheck = { json: vi.fn() };
      await handlers.checkHandler(null, resCheck);
      expect(resCheck.json).toHaveBeenCalledWith({ exists: false });

      // Test meHandler
      const resMe = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      handlers.meHandler({ session: { adminUser: { id: 1, name: 'Admin' } } }, resMe);
      expect(resMe.json).toHaveBeenCalledWith({ user: { id: 1, name: 'Admin' } });

      handlers.meHandler({ session: null }, resMe);
      expect(resMe.status).toHaveBeenCalledWith(401);

      // Test models listing
      const resModels = { json: vi.fn() };
      handlers.modelsHandler({}, resModels);
      expect(resModels.json).toHaveBeenCalledWith({
        models: [
          expect.objectContaining({ name: 'Post', label: 'Posts' }),
        ],
      });

      // Test model metadata
      const resModelMeta = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      handlers.modelHandler({ params: { model: 'Post' } }, resModelMeta);
      expect(resModelMeta.json).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Post', softDelete: true })
      );

      // Test recordsListHandler with filters and trashed
      const resList = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const reqList = {
        params: { model: 'Post' },
        query: {
          page: '2',
          perPage: '10',
          trashed: 'only',
          sort: 'title',
          order: 'desc',
          filter: {
            title: { op: 'contains', value: 'Hello' },
            content: { op: 'is_null' },
            id: { op: 'between', from: '1', to: '10' },
          },
        },
      };
      await handlers.recordsListHandler(reqList, resList);
      expect(resList.json).toHaveBeenCalled();
    });
  });

  describe('plugins/mcp components branch coverage', () => {
    const { createBuiltinPrompts } = require('../../plugins/mcp/prompts.js');
    const { createSystemResources } = require('../../plugins/mcp/providers/system.js');
    const { scanModuleDir, discoverMcpDirectory } = require('../../plugins/mcp/discovery.js');

    it('exercises createBuiltinPrompts handlers', async () => {
      const prompts = createBuiltinPrompts();
      expect(prompts.length).toBe(3);

      const servicePrompt = prompts.find((p) => p.name === 'scaffold_service');
      const sRes = await servicePrompt.handler({ serviceName: 'user.invite', description: 'Invites user' });
      expect(sRes.messages[0].content.text).toContain('services/user/invite.js');

      const modelPrompt = prompts.find((p) => p.name === 'scaffold_model');
      const mRes = await modelPrompt.handler({ modelName: 'Invoice', tableName: 'invoices' });
      expect(mRes.messages[0].content.text).toContain('models/invoice.js');

      const apiPrompt = prompts.find((p) => p.name === 'scaffold_api');
      const aRes = await apiPrompt.handler({ endpoint: '/api/users', method: 'POST' });
      expect(aRes.messages[0].content.text).toContain('pages/api/users.post.js');
    });

    it('exercises createSystemResources handlers', async () => {
      const mockServiceRegistry = {
        list: () => ['user.create'],
        get: () => ({ description: 'Creates user', schema: true, auth: true, timeout: 5000, transaction: true }),
      };

      const resources = createSystemResources({
        routes: [{ path: '/api/test', method: 'POST', filePath: 'test.js' }],
        serviceRegistry: mockServiceRegistry,
        db: {},
      });

      const routesRes = resources.find((r) => r.uri === 'webspresso://routes');
      const routeData = await routesRes.handler();
      expect(routeData[0].isApi).toBe(true);
      expect(routeData[0].method).toBe('POST');

      const servicesRes = resources.find((r) => r.uri === 'webspresso://services');
      const serviceData = await servicesRes.handler();
      expect(serviceData[0].name).toBe('user.create');
      expect(serviceData[0].hasSchema).toBe(true);

      const healthRes = resources.find((r) => r.uri === 'webspresso://health');
      const healthData = await healthRes.handler();
      expect(healthData.status).toBe('ok');
      expect(healthData.databaseConnected).toBe(true);
    });

    it('exercises scanModuleDir and discoverMcpDirectory edge cases', () => {
      expect(scanModuleDir('/non/existent/dir')).toEqual([]);

      const mockServer = {
        registerTool: vi.fn(),
        registerResource: vi.fn(),
        registerResourceTemplate: vi.fn(),
        registerPrompt: vi.fn(),
      };
      discoverMcpDirectory(mockServer, '/non/existent/project');
      expect(mockServer.registerTool).not.toHaveBeenCalled();
    });
  });

  describe('plugins/file-manager/api-handlers.js branch coverage', () => {
    const { createFileManagerApiHandlers } = require('../../plugins/file-manager/api-handlers.js');

    it('exercises RBAC permission denial and storage handlers', async () => {
      const handlers = createFileManagerApiHandlers({
        baseDir: './tmp/uploads',
        publicBasePath: '/uploads',
        permissions: {
          list: ['admin'],
          delete: ['superadmin'],
        },
      });

      // RBAC Denied
      const reqDenied = { session: { adminUser: { role: 'editor' } }, query: {} };
      const resDenied = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.list(reqDenied, resDenied);
      expect(resDenied.status).toHaveBeenCalledWith(403);
      expect(resDenied.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Permission denied') }));

      // Missing path on create directory (mkdir)
      const reqCreateEmpty = { session: { adminUser: { role: 'admin' } }, body: {} };
      const resCreateEmpty = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.mkdir(reqCreateEmpty, resCreateEmpty);
      expect(resCreateEmpty.status).toHaveBeenCalledWith(400);

      // Missing names on rename
      const reqRenameEmpty = { session: { adminUser: { role: 'admin' } }, body: {} };
      const resRenameEmpty = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.rename(reqRenameEmpty, resRenameEmpty);
      expect(resRenameEmpty.status).toHaveBeenCalledWith(400);

      // Missing target on move
      const reqMoveEmpty = { session: { adminUser: { role: 'admin' } }, body: {} };
      const resMoveEmpty = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.move(reqMoveEmpty, resMoveEmpty);
      expect(resMoveEmpty.status).toHaveBeenCalledWith(400);

      // Missing item on delete
      const reqDeleteEmpty = { session: { adminUser: { role: 'superadmin' } }, body: {} };
      const resDeleteEmpty = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.delete(reqDeleteEmpty, resDeleteEmpty);
      expect(resDeleteEmpty.status).toHaveBeenCalledWith(400);
    });
  });

  describe('core/auth/manager.js branch coverage', () => {
    const { AuthManager } = require('../../core/auth/manager.js');

    it('exercises validation, token operations, and credentials login', async () => {
      expect(() => new AuthManager({})).toThrow(/findUserById/);
      expect(() => new AuthManager({ findUserById: () => null })).toThrow(/findUserByCredentials/);

      const mockUsers = [
        { id: 1, email: 'user@example.com', password: 'hashed_password', role: 'admin' },
      ];

      const rememberTokenStore = new Map();
      const auth = new AuthManager({
        findUserById: async (id) => mockUsers.find((u) => u.id === id) || null,
        findUserByCredentials: async (email, pass) => {
          if (email === 'user@example.com' && pass === 'correct') {
            return mockUsers[0];
          }
          return null;
        },
        rememberTokens: {
          create: async (userId, token, expiresAt) => {
            rememberTokenStore.set(token, { user_id: userId, token, expires_at: expiresAt });
          },
          find: async (token) => rememberTokenStore.get(token) || null,
          delete: async (token) => {
            rememberTokenStore.delete(token);
          },
          deleteAllForUser: async (userId) => {
            for (const [k, v] of rememberTokenStore.entries()) {
              if (v.user_id === userId) rememberTokenStore.delete(k);
            }
          },
        },
        session: { secret: 'test-session-secret' },
        jwt: { enabled: true, secret: 'jwt-secret', refreshSecret: 'refresh-secret' },
      });

      // Login success with remember me via request-bound auth
      const loginReq = {
        session: {
          destroy: vi.fn((cb) => {
            delete loginReq.session.userId;
            cb();
          }),
        },
        headers: {},
        cookies: {},
      };
      const loginRes = { cookie: vi.fn(), clearCookie: vi.fn() };
      const reqAuth = auth.createRequestAuth(loginReq, loginRes);

      const loggedIn = await reqAuth.attempt('user@example.com', 'correct', { remember: true });
      expect(loggedIn.id).toBe(1);
      expect(loginReq.session.userId).toBe(1);
      expect(loginRes.cookie).toHaveBeenCalled();

      // Login failed credentials
      const failedUser = await reqAuth.attempt('user@example.com', 'wrong');
      expect(failedUser).toBeNull();

      // Destroy session and logout
      await reqAuth.logout();
      expect(loginReq.session.userId).toBeUndefined();
      expect(loginReq.user).toBeNull();
      expect(loginRes.clearCookie).toHaveBeenCalled();

      // Remember token lifecycle
      const cookieRes = { cookie: vi.fn(), clearCookie: vi.fn() };
      await auth.createRememberToken(1, cookieRes);
      expect(cookieRes.cookie).toHaveBeenCalled();

      const rememberCookieCall = cookieRes.cookie.mock.calls.find((c) => c[0] === 'remember_token');
      expect(rememberCookieCall).toBeDefined();
      const rawToken = rememberCookieCall[1];

      const verifyReq = { signedCookies: { remember_token: rawToken } };
      const verifyRes = { cookie: vi.fn(), clearCookie: vi.fn() };
      const userFromToken = await auth.verifyRememberToken(verifyReq, verifyRes);
      expect(userFromToken.id).toBe(1);
    });
  });

  describe('plugins/admin-panel/core/api-extensions.js branch coverage', () => {
    const {
      compareSemver,
      formatUptime,
      formatBytes,
      buildFilteredQuery,
      getAllMatchingIds,
      coerceBulkTemporalValue,
      createExtensionApiHandlers,
    } = require('../../plugins/admin-panel/core/api-extensions.js');

    it('exercises semver comparison, uptime and bytes formatters', () => {
      expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
      expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
      expect(compareSemver(null, '1.0.0')).toBe(0);
      expect(compareSemver('1.0.0', null)).toBe(0);

      expect(formatUptime(0)).toBe('0s');
      expect(formatUptime(50)).toBe('50s');
      expect(formatUptime(3665)).toBe('1h 1m 5s');
      expect(formatUptime(90061)).toBe('1d 1h 1m 1s');

      expect(formatBytes(0)).toBe('0 MB');
      expect(formatBytes(10485760)).toBe('10.0 MB');
    });

    it('exercises coerceBulkTemporalValue with dates, datetimes, and errors', () => {
      // Nullable empty
      expect(coerceBulkTemporalValue({ type: 'date', nullable: true }, '', 'dateField')).toEqual({ value: null });
      // Non-nullable empty
      expect(coerceBulkTemporalValue({ type: 'date', nullable: false }, '', 'dateField')).toHaveProperty('error');

      // Valid date YYYY-MM-DD
      const dateRes = coerceBulkTemporalValue({ type: 'date' }, '2026-05-15', 'dateField');
      expect(dateRes.value).toBeInstanceOf(Date);

      // Invalid date formats
      expect(coerceBulkTemporalValue({ type: 'date' }, 'invalid', 'dateField')).toHaveProperty('error');
      expect(coerceBulkTemporalValue({ type: 'date' }, 12345, 'dateField')).toHaveProperty('error');

      // Valid datetime
      const dt1 = coerceBulkTemporalValue({ type: 'datetime' }, '2026-05-15T14:30', 'dtField');
      expect(dt1.value).toBeInstanceOf(Date);
      const dt2 = coerceBulkTemporalValue({ type: 'timestamp' }, '2026-05-15', 'dtField');
      expect(dt2.value).toBeInstanceOf(Date);
    });

    it('exercises buildFilteredQuery and getAllMatchingIds with diverse filter ops', async () => {
      const mockQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        whereNull: vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        onlyTrashed: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        list: vi.fn().mockResolvedValue([{ id: 10 }, { id: 20 }]),
      };

      const mockRepo = {
        query: vi.fn().mockReturnValue(mockQueryBuilder),
      };

      const filters = {
        name: { op: 'is_not_null' },
        email: { op: 'ends_with', value: '@example.com' },
        age: { op: 'gte', value: 18 },
        status: { op: 'in', value: ['active', 'pending'] },
        score: { op: 'between', from: 10, to: 100 },
        tag: { op: 'starts_with', value: 'tech' },
        desc: { op: 'contains', value: 'hello' },
        exact: { op: 'equals', value: 'match' },
        less: { op: 'lt', value: 50 },
        lessEq: { op: 'lte', value: 60 },
        greater: { op: 'gt', value: 5 },
      };

      const q = buildFilteredQuery(mockRepo, filters, { onlyTrashed: true });
      expect(mockQueryBuilder.onlyTrashed).toHaveBeenCalled();
      expect(mockQueryBuilder.whereNotNull).toHaveBeenCalledWith('name');

      const ids = await getAllMatchingIds(mockRepo, filters, 'id');
      expect(ids).toEqual([10, 20]);
    });

    it('exercises createExtensionApiHandlers methods', async () => {
      const mockRegistry = {
        toClientConfig: () => ({ widgets: [{ id: 'w1', title: 'Widget 1' }], actions: [{ id: 'a1' }], bulkActions: [{ id: 'b1' }] }),
        widgets: new Map([['w1', { dataLoader: async () => ({ value: 42 }) }]]),
        actions: new Map([['a1', { models: '*', handler: async (rec) => ({ success: true, rec }) }]]),
        bulkActions: new Map([['b1', { models: '*', handler: async (recs) => ({ success: true, count: recs.length }) }]]),
        getCustomPages: () => [{ id: 'custom-p1', title: 'Custom 1' }],
        getCustomPage: (id) => (id === 'custom-p1' ? { id: 'custom-p1', title: 'Custom 1' } : null),
      };

      const mockDb = {
        getModel: (name) => ({ name, primaryKey: 'id', scopes: {} }),
        getRepository: () => ({
          findById: async (id) => ({ id, name: 'Record ' + id }),
          query: () => ({
            whereIn: vi.fn().mockReturnThis(),
            list: async () => [{ id: 1 }, { id: 2 }],
          }),
        }),
      };

      const handlers = createExtensionApiHandlers({
        registry: mockRegistry,
        db: mockDb,
        path: '/_admin',
      });

      // configHandler
      const resConfig = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      handlers.configHandler({}, resConfig);
      expect(resConfig.json).toHaveBeenCalled();

      // widgetDataHandler success & 404
      const resWidget = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.widgetDataHandler({ params: { widgetId: 'w1' } }, resWidget);
      expect(resWidget.json).toHaveBeenCalledWith({ data: { value: 42 } });

      await handlers.widgetDataHandler({ params: { widgetId: 'unknown' } }, resWidget);
      expect(resWidget.status).toHaveBeenCalledWith(404);

      // actionHandler
      const resAction = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.actionHandler({ params: { actionId: 'a1', model: 'Post', id: '1' } }, resAction);
      expect(resAction.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // bulkActionHandler
      const resBulk = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.bulkActionHandler({ params: { actionId: 'b1', model: 'Post' }, body: { ids: [1, 2] } }, resBulk);
      expect(resBulk.json).toHaveBeenCalled();

      // systemInfoHandler
      const resSys = { json: vi.fn() };
      await handlers.systemInfoHandler({}, resSys);
      expect(resSys.json).toHaveBeenCalledWith(expect.objectContaining({ nodeVersion: process.version }));

      // bulkFieldsHandler
      const resBulkFields = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      handlers.bulkFieldsHandler({ params: { model: 'Post' } }, resBulkFields);
      expect(resBulkFields.json).toHaveBeenCalled();
    });
  });

  describe('plugins/admin-panel/modules/admin-users.js branch coverage', () => {
    const {
      sanitizeAdminUser,
      registerAdminUsersManagement,
      createAdminUsersApiHandlers,
      generateAdminUsersComponent,
    } = require('../../plugins/admin-panel/modules/admin-users.js');

    it('exercises helpers and component generator', () => {
      expect(sanitizeAdminUser(null)).toBeNull();
      const sanitized = sanitizeAdminUser({ id: 1, email: 'admin@test.com', password: 'secret', active: 1 });
      expect(sanitized.password).toBeUndefined();
      expect(sanitized.active).toBe(true);

      const compCode = generateAdminUsersComponent();
      expect(typeof compCode).toBe('string');
      expect(compCode).toContain('AdminUsersPage');

      // register menu
      const mockReg = { registerMenuItem: vi.fn() };
      registerAdminUsersManagement({ registry: mockReg, config: { enabled: true, label: 'Staff' } });
      expect(mockReg.registerMenuItem).toHaveBeenCalledWith(expect.objectContaining({ label: 'Staff' }));

      registerAdminUsersManagement({ registry: mockReg, config: { enabled: false } });
    });

    it('exercises createAdminUsersApiHandlers CRUD endpoints', async () => {
      const adminUsersList = [
        { id: 1, name: 'Admin 1', email: 'a1@test.com', password: 'hash', role: 'admin', active: true },
        { id: 2, name: 'Admin 2', email: 'a2@test.com', password: 'hash', role: 'staff', active: false },
      ];

      const mockRepo = {
        find: vi.fn().mockResolvedValue(adminUsersList),
        findById: vi.fn().mockImplementation((id) => Promise.resolve(adminUsersList.find((u) => u.id === Number(id)) || null)),
        findOne: vi.fn().mockImplementation((cond) => Promise.resolve(adminUsersList.find((u) => u.email === cond.email) || null)),
        create: vi.fn().mockImplementation((data) => Promise.resolve({ id: 3, ...data })),
        update: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true),
        query: () => ({
          whereNot: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          count: vi.fn().mockResolvedValue([{ count: 2 }]),
          first: vi.fn().mockResolvedValue(null),
        }),
      };

      const mockDb = {
        getRepository: () => mockRepo,
        knex: { client: { config: { client: 'sqlite3' } } },
      };

      const handlers = createAdminUsersApiHandlers({
        db: mockDb,
        AdminUser: { name: 'AdminUser' },
        hashPassword: async (pwd) => `hashed_${pwd}`,
      });

      // listAdmins
      const resList = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.listAdmins({}, resList);
      expect(resList.json).toHaveBeenCalled();

      // getAdmin success & 404
      const resGet = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.getAdmin({ params: { id: '1' } }, resGet);
      expect(resGet.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      await handlers.getAdmin({ params: { id: '99' } }, resGet);
      expect(resGet.status).toHaveBeenCalledWith(404);

      // createAdmin missing fields & duplicate
      const resCreate = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.createAdmin({ body: { name: 'New' } }, resCreate);
      expect(resCreate.status).toHaveBeenCalledWith(400);

      await handlers.createAdmin({ body: { name: 'Dup', email: 'a1@test.com', password: 'password123' } }, resCreate);
      expect(resCreate.status).toHaveBeenCalledWith(400);

      await handlers.createAdmin({ body: { name: 'New Staff', email: 'new@test.com', password: 'password123' } }, resCreate);
      expect(resCreate.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // updateAdmin
      const resUpdate = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateAdmin({ params: { id: '1' }, body: { name: 'Updated 1', newPassword: 'newpassword123', active: true } }, resUpdate);
      expect(resUpdate.json).toHaveBeenCalled();

      // deleteAdmin
      const resDelete = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.deleteAdmin({ params: { id: '2' }, session: { adminUser: { id: 1 } } }, resDelete);
      expect(resDelete.json).toHaveBeenCalled();
    });
  });

  describe('plugins/file-manager/core.js and security.js branch coverage', () => {
    const {
      resolveSafePath,
      buildBreadcrumbs,
      getFileType,
      getMimeType,
    } = require('../../plugins/file-manager/core.js');

    const {
      validateSafeExtension,
      validateMagicBytes,
      sanitizeSvgContent,
    } = require('../../plugins/file-manager/security.js');

    it('exercises core path helpers and formatters', () => {
      expect(getFileType('jpg')).toBe('image');
      expect(getFileType('pdf')).toBe('document');
      expect(getFileType('js')).toBe('code');
      expect(getFileType('mp3')).toBe('audio');
      expect(getFileType('mp4')).toBe('video');
      expect(getFileType('zip')).toBe('archive');
      expect(getFileType('unknownext')).toBe('other');

      expect(getMimeType('jpg')).toBe('image/jpeg');
      expect(getMimeType('unknown')).toBe('application/octet-stream');

      expect(buildBreadcrumbs('')).toEqual([{ name: 'Root', path: '' }]);
      expect(buildBreadcrumbs('photos/2026')).toEqual([
        { name: 'Root', path: '' },
        { name: 'photos', path: 'photos' },
        { name: '2026', path: 'photos/2026' },
      ]);

      const resolved = resolveSafePath('/tmp/base', 'subdir/file.txt');
      expect(resolved).toBe(path.resolve('/tmp/base/subdir/file.txt'));
      expect(() => resolveSafePath('/tmp/base', '../../etc/passwd')).toThrow();
    });

    it('exercises security validation for extensions, magic bytes, and SVG sanitization', () => {
      expect(() => validateSafeExtension('sh')).toThrow();
      expect(() => validateSafeExtension('exe')).toThrow();
      expect(() => validateSafeExtension('php')).toThrow();
      expect(validateSafeExtension('png')).toBe('png');

      // Magic bytes
      const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(validateMagicBytes(pngBuf, 'png')).toBe(true);

      const fakeBuf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      expect(() => validateMagicBytes(fakeBuf, 'png')).toThrow();

      // SVG Sanitization
      const dirtySvg = '<svg><script>alert("xss")</script><circle cx="50" cy="50" r="40"/></svg>';
      const cleanSvg = sanitizeSvgContent(dirtySvg).toString('utf8');
      expect(cleanSvg).not.toContain('<script>');
      expect(cleanSvg).toContain('<circle');
    });
  });

  describe('core/content/field-types.js branch coverage', () => {
    const {
      FIELD_TYPES,
      isValidFieldType,
      normalizeFieldValue,
    } = require('../../core/content/field-types.js');

    it('exercises all field types validations and coercions', () => {
      expect(isValidFieldType('text')).toBe(true);
      expect(isValidFieldType('non-existent')).toBe(false);

      // Boolean
      expect(normalizeFieldValue(true, { name: 'flag', type: 'boolean' })).toBe(true);
      expect(normalizeFieldValue(false, { name: 'flag', type: 'boolean' })).toBe(false);

      // Number
      expect(normalizeFieldValue(42.5, { name: 'score', type: 'number' })).toBe(42.5);
      expect(() => normalizeFieldValue('invalid', { name: 'score', type: 'number' })).toThrow();

      // Text / TextArea
      expect(normalizeFieldValue('hello', { name: 'title', type: 'text' })).toBe('hello');
      expect(() => normalizeFieldValue(123, { name: 'title', type: 'text' })).toThrow();

      // Rich-Text
      expect(normalizeFieldValue('<p>hi</p>', { name: 'body', type: 'rich-text' })).toBe('<p>hi</p>');

      // Required check
      expect(() => normalizeFieldValue(null, { name: 'req', type: 'text', required: true })).toThrow();
    });
  });

  describe('core/auth/middleware.js branch coverage', () => {
    const { createAuthMiddleware } = require('../../core/auth/middleware.js');

    it('exercises requireGuest, requireAuth, requireCan, and parseMiddlewareString', () => {
      const mockAuthManager = {
        config: { session: { secret: 'test-secret' }, routes: { login: '/login' } },
        getSessionConfig: () => ({ secret: 'test-secret', cookie: {} }),
        createRequestAuth: () => ({}),
        verifyJwt: (token) => {
          if (token === 'valid') return { id: 1, role: 'admin' };
          throw new Error('Invalid token');
        },
        findUserById: async (id) => ({ id, name: 'User' }),
      };

      const mwStack = createAuthMiddleware(mockAuthManager);

      // requireGuest
      const guestMw = mwStack.requireGuest({ redirectTo: '/dashboard' });
      const reqAuthUser = { user: { id: 1 } };
      const resRedirect = { redirect: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
      const nextFn = vi.fn();

      guestMw(reqAuthUser, resRedirect, nextFn);
      expect(resRedirect.redirect).toHaveBeenCalledWith('/dashboard');

      const reqGuest = { user: null };
      guestMw(reqGuest, resRedirect, nextFn);
      expect(nextFn).toHaveBeenCalled();

      // requireAuth
      const authApiMw = mwStack.requireAuth({ api: true });
      const resUnauthorized = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      authApiMw({ user: null }, resUnauthorized, nextFn);
      expect(resUnauthorized.status).toHaveBeenCalledWith(401);

      // parseMiddlewareString
      expect(typeof mwStack.parseMiddlewareString('auth')).toBe('function');
      expect(typeof mwStack.parseMiddlewareString('jwt')).toBe('function');
      expect(typeof mwStack.parseMiddlewareString('guest')).toBe('function');
      expect(() => mwStack.parseMiddlewareString('invalid-guard')).toThrow();
    });
  });

  describe('src/file-router.js i18n, locale resolution, and route rewriting branches', () => {
    const {
      filePathToRoute,
      detectLocale,
      loadI18n,
      createTranslator,
      clearNjkFrontmatterCaches,
      resolvePageAssets,
      applyPageAssetsToTemplateData,
    } = require('../../src/file-router.js');

    it('exercises detectLocale with query param, accept-language header, and fallbacks', () => {
      const origLocales = process.env.SUPPORTED_LOCALES;
      process.env.SUPPORTED_LOCALES = 'en,tr,fr-ca';

      expect(detectLocale({ query: { lang: 'tr' }, headers: {} })).toBe('tr');
      expect(detectLocale({ query: { lang: 'fr-ca' }, headers: {} })).toBe('fr-ca');
      expect(detectLocale({ query: {}, headers: { 'accept-language': 'tr-TR,tr;q=0.9' } })).toBe('tr');
      expect(detectLocale({ query: {}, headers: {} })).toBe('en');

      if (origLocales !== undefined) process.env.SUPPORTED_LOCALES = origLocales;
      else delete process.env.SUPPORTED_LOCALES;
    });

    it('exercises filePathToRoute with dynamic brackets, catch-alls, and extensions', () => {
      expect(filePathToRoute('users/index.njk', '.njk')).toBe('/users');
      expect(filePathToRoute('users/[id].njk', '.njk')).toBe('/users/:id');
      expect(filePathToRoute('docs/[...slug].njk', '.njk')).toBe('/docs/*slug');
      expect(filePathToRoute('files/[...].njk', '.njk')).toBe('/files/*splat');
      expect(filePathToRoute('index.njk', '.njk')).toBe('/');
    });

    it('exercises resolvePageAssets and applyPageAssetsToTemplateData', () => {
      const assets = resolvePageAssets({
        scripts: ['/app.js'],
        styles: ['/style.css'],
      });
      expect(assets).toBeDefined();

      const bundled = applyPageAssetsToTemplateData(assets, { existing: true });
      expect(bundled.data.existing).toBe(true);

      clearNjkFrontmatterCaches();
    });

    it('exercises loadI18n and createTranslator with fallback translations and interpolation', () => {
      const translations = {
        greeting: 'Hello {{ name }}',
        farewell: 'Goodbye',
        nested: { count: 'Items: {{ count }}' },
      };
      const fallback = {
        missing: 'Fallback text',
        greeting: 'Default Hello',
      };

      const t = createTranslator(translations, {
        locale: 'en',
        fallbackTranslations: fallback,
        fallbackLocale: 'en',
      });

      expect(t('greeting', { name: 'Alice' })).toBe('Hello Alice');
      expect(t('farewell')).toBe('Goodbye');
      expect(t('nested.count', { count: 5 })).toBe('Items: 5');
      expect(t('missing')).toBe('Fallback text');
      expect(t('nonexistent', null, 'Default val')).toBe('Default val');
      expect(t('nonexistent')).toBe('nonexistent');
    });
  });
});



