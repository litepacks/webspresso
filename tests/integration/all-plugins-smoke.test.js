/**
 * All built-in plugins — minimal config smoke (one critical endpoint each)
 */

const path = require('path');
const request = require('../helpers/http').request;
const { createApp } = require('../../src/server');
const plugins = require('../../plugins');

const PAGES = path.join(__dirname, '../fixtures/pages');
const VIEWS = path.join(__dirname, '../fixtures/views');

describe('All plugins smoke', () => {
  let app;

  beforeAll(() => {
    const { app: a } = createApp({
      pagesDir: PAGES,
      viewsDir: VIEWS,
      logging: false,
      helmet: false,
      plugins: [
        plugins.sitemapPlugin({ hostname: 'https://example.com', robots: true }),
        plugins.analyticsPlugin({ google: { measurementId: 'G-SMOKE' } }),
        plugins.dashboardPlugin(),
        plugins.healthCheckPlugin({ path: '/healthz' }),
        plugins.redirectPlugin({ rules: [] }),
        plugins.rateLimitPlugin(),
        plugins.swaggerPlugin({ path: '/api-docs' }),
        plugins.schemaExplorerPlugin({ path: '/schema' }),
        plugins.seoCheckerPlugin({ enabled: false }),
      ],
    });
    app = a;
  });

  const cases = [
    { name: 'sitemap', method: 'get', path: '/sitemap.xml', status: 200 },
    { name: 'robots', method: 'get', path: '/robots.txt', status: 200 },
    { name: 'dashboard', method: 'get', path: '/_webspresso', status: 200 },
    { name: 'health-check', method: 'get', path: '/healthz', status: 200 },
    { name: 'swagger', method: 'get', path: '/api-docs', status: [200, 301, 302] },
    { name: 'schema-explorer', method: 'get', path: '/schema', status: [200, 404] },
  ];

  for (const c of cases) {
    it(`${c.name} responds`, async () => {
      const res = await request(app)[c.method](c.path);
      const expected = Array.isArray(c.status) ? c.status : [c.status];
      expect(expected).toContain(res.status);
    });
  }
});
