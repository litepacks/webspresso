const {
  wait
} = require('../utils');

/**
 * Comprehensive Vitest tests for Webspresso Graceful Shutdown, Force Close,
 * Shutdown Hooks, and Plugin Disposal Lifecycle.
 */

const http = require('http');
const net = require('net');
const path = require('path');

const { createApp } = require('../../src/server');
const { ShutdownManager, NodeHttpAdapter } = require('../../core/shutdown');
const { getAppContext, resetAppContext } = require('../../src/app-context');

const FIXTURES_PAGES = path.join(__dirname, 'fixtures/pages');

describe.sequential('Webspresso Shutdown & Lifecycle Management', () => {
  let createdServers = [];

  afterEach(async () => {
    // Clean up any remaining servers
    for (const server of createdServers) {
      if (server && server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
    createdServers = [];
    resetAppContext();
  });

  // Helper to start real server
  function startServer(app) {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => {
        createdServers.push(server);
        const addr = server.address();
        resolve({ server, port: addr.port });
      });
      server.on('error', reject);
    });
  }

  // Helper to make an HTTP request to local server
  function makeRequest(port, path, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: options.method || 'GET',
          headers: { connection: 'close', ...(options.headers || {}) },
          agent: false,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
          });
        }
      );
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  // 1. normal app.close()
  it('1. normal app.close() closes the HTTP server and marks closed', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      shutdown: { enabled: true, mode: 'graceful', timeout: 5000 },
    });

    const { server } = await startServer(app);
    expect(server.listening).toBe(true);
    expect(app.isShuttingDown).toBe(false);

    await app.close();

    expect(server.listening).toBe(false);
    expect(app.isShuttingDown).toBe(true);
    expect(app.shutdownManager.isClosed).toBe(true);
  });

  // 2. app.close() called twice
  it('2. app.close() called twice is idempotent and does not error', async () => {
    const hookFn = vi.fn();
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      shutdown: { enabled: true },
    });

    app.onShutdown(hookFn);
    const { server } = await startServer(app);

    const [firstCall, secondCall] = await Promise.all([app.close(), app.close()]);
    await app.close(); // third call

    expect(hookFn).toHaveBeenCalledTimes(1);
    expect(server.listening).toBe(false);
  });

  // 3. SIGTERM shutdown
  it('3. handles SIGTERM signal cleanly', async () => {
    const manager = new ShutdownManager({
      enabled: true,
      mode: 'graceful',
      timeout: 1000,
      exitOnSignal: false,
      logger: null,
    });

    let hookCalled = false;
    manager.onShutdown(async () => {
      hookCalled = true;
    });

    manager.enableShutdownHooks();
    const termListener = manager._signalListeners.get('SIGTERM');
    expect(typeof termListener).toBe('function');

    await termListener();

    expect(hookCalled).toBe(true);
    expect(manager.isClosed).toBe(true);
    expect(manager.isShuttingDown).toBe(true);
  });

  // 4. SIGINT shutdown
  it('4. handles SIGINT signal cleanly', async () => {
    const manager = new ShutdownManager({
      enabled: true,
      mode: 'graceful',
      timeout: 1000,
      exitOnSignal: false,
      logger: null,
    });

    let hookCalled = false;
    manager.onShutdown(async () => {
      hookCalled = true;
    });

    manager.enableShutdownHooks();
    const intListener = manager._signalListeners.get('SIGINT');
    expect(typeof intListener).toBe('function');

    await intListener();

    expect(hookCalled).toBe(true);
    expect(manager.isClosed).toBe(true);
    expect(manager.isShuttingDown).toBe(true);
  });

  // 5. graceful shutdown
  it('5. graceful shutdown allows in-flight requests to complete', async () => {
    let requestFinished = false;
    let resolveStarted;
    const requestStarted = new Promise((r) => { resolveStarted = r; });

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      shutdown: { mode: 'graceful', timeout: 500 },
      setupRoutes(expressApp) {
        expressApp.get('/slow-work', async (req, res) => {
          if (resolveStarted) resolveStarted();
          await wait(20);
          requestFinished = true;
          res.json({ ok: true });
        });
      },
    });

    const { port } = await startServer(app);
    const requestPromise = makeRequest(port, '/slow-work');

    await requestStarted;

    const closePromise = app.close();
    const response = await requestPromise;
    await closePromise;

    expect(response.statusCode).toBe(200);
    expect(requestFinished).toBe(true);
  });

  // 6. force shutdown
  it('6. force shutdown mode terminates active connections immediately', async () => {
    let resolveStarted;
    const requestStarted = new Promise((r) => { resolveStarted = r; });

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      shutdown: { mode: 'force', timeout: 1000 },
      setupRoutes(expressApp) {
        expressApp.get('/hanging', (req, res) => {
          if (resolveStarted) resolveStarted();
          // Never respond
        });
      },
    });

    const { port } = await startServer(app);

    let errorThrown = false;
    const req = http.get(`http://127.0.0.1:${port}/hanging`, () => {});
    const clientErrorPromise = new Promise((resolve) => {
      req.on('error', (err) => {
        errorThrown = true;
        resolve(err);
      });
    });

    await requestStarted;
    await app.close();
    await clientErrorPromise;

    expect(errorThrown).toBe(true);
  });

  // 7. force close after timeout
  it('7. forces connection termination if graceful timeout expires', async () => {
    let resolveStarted;
    const requestStarted = new Promise((r) => { resolveStarted = r; });

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      shutdown: { mode: 'graceful', timeout: 150 },
      setupRoutes(expressApp) {
        expressApp.get('/stuck', (req, res) => {
          if (resolveStarted) resolveStarted();
          // never ends
        });
      },
    });

    const { port } = await startServer(app);

    let clientError = false;
    const req = http.get(`http://127.0.0.1:${port}/stuck`, () => {});
    const clientErrorPromise = new Promise((resolve) => {
      req.on('error', (err) => {
        clientError = true;
        resolve(err);
      });
    });

    await requestStarted;

    const start = Date.now();
    await app.close();
    const duration = Date.now() - start;

    await clientErrorPromise;

    expect(duration).toBeGreaterThanOrEqual(130);
    expect(clientError).toBe(true);
  });

  // 8. shutdown hook execution
  it('8. executes registered shutdown hooks on app.close()', async () => {
    let hookExecuted = false;
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
    });

    app.onShutdown(() => {
      hookExecuted = true;
    });

    await app.close();
    expect(hookExecuted).toBe(true);
  });

  // 9. async shutdown hook
  it('9. awaits asynchronous shutdown hooks before completing', async () => {
    let asyncFinished = false;
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
    });

    app.onShutdown(async () => {
      await wait(50);
      asyncFinished = true;
    });

    await app.close();
    expect(asyncFinished).toBe(true);
  });

  // 10. shutdown hook throwing an error
  it('10. handles a throwing shutdown hook gracefully without unhandled rejection', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
    });

    app.onShutdown(() => {
      throw new Error('Sync hook failed');
    });

    await expect(app.close()).resolves.toBeUndefined();
    expect(app.shutdownManager.isClosed).toBe(true);
  });

  // 11. one hook errors while others continue
  it('11. continues executing subsequent shutdown hooks when one fails', async () => {
    const executed = [];
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
    });

    app.onShutdown(async () => {
      executed.push('first');
    });

    app.onShutdown(async () => {
      executed.push('failing');
      throw new Error('Async hook error');
    });

    app.onShutdown(async () => {
      executed.push('third');
    });

    await app.close();
    expect(executed).toEqual(['first', 'failing', 'third']);
  });

  // 12. plugin disposer execution
  it('12. executes plugin returned disposer function on shutdown', async () => {
    let disposed = false;
    const samplePlugin = {
      name: 'sample-plugin',
      setup(app) {
        return () => {
          disposed = true;
        };
      },
    };

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      plugins: [samplePlugin],
    });

    await app.close();
    expect(disposed).toBe(true);
  });

  // 13. plugin disposer reverse order
  it('13. executes plugin disposers in reverse registration order (teardown order)', async () => {
    const disposalOrder = [];

    const pluginA = {
      name: 'plugin-a',
      setup() {
        return () => disposalOrder.push('plugin-a');
      },
    };

    const pluginB = {
      name: 'plugin-b',
      setup() {
        return () => disposalOrder.push('plugin-b');
      },
    };

    const pluginC = {
      name: 'plugin-c',
      setup() {
        return () => disposalOrder.push('plugin-c');
      },
    };

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      plugins: [pluginA, pluginB, pluginC],
    });

    await app.close();
    expect(disposalOrder).toEqual(['plugin-c', 'plugin-b', 'plugin-a']);
  });

  // 14. async plugin disposer
  it('14. awaits async plugin disposers', async () => {
    let asyncDisposed = false;
    const asyncPlugin = {
      name: 'async-plugin',
      register(ctx) {
        return async () => {
          await wait(40);
          asyncDisposed = true;
        };
      },
    };

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      plugins: [asyncPlugin],
    });

    await app.close();
    expect(asyncDisposed).toBe(true);
  });

  // 15. other disposers continue when one fails
  it('15. continues executing other plugin disposers if one fails', async () => {
    const order = [];

    const plugin1 = {
      name: 'p1',
      setup: () => () => order.push('p1'),
    };
    const plugin2 = {
      name: 'p2',
      setup: () => () => {
        order.push('p2-fail');
        throw new Error('p2 error');
      },
    };
    const plugin3 = {
      name: 'p3',
      setup: () => () => order.push('p3'),
    };

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      plugins: [plugin1, plugin2, plugin3],
    });

    await app.close();
    expect(order).toEqual(['p3', 'p2-fail', 'p1']);
  });

  // 16. Node/server implementation without closeAllConnections
  it('16. forceClose falls back to socket destruction when closeAllConnections is absent', () => {
    const fakeSocket = {
      destroyed: false,
      destroy: vi.fn(function () {
        this.destroyed = true;
      }),
      once: vi.fn(),
      removeListener: vi.fn(),
    };

    const fakeServer = {
      on: vi.fn(),
      listening: true,
      close: vi.fn((cb) => cb && cb()),
    };

    const adapter = new NodeHttpAdapter(fakeServer);
    adapter._trackSocket(fakeSocket);

    adapter.forceClose();
    expect(fakeSocket.destroy).toHaveBeenCalled();
  });

  // 17. HTTP server stops accepting new connections / 503 draining
  it('17. server stops accepting new connections and drains with 503 during shutdown', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      setupRoutes(expressApp) {
        expressApp.get('/ping', (req, res) => res.send('pong'));
      },
    });

    const { port } = await startServer(app);

    const okRes = await makeRequest(port, '/ping');
    expect(okRes.statusCode).toBe(200);

    app.shutdownManager.isShuttingDown = true;

    const drainRes = await makeRequest(port, '/ping');
    expect(drainRes.statusCode).toBe(503);
    expect(drainRes.headers['connection']).toBe('close');
  });

  // 18. keep-alive connection scenario
  it('18. closes keep-alive connections on response finish during shutdown', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      shutdown: { mode: 'graceful', timeout: 2000 },
      setupRoutes(expressApp) {
        expressApp.get('/hello', (req, res) => res.send('world'));
      },
    });

    const { port } = await startServer(app);
    const agent = new http.Agent({ keepAlive: true });

    await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/hello`, { agent }, (res) => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject);
    });

    await app.close();
    agent.destroy();

    expect(app.shutdownManager.isClosed).toBe(true);
  });

  // 19. manual app.close() does not call process.exit()
  it('19. manual app.close() never calls process.exit()', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
    });

    await startServer(app);
    await app.close();

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  // 20. watch-mode force shutdown behavior
  it('20. supports watch/development configuration with force mode and short timeout', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      server: {
        shutdown: {
          mode: 'force',
          timeout: 500,
        },
      },
    });

    expect(app.shutdownManager.mode).toBe('force');
    expect(app.shutdownManager.timeout).toBe(500);

    await app.close();
    expect(app.shutdownManager.isClosed).toBe(true);
  });

  // 21. parallel plugin disposers
  it('21. supports parallel plugin disposers for concurrent teardown', async () => {
    const started = [];
    const finished = [];

    const plugin1 = {
      name: 'plugin-slow-1',
      register() {
        return async () => {
          started.push('p1');
          await wait(50);
          finished.push('p1');
        };
      },
    };

    const plugin2 = {
      name: 'plugin-slow-2',
      register() {
        return async () => {
          started.push('p2');
          await wait(50);
          finished.push('p2');
        };
      },
    };

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      plugins: [plugin1, plugin2],
      shutdown: {
        parallel: true,
      },
    });

    const start = Date.now();
    await app.close();
    const duration = Date.now() - start;

    // Both plugins were initiated (in reverse order: p2 then p1)
    expect(started).toEqual(['p2', 'p1']);
    expect(finished).toContain('p1');
    expect(finished).toContain('p2');
    // Running in parallel takes ~50ms rather than 100ms+ (serial)
    expect(duration).toBeLessThan(120);
    expect(app.shutdownManager.isClosed).toBe(true);
  });

  // 22. parallel shutdown hooks
  it('22. supports parallel shutdown hooks for concurrent execution', async () => {
    const started = [];
    const finished = [];

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      shutdown: {
        parallelHooks: true,
      },
    });

    app.onShutdown(async () => {
      started.push('h1');
      await wait(50);
      finished.push('h1');
    });

    app.onShutdown(async () => {
      started.push('h2');
      await wait(50);
      finished.push('h2');
    });

    const start = Date.now();
    await app.close();
    const duration = Date.now() - start;

    expect(started).toEqual(['h1', 'h2']);
    expect(finished).toContain('h1');
    expect(finished).toContain('h2');
    expect(duration).toBeLessThan(120);
    expect(app.shutdownManager.isClosed).toBe(true);
  });

  // 23. synchronous fast path
  it('23. fast-path executes synchronous disposers and hooks immediately', async () => {
    const executed = [];

    const plugin = {
      name: 'sync-plugin',
      register() {
        return () => {
          executed.push('plugin-disposed');
        };
      },
    };

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      plugins: [plugin],
    });

    app.onShutdown(() => {
      executed.push('hook-executed');
    });

    const start = Date.now();
    await app.close();
    const duration = Date.now() - start;

    expect(executed).toEqual(['plugin-disposed', 'hook-executed']);
    // Synchronous execution completes almost instantaneously (< 20ms)
    expect(duration).toBeLessThan(50);
    expect(app.shutdownManager.isClosed).toBe(true);
  });
});
