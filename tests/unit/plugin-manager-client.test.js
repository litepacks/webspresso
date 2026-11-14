import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nunjucks from 'nunjucks';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  getPluginManager,
  createPluginManager,
  resetPluginManager,
} = require('../../core/plugins/plugin-manager');
const {
  defineFragment,
  attachSsrFragmentHelper,
  resolvePendingSsrFragments,
  createFragmentRefreshHandler,
} = require('../../core/client/server-fragments');
const {
  discoverClientControllers,
  findPageEntryPoints,
} = require('../../src/bundle/index');

describe('PluginManager client integration (controllers, services, fragments)', () => {
  let tmpDir;

  beforeEach(() => {
    resetPluginManager();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-pm-client-'));
  });

  afterEach(() => {
    resetPluginManager();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers client controllers, client services, and fragments via plugin ctx and exposes manifest', async () => {
    const pm = createPluginManager();
    const ctrlPath = path.join(tmpDir, 'widget.client.js');
    const svcPath = path.join(tmpDir, 'analytics.service.js');
    fs.writeFileSync(ctrlPath, 'export default {};');
    fs.writeFileSync(svcPath, 'export default {};');

    const badgeFrag = defineFragment({
      template: 'badge.njk',
      dependsOn: ['notifications'],
      async load({ input }) {
        return { count: input.count || 3 };
      },
    });

    await pm.register(
      [
        {
          name: 'notify-plugin',
          version: '1.0.0',
          register(ctx) {
            ctx.registerClientController('notify-widget', ctrlPath);
            ctx.registerClientService('notify-api', svcPath);
            ctx.registerFragment('notify-badge', badgeFrag);
          },
        },
      ],
      {}
    );

    const manifest = pm.getClientManifest();
    expect(manifest.controllers).toEqual([
      { name: 'notify-widget', filePath: ctrlPath, pluginName: 'notify-plugin' },
    ]);
    expect(manifest.services).toEqual([
      { name: 'notify-api', filePath: svcPath, pluginName: 'notify-plugin' },
    ]);
    expect(manifest.fragments).toEqual(['notify-badge']);
    expect(pm.getFragment('notify-badge')).toBe(badgeFrag);
  });

  it('throws collision error when two plugins register different files for the same controller or service', async () => {
    const pm = createPluginManager();

    pm.registerClientController('shared-ctrl', '/a/ctrl.client.js', 'plugin-a');
    expect(() =>
      pm.registerClientController('shared-ctrl', '/b/ctrl.client.js', 'plugin-b')
    ).toThrowError(/Client controller name collision/);

    pm.registerClientService('shared-svc', '/a/svc.js', 'plugin-a');
    expect(() =>
      pm.registerClientService('shared-svc', '/b/svc.js', 'plugin-b')
    ).toThrowError(/Client service name collision/);
  });

  it('includes plugin client controllers & services in bundler discovery and detects app vs plugin collisions', async () => {
    const pm = getPluginManager();
    const pluginCtrl = path.join(tmpDir, 'plugin-widget.client.js');
    const pluginSvc = path.join(tmpDir, 'plugin-toast.service.js');
    fs.writeFileSync(pluginCtrl, 'export default {};');
    fs.writeFileSync(pluginSvc, 'export default {};');

    await pm.register(
      [
        {
          name: 'ui-plugin',
          version: '1.0.0',
          register(ctx) {
            ctx.registerClientController('ui-widget', pluginCtrl);
            ctx.registerClientService('ui-toast', pluginSvc);
          },
        },
      ],
      {}
    );

    const entries = findPageEntryPoints(tmpDir);
    expect(entries['plugins/ui-plugin/ui-widget']).toBe(pluginCtrl);
    expect(entries['plugins/ui-plugin/services/ui-toast']).toBe(pluginSvc);

    const discovered = discoverClientControllers(tmpDir);
    expect(discovered.some((c) => c.controllerName === 'ui-widget' && c.pluginName === 'ui-plugin')).toBe(true);

    // Now create an app controller with the same name -> must throw CONTROLLER_NAME_COLLISION
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages', 'ui-widget.client.js'), 'export default {};');
    expect(() => discoverClientControllers(tmpDir)).toThrowError(/Controller name collision/);
  });

  it('renders and refreshes plugin-registered fragments via fsy.fragment() and /__webspresso/fragments', async () => {
    const pm = getPluginManager();
    fs.writeFileSync(path.join(tmpDir, 'badge.njk'), '<span>Count: {{ count }}</span>');
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(tmpDir));

    await pm.register(
      [
        {
          name: 'badge-plugin',
          version: '1.0.0',
          register(ctx) {
            ctx.registerFragment(
              'global-badge',
              defineFragment({
                template: 'badge.njk',
                dependsOn: ['badge'],
                async load({ input }) {
                  return { count: Number(input.count || 5) };
                },
              })
            );
          },
        },
      ],
      {}
    );

    // 1. SSR render pass via fsy.fragment() on a page without local fragments
    const req = { params: {}, query: {}, body: {}, headers: {} };
    const res = { locals: {} };
    const fsy = {};
    const ctx = {};
    attachSsrFragmentHelper({
      req,
      res,
      ctx,
      pageMod: {},
      pagePath: '/home',
      nunjucksEnv: env,
      fsy,
    });

    const tokenHtml = fsy.fragment('global-badge', { count: 7 });
    const rendered = await resolvePendingSsrFragments(String(tokenHtml), req);
    expect(rendered).toContain('Count: 7');
    expect(rendered).toContain('data-w-fragment="global-badge"');

    // 2. Refresh pass via /__webspresso/fragments handler
    const handler = createFragmentRefreshHandler({
      getPageEntries: () => [{ routePath: '/home', pageMod: {} }],
      nunjucksEnv: env,
      buildFsy: () => ({}),
      buildContext: (r, s, extra) => ({ req: r, res: s, ...extra }),
    });

    let statusCode = 200;
    let jsonPayload = null;
    await handler(
      {
        method: 'POST',
        headers: {},
        body: {
          pagePath: '/home',
          fragments: [{ instanceId: 'global-badge:default', name: 'global-badge', input: { count: 12 } }],
        },
      },
      {
        setHeader() {},
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonPayload = data;
          return this;
        },
      },
      (err) => {
        if (err) throw err;
      }
    );

    expect(statusCode).toBe(200);
    expect(jsonPayload.ok).toBe(true);
    expect(jsonPayload.fragments['global-badge:default'].html).toContain('Count: 12');
  });
});
