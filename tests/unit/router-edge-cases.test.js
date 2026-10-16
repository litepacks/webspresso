const path = require('path');
const fs = require('fs');
const os = require('os');
const request = require('supertest');
const { createApp } = require('../../src/server');

describe.sequential('Router & Error Edge Cases', () => {
  let tempDir;
  let pagesDir;
  let viewsDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-router-edge-'));
    pagesDir = path.join(tempDir, 'pages');
    viewsDir = path.join(tempDir, 'views');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.mkdirSync(viewsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should warn when duplicate route bindings exist across files', () => {
    const apiDir = path.join(pagesDir, 'api');
    fs.mkdirSync(apiDir, { recursive: true });

    // api/posts.js (defaults to GET /api/posts)
    fs.writeFileSync(
      path.join(apiDir, 'posts.js'),
      'module.exports = (req, res) => res.json({ src: "posts.js" });'
    );
    // api/posts.get.js (explicit GET /api/posts)
    fs.writeFileSync(
      path.join(apiDir, 'posts.get.js'),
      'module.exports = (req, res) => res.json({ src: "posts.get.js" });'
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createApp({ pagesDir, viewsDir });

    const duplicateWarn = warnSpy.mock.calls.find((call) =>
      call[0] && call[0].includes('Duplicate route detected') && call[0].includes('GET /api/posts')
    );

    expect(duplicateWarn).toBeDefined();
    warnSpy.mockRestore();
  });

  it('should handle null, undefined, or primitive returns from load() and meta() safely', async () => {
    fs.writeFileSync(
      path.join(pagesDir, 'null-load.js'),
      'module.exports = { load: async () => null, meta: async () => undefined };'
    );
    fs.writeFileSync(
      path.join(pagesDir, 'null-load.njk'),
      '<h1>Safe Render</h1>'
    );

    fs.writeFileSync(
      path.join(pagesDir, 'primitive-load.js'),
      'module.exports = { load: async () => 12345, meta: async () => "invalid" };'
    );
    fs.writeFileSync(
      path.join(pagesDir, 'primitive-load.njk'),
      '<h1>Primitive Load Safe</h1>'
    );

    const { app } = createApp({ pagesDir, viewsDir });

    const resNull = await request(app).get('/null-load');
    expect(resNull.status).toBe(200);
    expect(resNull.text).toContain('Safe Render');

    const resPrim = await request(app).get('/primitive-load');
    expect(resPrim.status).toBe(200);
    expect(resPrim.text).toContain('Primitive Load Safe');
  });

  it('should not attempt to send error response if res.headersSent is already true', async () => {
    const apiDir = path.join(pagesDir, 'api');
    fs.mkdirSync(apiDir, { recursive: true });

    fs.writeFileSync(
      path.join(apiDir, 'stream-error.js'),
      `module.exports = (req, res, next) => {
        res.status(200).send('early-response');
        next(new Error('Post-response error'));
      };`
    );

    const { app } = createApp({ pagesDir, viewsDir });
    const res = await request(app).get('/api/stream-error');

    expect(res.status).toBe(200);
    expect(res.text).toBe('early-response');
  });

  it('should return JSON error response when client prefers JSON even with custom 404/500 template defined', async () => {
    const customPages = path.join(tempDir, 'custom-pages');
    const customViews = path.join(tempDir, 'custom-views');
    fs.mkdirSync(customPages, { recursive: true });
    fs.mkdirSync(customViews, { recursive: true });

    fs.writeFileSync(
      path.join(customViews, '404.njk'),
      '<h1>Custom 404 HTML</h1>'
    );
    fs.writeFileSync(
      path.join(customViews, '500.njk'),
      '<h1>Custom 500 HTML</h1>'
    );
    fs.writeFileSync(
      path.join(customPages, 'crash.js'),
      'module.exports = { load: async () => { throw new Error("Kaboom"); } };'
    );
    fs.writeFileSync(path.join(customPages, 'crash.njk'), '<h1>Never</h1>');

    const { app } = createApp({ pagesDir: customPages, viewsDir: customViews });

    // 1. Missing page with Accept: application/json
    const res404Json = await request(app)
      .get('/missing-something')
      .set('Accept', 'application/json');
    expect(res404Json.status).toBe(404);
    expect(res404Json.body).toEqual({ error: 'Not Found', status: 404 });

    // 2. SSR route crashing with X-Requested-With: XMLHttpRequest (AJAX)
    const res500Ajax = await request(app)
      .get('/crash')
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res500Ajax.status).toBe(500);
    expect(res500Ajax.body).toHaveProperty('error', 'Internal Server Error');
    expect(res500Ajax.body).toHaveProperty('status', 500);
  });

  it('supports route groups (parentheses), multi-level dynamic brackets, and catch-all routes', async () => {
    const complexPages = path.join(tempDir, 'complex-pages');
    fs.mkdirSync(path.join(complexPages, '(marketing)'), { recursive: true });
    fs.mkdirSync(path.join(complexPages, 'catalog', '[category]'), { recursive: true });
    fs.mkdirSync(path.join(complexPages, 'docs', '[...slug]'), { recursive: true });

    // 1. Route group (marketing) -> /about
    fs.writeFileSync(
      path.join(complexPages, '(marketing)', 'about.njk'),
      '<h1>About Marketing</h1>'
    );

    // 2. Bracket parameter -> /catalog/:category/:id
    fs.writeFileSync(
      path.join(complexPages, 'catalog', '[category]', '[id].js'),
      `module.exports = {
        load: async (req) => ({ category: req.params.category, id: req.params.id })
      };`
    );
    fs.writeFileSync(
      path.join(complexPages, 'catalog', '[category]', '[id].njk'),
      '<p>Item {{ category }} - {{ id }}</p>'
    );

    // 3. Catch-all route -> /docs/*
    fs.writeFileSync(
      path.join(complexPages, 'docs', '[...slug]', 'index.js'),
      `module.exports = {
        load: async (req) => ({ slug: req.params[0] || req.params.slug })
      };`
    );
    fs.writeFileSync(
      path.join(complexPages, 'docs', '[...slug]', 'index.njk'),
      '<h1>Docs: {{ slug }}</h1>'
    );

    const { app } = createApp({ pagesDir: complexPages, viewsDir });

    // Test route group URL
    const resGroup = await request(app).get('/about');
    expect(resGroup.status).toBe(200);
    expect(resGroup.text).toContain('About Marketing');

    // Test dynamic parameters
    const resParams = await request(app).get('/catalog/electronics/macbook-pro');
    expect(resParams.status).toBe(200);
    expect(resParams.text).toContain('Item electronics - macbook-pro');

    // Test catch-all route
    const resCatchAll = await request(app).get('/docs/installation/guide');
    expect(resCatchAll.status).toBe(200);
    expect(resCatchAll.text).toContain('Docs: installation/guide');
  });
});

