/**
 * Integration Tests for SSR Routes
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');

const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');
const PAGES_DIR = path.join(FIXTURES_PATH, 'pages');
const VIEWS_DIR = path.join(FIXTURES_PATH, 'views');

describe('SSR Routes Integration', () => {
  let app;

  beforeAll(() => {
    const result = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR
    });
    app = result.app;
  });

  describe('GET /', () => {
    it('should render home page', async () => {
      const res = await request(app)
        .get('/')
        .expect('Content-Type', /html/)
        .expect(200);

      expect(res.text).toContain('Webspresso');
      expect(res.text).toContain('<!DOCTYPE html>');
    });

    it('should include navigation', async () => {
      const res = await request(app).get('/').expect(200);

      expect(res.text).toContain('href="/"');
      expect(res.text).toContain('href="/tools"');
      expect(res.text).toContain('href="/about"');
    });

    it('should include meta tags', async () => {
      const res = await request(app).get('/').expect(200);

      expect(res.text).toContain('<title>');
      expect(res.text).toContain('meta name="description"');
    });
  });

  describe('GET /about', () => {
    it('should render about page', async () => {
      const res = await request(app)
        .get('/about')
        .expect('Content-Type', /html/)
        .expect(200);

      expect(res.text).toContain('About');
    });
  });

  describe('GET /tools', () => {
    it('should render tools list page', async () => {
      const res = await request(app)
        .get('/tools')
        .expect('Content-Type', /html/)
        .expect(200);

      expect(res.text).toContain('Tools');
    });

    it('should load tools data via load() function', async () => {
      const res = await request(app).get('/tools').expect(200);

      // Check that tools are rendered (from load() function)
      expect(res.text).toContain('JSON Formatter');
      expect(res.text).toContain('Base64 Encoder');
    });

    it('should have links to individual tools', async () => {
      const res = await request(app).get('/tools').expect(200);

      expect(res.text).toContain('href="/tools/json-formatter"');
    });
  });

  describe('GET /tools/:slug', () => {
    it('should render dynamic tool page', async () => {
      const res = await request(app)
        .get('/tools/json-formatter')
        .expect('Content-Type', /html/)
        .expect(200);

      expect(res.text).toContain('JSON Formatter');
    });

    it('should show related tools', async () => {
      const res = await request(app)
        .get('/tools/json-formatter')
        .expect(200);

      expect(res.text).toContain('Related Tools');
    });

    it('should have correct meta title for tool', async () => {
      const res = await request(app)
        .get('/tools/json-formatter')
        .expect(200);

      expect(res.text).toContain('<title>JSON Formatter');
    });

    it('should handle non-existent tool slug', async () => {
      const res = await request(app)
        .get('/tools/non-existent-tool')
        .expect(200);

      // Should still render but with null tool data
      expect(res.text).toBeDefined();
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app)
        .get('/unknown/path')
        .expect(404);

      expect(res.text).toContain('404');
    });
  });

  describe('Locale handling', () => {
    it('should respect lang query parameter', async () => {
      const res = await request(app)
        .get('/?lang=de')
        .expect(200);

      expect(res.text).toContain('lang="de"');
    });

    it('should respect Accept-Language header', async () => {
      const res = await request(app)
        .get('/')
        .set('Accept-Language', 'de-DE,de;q=0.9')
        .expect(200);

      expect(res.text).toBeDefined();
    });
  });

  describe('Layout rendering', () => {
    it('should use base layout', async () => {
      const res = await request(app).get('/').expect(200);

      // Check for layout elements
      expect(res.text).toContain('<nav');
      expect(res.text).toContain('<footer');
      expect(res.text).toContain('tailwind');
    });

    it('should include canonical URL', async () => {
      const res = await request(app).get('/').expect(200);

      expect(res.text).toContain('rel="canonical"');
    });

    it('should include Open Graph tags', async () => {
      const res = await request(app).get('/').expect(200);

      expect(res.text).toContain('og:title');
      expect(res.text).toContain('og:type');
    });
  });

  describe('pageAssets', () => {
    it('does not emit load() asset tags when pageAssets is off (default)', async () => {
      const res = await request(app).get('/page-assets-test').expect(200);
      expect(res.text).toContain('page-assets-test-marker');
      expect(res.text).not.toContain('page-assets-extra.css');
    });

    it('emits link and script from load() when createApp({ pageAssets: true })', async () => {
      const { app: appOn } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        pageAssets: true,
        logging: false,
      });
      const res = await request(appOn).get('/page-assets-test').expect(200);
      expect(res.text).toContain('page-assets-test-marker');
      expect(res.text).toContain('href="/page-assets-extra.css"');
      expect(res.text).toContain('src="/page-assets-extra.js"');
    });
  });
});
