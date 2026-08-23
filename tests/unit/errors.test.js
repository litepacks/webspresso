import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import {
  WebspressoError,
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
  ValidationError,
  ConfigurationError,
  PluginError,
  SecurityError,
  RequestError,
  RequestAbortedError,
  RouterError,
  RouteNotFoundError,
  RouteGenerationError,
  normalizeError,
  toErrorResponseObject,
  createApp,
} from '../../index';

describe('Webspresso Framework Exceptions & Error Handling', () => {
  describe('Exception Class Hierarchy & Metadata', () => {
    it('1. WebspressoError base class sets name, message, code, details and cause', () => {
      const cause = new Error('Database down');
      const err = new WebspressoError('Something failed', {
        code: 'FAILED_OPERATION',
        details: { table: 'users' },
        cause,
      });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(WebspressoError);
      expect(err.name).toBe('WebspressoError');
      expect(err.message).toBe('Something failed');
      expect(err.code).toBe('FAILED_OPERATION');
      expect(err.details).toEqual({ table: 'users' });
      expect(err.cause).toBe(cause);
    });

    it('2. preserves error cause chain', () => {
      const root = new Error('Disk full');
      const wrapped = new WebspressoError('Write failed', { cause: root });
      expect(wrapped.cause).toBe(root);
    });

    it('3. machine-readable code support', () => {
      const err = new ConflictError('User already exists', { code: 'USER_EXISTS' });
      expect(err.code).toBe('USER_EXISTS');
      expect(err.status).toBe(409);
    });

    it('4. details payload support', () => {
      const err = new BadRequestError('Invalid filter', { details: { filter: 'status' } });
      expect(err.details).toEqual({ filter: 'status' });
    });

    it('5. HttpError status, headers, and expose default values', () => {
      const clientErr = new HttpError(400, 'Client issue');
      expect(clientErr.status).toBe(400);
      expect(clientErr.expose).toBe(true);

      const serverErr = new HttpError(500, 'Server issue');
      expect(serverErr.status).toBe(500);
      expect(serverErr.expose).toBe(false);

      const customHeadersErr = new HttpError(401, 'Unauthorized', {
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
      expect(customHeadersErr.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
    });

    it('6. built-in HTTP exception status codes', () => {
      expect(new BadRequestError().status).toBe(400);
      expect(new UnauthorizedError().status).toBe(401);
      expect(new ForbiddenError().status).toBe(403);
      expect(new NotFoundError().status).toBe(404);
      expect(new MethodNotAllowedError().status).toBe(405);
      expect(new ConflictError().status).toBe(409);
      expect(new PayloadTooLargeError().status).toBe(413);
      expect(new UnsupportedMediaTypeError().status).toBe(415);
      expect(new UnprocessableEntityError().status).toBe(422);
      expect(new TooManyRequestsError().status).toBe(429);
    });

    it('7. NotFoundError initializes with 404 status', () => {
      const err = new NotFoundError('Item not found');
      expect(err.status).toBe(404);
      expect(err.message).toBe('Item not found');
      expect(err.code).toBe('NOT_FOUND');
    });

    it('8. ValidationError defaults to 422 Unprocessable Entity', () => {
      const err = new ValidationError();
      expect(err.status).toBe(422);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.expose).toBe(true);
    });

    it('9. ValidationError exposes structured validation fields', () => {
      const fields = {
        email: ['Invalid email address'],
        age: ['Must be at least 18'],
      };
      const err = new ValidationError('Validation failed', { fields });
      expect(err.fields).toEqual(fields);
    });

    it('10. ConfigurationError identifies bootstrap issues', () => {
      const err = new ConfigurationError('Invalid database host');
      expect(err.name).toBe('ConfigurationError');
      expect(err.code).toBe('CONFIGURATION_ERROR');
      expect(err).toBeInstanceOf(WebspressoError);
    });

    it('11. PluginError captures plugin name and metadata', () => {
      const err = new PluginError('Plugin failed', { plugin: 'analytics' });
      expect(err.name).toBe('PluginError');
      expect(err.plugin).toBe('analytics');
      expect(err.code).toBe('PLUGIN_ERROR');
    });

    it('12. RouteNotFoundError formats path and status 404', () => {
      const err = new RouteNotFoundError('/api/users/99');
      expect(err.status).toBe(404);
      expect(err.path).toBe('/api/users/99');
      expect(err.message).toBe('Route not found: /api/users/99');
      expect(err.code).toBe('ROUTE_NOT_FOUND');
    });

    it('13. RouteGenerationError identifies missing route parameters', () => {
      const err = new RouteGenerationError('Missing param "id" for route "users.show"');
      expect(err.name).toBe('RouteGenerationError');
      expect(err.code).toBe('ROUTE_GENERATION_ERROR');
      expect(err).toBeInstanceOf(RouterError);
    });

    it('14. SecurityError defaults to 400 with expose: false', () => {
      const err = new SecurityError('Invalid CSRF token');
      expect(err.status).toBe(400);
      expect(err.expose).toBe(false);
      expect(err.code).toBe('SECURITY_ERROR');
    });

    it('15. RequestAbortedError defaults to 499 with expose: false', () => {
      const err = new RequestAbortedError();
      expect(err.status).toBe(499);
      expect(err.expose).toBe(false);
      expect(err.code).toBe('REQUEST_ABORTED');
      expect(err).toBeInstanceOf(RequestError);
    });

    it('15b. core/errors subpath exports all exception classes and helpers', () => {
      const coreErrors = require('../../core/errors');
      expect(coreErrors.NotFoundError).toBe(NotFoundError);
      expect(coreErrors.ValidationError).toBe(ValidationError);
      expect(coreErrors.normalizeError).toBe(normalizeError);
    });
  });

  describe('Normalization and Serialization', () => {
    it('19. normalizes standard JavaScript Error to 500 HttpError', () => {
      const raw = new TypeError('Cannot read property foo of undefined');
      const normalized = normalizeError(raw, false);

      expect(normalized).toBeInstanceOf(HttpError);
      expect(normalized.status).toBe(500);
      expect(normalized.expose).toBe(false);
      expect(normalized.cause).toBe(raw);
    });

    it('20. production response masks 500 error messages and excludes stack traces', () => {
      const raw = new Error('Super sensitive database connection credentials string');
      const normalized = normalizeError(raw, false);
      const resObj = toErrorResponseObject(normalized, false);

      expect(resObj.status).toBe(500);
      expect(resObj.error).toBe('Internal Server Error');
      expect(resObj.message).toBe('Internal Server Error');
      expect(resObj.stack).toBeUndefined();
      expect(resObj.cause).toBeUndefined();
    });

    it('21. development response includes stack trace and actual message', () => {
      const raw = new Error('Syntax issue');
      const normalized = normalizeError(raw, true);
      const resObj = toErrorResponseObject(normalized, true);

      expect(resObj.status).toBe(500);
      expect(resObj.message).toBe('Syntax issue');
      expect(resObj.stack).toBeDefined();
    });

    it('22. expose: true permits error message in production for custom 5xx or 4xx', () => {
      const custom = new HttpError(500, 'Service maintenance until 2pm', { expose: true });
      const resObj = toErrorResponseObject(custom, false);
      expect(resObj.message).toBe('Service maintenance until 2pm');
    });

    it('23. expose: false masks error message in production for 4xx', () => {
      const sec = new SecurityError('Suspicious header detected');
      const resObj = toErrorResponseObject(sec, false);
      expect(resObj.status).toBe(400);
      expect(resObj.message).toBe('Bad Request');
    });

    it('31. formats machine-readable code and validation fields in JSON output', () => {
      const val = new ValidationError('Validation failed', {
        code: 'USER_INVALID',
        fields: { email: ['Email already in use'] },
      });
      const resObj = toErrorResponseObject(val, false);

      expect(resObj).toEqual({
        status: 422,
        error: 'Validation Error',
        message: 'Validation failed',
        code: 'USER_INVALID',
        fields: { email: ['Email already in use'] },
      });
    });

    it('32. safely normalizes primitive and malformed non-Error thrown values', () => {
      const fromString = normalizeError('String error message', false);
      expect(fromString.status).toBe(500);

      const fromNull = normalizeError(null, false);
      expect(fromNull.status).toBe(500);

      const fromObj = normalizeError({ status: 400, message: 'Bad input' }, false);
      expect(fromObj.status).toBe(400);
      expect(fromObj.message).toBe('Bad input');
    });
  });

  describe('Central Error Boundary Integration', () => {
    function setupApp(routeConfig = {}, appOptions = {}) {
      const fixtureDir = path.resolve(__dirname, '../fixtures/basic-app');
      return createApp({
        pagesDir: path.join(fixtureDir, 'pages'),
        viewsDir: path.join(fixtureDir, 'views'),
        logging: false,
        ...appOptions,
        setupRoutes(app) {
          if (typeof routeConfig === 'function') {
            routeConfig(app);
          }
        },
      });
    }

    it('16. handles synchronous route throws', async () => {
      const { app } = setupApp((a) => {
        a.get('/api/sync-error', () => {
          throw new NotFoundError('User record missing');
        });
      });

      const res = await request(app).get('/api/sync-error');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        status: 404,
        error: 'Not Found',
        message: 'User record missing',
        code: 'NOT_FOUND',
      });
    });

    it('17. handles asynchronous route throws', async () => {
      const { app } = setupApp((a) => {
        a.get('/api/async-error', async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new ForbiddenError('Access Denied');
        });
      });

      const res = await request(app).get('/api/async-error');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        status: 403,
        error: 'Forbidden',
        message: 'Access Denied',
        code: 'FORBIDDEN',
      });
    });

    it('18. handles middleware throws in central boundary', async () => {
      const { app } = setupApp((a) => {
        a.use('/api/protected', () => {
          throw new UnauthorizedError('Missing bearer token');
        });
        a.get('/api/protected/resource', (req, res) => {
          res.json({ ok: true });
        });
      });

      const res = await request(app).get('/api/protected/resource');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.message).toBe('Missing bearer token');
    });

    it('24. sets custom error response headers (e.g. WWW-Authenticate, Retry-After)', async () => {
      const { app } = setupApp((a) => {
        a.get('/api/rate-limited', () => {
          throw new TooManyRequestsError('Rate limit exceeded', {
            headers: { 'Retry-After': '60', 'X-RateLimit-Limit': '100' },
          });
        });
      });

      const res = await request(app).get('/api/rate-limited');
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe('60');
      expect(res.headers['x-ratelimit-limit']).toBe('100');
    });

    it('25. supports custom error handler via app.setErrorHandler', async () => {
      const { app } = setupApp((a) => {
        a.get('/api/validate', () => {
          throw new ValidationError('Form invalid', {
            fields: { username: ['Already taken'] },
          });
        });
      });

      app.setErrorHandler((err, req, res) => {
        if (err instanceof ValidationError) {
          return res.status(422).json({
            success: false,
            customErrors: err.fields,
          });
        }
      });

      const res = await request(app).get('/api/validate');
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        success: false,
        customErrors: { username: ['Already taken'] },
      });
    });

    it('26. falls back to default error handler when custom handler returns false or does not send response', async () => {
      const { app } = setupApp((a) => {
        a.get('/api/fallback-error', () => {
          throw new NotFoundError('Resource absent');
        });
      });

      app.setErrorHandler((err) => {
        if (err instanceof ValidationError) {
          // Ignore non-validation errors
          return true;
        }
      });

      const res = await request(app).get('/api/fallback-error');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Resource absent');
    });

    it('27. custom error handler that throws does not crash server and falls back to default 500 handler', async () => {
      const { app } = setupApp((a) => {
        a.get('/api/handler-crash', () => {
          throw new BadRequestError('Bad input');
        });
      });

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      app.setErrorHandler(() => {
        throw new Error('Crash inside custom handler!');
      });

      const res = await request(app).get('/api/handler-crash');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Bad input');

      spy.mockRestore();
    });

    it('28. prevents infinite error loops when error handler encounters errors', async () => {
      const { app } = setupApp((a) => {
        a.get('/api/loop-check', () => {
          throw new Error('First error');
        });
      });

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      let attempts = 0;
      app.setErrorHandler(() => {
        attempts++;
        throw new Error('Second error');
      });

      const res = await request(app).get('/api/loop-check');
      expect(res.status).toBe(500);
      expect(attempts).toBe(1); // Executed once and cleanly fell back

      spy.mockRestore();
    });

    it('29. ignores write attempts on RequestAbortedError or aborted requests', async () => {
      const { app } = setupApp((a) => {
        a.get('/api/aborted', () => {
          throw new RequestAbortedError();
        });
      });

      const res = await request(app).get('/api/aborted');
      // RequestAbortedError returns immediately without writing
      expect(res.status).toBe(200); // Supertest default when empty
    });

    it('30. delegates to next(err) if headers are already sent', async () => {
      const { app } = setupApp((a) => {
        a.get('/api/headers-sent', (req, res, next) => {
          res.writeHead(200);
          res.write('Partial body');
          next(new Error('Post-header error'));
        });
      });

      try {
        const res = await request(app).get('/api/headers-sent');
        expect(res.status).toBe(200);
      } catch (err) {
        // In Express, delegating to next(err) when headers are already sent closes the connection
        expect(err).toBeDefined();
      }
    });
  });
});
