/**
 * Dashboard plugin HTTP smoke
 */

const path = require('path');
const request = require('../helpers/http').request;
const { createApp } = require('../../src/server');
const { dashboardPlugin } = require('../../plugins');

describe('Dashboard plugin (integration)', () => {
  it('serves dashboard HTML at configured path', async () => {
    const { app } = createApp({
      pagesDir: path.join(__dirname, '../fixtures/pages'),
      viewsDir: path.join(__dirname, '../fixtures/views'),
      logging: false,
      plugins: [dashboardPlugin({ path: '/_webspresso' })],
    });
    const res = await request(app).get('/_webspresso');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/webspresso|dashboard/i);
  });

  it('exposes routes API', async () => {
    const { app } = createApp({
      pagesDir: path.join(__dirname, '../fixtures/pages'),
      viewsDir: path.join(__dirname, '../fixtures/views'),
      logging: false,
      plugins: [dashboardPlugin()],
    });
    const res = await request(app).get('/_webspresso/api/routes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body) || typeof res.body === 'object').toBe(true);
  });
});
