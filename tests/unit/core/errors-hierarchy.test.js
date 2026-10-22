/**
 * Unit tests for Webspresso Error Hierarchy, Normalizer, and Central Error Middleware
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { WebspressoError } = require('../../../core/errors/base');
const {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  UnprocessableEntityError,
  TooManyRequestsError,
} = require('../../../core/errors/http');
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
} = require('../../../core/errors/domain');
const {
  getStatusTitle,
  normalizeError,
  toErrorResponseObject,
} = require('../../../core/errors/normalize');
const {
  preferJsonErrorResponse,
  renderDefaultErrorHtml,
  createCentralErrorHandler,
} = require('../../../core/errors/middleware');
const {
  createMockReq,
  createMockSpyRes: createMockRes,
  createMockSpyNext
} = require('../../utils');

describe('Error Hierarchy & Domain Exceptions', () => {
  describe('WebspressoError & Base Classes', () => {
    it('instantiates WebspressoError with code, details, cause, and status', () => {
      const cause = new Error('Root reason');
      const err = new WebspressoError('Custom failed', {
        code: 'CUSTOM_CODE',
        details: { foo: 'bar' },
        cause,
        status: 418,
      });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(WebspressoError);
      expect(err.name).toBe('WebspressoError');
      expect(err.message).toBe('Custom failed');
      expect(err.code).toBe('CUSTOM_CODE');
      expect(err.details).toEqual({ foo: 'bar' });
      expect(err.cause).toBe(cause);
      expect(err.status).toBe(418);
    });

    it('instantiates HttpError with proper expose flag and headers', () => {
      const err400 = new HttpError(400, 'Invalid', {
        headers: { 'X-Custom': 'value' },
      });
      expect(err400.status).toBe(400);
      expect(err400.expose).toBe(true);
      expect(err400.headers).toEqual({ 'X-Custom': 'value' });

      const err500 = new HttpError(500, 'Crash');
      expect(err500.status).toBe(500);
      expect(err500.expose).toBe(false);

      const errExposed500 = new HttpError(500, 'Crash', { expose: true });
      expect(errExposed500.expose).toBe(true);

      const defaultErr = new HttpError('invalid-status');
      expect(defaultErr.status).toBe(500);
    });

    it('instantiates all HTTP 4xx sub-classes with correct defaults', () => {
      expect(new BadRequestError().status).toBe(400);
      expect(new BadRequestError().code).toBe('BAD_REQUEST');

      expect(new UnauthorizedError().status).toBe(401);
      expect(new UnauthorizedError().code).toBe('UNAUTHORIZED');

      expect(new ForbiddenError().status).toBe(403);
      expect(new ForbiddenError().code).toBe('FORBIDDEN');

      expect(new NotFoundError().status).toBe(404);
      expect(new NotFoundError().code).toBe('NOT_FOUND');

      expect(new MethodNotAllowedError().status).toBe(405);
      expect(new MethodNotAllowedError().code).toBe('METHOD_NOT_ALLOWED');

      expect(new ConflictError().status).toBe(409);
      expect(new ConflictError().code).toBe('CONFLICT');

      expect(new PayloadTooLargeError().status).toBe(413);
      expect(new PayloadTooLargeError().code).toBe('PAYLOAD_TOO_LARGE');

      expect(new UnsupportedMediaTypeError().status).toBe(415);
      expect(new UnsupportedMediaTypeError().code).toBe('UNSUPPORTED_MEDIA_TYPE');

      expect(new UnprocessableEntityError().status).toBe(422);
      expect(new UnprocessableEntityError().code).toBe('UNPROCESSABLE_ENTITY');

      expect(new TooManyRequestsError().status).toBe(429);
      expect(new TooManyRequestsError().code).toBe('TOO_MANY_REQUESTS');
    });

    it('instantiates domain error sub-classes properly', () => {
      const valErr = new ValidationError('Bad input', {
        fields: { email: 'Invalid format' },
      });
      expect(valErr.status).toBe(422);
      expect(valErr.code).toBe('VALIDATION_ERROR');
      expect(valErr.fields).toEqual({ email: 'Invalid format' });
      expect(valErr.expose).toBe(true);

      const cfgErr = new ConfigurationError('Missing DB config');
      expect(cfgErr.code).toBe('CONFIGURATION_ERROR');
      expect(cfgErr.status).toBe(500);

      const plugErr = new PluginError('Plugin failed', { plugin: 'analytics' });
      expect(plugErr.plugin).toBe('analytics');
      expect(plugErr.status).toBe(500);

      const secErr = new SecurityError('CSRF token invalid');
      expect(secErr.status).toBe(400);
      expect(secErr.expose).toBe(false);

      const reqErr = new RequestError(400, 'Malformed');
      expect(reqErr.status).toBe(400);

      const abortErr = new RequestAbortedError();
      expect(abortErr.status).toBe(499);
      expect(abortErr.code).toBe('REQUEST_ABORTED');

      const routerErr = new RouterError('Route error');
      expect(routerErr).toBeInstanceOf(WebspressoError);

      const notFoundErr = new RouteNotFoundError('/admin/secret');
      expect(notFoundErr.status).toBe(404);
      expect(notFoundErr.message).toBe('Route not found: /admin/secret');
      expect(notFoundErr.path).toBe('/admin/secret');

      const genericNotFound = new RouteNotFoundError('Custom 404 message');
      expect(genericNotFound.message).toBe('Custom 404 message');

      const routeGenErr = new RouteGenerationError('Missing param');
      expect(routeGenErr.code).toBe('ROUTE_GENERATION_ERROR');
    });
  });

  describe('normalizeError', () => {
    it('returns internal server error for nullish errors', () => {
      const errNull = normalizeError(null);
      expect(errNull.status).toBe(500);
      expect(errNull.expose).toBe(false);

      const errUndef = normalizeError(undefined);
      expect(errUndef.status).toBe(500);
    });

    it('returns WebspressoError as is', () => {
      const original = new BadRequestError('Bad input');
      expect(normalizeError(original)).toBe(original);
    });

    it('normalizes standard JS Error to HttpError with status and stack', () => {
      const jsErr = new TypeError('Cannot read property');
      jsErr.statusCode = 400;
      jsErr.route = '/users';
      jsErr.method = 'GET';
      jsErr.source = 'handler.js';
      jsErr.module = 'user';
      jsErr.phase = 'execute';
      jsErr.requestId = 'req_123';

      const normalized = normalizeError(jsErr, false);
      expect(normalized).toBeInstanceOf(HttpError);
      expect(normalized.status).toBe(400);
      expect(normalized.route).toBe('/users');
      expect(normalized.method).toBe('GET');
      expect(normalized.source).toBe('handler.js');
      expect(normalized.requestId).toBe('req_123');
      expect(normalized.stack).toBe(jsErr.stack);
    });

    it('masks message in production for 500 standard error', () => {
      const crash = new Error('Database password leak in message');
      const prodNorm = normalizeError(crash, false);
      expect(prodNorm.message).toBe('Internal Server Error');

      const devNorm = normalizeError(crash, true);
      expect(devNorm.message).toBe('Database password leak in message');
    });

    it('normalizes primitives (string, number, boolean)', () => {
      const strErr = normalizeError('String error throw', false);
      expect(strErr.status).toBe(500);
      expect(strErr.message).toBe('Internal Server Error');

      const devStrErr = normalizeError('String error throw', true);
      expect(devStrErr.message).toBe('String error throw');

      const numErr = normalizeError(12345, true);
      expect(numErr.message).toBe('12345');
    });

    it('normalizes plain objects with status or message', () => {
      const objErr = { status: 403, message: 'Access denied' };
      const norm = normalizeError(objErr, false);
      expect(norm.status).toBe(403);
      expect(norm.message).toBe('Access denied');

      const obj500 = { statusCode: 500, message: 'Internal secret' };
      const norm500 = normalizeError(obj500, false);
      expect(norm500.status).toBe(500);
      expect(norm500.message).toBe('Internal Server Error');
    });

    it('normalizes unexpected objects fallback', () => {
      const weird = Object.create(null);
      const norm = normalizeError(weird);
      expect(norm.status).toBe(500);
    });
  });

  describe('getStatusTitle & toErrorResponseObject', () => {
    it('returns known status titles and fallback', () => {
      expect(getStatusTitle(404)).toBe('Not Found');
      expect(getStatusTitle(422)).toBe('Unprocessable Entity');
      expect(getStatusTitle(500)).toBe('Internal Server Error');
      expect(getStatusTitle(502)).toBe('Bad Gateway');
      expect(getStatusTitle(599)).toBe('Internal Server Error');
      expect(getStatusTitle(499)).toBe('Error');
    });

    it('formats safe JSON response in production mode', () => {
      const err = new HttpError(500, 'Sensitive DB error', {
        code: 'DB_CRASH',
        details: { table: 'users' },
      });

      const res = toErrorResponseObject(err, false);
      expect(res).toEqual({
        status: 500,
        error: 'Internal Server Error',
        message: 'Internal Server Error',
        code: 'DB_CRASH',
      });
      expect(res.stack).toBeUndefined();
      expect(res.details).toBeUndefined();
    });

    it('includes validation fields when present', () => {
      const err = new ValidationError('Invalid form', {
        fields: { username: 'Required' },
      });

      const res = toErrorResponseObject(err, false);
      expect(res.status).toBe(422);
      expect(res.error).toBe('Validation Error');
      expect(res.message).toBe('Invalid form');
      expect(res.fields).toEqual({ username: 'Required' });
    });

    it('includes trace, stack, and cause in development mode', () => {
      const cause = new Error('Root cause details');
      const err = new HttpError(500, 'Failed operation', {
        cause,
        details: { attempt: 3 },
      });
      err.route = '/items';
      err.method = 'POST';
      err.source = 'items.post.js';

      const res = toErrorResponseObject(err, true);
      expect(res.status).toBe(500);
      expect(res.message).toBe('Failed operation');
      expect(res.details).toEqual({ attempt: 3 });
      expect(res.trace).toEqual({
        route: '/items',
        method: 'POST',
        source: 'items.post.js',
      });
      expect(res.stack).toBeDefined();
      expect(res.cause).toBeDefined();
    });
  });

  describe('Central Error Handler Middleware', () => {
    it('preferJsonErrorResponse detects /api/, /_admin/api/, json accept, and xhr', () => {
      expect(preferJsonErrorResponse(createMockReq({ path: '/api/users' }))).toBe(true);
      expect(preferJsonErrorResponse(createMockReq({ path: '/_admin/api/files' }))).toBe(true);
      expect(preferJsonErrorResponse(createMockReq({ headers: { accept: 'application/json' } }))).toBe(true);
      expect(preferJsonErrorResponse(createMockReq({ headers: { 'x-requested-with': 'XMLHttpRequest' } }))).toBe(true);
      expect(preferJsonErrorResponse(createMockReq({ xhr: true }))).toBe(true);

      expect(preferJsonErrorResponse(createMockReq({ path: '/about', headers: { accept: 'text/html' } }))).toBe(false);
    });

    it('renders default error html with escapeHtml', () => {
      const err = new HttpError(404, 'Page <script>alert(1)</script> Not Found');
      const html = renderDefaultErrorHtml(err, false);
      expect(html).toContain('Error 404');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
    });

    it('skips handling if headersSent is true', async () => {
      const middleware = createCentralErrorHandler();
      const req = createMockReq();
      const res = createMockRes();
      res.headersSent = true;
      const next = createMockSpyNext();

      const err = new Error('Already started');
      await middleware(err, req, res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('ignores aborted requests without writing to socket', async () => {
      const middleware = createCentralErrorHandler();
      const req = createMockReq({ aborted: true });
      const res = createMockRes();
      const next = createMockSpyNext();

      await middleware(new RequestAbortedError(), req, res, next);
      expect(res.status).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('executes custom error handler and returns early if handled', async () => {
      const customHandler = vi.fn().mockResolvedValue(true);
      const middleware = createCentralErrorHandler({
        getCustomHandler: () => customHandler,
      });

      const req = createMockReq();
      const res = createMockRes();
      const next = createMockSpyNext();
      const err = new BadRequestError('Bad parameter');

      await middleware(err, req, res, next);
      expect(customHandler).toHaveBeenCalledWith(err, req, res, next);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('falls back if custom handler throws', async () => {
      const customHandler = vi.fn().mockRejectedValue(new Error('Handler crashed'));
      const middleware = createCentralErrorHandler({
        getCustomHandler: () => customHandler,
      });

      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockSpyNext();

      await middleware(new BadRequestError('Bad parameter'), req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
    });

    it('attaches headers and sends JSON for API requests', async () => {
      const middleware = createCentralErrorHandler({ isDev: false });
      const req = createMockReq({ path: '/api/v1/resource' });
      const res = createMockRes();
      const next = createMockSpyNext();

      const err = new HttpError(401, 'Unauthorized access', {
        headers: { 'WWW-Authenticate': 'Bearer' },
      });

      await middleware(err, req, res, next);
      expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        status: 401,
        error: 'Unauthorized',
        message: 'Unauthorized access',
      }));
    });

    it('uses custom renderHtmlError when provided and falls back to default html on failure', async () => {
      const renderHtml = vi.fn().mockResolvedValue('<h1>Custom Error Page</h1>');
      const middleware = createCentralErrorHandler({
        renderHtmlError: renderHtml,
      });

      const req = createMockReq({ path: '/profile' });
      const res = createMockRes();
      const next = createMockSpyNext();

      await middleware(new NotFoundError('User not found'), req, res, next);
      expect(renderHtml).toHaveBeenCalled();
      expect(res.send).toHaveBeenCalledWith('<h1>Custom Error Page</h1>');
    });
  });
});
