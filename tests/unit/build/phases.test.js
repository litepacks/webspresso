/**
 * Build phase unit tests (analyze, bundle, templates)
 */

const fs = require('fs');
const path = require('path');
const { discoverRoutes } = require('../../../core/build/phases/01-discover');
const {
  analyzeRoutes,
  extractRequires,
  parseNjkDirectives,
  resolveNjkPath,
} = require('../../../core/build/phases/02-analyze');
const { bundlePhase, copyPublicAssets } = require('../../../core/build/phases/05-bundle');
const { compileTemplates } = require('../../../core/build/phases/03-compile/templates');
const { BuildGraph } = require('../../../core/build/graph/build-graph');
const { resolveAdapter } = require('../../../core/build');
const { createBuildProject } = require('./helpers');

describe('build phases', () => {
  it('extractRequires finds require and import', () => {
    const src = `const x = require('fs'); import y from 'path';`;
    expect(extractRequires(src)).toEqual(expect.arrayContaining(['fs', 'path']));
  });

  it('parseNjkDirectives parses extends/include/import', () => {
    const content = `{% extends "layout.njk" %}{% include "part.njk" %}`;
    const parsed = parseNjkDirectives(content);
    expect(parsed.extends).toBe('layout.njk');
    expect(parsed.includes).toContain('part.njk');
  });

  it('analyzeRoutes flags cloudflare-incompatible imports', () => {
    const cwd = createBuildProject();
    const apiDir = path.join(cwd, 'pages/api');
    fs.writeFileSync(
      path.join(apiDir, 'edge-bad.get.js'),
      `const fs = require('fs'); module.exports = (req, res) => res.end();`
    );
    const ctx = {
      cwd,
      config: { pagesDir: 'pages', viewsDir: 'views', adapter: 'cloudflare' },
      adapter: resolveAdapter('cloudflare'),
      graph: new BuildGraph(),
    };
    const { routes } = discoverRoutes(ctx);
    const { edgeIssues } = analyzeRoutes(ctx, routes);
    expect(edgeIssues.some((e) => e.code === 'WS_BUILD_EDGE_INCOMPATIBLE')).toBe(true);
  });

  it('bundlePhase writes artifacts and copies public assets', async () => {
    const cwd = createBuildProject();
    fs.writeFileSync(path.join(cwd, 'public', 'asset.txt'), 'hello');
    const ctx = {
      cwd,
      config: { pagesDir: 'pages', viewsDir: 'views', publicDir: 'public' },
      adapter: resolveAdapter('node'),
      graph: new BuildGraph(),
    };
    const manifest = { routes: [], templates: {} };
    const result = await bundlePhase(ctx, manifest, 'export const handlers = {};', {
      skipEsbuild: true,
    });
    expect(fs.existsSync(result.artifacts.manifest)).toBe(true);
    expect(fs.existsSync(result.artifacts.handlers)).toBe(true);
    expect(
      fs.existsSync(path.join(result.outputDir, 'assets', 'public', 'asset.txt'))
    ).toBe(true);
  });

  it('compileTemplates bundles njk bodies and locales', () => {
    const cwd = createBuildProject();
    const ctx = {
      cwd,
      config: { pagesDir: 'pages', viewsDir: 'views' },
      graph: new BuildGraph(),
    };
    const { routes } = discoverRoutes(ctx);
    const { analyzed, viewsDir } = analyzeRoutes(ctx, routes);
    const ssrRoutes = analyzed.filter((r) => r.type === 'ssr');
    const { templates, i18n } = compileTemplates(ctx, ssrRoutes, viewsDir);
    expect(Object.keys(templates).length).toBeGreaterThan(0);
    expect(Object.keys(i18n).length).toBeGreaterThan(0);
  });

  it('resolveNjkPath returns null for missing template', () => {
    const cwd = createBuildProject();
    const pagesDir = path.join(cwd, 'pages');
    const resolved = resolveNjkPath('missing.njk', path.join(pagesDir, 'about/index.njk'), pagesDir, path.join(cwd, 'views'));
    expect(resolved).toBeNull();
  });
});
