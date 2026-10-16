'use strict';

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../../src/server');
const { HttpError, RequestAbortedError } = require('../../../core/errors');

const FIXTURES_PATH = path.join(__dirname, '../../fixtures');
const PAGES_DIR = path.join(FIXTURES_PATH, 'pages');
const VIEWS_DIR = path.join(FIXTURES_PATH, 'views');

describe('Server Error Boundaries & Lifecycle Scenarios (src/server.js)', () => {
  describe('app.setErrorHandler Hook', () => {
    it('allows custom error handler to intercept errors and respond', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
      });

      app.get('/test-error', () => {
        throw new Error('Something exploded');
      });

      app.setErrorHandler((err, req, res) => {
        return res.status(500).json({ intercepted: true, message: err.message });
      });

      const res = await request(app).get('/test-error');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ intercepted: true, message: 'Something exploded' });
    });

    it('falls through to default error handler if custom handler does not send response or return true', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
      });

      app.get('/test-fallthrough', () => {
        throw new Error('Fallthrough error');
      });

      app.setErrorHandler(() => {
        // Do not send headers or return true
        return false;
      });

      const res = await request(app)
        .get('/test-fallthrough')
        .set('Accept', 'application/json');

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });

    it('safely catches errors thrown inside custom error handler and continues to default handler', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
      });

      app.get('/test-handler-throw', () => {
        throw new Error('Initial error');
      });

      app.setErrorHandler(() => {
        throw new Error('Error inside custom error handler');
      });

      const res = await request(app)
        .get('/test-handler-throw')
        .set('Accept', 'application/json');

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('HttpError Custom Headers', () => {
    it('sets custom headers specified on HttpError onto the response', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
      });

      app.get('/rate-limited', () => {
        const err = new HttpError(429, 'Rate limit exceeded', {
          headers: {
            'Retry-After': '120',
            'X-RateLimit-Limit': '60',
          },
        });
        throw err;
      });

      const res = await request(app)
        .get('/rate-limited')
        .set('Accept', 'application/json');

      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe('120');
      expect(res.headers['x-ratelimit-limit']).toBe('60');
      expect(res.body.status).toBe(429);
    });
  });

  describe('Request Aborted Error Handling', () => {
    it('ends response silently without crashing when RequestAbortedError is received', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
      });

      app.get('/abort-test', () => {
        throw new RequestAbortedError('Client disconnected');
      });

      const res = await request(app).get('/abort-test');
      expect(res.status).toBe(200); // socket ended without error payload
    });
  });

  describe('Custom Error Pages (errorPages config)', () => {
    it('executes custom function for errorPages.notFound', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
        errorPages: {
          notFound: (req, res, ctx) => {
            return res.status(404).send(`Custom 404 for ${ctx.url} in ${ctx.locale}`);
          },
        },
      });

      const res = await request(app).get('/non-existent-custom-404');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Custom 404 for /non-existent-custom-404');
    });

    it('executes custom function for errorPages.serverError', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
        errorPages: {
          serverError: (err, req, res, ctx) => {
            return res.status(500).send(`Custom 500: ${err.message}`);
          },
        },
      });

      app.get('/custom-500-trigger', () => {
        throw new Error('Database crash');
      });

      const res = await request(app).get('/custom-500-trigger');
      expect(res.status).toBe(500);
      expect(res.text).toBe('Custom 500: Database crash');
    });

    it('returns JSON error response when request prefers JSON', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
      });

      const res = await request(app)
        .get('/ghost-endpoint')
        .set('Accept', 'application/json');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not Found', status: 404 });
    });
  });

  describe('Timeout Handling (req.timedout)', () => {
    it('handles timedout request with custom errorPages.timeout function', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
        errorPages: {
          timeout: (req, res, ctx) => {
            return res.status(503).send(`Service Timed Out: ${ctx.url}`);
          },
        },
      });

      app.get('/trigger-timeout', (req, res, next) => {
        req.timedout = true;
        next(new Error('Gateway timeout'));
      });

      const res = await request(app).get('/trigger-timeout');
      expect(res.status).toBe(503);
      expect(res.text).toBe('Service Timed Out: /trigger-timeout');
    });

    it('returns JSON 503 response for timed out request when accepting JSON', async () => {
      const { app } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        logging: false,
      });

      app.get('/trigger-timeout-json', (req, res, next) => {
        req.timedout = true;
        next(new Error('Timeout'));
      });

      const res = await request(app)
        .get('/trigger-timeout-json')
        .set('Accept', 'application/json');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'Request Timeout', status: 503 });
    });
  });
});
