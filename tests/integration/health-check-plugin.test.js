/**
 * Health check plugin integration tests
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');
const healthCheckPlugin = require('../../plugins/health-check');

const FIXTURES_PAGES = path.join(__dirname, '..', 'fixtures', 'pages');
const FIXTURES_VIEWS = path.join(__dirname, '..', 'fixtures', 'views');

describe('Health check plugin', () => {
  it('should expose GET /health with status ok by default', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [healthCheckPlugin()],
    });

    const res = await request(app).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body.framework).toEqual({ name: 'webspresso', version: expect.any(String) });
  });

  it('should respect custom path', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [healthCheckPlugin({ path: '/_healthz' })],
    });

    await request(app).get('/_healthz').expect(200);
    await request(app).get('/health').expect(404);
  });

  it('should return 403 when authorize returns false', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [healthCheckPlugin({ authorize: () => false })],
    });

    await request(app).get('/health').expect(403);
  });

  it('should omit verbose fields when verbose is false', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [healthCheckPlugin({ verbose: false })],
    });

    const res = await request(app).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('should run custom checks and return 503 on failure', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        healthCheckPlugin({
          checks: async () => {
            throw new Error('db down');
          },
        }),
      ],
    });

    const res = await request(app).get('/health').expect(503);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.error).toContain('db down');
  });

  it('should merge successful checks into body', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        healthCheckPlugin({
          checks: async () => ({ custom: 'pass' }),
        }),
      ],
    });

    const res = await request(app).get('/health').expect(200);
    expect(res.body.checks).toEqual({ custom: 'pass' });
  });
});
