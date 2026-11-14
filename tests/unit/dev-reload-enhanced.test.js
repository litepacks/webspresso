const {
  wait,
  createTempDir,
  cleanupDir
} = require('../utils');

/**
 * Unit & Integration tests for Enhanced Dev Live Reload (Templates, Views, Pages & Cache Invalidation)
 */

const fs = require('fs');
const path = require('path');
const { createApp } = require('../../index');
const { createDevReloadHub } = require('../../src/dev-reload');

async function waitFor(fn, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await wait(25);
  }
  return fn();
}

describe('Enhanced Dev Live Reload (Template & View Watching)', () => {
  const baseFixtureDir = createTempDir('temp-dev-reload-test');

  beforeAll(() => {
    fs.mkdirSync(baseFixtureDir, { recursive: true });
  });

  afterAll(() => {
    cleanupDir(baseFixtureDir);
  });

  it('watches viewsDir and triggers full reload when .njk layout is modified', async () => {
    const testViewsDir = path.join(baseFixtureDir, 'views-1');
    const testPagesDir = path.join(baseFixtureDir, 'pages-1');
    fs.mkdirSync(testViewsDir, { recursive: true });
    fs.mkdirSync(testPagesDir, { recursive: true });
    fs.writeFileSync(path.join(testViewsDir, 'layout.njk'), '<html><body>{% block content %}{% endblock %}</body></html>');
    fs.writeFileSync(path.join(testPagesDir, 'index.njk'), '{% extends "layout.njk" %}\n{% block content %}Hi{% endblock %}');

    let templateChangedArg = null;
    const { app } = createApp({
      pagesDir: testPagesDir,
      viewsDir: testViewsDir,
      devReload: {
        enabled: true,
        debounce: 20,
      },
    });

    const receivedEvents = [];
    const origBroadcast = app.devReloadHub.broadcast;
    app.devReloadHub.broadcast = (type, payload) => {
      receivedEvents.push({ type, payload });
      return origBroadcast(type, payload);
    };

    app.devReloadHub.setOnTemplateChange((file) => {
      templateChangedArg = file;
    });

    // Modify views/layout.njk
    const layoutPath = path.join(testViewsDir, 'layout.njk');
    fs.writeFileSync(layoutPath, `<html><body><!-- updated ${Date.now()} -->{% block content %}{% endblock %}</body></html>`);

    const ok = await waitFor(() => receivedEvents.some((e) => e.type === 'full'));
    expect(ok).toBe(true);

    const fullEvent = receivedEvents.find((e) => e.type === 'full');
    expect(fullEvent).toBeDefined();
    expect(fullEvent.payload.reason).toBe('views');
    expect(templateChangedArg).toBeDefined();

    app.devReloadHub.close();
  });

  it('watches pagesDir and triggers full reload when .njk page or .js loader is modified', async () => {
    const testPagesDir = path.join(baseFixtureDir, 'pages-2');
    fs.mkdirSync(testPagesDir, { recursive: true });
    fs.writeFileSync(path.join(testPagesDir, 'index.njk'), '<h1>Initial</h1>');

    const { app } = createApp({
      pagesDir: testPagesDir,
      devReload: {
        enabled: true,
        debounce: 20,
      },
    });

    const receivedEvents = [];
    app.devReloadHub.broadcast = (type, payload) => {
      receivedEvents.push({ type, payload });
    };

    // Allow initial directory settlement before tracking events
    await wait(200);
    receivedEvents.length = 0;

    // Modify pages/index.njk
    const pageNjk = path.join(testPagesDir, 'index.njk');
    fs.writeFileSync(pageNjk, `<h1>Updated ${Date.now()}</h1>`);

    const ok = await waitFor(() => receivedEvents.some((e) => e.type === 'full'));
    expect(ok).toBe(true);

    const pageEvent = receivedEvents.find((e) => e.type === 'full');
    expect(pageEvent).toBeDefined();
    expect(pageEvent.payload.reason).toBe('pages');

    app.devReloadHub.close();
  });

  it('discriminates CSS changes inside views or pages as css hot reload rather than full reload', async () => {
    const testViewsDir = path.join(baseFixtureDir, 'views-3');
    fs.mkdirSync(testViewsDir, { recursive: true });
    fs.writeFileSync(path.join(testViewsDir, 'layout.njk'), '<html><body>Hello</body></html>');

    const { app } = createApp({
      pagesDir: path.join(baseFixtureDir, 'pages-3'),
      viewsDir: testViewsDir,
      devReload: {
        enabled: true,
        debounce: 20,
      },
    });

    const receivedEvents = [];
    app.devReloadHub.broadcast = (type, payload) => {
      receivedEvents.push({ type, payload });
    };

    // Allow initial directory settlement before tracking events
    await wait(200);
    receivedEvents.length = 0;

    // Add a css file inside testViewsDir
    const viewCss = path.join(testViewsDir, 'component.css');
    fs.writeFileSync(viewCss, `.component { color: red; }`);

    const ok = await waitFor(() => receivedEvents.some((e) => e.type === 'css'), 5000);
    expect(ok).toBe(true);

    const cssEvent = receivedEvents.find((e) => e.type === 'css');
    expect(cssEvent).toBeDefined();
    expect(cssEvent.payload.file).toContain('component.css');

    // Should NOT have triggered a full reload for a css file
    const fullEvent = receivedEvents.find((e) => e.type === 'full');
    expect(fullEvent).toBeUndefined();

    app.devReloadHub.close();
  });

  it('watches extraWatch directories configured via devReload.watch', async () => {
    const testExtraDir = path.join(baseFixtureDir, 'extra-4');
    fs.mkdirSync(testExtraDir, { recursive: true });
    fs.writeFileSync(path.join(testExtraDir, 'extra.txt'), 'extra content');

    const { app } = createApp({
      pagesDir: path.join(baseFixtureDir, 'pages-4'),
      devReload: {
        enabled: true,
        debounce: 20,
        watch: [testExtraDir],
      },
    });

    const receivedEvents = [];
    app.devReloadHub.broadcast = (type, payload) => {
      receivedEvents.push({ type, payload });
    };

    // Allow initial directory settlement before tracking events
    await wait(200);
    receivedEvents.length = 0;

    // Modify file inside extra directory
    const extraFile = path.join(testExtraDir, 'extra.txt');
    fs.writeFileSync(extraFile, `extra content ${Date.now()}`);

    const ok = await waitFor(() => receivedEvents.some((e) => e.type === 'full'), 5000);
    expect(ok).toBe(true);

    const fullEvent = receivedEvents.find((e) => e.type === 'full');
    expect(fullEvent).toBeDefined();
    expect(fullEvent.payload.reason).toBe('extra');

    app.devReloadHub.close();
  });

  it('ignores editor swap, temporary files, and test files', async () => {
    const testPagesDir = path.join(baseFixtureDir, 'pages-5');
    fs.mkdirSync(testPagesDir, { recursive: true });
    fs.writeFileSync(path.join(testPagesDir, 'index.njk'), '<h1>Initial</h1>');

    const { app } = createApp({
      pagesDir: testPagesDir,
      devReload: {
        enabled: true,
        debounce: 20,
      },
    });

    // Allow initial directory settlement before tracking events
    await wait(250);

    const receivedEvents = [];
    app.devReloadHub.broadcast = (type, payload) => {
      receivedEvents.push({ type, payload });
    };

    // Write temp / swap / test files
    fs.writeFileSync(path.join(testPagesDir, 'index.njk.tmp'), 'temp');
    fs.writeFileSync(path.join(testPagesDir, '.index.njk.swp'), 'swap');
    fs.writeFileSync(path.join(testPagesDir, 'index.test.js'), '// test');

    await wait(150);

    expect(receivedEvents.length).toBe(0);

    app.devReloadHub.close();
  });

  it('supports programmatic cache invalidation and trigger APIs', async () => {
    let clearedHookCalled = false;
    const mockNunjucks = {
      invalidateCalled: false,
      loaders: [{ cache: { 'layout.njk': 'compiled' }, invalidateCalled: false, invalidateCache() { this.invalidateCalled = true; } }],
      invalidateCache() {
        this.invalidateCalled = true;
      },
    };

    const hub = createDevReloadHub({
      enabled: true,
      nunjucksEnv: mockNunjucks,
      onTemplateChange: () => {
        clearedHookCalled = true;
      },
    });

    expect(hub.getClientsCount()).toBe(0);
    expect(typeof hub.triggerTemplateReload).toBe('function');
    expect(typeof hub.triggerCssReload).toBe('function');
    expect(typeof hub.invalidateTemplateCache).toBe('function');

    // Trigger invalidation
    hub.invalidateTemplateCache('layout.njk');
    expect(clearedHookCalled).toBe(true);
    expect(mockNunjucks.invalidateCalled).toBe(true);
    expect(mockNunjucks.loaders[0].cache).toEqual({});
    expect(mockNunjucks.loaders[0].invalidateCalled).toBe(true);

    // Track broadcasts
    const events = [];
    hub.broadcast = (t, p) => events.push({ t, p });

    hub.triggerTemplateReload('layout.njk', 'manual');
    await wait(70);
    expect(events.some((e) => e.t === 'full')).toBe(true);

    hub.triggerCssReload('custom.css');
    await wait(70);
    expect(events.some((e) => e.t === 'css' && e.p.file === 'custom.css')).toBe(true);

    hub.close();
  });

  it('respects watchTemplates: false to disable views and pages watching', async () => {
    const testViewsDir = path.join(baseFixtureDir, 'views-7');
    const testPagesDir = path.join(baseFixtureDir, 'pages-7');
    fs.mkdirSync(testViewsDir, { recursive: true });
    fs.mkdirSync(testPagesDir, { recursive: true });

    const { app } = createApp({
      pagesDir: testPagesDir,
      viewsDir: testViewsDir,
      devReload: {
        enabled: true,
        watchTemplates: false,
      },
    });

    const watchedPaths = app.devReloadHub.getWatchedPaths();
    // Should NOT have watched viewsDir or pagesDir
    expect(watchedPaths).not.toContain(path.resolve(testViewsDir));
    expect(watchedPaths).not.toContain(path.resolve(testPagesDir));

    app.devReloadHub.close();
  });

  it('includes scroll position preservation in dev-reload client script and skips .client.* files when ignoreClientFiles is enabled', async () => {
    const testPagesDir = path.join(baseFixtureDir, 'pages-8');
    fs.mkdirSync(testPagesDir, { recursive: true });
    fs.writeFileSync(path.join(testPagesDir, 'index.client.js'), 'console.log(1);');

    const hub = createDevReloadHub({
      enabled: true,
      pagesDir: testPagesDir,
      options: { debounce: 20, ignoreClientFiles: true },
    });

    // Verify client script includes scroll preservation helpers
    let sentScript = '';
    const mockRes = {
      type: () => {},
      setHeader: () => {},
      send: (body) => { sentScript = body; },
    };
    hub.handleScript({}, mockRes);
    expect(sentScript).toContain('__ws_dev_scroll');
    expect(sentScript).toContain('saveScrollPosition');
    expect(sentScript).toContain('restoreScrollPosition');

    // Verify .client.js edits do not trigger premature template reload when ignoreClientFiles is true
    let templateReloads = 0;
    const origBroadcast = hub.broadcast;
    hub.broadcast = (type, payload) => {
      if (type === 'full') templateReloads += 1;
      return origBroadcast(type, payload);
    };

    fs.writeFileSync(path.join(testPagesDir, 'index.client.js'), 'console.log(2);');
    await wait(120);
    expect(templateReloads).toBe(0);

    // Toggling off allows normal .njk reloads
    hub.setIgnoreClientFiles(false);
    fs.writeFileSync(path.join(testPagesDir, 'about.njk'), '<h1>About</h1>');
    await wait(250);
    expect(templateReloads).toBeGreaterThanOrEqual(1);

    hub.close();
  });
});
