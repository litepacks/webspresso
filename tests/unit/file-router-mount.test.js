/**
 * mountPages integration (file-router SSR/API wiring)
 */

const path = require('path');
const nunjucks = require('nunjucks');
const { request } = require('../helpers/http');
const { createCompatApp } = require('../../src/http');
const { mountPages } = require('../../src/file-router');

const PAGES_DIR = path.join(__dirname, '..', 'fixtures', 'pages');
const VIEWS_DIR = path.join(__dirname, '..', 'fixtures', 'views');

describe('mountPages', () => {
  it('registers fixture API and SSR routes', async () => {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    const env = nunjucks.configure([PAGES_DIR, VIEWS_DIR], { autoescape: true, noCache: true });
    app.mountBodyParsers();
    const { registerDynamicFileRoutes } = mountPages(app, {
      pagesDir: PAGES_DIR,
      nunjucks: env,
      silent: true,
      clientRuntime: { alpine: false, swup: false },
      middlewares: {
        fixtureRequireAuth: (req, res, next) => next(),
      },
    });
    registerDynamicFileRoutes();

    await request(app).get('/api/health').expect(200);
    const page = await request(app).get('/tools').expect(200);
    expect(page.text.length).toBeGreaterThan(0);
    const dynamic = await request(app).get('/tools/uuid-generator').expect(200);
    expect(dynamic.text.length).toBeGreaterThan(0);
  });
});
