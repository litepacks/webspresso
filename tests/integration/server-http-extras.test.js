/**
 * Functional integration tests for createApp options and HTTP behavior
 * not fully covered by unit tests (client runtime, setupRoutes, helmet/CSP, errors).
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');

const PAGES_DIR = path.join(__dirname, '..', 'fixtures', 'pages');
const VIEWS_DIR = path.join(__dirname, '..', 'fixtures', 'views');

function baseOpts() {
  return {
    pagesDir: PAGES_DIR,
    viewsDir: VIEWS_DIR,
    logging: false,
  };
}

describe('createApp HTTP extras (integration)', () => {
  describe('clientRuntime', () => {
    it('serves Alpine when clientRuntime.alpine is true', async () => {
      const { app } = createApp({
        ...baseOpts(),
        clientRuntime: { alpine: true },
      });
      const res = await request(app)
        .get('/__webspresso/client-runtime/alpine.min.js')
        .expect(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.text.length).toBeGreaterThan(500);
    });

    it('serves Swup UMD when clientRuntime.swup is true', async () => {
      const { app } = createApp({
        ...baseOpts(),
        clientRuntime: { swup: true },
      });
      const res = await request(app)
        .get('/__webspresso/client-runtime/swup.umd.js')
        .expect(200);
      expect(res.text.length).toBeGreaterThan(500);
    });

    it('serves bootstrap-alpine-swup when both flags are on', async () => {
      const { app } = createApp({
        ...baseOpts(),
        clientRuntime: { alpine: true, swup: true },
      });
      const res = await request(app)
        .get('/__webspresso/client-runtime/bootstrap-alpine-swup.js')
        .expect(200);
      expect(res.text).toContain('swup');
    });

    it('serves bootstrap-swup when only swup is on', async () => {
      const { app } = createApp({
        ...baseOpts(),
        clientRuntime: { swup: true },
      });
      const res = await request(app)
        .get('/__webspresso/client-runtime/bootstrap-swup.js')
        .expect(200);
      expect(res.text.length).toBeGreaterThan(50);
    });
  });

  describe('setupRoutes', () => {
    it('registers routes that respond after file router setup', async () => {
      const { app } = createApp({
        ...baseOpts(),
        setupRoutes: (appInstance) => {
          appInstance.get('/__integration-setup-route', (req, res) => {
            res.json({ from: 'setupRoutes' });
          });
        },
      });
      const res = await request(app).get('/__integration-setup-route').expect(200);
      expect(res.body).toEqual({ from: 'setupRoutes' });
    });
  });

  describe('middleware toggles', () => {
    it('serves SSR when helmet is disabled', async () => {
      const { app } = createApp({
        ...baseOpts(),
        helmet: false,
      });
      await request(app).get('/').expect(200);
    });

    it('serves API when request timeout middleware is disabled', async () => {
      const { app } = createApp({
        ...baseOpts(),
        timeout: false,
      });
      await request(app).get('/api/health').expect(200);
    });
  });

  describe('JSON error responses', () => {
    it('returns JSON 500 when client prefers application/json', async () => {
      const { app } = createApp({
        ...baseOpts(),
        setupRoutes: (a) => {
          a.get('/__throw-500-json', (req, res, next) => {
            next(new Error('integration-boom'));
          });
        },
      });
      const res = await request(app)
        .get('/__throw-500-json')
        .set('Accept', 'application/json')
        .expect(500);
      expect(res.body.error).toBe('Internal Server Error');
      expect(res.body.status).toBe(500);
    });
  });

  describe('errorPages (integration)', () => {
    function routeThatThrows(appInstance, path, errFactory) {
      appInstance.get(path, (req, res, next) => {
        next(errFactory());
      });
    }

    it('calls errorPages.serverError function with ctx', async () => {
      const { app } = createApp({
        ...baseOpts(),
        errorPages: {
          serverError: (err, req, res, ctx) => {
            res.status(500).json({
              customServerError: true,
              path: req.path,
              hasFsy: typeof ctx.fsy === 'object',
            });
          },
        },
        setupRoutes: (a) => {
          routeThatThrows(a, '/__server-err-fn', () => new Error('handled'));
        },
      });
      const res = await request(app)
        .get('/__server-err-fn')
        .set('Accept', 'application/json')
        .expect(500);
      expect(res.body.customServerError).toBe(true);
      expect(res.body.path).toBe('/__server-err-fn');
      expect(res.body.hasFsy).toBe(true);
    });

    it('renders errorPages.serverError Nunjucks template', async () => {
      const { app } = createApp({
        ...baseOpts(),
        errorPages: { serverError: 'errors/integration-500.njk' },
        setupRoutes: (a) => {
          routeThatThrows(a, '/__server-err-tpl', () => new Error('tpl'));
        },
      });
      const res = await request(app).get('/__server-err-tpl').expect(500);
      expect(res.text).toContain('integration-500-template');
      expect(res.text).toContain('500');
    });

    it('respects err.status for non-500 errors', async () => {
      const { app } = createApp({
        ...baseOpts(),
        setupRoutes: (a) => {
          a.get('/__custom-status-err', (req, res, next) => {
            const err = new Error('Forbidden');
            err.status = 403;
            next(err);
          });
        },
      });
      await request(app).get('/__custom-status-err').expect(403);
      const res = await request(app)
        .get('/__custom-status-err')
        .set('Accept', 'application/json')
        .expect(403);
      expect(res.body.status).toBe(403);
    });

    it('returns default 503 HTML when req.timedout is true', async () => {
      const { app } = createApp({
        ...baseOpts(),
        setupRoutes: (a) => {
          a.get('/__timed-out', (req, res, next) => {
            req.timedout = true;
            next(new Error('timeout'));
          });
        },
      });
      const res = await request(app).get('/__timed-out').expect(503);
      expect(res.text).toContain('503');
      expect(res.text).toContain('timed out');
    });

    it('returns JSON 503 when req.timedout and Accept is application/json', async () => {
      const { app } = createApp({
        ...baseOpts(),
        setupRoutes: (a) => {
          a.get('/__timed-out-json', (req, res, next) => {
            req.timedout = true;
            next(new Error('timeout'));
          });
        },
      });
      const res = await request(app)
        .get('/__timed-out-json')
        .set('Accept', 'application/json')
        .expect(503);
      expect(res.body.error).toBe('Request Timeout');
      expect(res.body.status).toBe(503);
    });

    it('calls errorPages.timeout function', async () => {
      const { app } = createApp({
        ...baseOpts(),
        errorPages: {
          timeout: (req, res) => {
            res.status(503).type('text').send('custom-timeout-body');
          },
        },
        setupRoutes: (a) => {
          a.get('/__timeout-fn', (req, res, next) => {
            req.timedout = true;
            next(new Error('x'));
          });
        },
      });
      const res = await request(app).get('/__timeout-fn').expect(503);
      expect(res.text).toBe('custom-timeout-body');
    });

    it('renders errorPages.timeout Nunjucks template', async () => {
      const { app } = createApp({
        ...baseOpts(),
        errorPages: { timeout: 'errors/integration-503.njk' },
        setupRoutes: (a) => {
          a.get('/__timeout-tpl', (req, res, next) => {
            req.timedout = true;
            next(new Error('x'));
          });
        },
      });
      const res = await request(app).get('/__timeout-tpl').expect(503);
      expect(res.text).toContain('integration-503-template');
      expect(res.text).toContain('/__timeout-tpl');
    });

    it('passes ctx to errorPages.notFound function', async () => {
      const { app } = createApp({
        ...baseOpts(),
        errorPages: {
          notFound: (req, res, ctx) => {
            res.status(404).json({
              custom404: true,
              hasFsy: typeof ctx.fsy === 'object',
              method: ctx.method,
            });
          },
        },
      });
      const res = await request(app)
        .get('/__no-such-path-404')
        .set('Accept', 'application/json')
        .expect(404);
      expect(res.body.custom404).toBe(true);
      expect(res.body.hasFsy).toBe(true);
      expect(res.body.method).toBe('GET');
    });
  });

  describe('production Helmet + plugin CSP', () => {
    const savedNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = savedNodeEnv;
    });

    it('merges plugin csp into Content-Security-Policy in production', async () => {
      process.env.NODE_ENV = 'production';
      const cspPlugin = {
        name: 'csp-fixture',
        version: '1.0.0',
        register() {},
        csp: {
          scriptSrc: ['https://example-cdn.test'],
        },
      };
      const { app } = createApp({
        ...baseOpts(),
        plugins: [cspPlugin],
      });
      const res = await request(app).get('/').expect(200);
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(String(csp)).toContain('example-cdn.test');
    });
  });
});
