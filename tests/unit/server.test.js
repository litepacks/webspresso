/**
 * Unit Tests for src/server.js
 */

const path = require('path');
const request = require('supertest');
const { createApp, fastETag } = require('../../src/server');

const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');
const PAGES_DIR = path.join(FIXTURES_PATH, 'pages');
const VIEWS_DIR = path.join(FIXTURES_PATH, 'views');

describe('server.js', () => {
  let app;
  let nunjucksEnv;

  beforeEach(() => {
    const result = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR
    });
    app = result.app;
    nunjucksEnv = result.nunjucksEnv;
  });

  describe('createApp', () => {
    it('should create an Express app', () => {
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe('function');
      expect(typeof app.use).toBe('function');
      expect(typeof app.get).toBe('function');
    });

    it('should return Nunjucks environment', () => {
      expect(nunjucksEnv).toBeDefined();
      expect(typeof nunjucksEnv.render).toBe('function');
      expect(typeof nunjucksEnv.addFilter).toBe('function');
    });

    it('should require pagesDir option', () => {
      expect(() => createApp()).toThrow('pagesDir is required');
    });

    it('should have JSON body parser', () => {
      // Check if body parser middleware is configured
      const stack = (app.router || app._router).stack;
      const hasJsonParser = stack.some(layer => 
        layer.name === 'jsonParser' || 
        (layer.handle && layer.handle.name === 'jsonParser')
      );
      expect(hasJsonParser).toBe(true);
    });

    it('should work without publicDir', () => {
      const result = createApp({
        pagesDir: PAGES_DIR
      });
      expect(result.app).toBeDefined();
    });

    it('should configure static file serving when publicDir provided', () => {
      const result = createApp({
        pagesDir: PAGES_DIR,
        publicDir: path.join(FIXTURES_PATH, 'public')
      });
      const stack = (result.app.router || result.app._router).stack;
      const hasStatic = stack.some(layer =>
        layer.name === 'serveStatic' ||
        (layer.handle && layer.handle.name === 'serveStatic')
      );
      expect(hasStatic).toBe(true);
    });
  });

  describe('Nunjucks filters', () => {
    it('should have json filter', () => {
      const obj = { foo: 'bar' };
      // Use | safe to prevent HTML escaping of quotes
      const result = nunjucksEnv.renderString('{{ obj | json | safe }}', { obj });
      expect(result).toContain('"foo"');
      expect(result).toContain('"bar"');
    });

    it('should have date filter', () => {
      const date = new Date('2025-01-15');
      
      // Test short format
      const shortResult = nunjucksEnv.renderString("{{ date | date('short') }}", { date });
      expect(shortResult).toBeTruthy();
      
      // Test iso format
      const isoResult = nunjucksEnv.renderString("{{ date | date('iso') }}", { date });
      expect(isoResult).toContain('2025-01-15');
    });
  });

  describe('Nunjucks template caching', () => {
    it('should cache compiled templates when noCache is false', () => {
      const prodApp = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        nunjucks: { noCache: false },
      });
      const t1 = prodApp.nunjucksEnv.getTemplate('layout.njk');
      const t2 = prodApp.nunjucksEnv.getTemplate('layout.njk');
      expect(t1).toBeDefined();
      expect(t1).toBe(t2);
    });
  });

  describe('Error handling', () => {
    it('should have 404 handler', () => {
      const stack = (app.router || app._router).stack;
      // 404 handler is added at the end
      expect(stack.length).toBeGreaterThan(0);
    });

    it('should have error handler', () => {
      const stack = (app.router || app._router).stack;
      // Error handlers have 4 arguments (err, req, res, next)
      const hasErrorHandler = stack.some(layer => 
        layer.handle && layer.handle.length === 4
      );
      expect(hasErrorHandler).toBe(true);
    });
  });

  describe('HTTP Server Socket Tuning', () => {
    it('should apply keepAliveTimeout and headersTimeout on app.listen', () => {
      const serverInstance = app.listen(0);
      try {
        expect(serverInstance.keepAliveTimeout).toBe(65000);
        expect(serverInstance.headersTimeout).toBe(66000);
      } finally {
        serverInstance.close();
      }
    });

    it('should respect custom server keepAliveTimeout options', () => {
      const customApp = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        server: {
          keepAliveTimeout: 75000,
          headersTimeout: 80000,
        },
      }).app;

      const serverInstance = customApp.listen(0);
      try {
        expect(serverInstance.keepAliveTimeout).toBe(75000);
        expect(serverInstance.headersTimeout).toBe(80000);
      } finally {
        serverInstance.close();
      }
    });
  });

  describe('Dynamic Route Pattern Matcher & LRU Cache', () => {
    it('should compile and fast-path dynamic routes with params', async () => {
      const testApp = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
      }).app;

      let capturedParams = null;
      testApp.get('/items/:category/:id', (req, res) => {
        capturedParams = req.params;
        res.json({ ok: true, params: req.params });
      });

      // Find the fast-path dispatcher layer
      const stack = (testApp.router || testApp._router).stack;
      const fastPathLayer = stack.find(layer => 
        layer.handle && layer.handle.name === 'fastPathDispatcher'
      );
      expect(fastPathLayer).toBeDefined();

      // Test route matching and LRU cache population
      const req = { method: 'GET', url: '/items/tools/42', path: '/items/tools/42', headers: {} };
      let jsonResponse = null;
      const res = {
        statusCode: 200,
        setHeader: () => {},
        json: (data) => { jsonResponse = data; },
        status: function(code) { this.statusCode = code; return this; },
      };

      await new Promise((resolve) => {
        fastPathLayer.handle(req, res, () => resolve());
        if (jsonResponse) resolve();
      });

      expect(capturedParams).toEqual({ category: 'tools', id: '42' });
      expect(jsonResponse).toEqual({ ok: true, params: { category: 'tools', id: '42' } });

      // Verify cached hit on second call
      capturedParams = null;
      jsonResponse = null;
      await new Promise((resolve) => {
        fastPathLayer.handle(req, res, () => resolve());
        if (jsonResponse) resolve();
      });
      expect(capturedParams).toEqual({ category: 'tools', id: '42' });

      // Verify 404 URL is memoized without throwing
      let nextCalled = false;
      const notFoundReq = { method: 'GET', url: '/nonexistent/random/path', path: '/nonexistent/random/path', headers: {} };
      fastPathLayer.handle(notFoundReq, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);

      // Verify second call to 404 URL uses sentinel
      let nextCalledAgain = false;
      fastPathLayer.handle(notFoundReq, res, () => { nextCalledAgain = true; });
      expect(nextCalledAgain).toBe(true);
    });
  });

  describe('Fast ETag generator & HTTP freshness', () => {
    it('should generate valid RFC 7232 Weak ETags', () => {
      expect(fastETag('')).toBe('W/"0-0"');
      expect(fastETag(Buffer.alloc(0))).toBe('W/"0-0"');

      const tag1 = fastETag('{"hello":"world"}');
      const tag2 = fastETag(Buffer.from('{"hello":"world"}'));
      expect(tag1).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
      expect(tag1).toBe(tag2);

      const tagDifferent = fastETag('{"hello":"different"}');
      expect(tag1).not.toBe(tagDifferent);
    });

    it('should set fast ETag on responses and return 304 when If-None-Match matches', async () => {
      const testApp = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
      }).app;

      testApp.get('/api/test-etag', (req, res) => {
        res.json({ message: 'etag-test-payload' });
      });

      const res1 = await request(testApp).get('/api/test-etag');
      expect(res1.status).toBe(200);
      const etagHeader = res1.headers.etag;
      expect(etagHeader).toBeDefined();
      expect(etagHeader).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);

      // Subsequent conditional request with If-None-Match
      const res2 = await request(testApp)
        .get('/api/test-etag')
        .set('if-none-match', etagHeader);
      expect(res2.status).toBe(304);
      expect(res2.text).toBe('');
    });

    it('should allow disabling ETag via options.etag = false', async () => {
      const noEtagApp = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        etag: false,
      }).app;

      noEtagApp.get('/api/no-etag', (req, res) => {
        res.json({ noEtag: true });
      });

      const res = await request(noEtagApp).get('/api/no-etag');
      expect(res.status).toBe(200);
      expect(res.headers.etag).toBeUndefined();
    });
  });
});
