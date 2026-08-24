const request = require('supertest');
const { createApp } = require('../../src/server');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');

describe('Security: HTTP Security Headers & Helmet Configuration', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should set production security headers (HSTS, NoSniff, Frameguard, ReferrerPolicy) by default', async () => {
    process.env.NODE_ENV = 'production';

    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      setupRoutes: (expressApp) => {
        expressApp.get('/test-headers', (req, res) => res.send('OK'));
      },
    });

    const res = await request(app).get('/test-headers').expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('should merge plugin CSP requirements into the final Content-Security-Policy header', async () => {
    process.env.NODE_ENV = 'production';

    const dummyPlugin = {
      name: 'analytics-widget',
      version: '1.0.0',
      csp: {
        scriptSrc: ['https://analytics.example.com'],
        connectSrc: ['https://telemetry.example.com'],
      },
      register: () => {},
    };

    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [dummyPlugin],
      setupRoutes: (expressApp) => {
        expressApp.get('/test-csp', (req, res) => res.send('OK'));
      },
    });

    const res = await request(app).get('/test-csp').expect(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('https://analytics.example.com');
    expect(csp).toContain('https://telemetry.example.com');
  });
});
