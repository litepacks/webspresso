/**
 * Unit Tests for src/server.js
 */

const path = require('path');
const { request } = require('../helpers/http');
const { createApp } = require('../../src/server');

const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');
const PAGES_DIR = path.join(FIXTURES_PATH, 'pages');
const VIEWS_DIR = path.join(FIXTURES_PATH, 'views');

describe('server.js', () => {
  let app;
  let nunjucksEnv;

  beforeEach(() => {
    const result = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
    });
    app = result.app;
    nunjucksEnv = result.nunjucksEnv;
  });

  describe('createApp', () => {
    it('should create a Hono compat app with fetch and route methods', () => {
      expect(app).toBeDefined();
      expect(typeof app.fetch).toBe('function');
      expect(typeof app.use).toBe('function');
      expect(typeof app.get).toBe('function');
      expect(typeof app.listen).toBe('function');
    });

    it('should return Nunjucks environment', () => {
      expect(nunjucksEnv).toBeDefined();
      expect(typeof nunjucksEnv.render).toBe('function');
      expect(typeof nunjucksEnv.addFilter).toBe('function');
    });

    it('should require pagesDir option', () => {
      expect(() => createApp()).toThrow('pagesDir is required');
    });

    it('should parse JSON request bodies', async () => {
      const { app: testApp } = createApp({
        pagesDir: PAGES_DIR,
        setupRoutes: (a) => {
          a.post('/__json-echo', (req, res) => {
            res.json({ body: req.body });
          });
        },
      });
      const res = await request(testApp)
        .post('/__json-echo')
        .send({ hello: 'world' })
        .expect(200);
      expect(res.body.body).toEqual({ hello: 'world' });
    });

    it('should work without publicDir', () => {
      const result = createApp({
        pagesDir: PAGES_DIR,
      });
      expect(result.app).toBeDefined();
    });

    it('should serve static files when publicDir provided', async () => {
      const result = createApp({
        pagesDir: PAGES_DIR,
        publicDir: path.join(FIXTURES_PATH, 'public'),
      });
      const res = await request(result.app).get('/test.txt').expect(200);
      expect(res.text).toContain('fixture');
    });
  });

  describe('Nunjucks filters', () => {
    it('should have json filter', () => {
      const obj = { foo: 'bar' };
      const result = nunjucksEnv.renderString('{{ obj | json | safe }}', { obj });
      expect(result).toContain('"foo"');
      expect(result).toContain('"bar"');
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/__definitely-not-a-route-xyz').expect(404);
      expect(res.text).toContain('404');
    });

    it('should return 500 JSON for API errors', async () => {
      const { app: errApp } = createApp({
        pagesDir: PAGES_DIR,
        setupRoutes: (a) => {
          a.get('/api/__throw', () => {
            throw new Error('boom');
          });
        },
      });
      const res = await request(errApp)
        .get('/api/__throw')
        .set('Accept', 'application/json')
        .expect(500);
      expect(res.body.error).toBeDefined();
    });
  });
});
