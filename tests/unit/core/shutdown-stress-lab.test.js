import { describe, it, expect } from 'vitest';
import http from 'http';

const { ShutdownManager, NodeHttpAdapter } = require('../../../core/shutdown');

describe('Shutdown Stress Lab', () => {
  it('1. executes 100 reverse-order plugin disposers and 50 hooks idempotently under concurrent close() storm', async () => {
    const disposerOrder = [];
    const hookOrder = [];

    const manager = new ShutdownManager({
      mode: 'graceful',
      timeout: 2000,
      logger: null,
      exitOnSignal: false,
    });

    for (let i = 0; i < 100; i++) {
      manager.registerDisposer(`plugin-${i}`, async () => {
        disposerOrder.push(i);
      });
    }

    for (let i = 0; i < 50; i++) {
      manager.onShutdown(async () => {
        hookOrder.push(i);
      });
    }

    // 25 concurrent close() calls must share the exact same shutdown execution
    await Promise.all(Array.from({ length: 25 }, (_, i) => manager.close(`sig-${i}`)));

    expect(manager.isShuttingDown).toBe(true);
    expect(manager.isClosed).toBe(true);
    expect(disposerOrder).toHaveLength(100);
    expect(disposerOrder[0]).toBe(99);
    expect(disposerOrder[99]).toBe(0);
    expect(hookOrder).toHaveLength(50);

    // Subsequent close() is a no-op
    await manager.close('repeat');
    expect(disposerOrder).toHaveLength(100);
  });

  it('2. isolates failing and slow/hanging disposers within timeout budget', async () => {
    const completed = [];
    const manager = new ShutdownManager({
      mode: 'graceful',
      timeout: 120,
      parallel: true,
      logger: null,
      exitOnSignal: false,
    });

    manager.registerDisposer('throwing-plugin', () => {
      throw new Error('disposer crash');
    });
    manager.registerDisposer('hanging-plugin', () => new Promise(() => {}));
    manager.registerDisposer('healthy-plugin', async () => {
      await new Promise((r) => setTimeout(r, 10));
      completed.push('healthy');
    });

    const start = Date.now();
    await manager.close('timeout-test');
    const elapsed = Date.now() - start;

    expect(completed).toEqual(['healthy']);
    expect(manager.isClosed).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it('3. tracks live HTTP keep-alive connections via NodeHttpAdapter and drains cleanly', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const adapter = new NodeHttpAdapter(server);
    const manager = new ShutdownManager({
      mode: 'graceful',
      timeout: 500,
      logger: null,
      exitOnSignal: false,
    });
    manager.registerAdapter(adapter);

    // Open 10 concurrent keep-alive requests
    await Promise.all(
      Array.from({ length: 10 }, () =>
        new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
            res.resume();
            res.on('end', resolve);
          });
          req.on('error', reject);
        }),
      ),
    );

    await manager.close('http-drain');
    expect(manager.isClosed).toBe(true);
  });
});

