import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import nunjucks from 'nunjucks';
import contentPlugin from '../../plugins/content';
import { createPluginManager } from '../../src/plugin-manager';

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

describe('contentPlugin', () => {
  it('returns disabled plugin when resolved config is off', () => {
    const p = contentPlugin({ enabled: false });
    expect(p.name).toBe('content');
    p.onRoutesReady();
  });

  it('register adds helpers and onRoutesReady sets contentService', () => {
    const resolved = contentPlugin.resolveContentConfig(
      {
        enabled: true,
        dir: path.join(fixtureRoot, 'content'),
        collections: { blog: { route: '/blog/:slug', indexRoute: '/blog' } },
      },
      'development',
      fixtureRoot
    );
    const plugin = contentPlugin(resolved);
    const pm = createPluginManager();
    const env = nunjucks.configure({ autoescape: true, noCache: true });
    const helpers = new Map();
    plugin.register({
      nunjucksEnv: env,
      addHelper: (n, fn) => helpers.set(n, fn),
    });
    expect(helpers.has('content_latest')).toBe(true);
    expect(env.getGlobal('content')).toBeTruthy();

    const routes = [];
    const pluginManager = { routes, getHelpers: () => ({}) };
    plugin.onRoutesReady({
      app: { get: () => {} },
      nunjucksEnv: env,
      options: {
        pagesDir: path.join(fixtureRoot, 'pages'),
        viewsDir: path.join(fixtureRoot, 'views'),
        pluginManager,
      },
      usePlugin: () => null,
    });
    expect(pluginManager.contentService).toBeTruthy();
  });

  it('api.registerCollection merges config and rebuilds', () => {
    const dir = path.join(fixtureRoot, 'content');
    const resolved = contentPlugin.resolveContentConfig(
      { enabled: true, dir },
      'development',
      fixtureRoot
    );
    const plugin = contentPlugin(resolved);
    plugin.api.registerCollection('docs', { route: '/docs/:slug' });
    const svc = plugin.api.getService();
    expect(svc.config.collections.docs).toBeTruthy();
    expect(svc.config.collections.docs).toBeTruthy();
  });

  it('startContentWatcher no-ops when chokidar missing', () => {
    const resolved = contentPlugin.resolveContentConfig(
      { enabled: true, dir: path.join(fixtureRoot, 'content') },
      'development',
      fixtureRoot
    );
    const plugin = contentPlugin(resolved);
    vi.doMock('chokidar', () => {
      throw new Error('missing');
    });
    plugin.onRoutesReady({
      app: { get: () => {} },
      nunjucksEnv: nunjucks.configure({ noCache: true }),
      options: {
        pagesDir: fixtureRoot,
        pluginManager: { routes: [], getHelpers: () => ({}) },
      },
      usePlugin: () => null,
    });
  });
});
