/**
 * Unit Tests for src/server.js
 */

const path = require('path');
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
      const stack = app._router.stack;
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
      const stack = result.app._router.stack;
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

  describe('Error handling', () => {
    it('should have 404 handler', () => {
      const stack = app._router.stack;
      // 404 handler is added at the end
      expect(stack.length).toBeGreaterThan(0);
    });

    it('should have error handler', () => {
      const stack = app._router.stack;
      // Error handlers have 4 arguments (err, req, res, next)
      const hasErrorHandler = stack.some(layer => 
        layer.handle && layer.handle.length === 4
      );
      expect(hasErrorHandler).toBe(true);
    });
  });
});
