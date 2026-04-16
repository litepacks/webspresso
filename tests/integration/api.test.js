/**
 * Integration Tests for API Routes
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');

const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');
const PAGES_DIR = path.join(FIXTURES_PATH, 'pages');
const VIEWS_DIR = path.join(FIXTURES_PATH, 'views');

describe('API Routes Integration', () => {
  let app;

  beforeAll(() => {
    const result = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR
    });
    app = result.app;
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app)
        .get('/api/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('environment');
      expect(res.body).toHaveProperty('version');
    });

    it('should have valid timestamp', async () => {
      const res = await request(app).get('/api/health').expect(200);

      const timestamp = new Date(res.body.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(isNaN(timestamp.getTime())).toBe(false);
    });

    it('should have positive uptime', async () => {
      const res = await request(app).get('/api/health').expect(200);

      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('POST /api/echo', () => {
    it('should echo back JSON body', async () => {
      const testBody = { message: 'Hello', count: 42 };

      const res = await request(app)
        .post('/api/echo')
        .send(testBody)
        .set('Content-Type', 'application/json')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(res.body).toHaveProperty('message', 'Echo response');
      expect(res.body).toHaveProperty('received');
      expect(res.body.received).toHaveProperty('body');
      expect(res.body.received.body).toEqual(testBody);
    });

    it('should include query parameters', async () => {
      const res = await request(app)
        .post('/api/echo?foo=bar&num=123')
        .send({})
        .expect(200);

      expect(res.body.received.query).toHaveProperty('foo', 'bar');
      expect(res.body.received.query).toHaveProperty('num', '123');
    });

    it('should include content-type header', async () => {
      const res = await request(app)
        .post('/api/echo')
        .send({ test: true })
        .set('Content-Type', 'application/json')
        .expect(200);

      expect(res.body.received.contentType).toContain('application/json');
    });

    it('should include timestamp', async () => {
      const res = await request(app)
        .post('/api/echo')
        .send({})
        .expect(200);

      expect(res.body).toHaveProperty('timestamp');
      const timestamp = new Date(res.body.timestamp);
      expect(isNaN(timestamp.getTime())).toBe(false);
    });

    it('should handle empty body', async () => {
      const res = await request(app)
        .post('/api/echo')
        .expect(200);

      expect(res.body.received.body).toEqual({});
    });
  });

  describe('API error handling', () => {
    it('should return 404 for unknown API routes', async () => {
      const res = await request(app)
        .get('/api/unknown')
        .set('Accept', 'application/json')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'Not Found');
    });

    it('should return JSON for API 404', async () => {
      const res = await request(app)
        .get('/api/unknown')
        .set('Accept', 'application/json')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('HTTP methods', () => {
    it('should reject GET on POST-only endpoint', async () => {
      // /api/echo is POST only, GET should 404
      const res = await request(app)
        .get('/api/echo')
        .expect(404);
    });

    it('should reject POST on GET-only endpoint', async () => {
      // /api/health is GET only, POST should 404
      const res = await request(app)
        .post('/api/health')
        .expect(404);
    });
  });

  describe('Content negotiation', () => {
    it('should return JSON for API endpoints', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Accept', 'application/json')
        .expect('Content-Type', /json/);

      expect(typeof res.body).toBe('object');
    });
  });

  describe('Zod schema (req.input)', () => {
    it('should populate req.input.body when schema validates', async () => {
      const res = await request(app)
        .post('/api/doc-demo')
        .send({ title: 'Hello' })
        .set('Content-Type', 'application/json')
        .expect(200);

      expect(res.body).toEqual({ ok: true, title: 'Hello' });
    });

    it('should return 400 when body fails schema', async () => {
      const res = await request(app)
        .post('/api/doc-demo')
        .send({})
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(res.body.error).toBe('Validation Error');
      expect(Array.isArray(res.body.issues)).toBe(true);
    });
  });

  describe('API object export (middleware + handler + schema)', () => {
    let appWithAuth;

    beforeAll(() => {
      const result = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        middlewares: {
          fixtureRequireAuth: (req, res, next) => {
            if (req.get('x-test-auth') !== 'yes') {
              return res.status(401).json({ error: 'Unauthorized' });
            }
            next();
          },
        },
      });
      appWithAuth = result.app;
    });

    it('should validate body before named middleware (400 before 401)', async () => {
      await request(appWithAuth)
        .post('/api/object-auth')
        .set('x-test-auth', 'yes')
        .send({})
        .set('Content-Type', 'application/json')
        .expect(400);
    });

    it('should reject when auth middleware fails after valid body', async () => {
      const res = await request(appWithAuth)
        .post('/api/object-auth')
        .send({ q: 'hi' })
        .set('Content-Type', 'application/json')
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('should run handler with req.input after schema and middleware', async () => {
      const res = await request(appWithAuth)
        .post('/api/object-auth')
        .set('x-test-auth', 'yes')
        .send({ q: 'search' })
        .set('Content-Type', 'application/json')
        .expect(200);

      expect(res.body).toEqual({
        results: [],
        q: 'search',
        mode: 'object-export',
      });
    });
  });

  describe('req.db (createApp with db)', () => {
    let appWithDb;

    beforeAll(() => {
      const fakeDb = { __fixtureMarker: true };
      const result = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        db: fakeDb,
      });
      appWithDb = result.app;
    });

    it('should attach db to req before handler and middleware', async () => {
      const res = await request(appWithDb).get('/api/db-context').expect(200);

      expect(res.body.hasRequestDb).toBe(true);
      expect(res.body.marker).toBe(true);
    });
  });
});
