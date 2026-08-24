const request = require('supertest');
const { createApp } = require('../../src/server');
const basicAuthPlugin = require('../../plugins/basic-auth');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');

describe('Security: HTTP Basic Auth Plugin (RFC 7617)', () => {
  it('should sanitize realm to prevent CRLF injection in WWW-Authenticate header', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [
        basicAuthPlugin({
          global: true,
          realm: 'Secure Area\r\nInjected-Header: evil\r\n\r\nEvilBody',
          users: { admin: 'secret123' },
          routes: ['/protected'],
        }),
      ],
      setupRoutes: (expressApp) => {
        expressApp.get('/protected', (req, res) => res.json({ ok: true }));
      },
    });

    const res = await request(app).get('/protected').expect(401);
    const authHeader = res.headers['www-authenticate'];
    expect(authHeader).toBeDefined();
    expect(authHeader).not.toContain('\r');
    expect(authHeader).not.toContain('\n');
    expect(authHeader).not.toContain('Injected-Header');
  });

  it('should reject invalid base64 and malformed credentials gracefully without crashing', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [
        basicAuthPlugin({
          global: true,
          users: { admin: 'secret123' },
          routes: ['/protected'],
        }),
      ],
      setupRoutes: (expressApp) => {
        expressApp.get('/protected', (req, res) => res.json({ ok: true }));
      },
    });

    // Malformed basic headers
    await request(app).get('/protected').set('Authorization', 'Basic !@#$%^&*()').expect(401);
    await request(app).get('/protected').set('Authorization', 'Basic ').expect(401);
    await request(app).get('/protected').set('Authorization', 'Bearer 12345').expect(401);
    // Credentials without colon
    const noColon = Buffer.from('onlyusername').toString('base64');
    await request(app).get('/protected').set('Authorization', `Basic ${noColon}`).expect(401);
  });

  it('should authenticate valid credentials and reject invalid credentials', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [
        basicAuthPlugin({
          global: true,
          users: { admin: 'secret123' },
          routes: ['/protected'],
        }),
      ],
      setupRoutes: (expressApp) => {
        expressApp.get('/protected/data', (req, res) => res.json({ ok: true }));
      },
    });

    const validCreds = Buffer.from('admin:secret123').toString('base64');
    const wrongPass = Buffer.from('admin:wrongpass').toString('base64');

    await request(app).get('/protected/data').set('Authorization', `Basic ${wrongPass}`).expect(401);
    const res = await request(app).get('/protected/data').set('Authorization', `Basic ${validCreds}`).expect(200);
    expect(res.body).toEqual({ ok: true });
  });
});
