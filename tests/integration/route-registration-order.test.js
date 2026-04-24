/**
 * SSR/API route registration order: static and more specific routes must win over [param] siblings.
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');

describe('Route registration order (dynamic vs static siblings)', () => {
  let app;

  beforeAll(() => {
    const result = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
    });
    app = result.app;
  });

  it('serves static /catalog/special before /catalog/:id', async () => {
    const res = await request(app).get('/catalog/special').expect(200);
    expect(res.text).toContain('STATIC_SPECIAL');
    expect(res.text).not.toContain('DYNAMIC_special');
  });

  it('serves /catalog/:id for non-reserved segments', async () => {
    const res = await request(app).get('/catalog/42').expect(200);
    expect(res.text).toContain('DYNAMIC_42');
  });

  it('serves static /about before root /:slug', async () => {
    const res = await request(app).get('/about').expect(200);
    expect(res.text).toContain('ABOUT_STATIC');
    expect(res.text).not.toContain('ROOT_SLUG_about');
  });

  it('uses root /:slug for paths without a static page', async () => {
    const res = await request(app).get('/anything-root').expect(200);
    expect(res.text).toContain('ROOT_SLUG_anything-root');
  });

  it('API: static /api/catalog/special before /api/catalog/:id', async () => {
    const res = await request(app).get('/api/catalog/special').expect(200);
    expect(res.body).toEqual({ which: 'API_STATIC_SPECIAL' });
  });

  it('API: dynamic /api/catalog/:id', async () => {
    const res = await request(app).get('/api/catalog/99').expect(200);
    expect(res.body).toEqual({ which: 'API_DYNAMIC', id: '99' });
  });
});
