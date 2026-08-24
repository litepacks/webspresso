const request = require('supertest');
const { createApp } = require('../../src/server');
const { HttpError } = require('../../core/errors');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');

describe('Security: Central Error Handling & Information Leakage Prevention', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should mask 500 error messages and suppress stack traces in production JSON responses', async () => {
    process.env.NODE_ENV = 'production';

    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      setupRoutes: (expressApp) => {
        expressApp.get('/api/internal-error', (req, res) => {
          throw new Error('Secret DB password in /var/secrets/db.key failed to connect');
        });
      },
    });

    const res = await request(app)
      .get('/api/internal-error')
      .set('Accept', 'application/json')
      .expect(500);

    expect(res.body.error).toBe('Internal Server Error');
    expect(res.body.message).toBe('Internal Server Error');
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('/var/secrets');
    expect(JSON.stringify(res.body)).not.toContain('Secret DB password');
  });

  it('should not leak stack trace in production HTML 500 pages', async () => {
    process.env.NODE_ENV = 'production';

    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      setupRoutes: (expressApp) => {
        expressApp.get('/crash-page', (req, res) => {
          throw new Error('Database /root/secret.sqlite crash');
        });
      },
    });

    const res = await request(app)
      .get('/crash-page')
      .set('Accept', 'text/html')
      .expect(500);

    expect(res.text).toContain('500');
    expect(res.text).not.toContain('<pre>');
    expect(res.text).not.toContain('/root/secret.sqlite');
  });
});
