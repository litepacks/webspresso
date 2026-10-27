const path = require('path');
const request = require('supertest');
const { createApp } = require('../../../src/server');

const FIXTURES_PATH = path.join(__dirname, '..', '..', 'fixtures');
const PAGES_DIR = path.join(FIXTURES_PATH, 'empty-pages');
const VIEWS_DIR = path.join(FIXTURES_PATH, 'views');

describe('Hardened Query Parser (src/server.js Item #4)', () => {
  it('should parse nested and dot-notation query parameters safely', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      cache: false,
      logging: false,
    });

    app.get('/test-query', (req, res) => {
      res.json(req.query);
    });

    const res = await request(app)
      .get('/test-query?filter[status]=active&filter.role=admin&sort=createdAt');

    expect(res.status).toBe(200);
    expect(res.body.filter).toEqual({ status: 'active', role: 'admin' });
    expect(res.body.sort).toBe('createdAt');
  });

  it('should block prototype pollution via query parameters', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      cache: false,
      logging: false,
    });

    app.get('/test-pollution', (req, res) => {
      res.json({
        query: req.query,
        isPolluted: ({}).polluted !== undefined,
      });
    });

    const res = await request(app)
      .get('/test-pollution?__proto__[polluted]=attack&constructor[prototype][polluted]=attack');

    expect(res.status).toBe(200);
    expect(res.body.isPolluted).toBe(false);
    expect(({}).polluted).toBeUndefined();
  });

  it('should prevent massive array allocation via arrayLimit protection', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      cache: false,
      logging: false,
    });

    app.get('/test-array-limit', (req, res) => {
      res.json({
        isArray: Array.isArray(req.query.items),
        keys: Object.keys(req.query.items || {}),
        val: req.query.items ? req.query.items['5000'] : undefined,
      });
    });

    const res = await request(app)
      .get('/test-array-limit?items[5000]=safe');

    expect(res.status).toBe(200);
    // Because index 5000 > arrayLimit (100), qs converts it to an object dictionary instead of a sparse array of length 5001
    expect(res.body.isArray).toBe(false);
    expect(res.body.val).toBe('safe');
  });

  it('should respect custom queryParser option (e.g. false or custom function)', async () => {
    const { app: appDisabled } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      cache: false,
      logging: false,
      queryParser: false,
    });

    appDisabled.get('/test-disabled', (req, res) => {
      res.json(req.query);
    });

    const resDisabled = await request(appDisabled).get('/test-disabled?a=1');
    expect(resDisabled.status).toBe(200);
    expect(resDisabled.body).toEqual({});
  });
});
