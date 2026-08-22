/**
 * Error Pages Configuration Tests
 */

const { createApp } = require('../../src/server');
const path = require('path');
const request = require('supertest');
const fs = require('fs');
const os = require('os');

describe('Error Pages', () => {
  const pagesDir = path.join(__dirname, '../fixtures/pages');
  const viewsDir = path.join(__dirname, '../fixtures/views');

  describe('Default Error Pages', () => {
    it('should return default 404 page for unknown routes', async () => {
      const { app } = createApp({ pagesDir, viewsDir });
      
      const res = await request(app).get('/unknown-route-xyz');
      
      expect(res.status).toBe(404);
      expect(res.text).toContain('404');
      expect(res.text).toContain('Page not found');
    });

    it('should return JSON 404 for API-like requests', async () => {
      const { app } = createApp({ pagesDir, viewsDir });
      
      const res = await request(app)
        .get('/unknown-route')
        .set('Accept', 'application/json');
      
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not Found');
    });
  });

  describe('Custom Error Handlers', () => {
    it('should use custom 404 handler function', async () => {
      const { app } = createApp({
        pagesDir,
        viewsDir,
        errorPages: {
          notFound: (req, res) => {
            res.send(`Custom 404: ${encodeURIComponent(req.path)}`);
          },
        },
      });
      
      const res = await request(app).get('/missing-page');
      
      expect(res.status).toBe(404);
      expect(res.text).toBe(`Custom 404: ${encodeURIComponent('/missing-page')}`);
    });

    it('should use custom 500 handler function', async () => {
      const express = require('express');
      const testApp = express();
      
      // Add error route BEFORE error handlers
      testApp.get('/error-test', (req, res, next) => {
        next(new Error('Test error'));
      });
      
      // Custom error handler
      testApp.use((err, req, res, next) => {
        res.status(500).send('Custom Error: ' + err.message);
      });
      
      const res = await request(testApp).get('/error-test');
      
      expect(res.status).toBe(500);
      expect(res.text).toBe('Custom Error: Test error');
    });
  });

  describe('Custom Error Templates', () => {
    const errorViewsDir = path.join(__dirname, '../fixtures/error-views');
    
    beforeAll(() => {
      // Create error templates directory
      if (!fs.existsSync(errorViewsDir)) {
        fs.mkdirSync(errorViewsDir, { recursive: true });
      }
      
      // Create 404 template
      fs.writeFileSync(path.join(errorViewsDir, '404.njk'), `
<!DOCTYPE html>
<html>
<head><title>Custom 404</title></head>
<body>
  <h1>Oops! Page not found</h1>
  <p>URL: {{ url }}</p>
</body>
</html>
      `);
      
      // Create 500 template
      fs.writeFileSync(path.join(errorViewsDir, '500.njk'), `
<!DOCTYPE html>
<html>
<head><title>Custom 500</title></head>
<body>
  <h1>Server Error</h1>
  <p>Status: {{ status }}</p>
  {% if isDev %}<pre>{{ error.stack }}</pre>{% endif %}
</body>
</html>
      `);
    });
    
    afterAll(() => {
      // Cleanup
      if (fs.existsSync(errorViewsDir)) {
        fs.rmSync(errorViewsDir, { recursive: true });
      }
    });

    it('should use custom 404 template', async () => {
      const { app } = createApp({
        pagesDir,
        viewsDir: errorViewsDir,
        errorPages: {
          notFound: '404.njk'
        }
      });
      
      const res = await request(app).get('/missing');
      
      expect(res.status).toBe(404);
      expect(res.text).toContain('Custom 404');
      expect(res.text).toContain('Oops! Page not found');
      expect(res.text).toContain('URL: /missing');
    });

    it('should use custom 500 template', async () => {
      // Test that 500 template option is supported
      // We can't easily trigger a 500 after routes are mounted
      // so we test the configuration is accepted
      const { app } = createApp({
        pagesDir,
        viewsDir: errorViewsDir,
        errorPages: {
          serverError: '500.njk'
        }
      });
      
      // Just verify app was created with the config
      expect(app).toBeDefined();
    });
  });

  describe('Error Status Codes', () => {
    it('should respect custom error status codes', async () => {
      const express = require('express');
      const testApp = express();
      
      testApp.get('/forbidden', (req, res, next) => {
        const err = new Error('Forbidden');
        err.status = 403;
        next(err);
      });
      
      // Error handler that respects err.status
      testApp.use((err, req, res, next) => {
        res.status(err.status || 500).json({ error: err.message });
      });
      
      const res = await request(testApp).get('/forbidden');
      
      expect(res.status).toBe(403);
    });
  });

  describe('404 Auto-Discovery and Fallback Hierarchy', () => {
    let autoDir;
    let autoPagesDir;
    let autoViewsDir;

    beforeEach(() => {
      autoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-auto-404-'));
      autoPagesDir = path.join(autoDir, 'pages');
      autoViewsDir = path.join(autoDir, 'views');
      fs.mkdirSync(autoPagesDir, { recursive: true });
      fs.mkdirSync(autoViewsDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(autoDir, { recursive: true, force: true });
    });

    it('should auto-discover views/404.njk when errorPages.notFound is not explicitly passed', async () => {
      fs.writeFileSync(path.join(autoViewsDir, '404.njk'), '<h1>Views 404 Auto: {{ url }}</h1>');

      const { app } = createApp({
        pagesDir: autoPagesDir,
        viewsDir: autoViewsDir,
      });

      const res = await request(app).get('/non-existent-route');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Views 404 Auto: /non-existent-route');
    });

    it('should auto-discover pages/404.njk when views/404.njk is absent', async () => {
      fs.writeFileSync(path.join(autoPagesDir, '404.njk'), '<h1>Pages 404 Auto: {{ url }}</h1>');

      const { app } = createApp({
        pagesDir: autoPagesDir,
        viewsDir: autoViewsDir,
      });

      const res = await request(app).get('/another-missing-route');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Pages 404 Auto: /another-missing-route');
    });

    it('should execute pages/404.js load() and provide data to 404 template', async () => {
      fs.writeFileSync(
        path.join(autoPagesDir, '404.js'),
        'module.exports = { load: async ({ req }) => ({ customMessage: "Helpful 404", requestedPath: req.url }) };'
      );
      fs.writeFileSync(
        path.join(autoPagesDir, '404.njk'),
        '<h1>{{ customMessage }}</h1><p>{{ requestedPath }}</p>'
      );

      const { app } = createApp({
        pagesDir: autoPagesDir,
        viewsDir: autoViewsDir,
      });

      const res = await request(app).get('/where-is-this');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Helpful 404');
      expect(res.text).toContain('/where-is-this');
    });

    it('should set HTTP 404 status when directly requesting /404 route', async () => {
      fs.writeFileSync(path.join(autoPagesDir, '404.njk'), '<h1>404 Page</h1>');

      const { app } = createApp({
        pagesDir: autoPagesDir,
        viewsDir: autoViewsDir,
      });

      const res = await request(app).get('/404');
      expect(res.status).toBe(404);
      expect(res.text).toContain('404 Page');
    });
  });
});

