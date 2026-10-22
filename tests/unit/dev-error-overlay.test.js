const {
  wait
} = require('../utils');

/**
 * Unit & Integration tests for Dev Error Overlay (Terminal-Free In-Browser Error Frame)
 * Tests:
 * 1. Client runtime script embeds showOverlay, clearOverlay, escapeHtml, and DOM styling
 * 2. SSE streaming of 'error' and 'clear-error' events from DevReloadHub
 * 3. Client script DOM execution: rendering error frame, line numbers, caret pointer, and dismiss
 * 4. esbuild incremental rebuild error capture & auto-clear lifecycle
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const supertest = require('supertest');
const { createApp } = require('../../index');
const { createDevReloadHub } = require('../../src/dev-reload');
const { createDevBundler } = require('../../src/bundle');

describe('Dev Error Overlay (Browser Dev Overlay)', () => {
  it('serves client runtime script containing showOverlay and clearOverlay logic', async () => {
    const { app } = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      devReload: true,
    });

    const res = await supertest(app).get('/__webspresso/dev-reload.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    
    // Check overlay element ID and styling markers
    expect(res.text).toContain('webspresso-dev-error-overlay');
    expect(res.text).toContain('function showOverlay(');
    expect(res.text).toContain('function clearOverlay(');
    expect(res.text).toContain('function escapeHtml(');
    expect(res.text).toContain('backdrop-filter:blur(6px)');
    expect(res.text).toContain('data.type === \'error\'');
    expect(res.text).toContain('data.type === \'clear-error\'');
    expect(res.text).toContain('data.type === \'css\'');
    expect(res.text).toContain('data.type === \'full\'');
    expect(res.text).toContain('Escape');

    if (app.devReloadHub) {
      app.devReloadHub.close();
    }
  });

  it('streams error and clear-error events to connected SSE clients', async () => {
    const { app } = createApp({
      pagesDir: './tests/fixtures/empty-pages',
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

      // 1. Broadcast an error event
      const errorPayload = {
        title: 'esbuild Build Error',
        message: 'Unexpected token "}"',
        file: 'src/client/main.js',
        line: 42,
        column: 7,
        lineText: '  const error = };',
        errors: [{ text: 'Unexpected token "}"', location: { file: 'src/client/main.js', line: 42, column: 7 } }],
      };
      app.broadcastDevReload('error', errorPayload);

      // Wait for delivery
      await wait(80);

      const errChunk = messages.find((m) => m.includes('"type":"error"'));
      expect(errChunk).toBeDefined();
      expect(errChunk).toContain('esbuild Build Error');
      expect(errChunk).toContain('Unexpected token');
      expect(errChunk).toContain('src/client/main.js');
      expect(errChunk).toContain('42');

      // 2. Broadcast clear-error event
      app.broadcastDevReload('clear-error');
      await wait(80);

      const clearChunk = messages.find((m) => m.includes('"type":"clear-error"'));
      expect(clearChunk).toBeDefined();

      sseReq.destroy();
    } finally {
      if (app.devReloadHub) {
        app.devReloadHub.close();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('renders and dismisses error overlay in a DOM environment', async () => {
    const { app } = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      devReload: true,
    });

    const res = await supertest(app).get('/__webspresso/dev-reload.js');
    const scriptContent = res.text;

    if (app.devReloadHub) {
      app.devReloadHub.close();
    }

    // Mock minimal browser environment
    let eventListeners = {};
    let appendedElements = [];
    let removedElements = [];
    let overlayNode = null;

    const mockDoc = {
      readyState: 'complete',
      getElementById: (id) => {
        if (id === 'webspresso-dev-error-overlay') return overlayNode;
        return null;
      },
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          id: '',
          style: { cssText: '' },
          children: [],
          innerText: '',
          innerHTML: '',
          appendChild: (child) => {
            el.children.push(child);
            return child;
          },
          remove: () => {
            removedElements.push(el);
            if (overlayNode === el) overlayNode = null;
          },
        };
        return el;
      },
      addEventListener: (evt, fn) => {
        if (!eventListeners[evt]) eventListeners[evt] = [];
        eventListeners[evt].push(fn);
      },
      removeEventListener: (evt, fn) => {
        if (eventListeners[evt]) {
          eventListeners[evt] = eventListeners[evt].filter((h) => h !== fn);
        }
      },
      querySelectorAll: () => [],
      body: {
        appendChild: (el) => {
          appendedElements.push(el);
          if (el.id === 'webspresso-dev-error-overlay') {
            overlayNode = el;
          }
          return el;
        },
      },
    };

    let sseCallback = null;
    class MockEventSource {
      constructor(url) {
        this.url = url;
      }
      addEventListener(evt, cb) {
        if (evt === 'reload') sseCallback = cb;
      }
      close() {}
    }

    const mockWindow = {
      EventSource: MockEventSource,
      location: { reload: () => {} },
    };

    // Run the runtime script within mocked browser context
    const runScript = new Function('window', 'document', scriptContent);
    runScript(mockWindow, mockDoc);

    expect(typeof sseCallback).toBe('function');

    // 1. Simulate incoming 'error' SSE event
    sseCallback({
      data: JSON.stringify({
        type: 'error',
        title: 'Syntax Error in App',
        message: 'Unexpected token ;',
        file: 'src/main.js',
        line: 10,
        column: 4,
        lineText: 'const x = ;',
      }),
    });

    expect(overlayNode).not.toBeNull();
    expect(overlayNode.id).toBe('webspresso-dev-error-overlay');
    expect(appendedElements).toContain(overlayNode);

    // 2. Simulate incoming 'clear-error' SSE event
    sseCallback({
      data: JSON.stringify({
        type: 'clear-error',
      }),
    });

    expect(overlayNode).toBeNull();
    expect(removedElements.length).toBeGreaterThan(0);

    // 3. Test Escape key dismissal
    sseCallback({
      data: JSON.stringify({
        type: 'error',
        title: 'Second Error',
        message: 'ReferenceError: foo is not defined',
      }),
    });
    expect(overlayNode).not.toBeNull();

    // Trigger Escape key handler
    const keydownHandlers = eventListeners['keydown'] || [];
    expect(keydownHandlers.length).toBeGreaterThan(0);
    keydownHandlers[0]({ key: 'Escape' });

    expect(overlayNode).toBeNull();
  });

  it('devBundler integrates error overlay broadcasting on failure and auto-clears on recovery', async () => {
    let devReloadPlugin = null;
    const broadcastEvents = [];
    const mockDevReloadHub = {
      broadcast: (type, payload) => {
        broadcastEvents.push({ type, payload });
      },
    };

    const mockEsbuild = {
      context: async (config) => {
        devReloadPlugin = config.plugins.find((p) => p.name === 'webspresso-dev-reload');
        return {
          watch: async () => {},
          dispose: async () => {},
        };
      },
    };

    const bundler = createDevBundler(
      {
        cwd: process.cwd(),
        esbuild: mockEsbuild,
        entryPoints: ['src/client/main.js'],
        logger: null,
      },
      mockDevReloadHub
    );

    await bundler.startWatch();
    expect(devReloadPlugin).toBeDefined();

    let onEndCallback = null;
    devReloadPlugin.setup({
      onStart: () => {},
      onEnd: (cb) => {
        onEndCallback = cb;
      },
    });

    // 1. First build succeeds
    onEndCallback({
      errors: [],
      metafile: { outputs: { 'public/js/main.js': {} } },
    });
    expect(broadcastEvents).toEqual([{ type: 'full', payload: undefined }]);

    // 2. Second build has a syntax error
    broadcastEvents.length = 0;
    onEndCallback({
      errors: [
        {
          text: 'Expected "(" but found "{"',
          location: {
            file: 'src/client/main.js',
            line: 25,
            column: 14,
            lineText: 'function test {',
          },
        },
      ],
    });

    expect(broadcastEvents.length).toBe(1);
    expect(broadcastEvents[0].type).toBe('error');
    expect(broadcastEvents[0].payload.title).toBe('esbuild Build Error');
    expect(broadcastEvents[0].payload.message).toContain('Expected "("');
    expect(broadcastEvents[0].payload.line).toBe(25);
    expect(broadcastEvents[0].payload.column).toBe(14);
    expect(broadcastEvents[0].payload.lineText).toBe('function test {');

    // 3. Third build fixes the error -> broadcasts 'clear-error' and 'full'
    broadcastEvents.length = 0;
    onEndCallback({
      errors: [],
      metafile: { outputs: { 'public/js/main.js': {} } },
    });

    expect(broadcastEvents.length).toBe(2);
    expect(broadcastEvents[0].type).toBe('clear-error');
    expect(broadcastEvents[1].type).toBe('full');

    await bundler.dispose();
  });
});
