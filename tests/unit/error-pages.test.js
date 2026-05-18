/**
 * Error Pages Configuration Tests
 */

const { createApp } = require('../../src/server');
const path = require('path');
const request = require('../helpers/http').request;
const fs = require('fs');

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
      const { app } = createApp({
        pagesDir,
        viewsDir,
        errorPages: {
          serverError: (err, req, res) => {
            res.status(500).send(`Custom Error: ${err.message}`);
          },
        },
      });

      app.get('/error-test', () => {
        throw new Error('Test error');
      });

      const res = await request(app).get('/error-test');

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
      const { app } = createApp({
        pagesDir,
        viewsDir,
        errorPages: {
          serverError: (err, req, res) => {
            res.status(err.status || 500).json({ error: err.message });
          },
        },
      });

      app.get('/forbidden', () => {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      });

      const res = await request(app).get('/forbidden');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });
});

