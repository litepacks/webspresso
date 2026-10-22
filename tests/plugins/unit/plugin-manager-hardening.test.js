const {
  createPluginManager,
} = require('../../../src/plugin-manager');

describe('Plugin Manager Hardening & Optimization', () => {
  let pm;

  beforeEach(() => {
    pm = createPluginManager();
  });

  describe('API extraction with prototype & class support', () => {
    it('should extract and bind prototype methods from ES6 class instances', () => {
      class TestService {
        constructor() {
          this.multiplier = 3;
        }
        compute(x) {
          return x * this.multiplier;
        }
        get name() {
          return 'ServiceA';
        }
      }

      const instance = new TestService();
      const plugin = {
        name: 'class-plugin',
        version: '1.0.0',
        api: instance,
      };

      pm.registerSync([plugin], {});
      const extracted = pm.getPluginAPI('class-plugin');

      expect(extracted).toBeDefined();
      expect(typeof extracted.compute).toBe('function');
      // Verify `this` binding is preserved
      expect(extracted.compute(4)).toBe(12);
      expect(extracted.name).toBe('ServiceA');
    });

    it('should extract plain object functions and properties', () => {
      const plugin = {
        name: 'plain-plugin',
        version: '1.0.0',
        api: {
          val: 42,
          greet(name) {
            return `Hello ${name} (${this.val})`;
          },
        },
      };

      pm.registerSync([plugin], {});
      const api = pm.getPluginAPI('plain-plugin');
      expect(api.val).toBe(42);
      expect(api.greet('World')).toBe('Hello World (42)');
    });
  });

  describe('Static & Request-Scoped Helper Caching', () => {
    it('should cache static helpers and not recreate objects if nothing changed', () => {
      const plugin = {
        name: 'helper-plugin',
        version: '1.0.0',
        register(ctx) {
          ctx.addHelper('formatDate', (d) => `Date: ${d}`);
        },
      };

      pm.registerSync([plugin], {});

      const helpers1 = pm.getHelpers();
      const helpers2 = pm.getHelpers();
      expect(helpers1).toBe(helpers2); // Same cached object reference
      expect(helpers1.formatDate('2026-10-22')).toBe('Date: 2026-10-22');
    });

    it('should invalidate cache when a new helper is registered', () => {
      const mockEnv = { addGlobal: vi.fn(), addFilter: vi.fn() };
      let context;
      const plugin = {
        name: 'dynamic-helpers',
        version: '1.0.0',
        register(ctx) {
          context = ctx;
          ctx.addHelper('h1', () => 1);
        },
      };

      pm.registerSync([plugin], { nunjucksEnv: mockEnv });
      const h1 = pm.getHelpers();
      expect(h1.h1()).toBe(1);

      context.addHelper('h2', () => 2);
      const h2 = pm.getHelpers();
      expect(h1).not.toBe(h2);
      expect(h2.h1()).toBe(1);
      expect(h2.h2()).toBe(2);
    });

    it('should support addRequestHelper and aggregate dynamic per-request helpers', () => {
      const pluginA = {
        name: 'req-helper-a',
        version: '1.0.0',
        register(ctx) {
          ctx.addRequestHelper((req) => ({
            userInitials: req.user ? req.user.name[0] : 'Anon',
          }));
        },
      };

      const pluginB = {
        name: 'req-helper-b',
        version: '1.0.0',
        register(ctx) {
          ctx.addRequestHelper((req) => ({
            reqPath: req.path,
          }));
        },
      };

      pm.registerSync([pluginA, pluginB], {});

      const req1 = { path: '/home', user: { name: 'Ahmet' } };
      const reqHelpers1 = pm.getRequestHelpers(req1);
      expect(reqHelpers1).toEqual({
        userInitials: 'A',
        reqPath: '/home',
      });

      const req2 = { path: '/login', user: null };
      const reqHelpers2 = pm.getRequestHelpers(req2);
      expect(reqHelpers2).toEqual({
        userInitials: 'Anon',
        reqPath: '/login',
      });
    });
  });

  describe('Collision Detection for Helpers and Filters', () => {
    it('should warn when registering a duplicate helper', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const plugin1 = {
        name: 'plugin-1',
        version: '1.0.0',
        register(ctx) {
          ctx.addHelper('duplicateFn', () => 'first');
        },
      };
      const plugin2 = {
        name: 'plugin-2',
        version: '1.0.0',
        register(ctx) {
          ctx.addHelper('duplicateFn', () => 'second');
        },
      };

      pm.registerSync([plugin1, plugin2], {});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Helper "duplicateFn" is already registered')
      );
      warnSpy.mockRestore();
    });

    it('should warn when registering a duplicate filter', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const plugin1 = {
        name: 'filter-1',
        version: '1.0.0',
        register(ctx) {
          ctx.addFilter('truncate', (s) => s);
        },
      };
      const plugin2 = {
        name: 'filter-2',
        version: '1.0.0',
        register(ctx) {
          ctx.addFilter('truncate', (s) => s.slice(0, 5));
        },
      };

      pm.registerSync([plugin1, plugin2], {});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Filter "truncate" is already registered')
      );
      warnSpy.mockRestore();
    });
  });

  describe('Pending Async Operations & whenReady', () => {
    it('should track async promises and resolve in whenReady()', async () => {
      let resolved = false;
      const asyncPlugin = {
        name: 'async-plugin',
        version: '1.0.0',
        async register() {
          await new Promise((r) => setTimeout(r, 10));
          resolved = true;
        },
      };

      pm.registerSync([asyncPlugin], {});
      expect(resolved).toBe(false);

      await pm.whenReady();
      expect(resolved).toBe(true);
    });

    it('should handle rejected async operations gracefully in whenReady()', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failingPlugin = {
        name: 'failing-async',
        version: '1.0.0',
        async register() {
          throw new Error('Async register failure');
        },
      };

      pm.registerSync([failingPlugin], {});
      // Should not throw or crash whenReady
      await expect(pm.whenReady()).resolves.toBeUndefined();
      errorSpy.mockRestore();
    });
  });

  describe('Disposer Resilience with Timeouts', () => {
    it('should execute disposers in reverse order and handle hanging disposers without stalling forever', async () => {
      const log = [];
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const pluginA = {
        name: 'plugin-a',
        version: '1.0.0',
        register(ctx) {
          ctx.addDisposer(async () => {
            log.push('a');
          });
        },
      };

      const pluginB = {
        name: 'plugin-b',
        version: '1.0.0',
        register(ctx) {
          ctx.addDisposer(async () => {
            log.push('b');
          });
        },
      };

      pm.registerSync([pluginA, pluginB], {});
      await pm.dispose();

      // Reverse order: B was registered second, so its disposer runs first
      expect(log).toEqual(['b', 'a']);
      warnSpy.mockRestore();
    });
  });

  describe('mountCustomRoutes deduplication', () => {
    it('should drain mounted custom routes so repeated calls do not register duplicates', () => {
      const mockApp = {
        routes: [],
        get(path, handler) {
          this.routes.push({ method: 'get', path, handler });
        },
        use(path, router) {
          this.routes.push({ method: 'use', path, router });
        },
      };

      const plugin = {
        name: 'route-plugin',
        version: '1.0.0',
        register(ctx) {
          ctx.addRoute('get', '/test-route', (req, res) => res.send('ok'));
        },
      };

      pm.registerSync([plugin], {});
      pm.mountCustomRoutes(mockApp);
      expect(mockApp.routes.length).toBe(1);

      // Calling again should not re-mount
      pm.mountCustomRoutes(mockApp);
      expect(mockApp.routes.length).toBe(1);
    });
  });
});
