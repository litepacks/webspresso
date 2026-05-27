/**
 * Additional build coverage — edge branches and bundle options
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { bundlePhase, copyPublicAssets } = require('../../../core/build/phases/05-bundle');
const { analyzeRoutes, resolveNjkPath } = require('../../../core/build/phases/02-analyze');
const { discoverRoutes } = require('../../../core/build/phases/01-discover');
const { BuildGraph } = require('../../../core/build/graph/build-graph');
const { assembleManifest } = require('../../../core/build/phases/04-manifest');
const { resolveAdapter, runBuild, BuildError } = require('../../../core/build');
const { hashFile } = require('../../../core/build/graph/hash');

function mkProject(structure = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-edge-'));
  for (const [rel, content] of Object.entries(structure)) {
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return root;
}

describe('bundlePhase options', () => {
  it('skipEsbuild copies entry without bundling', async () => {
    const root = mkProject({});
    const adapter = resolveAdapter('node');
    const graph = new BuildGraph();
    const manifest = assembleManifest(
      { cwd: root, config: {}, adapter, graph },
      { routeEntries: [], templates: {}, i18n: {}, middleware: {}, plugins: [], hooks: {} }
    );
    const result = await bundlePhase(
      { cwd: root, config: { publicDir: 'public' }, adapter, graph },
      manifest,
      'export const handlers = {};',
      { skipEsbuild: true }
    );
    expect(result.bundled).toBe(false);
    expect(fs.existsSync(result.artifacts.manifest)).toBe(true);
  });

  it('copyPublicAssets no-ops when public dir missing', () => {
    const root = mkProject({});
    copyPublicAssets({ cwd: root, config: { publicDir: 'missing-public' } }, root);
    expect(fs.existsSync(path.join(root, 'missing-public'))).toBe(false);
  });

  it('copyPublicAssets copies public files', () => {
    const root = mkProject({ 'public/a.txt': 'hello' });
    const out = path.join(root, 'out');
    copyPublicAssets({ cwd: root, config: { publicDir: 'public' } }, out);
    expect(fs.readFileSync(path.join(out, 'assets/public/a.txt'), 'utf8')).toBe('hello');
  });
});

describe('analyze phase edge cases', () => {
  it('detects unresolved njk includes and extends', () => {
    const root = mkProject({
      'pages/x/index.njk': "{% include 'missing.njk' %}{% extends 'nope.njk' %}",
    });
    const graph = new BuildGraph();
    const { routes } = discoverRoutes({ cwd: root, config: { pagesDir: 'pages' }, graph });
    const { analyzed } = analyzeRoutes(
      { cwd: root, config: { pagesDir: 'pages' }, adapter: { name: 'node' }, graph },
      routes
    );
    expect(analyzed[0].unresolvedTemplates.length).toBeGreaterThan(0);
  });

  it('resolveNjkPath finds views partial', () => {
    const root = mkProject({
      'views/partials/card.njk': '<div/>',
      'pages/home/index.njk': 'x',
    });
    const resolved = resolveNjkPath(
      'partials/card.njk',
      path.join(root, 'pages/home/index.njk'),
      path.join(root, 'pages'),
      path.join(root, 'views')
    );
    expect(resolved).toContain('card.njk');
  });

  it('loads global hooks path when _hooks.js exists', () => {
    const root = mkProject({
      'pages/_hooks.js': 'module.exports = { onRequest: async () => {} };',
      'pages/index.njk': '<p>x</p>',
    });
    const graph = new BuildGraph();
    const { routes } = discoverRoutes({ cwd: root, config: { pagesDir: 'pages' }, graph });
    const { globalHooks } = analyzeRoutes(
      { cwd: root, config: { pagesDir: 'pages' }, adapter: { name: 'node' }, graph },
      routes
    );
    expect(globalHooks).toBe('pages/_hooks.js');
  });
});

describe('runBuild validation failures', () => {
  it('throws BuildError when cloudflare adapter hits node-only plugins in config', async () => {
    const root = mkProject({
      'pages/index.njk': '<p>Hi</p>',
      'config/app.js': 'module.exports = { plugins: [adminPanelPlugin, uploadPlugin] };',
      'webspresso.build.js': 'module.exports = { adapter: "cloudflare", pagesDir: "pages" };',
    });
    await expect(runBuild({ cwd: root, adapter: 'cloudflare', skipBundle: true })).rejects.toThrow(
      BuildError
    );
  });
});

describe('hashFile', () => {
  it('hashes existing file content', () => {
    const root = mkProject({ 'a.txt': 'content' });
    expect(hashFile(path.join(root, 'a.txt'))).toHaveLength(64);
  });
});
