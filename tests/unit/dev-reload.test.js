/**
 * Unit & Integration tests for Dev Live & Hot Reload (SSE-based CSS Hot Reload)
 * Tests:
 * 1. DevReloadHub creation & disabled behavior
 * 2. Serving /__webspresso/dev-reload.js script
 * 3. SSE endpoint /__webspresso/dev-reload streaming
 * 4. Broadcasting 'css' and 'full' reload events to SSE clients
 * 5. Auto-inject middleware injecting script tag into HTML before </body>
 * 6. Template helper fsy.devReload() in dev vs prod
 * 7. Native file watcher detecting CSS file changes and broadcasting 'css'
 * 8. Clean shutdown & resource cleanup
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const supertest = require('supertest');
const { createApp } = require('../../index');
const { createHelpers, utils } = require('../../src/helpers');
const { createDevReloadHub } = require('../../src/dev-reload');

describe('Dev Live & Hot Reload (SSE CSS Hot Reload)', () => {
  const tempPublicDir = path.resolve(__dirname, '../fixtures/temp-dev-reload-public');

  beforeAll(() => {
    fs.mkdirSync(path.join(tempPublicDir, 'css'), { recursive: true });
    fs.writeFileSync(path.join(tempPublicDir, 'css', 'style.css'), '/* initial */');
  });

  afterAll(() => {
    try {
      fs.rmSync(tempPublicDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('createDevReloadHub returns null when enabled is false', () => {
    const hub = createDevReloadHub({ enabled: false });
    expect(hub).toBeNull();
  });

  it('serves client runtime script via GET /__webspresso/dev-reload.js', async () => {
    const { app } = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      publicDir: tempPublicDir,
      devReload: true,
    });

    const res = await supertest(app).get('/__webspresso/dev-reload.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.text).toContain('/__webspresso/dev-reload');
    expect(res.text).toContain('reloadCss');
    expect(res.text).toContain('CSS hot reloaded');
    expect(res.text).toContain('window.location.reload()');

    if (app.devReloadHub) {
      app.devReloadHub.close();
    }
  });

  it('establishes SSE stream and receives initial connection and broadcast events', async () => {
    const { app } = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      publicDir: tempPublicDir,
      devReload: { enabled: true, debounce: 20 },
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const messages = [];
      let connectionResolve;
      const connectedPromise = new Promise((resolve) => {
        connectionResolve = resolve;
      });

      const sseReq = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/__webspresso/dev-reload',
          method: 'GET',
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');
          expect(res.headers['cache-control']).toContain('no-cache');

          res.on('data', (chunk) => {
            const str = chunk.toString();
            messages.push(str);
            if (str.includes('connected')) {
              connectionResolve();
            }
          });
        }
      );

      sseReq.end();
      await connectedPromise;

      expect(app.devReloadHub.getClientsCount()).toBe(1);

      // Broadcast CSS hot reload
      app.broadcastDevReload('css', { file: 'style.css' });

      // Wait a moment for chunk delivery
      await new Promise((resolve) => setTimeout(resolve, 80));

      const hasCssEvent = messages.some((m) => m.includes('reload') && m.includes('"type":"css"') && m.includes('style.css'));
      expect(hasCssEvent).toBe(true);

      // Broadcast full reload
      app.broadcastDevReload('full');
      await new Promise((resolve) => setTimeout(resolve, 80));

      const hasFullEvent = messages.some((m) => m.includes('reload') && m.includes('"type":"full"'));
      expect(hasFullEvent).toBe(true);

      sseReq.destroy();
    } finally {
      if (app.devReloadHub) {
        app.devReloadHub.close();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('auto-injects dev-reload.js script into HTML before </body>', async () => {
    const { app } = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      devReload: { enabled: true, autoInject: true },
      setupRoutes: (expressApp) => {
        expressApp.get('/test-page', (req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.send('<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>');
        });

        expressApp.get('/test-api', (req, res) => {
          res.json({ ok: true });
        });

        expressApp.get('/test-already-injected', (req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.send('<html><body><script defer src="/__webspresso/dev-reload.js"></script></body></html>');
        });
      },
    });

    // 1. HTML route should have script injected
    const pageRes = await supertest(app).get('/test-page');
    expect(pageRes.status).toBe(200);
    expect(pageRes.text).toContain('<script defer src="/__webspresso/dev-reload.js"></script>\n</body>');

    // 2. JSON route should NOT have script injected
    const apiRes = await supertest(app).get('/test-api');
    expect(apiRes.status).toBe(200);
    expect(apiRes.body).toEqual({ ok: true });

    // 3. Already injected route should NOT duplicate script tag
    const dupRes = await supertest(app).get('/test-already-injected');
    expect(dupRes.status).toBe(200);
    const occurrences = (dupRes.text.match(/__webspresso\/dev-reload\.js/g) || []).length;
    expect(occurrences).toBe(1);

    if (app.devReloadHub) {
      app.devReloadHub.close();
    }
  });

  it('template helper fsy.devReload() generates script tag in dev and empty string in prod', () => {
    const origEnv = process.env.NODE_ENV;

    try {
      // Dev mode
      process.env.NODE_ENV = 'development';
      const devFsy = createHelpers();
      expect(devFsy.devReload()).toBe('<script defer src="/__webspresso/dev-reload.js"></script>');
      expect(utils.devReload()).toBe('<script defer src="/__webspresso/dev-reload.js"></script>');

      // Production mode
      process.env.NODE_ENV = 'production';
      const prodFsy = createHelpers();
      expect(prodFsy.devReload()).toBe('');
      expect(utils.devReload()).toBe('');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('native file watcher detects CSS file changes and triggers broadcast', async () => {
    const { app } = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      publicDir: tempPublicDir,
      devReload: {
        enabled: true,
        watchCss: true,
        debounce: 25,
      },
    });

    const receivedEvents = [];
    const origBroadcast = app.devReloadHub.broadcast;
    app.devReloadHub.broadcast = (type, payload) => {
      receivedEvents.push({ type, payload });
      return origBroadcast(type, payload);
    };

    // Modify the CSS file in tempPublicDir/css/style.css
    const targetFile = path.join(tempPublicDir, 'css', 'style.css');
    fs.writeFileSync(targetFile, `/* updated ${Date.now()} */`);

    // Wait for debounce and fs.watch notification
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(receivedEvents.length).toBeGreaterThan(0);
    const cssEvent = receivedEvents.find((e) => e.type === 'css');
    expect(cssEvent).toBeDefined();

    if (app.devReloadHub) {
      app.devReloadHub.close();
    }
  });

  it('shutdown closes all watchers and clients cleanly', () => {
    const { app } = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      publicDir: tempPublicDir,
      devReload: true,
    });

    expect(app.devReloadHub).toBeDefined();
    app.devReloadHub.close();
    expect(app.devReloadHub.getClientsCount()).toBe(0);
  });
});
