const request = require('supertest');
const { createApp } = require('../../src/server');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');

describe('Security: Proxy & Header Spoofing Protection', () => {
  it('should ignore X-Forwarded-For and X-Forwarded-Proto when trustProxy is explicitly false', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      trustProxy: false,
      setupRoutes: (expressApp) => {
        expressApp.get('/test-ip', (req, res) => {
          res.json({
            ip: req.ip,
            protocol: req.protocol,
            secure: req.secure,
          });
        });
      },
    });

    const res = await request(app)
      .get('/test-ip')
      .set('X-Forwarded-For', '203.0.113.195')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    // When trust proxy is disabled, req.ip should NOT be the spoofed header
    expect(res.body.ip).not.toBe('203.0.113.195');
    expect(res.body.protocol).toBe('http');
    expect(res.body.secure).toBe(false);
  });

  it('should allow custom trustProxy configuration (e.g. loopback / hops)', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      trustProxy: 1,
      setupRoutes: (expressApp) => {
        expressApp.get('/test-ip', (req, res) => {
          res.json({
            ip: req.ip,
            protocol: req.protocol,
            secure: req.secure,
          });
        });
      },
    });

    const res = await request(app)
      .get('/test-ip')
      .set('X-Forwarded-For', '203.0.113.195')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    expect(res.body.ip).toBe('203.0.113.195');
    expect(res.body.protocol).toBe('https');
    expect(res.body.secure).toBe(true);
  });
});
