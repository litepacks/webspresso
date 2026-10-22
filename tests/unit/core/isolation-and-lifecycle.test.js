'use strict';

const http = require('http');
const {
  getAmbientTransaction,
  runWithAmbientTransaction,
  createTransactionContext,
} = require('../../../core/orm/transaction');
const { QueryBuilder } = require('../../../core/orm/query-builder');
const { createScopeContext } = require('../../../core/orm/scopes');
const { ShutdownManager } = require('../../../core/shutdown/shutdown-manager');
const { NodeHttpAdapter } = require('../../../core/shutdown/http-adapter');
const { createApp } = require('../../../src/server');

describe('Core Isolation and Lifecycle Hardening', () => {
  describe('1. Transaction Isolation & Stale Context Prevention', () => {
    it('returns null from getAmbientTransaction when trx is already completed', async () => {
      const fakeCompletedTrx = {
        isTransaction: true,
        isCompleted: () => true,
        commit: vi.fn(),
        rollback: vi.fn(),
      };

      await runWithAmbientTransaction(fakeCompletedTrx, async () => {
        const active = getAmbientTransaction();
        expect(active).toBeNull();
      });
    });

    it('returns active trx from getAmbientTransaction while in progress', async () => {
      const fakeActiveTrx = {
        isTransaction: true,
        isCompleted: () => false,
        commit: vi.fn(),
      };

      await runWithAmbientTransaction(fakeActiveTrx, async () => {
        const active = getAmbientTransaction();
        expect(active).toBe(fakeActiveTrx);
      });
    });

    it('createTransactionContext isolates scopeContext and prevents caller scope pollution', () => {
      const originalScope = createScopeContext({ tenantId: 'tenant-parent' });
      const fakeTrx = { isTransaction: true, isCompleted: () => false };

      const txCtx = createTransactionContext(fakeTrx, originalScope);
      txCtx.forTenant('tenant-child');

      // Caller's original scope should remain untouched
      expect(originalScope.tenantId).toBe('tenant-parent');
      expect(txCtx.getScopeContext().tenantId).toBe('tenant-child');
    });
  });

  describe('2. QueryBuilder Clone & Scope State Isolation', () => {
    const mockModel = {
      name: 'User',
      table: 'users',
      scopes: {},
      columns: new Map([
        ['id', { type: 'id' }],
        ['name', { type: 'string' }],
      ]),
    };
    const mockKnex = Object.assign(vi.fn(), {
      raw: vi.fn(),
    });

    it('preserves action in cloned QueryBuilder', () => {
      const qb = new QueryBuilder(mockModel, mockKnex);
      qb.asAction('update');

      const cloned = qb.clone();
      expect(cloned.action).toBe('update');
    });

    it('synchronizes cloned scopeContext with state.scopeContext without mutating parent', () => {
      const parentScope = createScopeContext({ tenantId: 'tenant-1' });
      const qb = new QueryBuilder(mockModel, mockKnex, parentScope);

      const cloned = qb.clone();
      // Ensure clone references match
      expect(cloned.scopeContext).toBe(cloned.state.scopeContext);

      // Mutate clone's scope
      cloned.withTrashed();
      cloned.forTenant('tenant-2');

      // Parent must not be affected
      expect(qb.scopeContext.withTrashed).toBeFalsy();
      expect(qb.scopeContext.tenantId).toBe('tenant-1');

      // Clone reflects changes in both access points
      expect(cloned.scopeContext.withTrashed).toBe(true);
      expect(cloned.state.scopeContext.withTrashed).toBe(true);
      expect(cloned.scopeContext.tenantId).toBe('tenant-2');
      expect(cloned.state.scopeContext.tenantId).toBe('tenant-2');
    });

    it('deep copies wheres conditions to prevent cross-query clause mutation', () => {
      const qb = new QueryBuilder(mockModel, mockKnex);
      qb.where('status', '=', 'active');

      const cloned = qb.clone();
      cloned.state.wheres[0].value = 'archived';

      expect(qb.state.wheres[0].value).toBe('active');
      expect(cloned.state.wheres[0].value).toBe('archived');
    });
  });

  describe('3. ShutdownManager Deadline Budgeting & Hung Resource Protection', () => {
    it('does not hang indefinitely when a plugin disposer hangs', async () => {
      const sm = new ShutdownManager({ timeout: 50, logger: null });

      let normalDisposerExecuted = false;
      let hookExecuted = false;

      // Hung disposer that never resolves
      sm.registerDisposer('hung-plugin', () => new Promise(() => {}));
      // Normal disposer registered before hung plugin (will execute after hung plugin in reverse order)
      sm.registerDisposer('healthy-plugin', () => {
        normalDisposerExecuted = true;
      });
      sm.onShutdown(() => {
        hookExecuted = true;
      });

      const start = Date.now();
      await sm.close();
      const elapsed = Date.now() - start;

      // Must complete within bounded time (close to timeout budget, well under 2 seconds)
      expect(elapsed).toBeLessThan(1500);
      expect(normalDisposerExecuted).toBe(true);
      expect(hookExecuted).toBe(true);
      expect(sm.isClosed).toBe(true);
    });

    it('does not multiply total shutdown timeout across multiple server adapters', async () => {
      const sm = new ShutdownManager({ timeout: 60, logger: null });

      const slowAdapter1 = {
        close: vi.fn(() => new Promise((resolve) => setTimeout(resolve, 200))),
        forceClose: vi.fn(),
      };
      const slowAdapter2 = {
        close: vi.fn(() => new Promise((resolve) => setTimeout(resolve, 200))),
        forceClose: vi.fn(),
      };

      sm.registerAdapter(slowAdapter1);
      sm.registerAdapter(slowAdapter2);

      const start = Date.now();
      await sm.close();
      const elapsed = Date.now() - start;

      // Both adapters combined must respect the shared budget (~60ms)…
      expect(elapsed).toBeLessThan(150);
      expect(sm.isClosed).toBe(true);
      expect(slowAdapter1.forceClose).toHaveBeenCalled();
      expect(slowAdapter2.forceClose).toHaveBeenCalled();
    });
  });

  describe('4. Application Instance Isolation', () => {
    it('isolates circuit breaker registries between multiple createApp instances', () => {
      const { app: app1 } = createApp({
        pagesDir: __dirname,
        logging: false,
      });

      const { app: app2 } = createApp({
        pagesDir: __dirname,
        logging: false,
      });

      expect(app1.breakers).toBeDefined();
      expect(app2.breakers).toBeDefined();
      expect(app1.breakers).not.toBe(app2.breakers);

      // Tripping breaker in app1 does not trip app2
      const breaker1 = app1.breakers.getBreaker('test-service', { failureThreshold: 1 });
      const breaker2 = app2.breakers.getBreaker('test-service', { failureThreshold: 1 });

      breaker1.open();
      expect(breaker1.isOpen).toBe(true);
      expect(breaker2.isOpen).toBe(false);
    });

    it('isolates AssetManager options between multiple createApp instances', () => {
      const { app: app1 } = createApp({
        pagesDir: __dirname,
        assets: { prefix: '/cdn-app1' },
        logging: false,
      });

      const { app: app2 } = createApp({
        pagesDir: __dirname,
        assets: { prefix: '/cdn-app2' },
        logging: false,
      });

      expect(app1.assetManager.prefix).toBe('/cdn-app1');
      expect(app2.assetManager.prefix).toBe('/cdn-app2');
    });

    it('closing app1 does not close app2', async () => {
      const { app: app1 } = createApp({ pagesDir: __dirname, logging: false });
      const { app: app2 } = createApp({ pagesDir: __dirname, logging: false });

      await app1.close();

      expect(app1.shutdownManager.isClosed).toBe(true);
      expect(app2.shutdownManager.isClosed).toBe(false);

      await app2.close();
      expect(app2.shutdownManager.isClosed).toBe(true);
    });
  });

  describe('5. NodeHttpAdapter Clean Lifecycle and Resource Teardown', () => {
    it('calls destroy() on server adapter close to remove connection listeners', async () => {
      const server = http.createServer();
      const adapter = new NodeHttpAdapter(server);

      const spyDestroy = vi.spyOn(adapter, 'destroy');

      await adapter.close();

      expect(spyDestroy).toHaveBeenCalled();
    });
  });

  describe('6. Startup Partial Failure and Rollback Hardening', () => {
    it('unwinds partially acquired disposers when a plugin fails during registration', async () => {
      const { createPluginManager } = require('../../../src/plugin-manager');
      const pm = createPluginManager();

      let disposerCalled = false;
      const failingPlugin = {
        name: 'partially-failing-plugin',
        setup: async () => {},
        register: async (ctx) => {
          ctx.onDispose(() => {
            disposerCalled = true;
          });
          throw new Error('plugin_init_failed');
        },
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await pm.register([failingPlugin], {});

      // Disposer must have been called during rollback
      expect(disposerCalled).toBe(true);
      // Failed plugin disposers must not linger in the manager
      expect(pm.getDisposers()).toHaveLength(0);
      expect(pm.hasPlugin('partially-failing-plugin')).toBe(false);

      warnSpy.mockRestore();
    });

    it('cleans up acquired resources on createApp startup failure without shadowing original error', () => {
      let pluginDisposerCalled = false;
      const testPlugin = {
        name: 'early-acquired-plugin',
        register: (ctx) => {
          ctx.onDispose(() => {
            pluginDisposerCalled = true;
          });
        },
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        createApp({
          pagesDir: __dirname,
          plugins: [
            testPlugin,
            {
              name: 'boom-plugin',
              register: () => {
                throw new Error('fatal_startup_crash');
              },
            },
          ],
          setupRoutes: () => {
            throw new Error('fatal_startup_crash');
          },
          logging: false,
        });
      }).toThrow('fatal_startup_crash');

      expect(pluginDisposerCalled).toBe(true);

      warnSpy.mockRestore();
    });
  });
});
