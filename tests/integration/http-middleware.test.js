/**
 * createApp HTTP middleware integration (static, JSON body, secure headers)
 */

const path = require('path');
const request = require('../helpers/http').request;
const { createApp } = require('../../src/server');

const PAGES_DIR = path.join(__dirname, '../fixtures/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/views');
const PUBLIC_DIR = path.join(__dirname, '../fixtures/public');

describe('HTTP middleware (integration)', () => {
  it('serves static files from publicDir', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      publicDir: PUBLIC_DIR,
      logging: false,
    });
    const res = await request(app).get('/test.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('fixture static file');
  });

  it('parses JSON POST body on custom route', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      logging: false,
      setupRoutes: (a) => {
        a.post('/__echo-json', (req, res) => {
          res.json({ got: req.body });
        });
      },
    });
    const res = await request(app)
      .post('/__echo-json')
      .send({ hello: 'world' })
      .expect(200);
    expect(res.body.got).toEqual({ hello: 'world' });
  });

  it('sets security headers when helmet is enabled', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      logging: false,
      helmet: true,
    });
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
