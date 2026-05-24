/**
 * Unit Tests for src/server.js
 */

const path = require('path');
const { request } = require('../helpers/http');
const { createApp } = require('../../src/server');

const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');
const PAGES_DIR = path.join(FIXTURES_PATH, 'pages');
const VIEWS_DIR = path.join(FIXTURES_PATH, 'views');

describe('server.js', () => {
  let app;
  let nunjucksEnv;

  beforeEach(() => {
    const result = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
    });
    app = result.app;
    nunjucksEnv = result.nunjucksEnv;
  });

  describe('createApp', () => {
    it('should create a Hono compat app with fetch and route methods', () => {
      expect(app).toBeDefined();
      expect(typeof app.fetch).toBe('function');
      expect(typeof app.use).toBe('function');
      expect(typeof app.get).toBe('function');
      expect(typeof app.listen).toBe('function');
    });

    it('should return Nunjucks environment', () => {
      expect(nunjucksEnv).toBeDefined();
      expect(typeof nunjucksEnv.render).toBe('function');
      expect(typeof nunjucksEnv.addFilter).toBe('function');
    });

    it('should require pagesDir option', () => {
      expect(() => createApp()).toThrow('pagesDir is required');
    });

    it('should parse JSON request bodies', async () => {
      const { app: testApp } = createApp({
        pagesDir: PAGES_DIR,
        setupRoutes: (a) => {
          a.post('/__json-echo', (req, res) => {
            res.json({ body: req.body });
          });
        },
      });
      const res = await request(testApp)
        .post('/__json-echo')
        .send({ hello: 'world' })
        .expect(200);
      expect(res.body.body).toEqual({ hello: 'world' });
    });

    it('should warn when plugin onRoutesReady throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        plugins: [
          {
            name: 'broken-routes-plugin',
            version: '1.0.0',
            onRoutesReady() {
              throw new Error('onRoutesReady failed');
            },
          },
        ],
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('onRoutesReady() failed'),
        expect.any(String)
      );
      warnSpy.mockRestore();
    });

    it('should work without publicDir', () => {
      const result = createApp({
        pagesDir: PAGES_DIR,
      });
      expect(result.app).toBeDefined();
    });

    it('should serve static files when publicDir provided', async () => {
      const result = createApp({
        pagesDir: PAGES_DIR,
        publicDir: path.join(FIXTURES_PATH, 'public'),
      });
      const res = await request(result.app).get('/test.txt').expect(200);
      expect(res.text).toContain('fixture');
    });

    it('should mount routes from manifest when _manifestMode is set', async () => {
      const { runBuild } = require('../../core/build');
      const fs = require('fs');
      const os = require('os');
      const { pathToFileURL } = require('url');

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-srv-manifest-'));
      fs.cpSync(PAGES_DIR, path.join(tmp, 'pages'), { recursive: true });
      fs.cpSync(VIEWS_DIR, path.join(tmp, 'views'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'public'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'webspresso.build.js'),
        'module.exports = { adapter: "node", pagesDir: "pages", viewsDir: "views" };'
      );
      await runBuild({ cwd: tmp, adapter: 'node', skipBundle: true });

      const manifest = JSON.parse(
        fs.readFileSync(path.join(tmp, '.webspresso/server/manifest.json'), 'utf8')
      );
      const handlersMod = await import(
        pathToFileURL(path.join(tmp, '.webspresso/server/handlers.mjs')).href
      );

      const { app } = createApp({
        pagesDir: path.join(tmp, 'pages'),
        viewsDir: path.join(tmp, 'views'),
        _manifestMode: true,
        _manifest: manifest,
        _handlers: handlersMod.handlers,
        logging: false,
        helmet: false,
        timeout: false,
      });

      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('Nunjucks filters', () => {
    it('should have json filter', () => {
      const obj = { foo: 'bar' };
      const result = nunjucksEnv.renderString('{{ obj | json | safe }}', { obj });
      expect(result).toContain('"foo"');
      expect(result).toContain('"bar"');
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/__definitely-not-a-route-xyz').expect(404);
      expect(res.text).toContain('404');
    });

    it('should use custom notFound handler', async () => {
      const { app: customApp } = createApp({
        pagesDir: PAGES_DIR,
        errorPages: {
          notFound: async (req, res) => {
            res.status(404).json({ custom: 'not-found' });
          },
        },
      });
      const res = await request(customApp)
        .get('/__missing-route-custom')
        .set('Accept', 'application/json')
        .expect(404);
      expect(res.body.custom).toBe('not-found');
    });

    it('should render custom notFound template', async () => {
      const { app: customApp } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        errorPages: {
          notFound: 'errors/integration-500.njk',
        },
      });
      const res = await request(customApp).get('/__missing-template-404').expect(404);
      expect(res.status).toBe(404);
    });

    it('should return JSON 404 when client prefers JSON', async () => {
      const { app: jsonApp } = createApp({ pagesDir: PAGES_DIR });
      const res = await request(jsonApp)
        .get('/__json-404')
        .set('Accept', 'application/json')
        .expect(404);
      expect(res.body.error).toBe('Not Found');
      expect(res.body.status).toBe(404);
    });

    it('should use custom serverError handler', async () => {
      const { app: errApp } = createApp({
        pagesDir: PAGES_DIR,
        errorPages: {
          serverError: async (err, req, res) => {
            res.status(500).json({ custom: err.message });
          },
        },
        setupRoutes: (a) => {
          a.get('/api/__custom-500', () => {
            throw new Error('custom-boom');
          });
        },
      });
      const res = await request(errApp)
        .get('/api/__custom-500')
        .set('Accept', 'application/json')
        .expect(500);
      expect(res.body.custom).toBe('custom-boom');
    });

    it('should return HTML 404 when client accepts html', async () => {
      const { app: htmlApp } = createApp({ pagesDir: PAGES_DIR });
      const res = await request(htmlApp)
        .get('/__html-404-only')
        .set('Accept', 'text/html')
        .expect(404);
      expect(res.text).toContain('404');
      expect(res.headers['content-type']).toMatch(/html/);
    });

    it('should log requests when logging is enabled', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { app: logApp } = createApp({
        pagesDir: PAGES_DIR,
        logging: true,
        helmet: false,
        timeout: false,
      });
      await request(logApp).get('/api/health').expect(200);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('GET'));
      logSpy.mockRestore();
    });

    it('should render timeout template for HTML clients', async () => {
      const { app: tApp } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
        errorPages: { timeout: 'errors/integration-503.njk' },
        setupRoutes: (a) => {
          a.get('/__timeout-html', (req) => {
            req.timedout = true;
            throw new Error('timeout');
          });
        },
      });
      const res = await request(tApp)
        .get('/__timeout-html')
        .set('Accept', 'text/html')
        .expect(503);
      expect(res.status).toBe(503);
    });

    it('should return HTML 500 in development for browser clients', async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const { app: devApp } = createApp({
        pagesDir: PAGES_DIR,
        setupRoutes: (a) => {
          a.get('/__html-500', () => {
            throw new Error('dev html error');
          });
        },
      });
      const res = await request(devApp)
        .get('/__html-500')
        .set('Accept', 'text/html')
        .expect(500);
      expect(res.text).toContain('500');
      process.env.NODE_ENV = prev;
    });

    it('should return 503 JSON when request timed out', async () => {
      const { app: timeoutApp } = createApp({
        pagesDir: PAGES_DIR,
        setupRoutes: (a) => {
          a.get('/api/__timed-out', (req) => {
            req.timedout = true;
            throw new Error('halted');
          });
        },
      });
      const res = await request(timeoutApp)
        .get('/api/__timed-out')
        .set('Accept', 'application/json')
        .expect(503);
      expect(res.body.error).toBe('Request Timeout');
    });

    it('should return 500 JSON for API errors', async () => {
      const { app: errApp } = createApp({
        pagesDir: PAGES_DIR,
        setupRoutes: (a) => {
          a.get('/api/__throw', () => {
            throw new Error('boom');
          });
        },
      });
      const res = await request(errApp)
        .get('/api/__throw')
        .set('Accept', 'application/json')
        .expect(500);
      expect(res.body.error).toBeDefined();
    });
  });
});
