/**
 * Unified error flow: file routes forward to Express error middleware;
 * global onError hook and /api JSON behavior.
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const VIEWS_DIR = path.join(FIXTURES, 'views');
const APM_PAGES = path.join(FIXTURES, 'apm-error-flow', 'pages');
const BAD_HOOK_PAGES = path.join(FIXTURES, 'apm-error-flow-bad-hook', 'pages');

const hooksModule = path.join(APM_PAGES, '_hooks.js');

describe('APM / unified error flow (integration)', () => {
  beforeEach(() => {
    require(hooksModule).resetOnErrorCapture();
  });

  it('calls global onError for API route errors and returns JSON 500', async () => {
    const { app } = createApp({
      pagesDir: APM_PAGES,
      viewsDir: VIEWS_DIR,
      logging: false,
    });

    const res = await request(app)
      .get('/api/throw-route-error')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(res.body.error).toBe('Internal Server Error');
    expect(res.body.status).toBe(500);

    const captured = require(hooksModule).getLastOnError();
    expect(captured).toEqual({
      path: '/api/throw-route-error',
      message: 'api-route-boom',
    });
  });

  it('calls global onError for SSR load() errors and returns default HTML 500', async () => {
    const { app } = createApp({
      pagesDir: APM_PAGES,
      viewsDir: VIEWS_DIR,
      logging: false,
    });

    const res = await request(app)
      .get('/error-ssr')
      .set('Accept', 'text/html')
      .expect('Content-Type', /html/)
      .expect(500);

    expect(res.text).toMatch(/500|Internal Server Error/i);

    const captured = require(hooksModule).getLastOnError();
    expect(captured).toEqual({
      path: '/error-ssr',
      message: 'ssr-load-boom',
    });
  });

  it('skips serverError Nunjucks template for /api and still returns JSON', async () => {
    const { app } = createApp({
      pagesDir: APM_PAGES,
      viewsDir: VIEWS_DIR,
      errorPages: { serverError: 'errors/integration-500.njk' },
      logging: false,
    });

    const res = await request(app)
      .get('/api/throw-route-error')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(res.body.error).toBe('Internal Server Error');
    expect(res.text).not.toContain('integration-500-template');
  });

  it('does not crash when onError throws; still returns 500 JSON for API', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { app } = createApp({
        pagesDir: BAD_HOOK_PAGES,
        viewsDir: VIEWS_DIR,
        logging: false,
      });

      const res = await request(app)
        .get('/api/throw')
        .expect('Content-Type', /json/)
        .expect(500);

      expect(res.body.error).toBe('Internal Server Error');

      const hookFailure = spy.mock.calls.some(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('Error in onError hook')
      );
      expect(hookFailure).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
