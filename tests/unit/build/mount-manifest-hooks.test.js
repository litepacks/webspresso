/**
 * mountPagesFromManifest — hook chain, middleware, and error paths
 */

const { request } = require('../../helpers/http');
const { createCompatApp } = require('../../../src/http');
const { mountPagesFromManifest } = require('../../../core/build/runtime/mount-manifest');
const { createPluginManager } = require('../../../src/plugin-manager');
const { runBuild } = require('../../../core/build');
const {
  createBuildProject,
  loadBuiltHandlers,
  readManifest,
  PAGES_DIR,
  VIEWS_DIR,
} = require('./helpers');

describe('mountPagesFromManifest hook chain', () => {
  let manifest;
  let handlers;
  let nunjucks;

  beforeAll(async () => {
    const cwd = createBuildProject();
    await runBuild({ cwd, adapter: 'node', skipBundle: true });
    manifest = readManifest(cwd);
    handlers = await loadBuiltHandlers(cwd);
    nunjucks = require('nunjucks').configure([PAGES_DIR, VIEWS_DIR], {
      autoescape: true,
      noCache: true,
    });
  });

  function mountApp(extra = {}) {
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.mountBodyParsers();
    const pm = createPluginManager();
    pm.registerSync(
      [
        {
          name: 'tpl-helper',
          version: '1.0.0',
          register(ctx) {
            ctx.addHelper('fromPlugin', () => 'plugin-ok');
          },
        },
      ],
      { app, nunjucksEnv: nunjucks }
    );
    const globalHooksModule = {
      onRequest: vi.fn(async (ctx) => {
        ctx.data = { ...ctx.data, globalFlag: true };
      }),
      onRoute: vi.fn(),
      beforeMiddleware: vi.fn(),
      afterMiddleware: vi.fn(),
      beforeLoad: vi.fn(),
      afterLoad: vi.fn(),
      beforeRender: vi.fn(),
      afterRender: vi.fn(),
      onError: vi.fn(),
    };
    const result = mountPagesFromManifest(app, {
      manifest,
      handlers,
      nunjucks,
      pluginManager: pm,
      globalHooksModule,
      pageAssets: { enabled: true, stylesheets: true, scripts: true },
      silent: true,
      ...extra,
    });
    result.registerDynamicFileRoutes();
    return { app, globalHooksModule, pm };
  }

  it('runs SSR hooks, load, meta, and plugin helpers on /tools', async () => {
    const { app, globalHooksModule } = mountApp();
    const res = await request(app).get('/tools').expect(200);
    expect(res.text.length).toBeGreaterThan(0);
    expect(globalHooksModule.onRequest).toHaveBeenCalled();
    expect(globalHooksModule.beforeRender).toHaveBeenCalled();
    expect(globalHooksModule.afterRender).toHaveBeenCalled();
  });

  it('API middleware can call next(err)', async () => {
    const route = manifest.routes.find((r) => r.type === 'api' && r.tier === 0);
    const errManifest = {
      ...manifest,
      routes: [{ ...route, id: 'mw-err', pattern: '/api/mw-err', middleware: ['boom'] }],
    };
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.onError((c, err) => c.json({ mw: err.message }, 500));
    app.mountBodyParsers();
    mountPagesFromManifest(app, {
      manifest: errManifest,
      handlers,
      middlewares: {
        boom: (req, res, next) => next(new Error('middleware failed')),
      },
      silent: true,
    });
    const res = await request(app).get('/api/mw-err').expect(500);
    expect(res.body.mw).toBe('middleware failed');
  });

  it('API handler errors propagate to next', async () => {
    const badHandlers = {
      ...handlers,
      throw_handler: () => {
        throw new Error('handler explode');
      },
    };
    const errManifest = {
      ...manifest,
      routes: [
        {
          id: 'throw',
          type: 'api',
          method: 'get',
          pattern: '/api/throw',
          tier: 0,
          registrationIndex: 99997,
          source: { file: 'x' },
          handler: { export: 'throw_handler' },
          middleware: [],
        },
      ],
    };
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    app.onError((c, err) => c.json({ err: err.message }, 500));
    app.mountBodyParsers();
    mountPagesFromManifest(app, { manifest: errManifest, handlers: badHandlers, silent: true });
    const res = await request(app).get('/api/throw').expect(500);
    expect(res.body.err).toBe('handler explode');
  });

  it('SSR onError hook runs when load throws', async () => {
    const toolsRoute = manifest.routes.find((r) => r.pattern === '/tools');
    const configKey = toolsRoute?.handler?.configExport;
    if (!configKey) return;

    const badHandlers = {
      ...handlers,
      [configKey]: {
        default: {
          async load() {
            throw new Error('load failed');
          },
        },
      },
    };
    const app = createCompatApp({ cookieSecret: 'test-secret-32-chars-minimum!!' });
    const onError = vi.fn();
    app.onError((c) => c.text('ssr err', 500));
    mountPagesFromManifest(app, {
      manifest,
      handlers: badHandlers,
      nunjucks,
      globalHooksModule: {
        onError,
      },
      silent: true,
    });
    await request(app).get('/tools').expect(500);
    expect(onError).toHaveBeenCalled();
  });
});
