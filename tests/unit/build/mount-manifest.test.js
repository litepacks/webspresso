/**
 * mountPagesFromManifest unit tests
 */

const fs = require('fs');
const path = require('path');
const { request } = require('../../helpers/http');
const { createCompatApp } = require('../../../src/http');
const { mountPagesFromManifest, loadI18nFromManifest } = require('../../../core/build/runtime/mount-manifest');
const { runBuild } = require('../../../core/build');
const {
  createBuildProject,
  loadBuiltHandlers,
  readManifest,
  PAGES_DIR,
  VIEWS_DIR,
} = require('./helpers');

describe('mountPagesFromManifest', () => {
  let manifest;
  let handlers;

  beforeAll(async () => {
    const cwd = createBuildProject();
    await runBuild({ cwd, adapter: 'node', skipBundle: true });
    manifest = readManifest(cwd);
    handlers = await loadBuiltHandlers(cwd);
  });

  it('loadI18nFromManifest merges global and route namespaces', () => {
    const i18n = {
      'global:en': { site: 'Global' },
      'pages/about:en': { title: 'About' },
    };
    const merged = loadI18nFromManifest(i18n, ['global:en', 'pages/about:en'], 'en');
    expect(merged.site).toBe('Global');
    expect(merged.title).toBe('About');
  });

  it('loadI18nFromManifest skips non-matching locale namespaces', () => {
    const i18n = {
      'global:en': { only: 'en' },
      'pages/tools:de': { nur: 'deutsch' },
    };
    const merged = loadI18nFromManifest(i18n, ['pages/tools:de', 'global:en'], 'en');
    expect(merged.only).toBe('en');
    expect(merged.nur).toBeUndefined();
  });

  it('should mount API routes and return JSON', async () => {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.mountBodyParsers();
    mountPagesFromManifest(app, {
      manifest,
      handlers,
      silent: true,
    });

    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('should return 400 for invalid API schema', async () => {
    const cwd = createBuildProject();
    const apiDir = path.join(cwd, 'pages/api');
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(
      path.join(apiDir, 'bad-schema.post.js'),
      `module.exports = (req, res) => res.json({ ok: true });
module.exports.schema = ({ z }) => ({ body: z.object({ x: z.number() }) });`
    );
    await runBuild({ cwd, adapter: 'node', skipBundle: true });
    const m = readManifest(cwd);
    const h = await loadBuiltHandlers(cwd);

    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.mountBodyParsers();
    mountPagesFromManifest(app, { manifest: m, handlers: h, silent: true });

    const res = await request(app)
      .post('/api/bad-schema')
      .send({ x: 'not-a-number' })
      .expect(400);
    expect(res.body.error).toBe('Validation Error');
    expect(res.body.issues).toBeDefined();
  });

  it('should render SSR route from manifest template', async () => {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    const nunjucks = require('nunjucks').configure([PAGES_DIR, VIEWS_DIR], {
      autoescape: true,
      noCache: true,
    });
    app.mountBodyParsers();
    mountPagesFromManifest(app, {
      manifest,
      handlers,
      nunjucks,
      silent: true,
    });

    const res = await request(app).get('/about').expect(200);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('should serve SSR routes with load/meta after dynamic registration', async () => {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    const nunjucks = require('nunjucks').configure([PAGES_DIR, VIEWS_DIR], {
      autoescape: true,
      noCache: true,
    });
    app.mountBodyParsers();
    const { registerDynamicFileRoutes } = mountPagesFromManifest(app, {
      manifest,
      handlers,
      nunjucks,
      silent: true,
    });
    registerDynamicFileRoutes();

    const tools = await request(app).get('/tools').expect(200);
    expect(tools.text).toMatch(/JSON Formatter|tools/i);

    const slug = await request(app).get('/tools/json-formatter').expect(200);
    expect(slug.text.length).toBeGreaterThan(0);
  });

  it('should skip API routes with missing handler export', async () => {
    const brokenManifest = {
      ...manifest,
      routes: [
        ...manifest.routes,
        {
          id: 'broken-api',
          type: 'api',
          method: 'get',
          pattern: '/api/broken-handler',
          tier: 0,
          registrationIndex: 99999,
          source: { file: 'pages/api/broken.get.js' },
          handler: { export: 'missing_handler_export' },
          middleware: [],
        },
      ],
    };
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.mountBodyParsers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountPagesFromManifest(app, {
      manifest: brokenManifest,
      handlers,
      silent: true,
    });
    const res = await request(app).get('/api/broken-handler');
    expect(res.status).toBe(404);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('should halt API route when middleware ends response', async () => {
    const route = manifest.routes.find((r) => r.type === 'api' && r.tier === 0);
    const haltedManifest = {
      ...manifest,
      routes: [
        {
          ...route,
          id: 'halt-test',
          pattern: '/api/halt-test',
          middleware: ['halt'],
        },
      ],
    };
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.mountBodyParsers();
    mountPagesFromManifest(app, {
      manifest: haltedManifest,
      handlers,
      middlewares: {
        halt: (req, res) => res.json({ halted: true }),
      },
      silent: true,
    });
    const res = await request(app).get('/api/halt-test').expect(200);
    expect(res.body.halted).toBe(true);
  });

  it('should return 500 when API schema compile throws', async () => {
    const badHandlers = {
      ...handlers,
      schema_fail_handler: (req, res) => res.json({ ok: true }),
      schema_fail_handler_schema: () => {
        throw new Error('schema compile fail');
      },
    };
    const badManifest = {
      ...manifest,
      routes: [
        {
          id: 'schema-fail',
          type: 'api',
          method: 'get',
          pattern: '/api/schema-fail',
          tier: 0,
          registrationIndex: 99998,
          source: { file: 'pages/api/schema-fail.get.js' },
          handler: { export: 'schema_fail_handler' },
          middleware: [],
        },
      ],
    };
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.mountBodyParsers();
    mountPagesFromManifest(app, {
      manifest: badManifest,
      handlers: badHandlers,
      silent: true,
    });
    const res = await request(app).get('/api/schema-fail').expect(500);
    expect(res.body.message).toContain('schema compile fail');
  });

  it('should render fallback HTML when template body missing', async () => {
    const ssrRoute = manifest.routes.find((r) => r.type === 'ssr' && r.template);
    const noTplManifest = {
      ...manifest,
      routes: [{ ...ssrRoute, id: 'no-tpl', pattern: '/no-tpl-page' }],
      templates: {},
    };
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    mountPagesFromManifest(app, {
      manifest: noTplManifest,
      handlers,
      silent: true,
    });
    const res = await request(app).get('/no-tpl-page').expect(200);
    expect(res.text).toContain('Missing template');
  });
});
