/**
 * Plugin onRoutesReady routes must not be shadowed by root pages/[slug].njk (/:slug).
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');

const PAGES = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS = path.join(__dirname, '../fixtures/route-order/views');

const singleSegmentPlugin = {
  name: 'shadow-test',
  registerSync() {},
  onRoutesReady(ctx) {
    ctx.addRoute('get', '/_shadow-test', (req, res) => {
      res.json({ from: 'plugin' });
    });
  },
};

describe('Plugin routes vs root :slug file route', () => {
  let app;

  beforeAll(() => {
    const result = createApp({
      pagesDir: PAGES,
      viewsDir: VIEWS,
      plugins: [singleSegmentPlugin],
    });
    app = result.app;
  });

  it('plugin wins for a single-segment path that would match /:slug', async () => {
    const res = await request(app).get('/_shadow-test').expect(200);
    expect(res.body).toEqual({ from: 'plugin' });
  });

  it('root [slug].njk still handles paths without a plugin match', async () => {
    const res = await request(app).get('/hello-slug').expect(200);
    expect(res.text).toContain('ROOT_SLUG_hello-slug');
  });
});
