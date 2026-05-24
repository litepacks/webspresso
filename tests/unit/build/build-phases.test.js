/**
 * Build compiler phase coverage tests
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BuildError, formatBuildError } = require('../../../core/build/errors/build-error');
const { BuildGraph } = require('../../../core/build/graph/build-graph');
const { sha256, hashFile, hashParts, cacheKey } = require('../../../core/build/graph/hash');
const { BuildCache } = require('../../../core/build/cache/build-cache');
const { loadBuildConfig, DEFAULT_CONFIG } = require('../../../core/build/config/load-build-config');
const { discoverRoutes } = require('../../../core/build/phases/01-discover');
const { analyzeRoutes, extractRequires, parseNjkDirectives } = require('../../../core/build/phases/02-analyze');
const { assembleManifest } = require('../../../core/build/phases/04-manifest');
const { bundlePhase } = require('../../../core/build/phases/05-bundle');
const { validateBuild, assertValid } = require('../../../core/build/phases/06-validate');
const { buildMiddlewareManifest } = require('../../../core/build/phases/03-compile/middleware');
const { compilePlugins, isEdgeCompatible } = require('../../../core/build/phases/03-compile/plugins');
const { compileTemplates, flattenIncludes } = require('../../../core/build/phases/03-compile/templates');
const { schemaToJson } = require('../../../core/build/phases/03-compile/routes-api');
const { resolveAdapter, runBuild } = require('../../../core/build');
const { loadI18nFromManifest } = require('../../../core/build/runtime/mount-manifest');

function mkProject(structure = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-phase-'));
  for (const [rel, content] of Object.entries(structure)) {
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return root;
}

describe('build errors and graph utilities', () => {
  it('BuildError and formatBuildError render details', () => {
    const err = new BuildError('WS_BUILD_TEST', 'failed', {
      file: 'pages/x.js',
      hint: 'fix it',
      docsUrl: 'https://example.com',
    });
    const text = formatBuildError(err);
    expect(text).toContain('WS_BUILD_TEST');
    expect(text).toContain('pages/x.js');
    expect(text).toContain('fix it');
    expect(formatBuildError(new Error('x'))).toContain('WS_BUILD_UNKNOWN');
  });

  it('hash helpers and build graph dependents', () => {
    expect(sha256('abc')).toHaveLength(64);
    expect(hashParts(['b', 'a'])).toBe(hashParts(['a', 'b']));
    expect(cacheKey('p', 'h', 'node', '1.0')).toContain('v3:node');

    const g = new BuildGraph();
    g.addNode('a', 'file', '1');
    g.addNode('b', 'file', '2');
    g.addEdge('a', 'b', 'import');
    expect(g.dependentsOf('a')).toEqual(['b']);
    expect(g.toJSON().edges).toHaveLength(1);
  });

  it('BuildCache load save and writeObject', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-cache-'));
    const cache = new BuildCache(dir);
    cache.load();
    const key = cache.makeKey('discover', 'abc', 'node', '0.1');
    cache.set(key, 'hash1', ['out.json']);
    cache.save();
    cache.writeObject('obj1', '{"x":1}');
    expect(fs.existsSync(path.join(dir, 'index.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'objects', 'obj1'))).toBe(true);

    const cache2 = new BuildCache(dir);
    cache2.load();
    expect(cache2.get(key).hash).toBe('hash1');
  });
});

describe('loadBuildConfig', () => {
  it('returns defaults when no config file', () => {
    const dir = mkProject({});
    const { config, configPath } = loadBuildConfig(dir);
    expect(configPath).toBeNull();
    expect(config.adapter).toBe(DEFAULT_CONFIG.adapter);
  });

  it('loads object and function config', () => {
    const dir = mkProject({
      'webspresso.build.js': 'module.exports = { adapter: "cloudflare", pagesDir: "p" };',
    });
    expect(loadBuildConfig(dir).config.adapter).toBe('cloudflare');

    const dir2 = mkProject({
      'webspresso.build.js': 'module.exports = () => ({ adapter: "bun" });',
    });
    expect(loadBuildConfig(dir2).config.adapter).toBe('bun');
  });
});

describe('discover and analyze phases', () => {
  it('discovers api and ssr routes from temp project', () => {
    const root = mkProject({
      'pages/api/ping.get.js': 'module.exports = (req,res)=>res.send("ok");',
      'pages/hello/index.njk': '<p>Hi</p>',
      'pages/hello/index.js': 'module.exports = { load: async () => ({ name: "x" }) };',
    });
    const graph = new BuildGraph();
    const { routes } = discoverRoutes({
      cwd: root,
      config: { pagesDir: 'pages' },
      graph,
    });
    expect(routes.some((r) => r.type === 'api' && r.pattern === '/api/ping')).toBe(true);
    expect(routes.some((r) => r.type === 'ssr' && r.pattern === '/hello')).toBe(true);
  });

  it('extractRequires and parseNjkDirectives', () => {
    const src = "const fs = require('fs'); import x from 'y'; {% include 'part.njk' %} {% extends 'base.njk' %}";
    expect(extractRequires(src)).toContain('fs');
    expect(extractRequires(src)).toContain('y');
    const njk = parseNjkDirectives("{% extends 'layout.njk' %}{% include 'card.njk' %}");
    expect(njk.extends).toBe('layout.njk');
    expect(njk.includes).toContain('card.njk');
  });

  it('analyze flags forbidden edge imports', () => {
    const root = mkProject({
      'pages/api/bad.get.js': "const fs = require('fs'); module.exports = (req,res)=>res.end();",
    });
    const graph = new BuildGraph();
    const { routes } = discoverRoutes({ cwd: root, config: { pagesDir: 'pages' }, graph });
    const ctx = { cwd: root, config: { pagesDir: 'pages' }, adapter: { name: 'cloudflare' }, graph };
    const { edgeIssues } = analyzeRoutes(ctx, routes);
    expect(edgeIssues.some((e) => e.code === 'WS_BUILD_EDGE_INCOMPATIBLE')).toBe(true);
  });

  it('analyze reads route middleware from config module', () => {
    const root = mkProject({
      'pages/secure/index.njk': '<p>S</p>',
      'pages/secure/index.js': `
        const mw = (req,res,next)=>next();
        module.exports = { middleware: ['auth', ['rateLimit', { max: 1 }]], load: async () => ({}) };
      `,
    });
    const graph = new BuildGraph();
    const { routes } = discoverRoutes({ cwd: root, config: { pagesDir: 'pages' }, graph });
    const ctx = { cwd: root, config: { pagesDir: 'pages' }, adapter: { name: 'node' }, graph };
    const { analyzed } = analyzeRoutes(ctx, routes);
    expect(analyzed[0].middleware.length).toBeGreaterThan(0);
  });
});

describe('compile helpers', () => {
  it('buildMiddlewareManifest resolves named and factory middleware', () => {
    const mw = buildMiddlewareManifest([
      { middleware: ['auth', ['rateLimit', { max: 10 }]] },
      { middleware: ['auth'] },
    ]);
    expect(mw.auth.kind).toBe('named');
    expect(mw.rateLimit.kind).toBe('named-factory');
  });

  it('isEdgeCompatible marks admin and upload as node-only', () => {
    expect(isEdgeCompatible('adminPanelPlugin')).toBe(false);
    expect(isEdgeCompatible('healthCheckPlugin')).toBe(true);
  });

  it('compilePlugins discovers plugins from config/app.js', async () => {
    const root = mkProject({
      'config/app.js': 'module.exports = { plugins: [healthCheckPlugin] };',
    });
    const ctx = { cwd: root, config: { plugins: [] }, adapter: { name: 'node' } };
    const { plugins } = await compilePlugins(ctx);
    expect(plugins.some((p) => p.name === 'healthCheckPlugin')).toBe(true);
  });

  it('compileTemplates flattens includes and collects i18n', () => {
    const root = mkProject({
      'pages/home/index.njk': '<p>{% include "part.njk" %}</p>',
      'pages/home/part.njk': '<span>Part</span>',
      'pages/locales/en.json': JSON.stringify({ title: 'Home' }),
      'pages/home/locales/en.json': JSON.stringify({ subtitle: 'Hi' }),
    });
    const graph = new BuildGraph();
    const routes = [{
      type: 'ssr',
      sourceFile: 'pages/home/index.njk',
      absPath: path.join(root, 'pages/home/index.njk'),
      njk: { includes: ['part.njk'], extends: null },
    }];
    const ctx = { cwd: root, config: { pagesDir: 'pages' }, graph };
    const { templates, i18n } = compileTemplates(ctx, routes, null);
    expect(templates['tpl:pages/home/index.njk'].body).toContain('<span>Part</span>');
    expect(i18n['global:en'].title).toBe('Home');
  });

  it('flattenIncludes inlines nested partials', () => {
    const root = mkProject({
      'pages/a/part.njk': '<b>P</b>',
      'pages/a/page.njk': '<div>{% include "part.njk" %}</motion.div>'.replace('motion.', ''),
    });
    const body = flattenIncludes(
      '<div>{% include "part.njk" %}</motion.div>'.replace('motion.', ''),
      path.join(root, 'pages/a/page.njk'),
      path.join(root, 'pages'),
      null
    );
    expect(body).toContain('<b>P</b>');
  });

  it('schemaToJson handles null compiled schema', () => {
    expect(schemaToJson(null)).toEqual({ query: null, body: null, params: null });
  });
});

describe('validate and manifest assembly', () => {
  it('validateBuild reports missing SSR template', () => {
    const manifest = {
      routes: [{ type: 'ssr', template: { id: 'tpl:missing.njk' }, source: { page: 'x.njk' } }],
      templates: {},
      plugins: [],
    };
    const result = validateBuild({}, manifest, resolveAdapter('node'), []);
    expect(result.errors.some((e) => e.code === 'WS_BUILD_NJK_MISSING')).toBe(true);
  });

  it('assertValid throws on errors and optional warnings', () => {
    expect(() => assertValid({ ok: false, errors: [{ code: 'X', message: 'bad' }], warnings: [] })).toThrow(
      BuildError
    );
    expect(() =>
      assertValid({ ok: true, errors: [], warnings: [{ code: 'W', message: 'warn' }] }, { failOnWarnings: true })
    ).toThrow(BuildError);
    expect(() => assertValid({ ok: true, errors: [], warnings: [] })).not.toThrow();
  });

  it('assembleManifest stamps framework and adapter metadata', () => {
    const graph = new BuildGraph();
    graph.addNode('file:x', 'api-route', 'abc');
    const manifest = assembleManifest(
      {
        cwd: process.cwd(),
        config: { publicDir: 'public' },
        adapter: resolveAdapter('node'),
        graph,
      },
      {
        routeEntries: [],
        templates: {},
        i18n: {},
        middleware: {},
        plugins: [],
        hooks: {},
      }
    );
    expect(manifest.version).toBe(3);
    expect(manifest.framework.name).toBe('webspresso');
    expect(manifest.adapter.name).toBe('node');
  });
});

describe('bundle phase and adapters', () => {
  it('bundlePhase writes artifacts to output directory', async () => {
    const root = mkProject({});
    const graph = new BuildGraph();
    const adapter = resolveAdapter('node');
    const manifest = assembleManifest(
      { cwd: root, config: {}, adapter, graph },
      { routeEntries: [], templates: {}, i18n: {}, middleware: {}, plugins: [], hooks: {} }
    );
    const result = await bundlePhase(
      { cwd: root, config: { publicDir: 'public' }, adapter, graph },
      manifest,
      'export const handlers = {};'
    );
    expect(fs.existsSync(result.artifacts.manifest)).toBe(true);
    expect(fs.existsSync(result.artifacts.handlers)).toBe(true);
  });

  it('node and cloudflare adapters expose generateEntry and bundleOptions', () => {
    const node = resolveAdapter('node');
    const cf = resolveAdapter('cloudflare');
    expect(node.generateEntry({}).length).toBeGreaterThan(50);
    expect(cf.generateEntry({}).length).toBeGreaterThan(50);
    expect(node.bundleOptions({}, '/tmp').platform).toBe('node');
    expect(cf.bundleOptions({}, '/tmp').platform).toBe('node');
  });

  it('cloudflare validate rejects memory session store', () => {
    const cf = resolveAdapter('cloudflare');
    const r = cf.validate({ plugins: [], middleware: { session: { store: 'memory' } } });
    expect(r.errors.some((e) => e.code === 'WS_BUILD_SESSION_MEMORY')).toBe(true);
  });
});

describe('loadI18nFromManifest', () => {
  it('merges global and route namespaces for locale', () => {
    const merged = loadI18nFromManifest(
      {
        'global:en': { title: 'G' },
        'route:pages/home:en': { subtitle: 'R' },
        'global:de': { title: 'D' },
      },
      ['global:en', 'route:pages/home:en'],
      'en'
    );
    expect(merged.title).toBe('G');
    expect(merged.subtitle).toBe('R');
  });
});

describe('runBuild on fixture project', () => {
  it('builds minimal temp project end-to-end', async () => {
    const root = mkProject({
      'pages/api/health.get.js': 'module.exports = (req,res)=>res.json({ ok: true });',
      'pages/index.njk': '<h1>Home</h1>',
      'webspresso.build.js': 'module.exports = { adapter: "node", pagesDir: "pages" };',
    });
    const result = await runBuild({ cwd: root, adapter: 'node', skipBundle: true });
    expect(result.manifest.routes.length).toBe(2);
  });
});
