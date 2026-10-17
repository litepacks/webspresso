import { describe, it, expect, beforeEach, vi } from 'vitest';
const {
  PluginManager,
  getPluginManager,
  createPluginManager,
  resetPluginManager,
  semver,
  matchPattern,
} = require('../../../src/plugin-manager');

describe('src/plugin-manager.js - Semver & Pattern Matching', () => {
  describe('semver', () => {
    it('parses valid semver strings and handles invalid formats', () => {
      expect(semver.parse(null)).toBeNull();
      expect(semver.parse('')).toBeNull();
      expect(semver.parse('invalid')).toBeNull();

      const parsed = semver.parse('1.2.3');
      expect(parsed).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });

      const parsedPre = semver.parse('2.0.0-beta.1');
      expect(parsedPre).toEqual({ major: 2, minor: 0, patch: 0, prerelease: 'beta.1' });

      // Cached lookup
      expect(semver.parse('1.2.3')).toBe(parsed);
    });

    it('compares versions accurately', () => {
      expect(semver.compare('1.0.0', '1.0.0')).toBe(0);
      expect(semver.compare('2.0.0', '1.9.9')).toBe(1);
      expect(semver.compare('1.1.0', '1.2.0')).toBe(-1);
      expect(semver.compare('1.0.1', '1.0.2')).toBe(-1);
      expect(semver.compare('invalid', '1.0.0')).toBe(0);
    });

    it('evaluates semver satisfaction across range specifiers', () => {
      expect(semver.satisfies('1.2.3', '*')).toBe(true);
      expect(semver.satisfies('1.2.3', null)).toBe(true);
      expect(semver.satisfies('invalid', '^1.0.0')).toBe(false);

      // Caret (^)
      expect(semver.satisfies('1.2.5', '^1.2.0')).toBe(true);
      expect(semver.satisfies('2.0.0', '^1.2.0')).toBe(false);
      expect(semver.satisfies('0.2.3', '^0.2.0')).toBe(true);
      expect(semver.satisfies('0.3.0', '^0.2.0')).toBe(false);
      expect(semver.satisfies('0.2.0', '^0.2.5')).toBe(false);

      // Tilde (~)
      expect(semver.satisfies('1.2.5', '~1.2.0')).toBe(true);
      expect(semver.satisfies('1.3.0', '~1.2.0')).toBe(false);

      // Relational operators
      expect(semver.satisfies('2.1.0', '>=2.0.0')).toBe(true);
      expect(semver.satisfies('1.9.0', '>=2.0.0')).toBe(false);
      expect(semver.satisfies('2.1.0', '>2.0.0')).toBe(true);
      expect(semver.satisfies('2.0.0', '>2.0.0')).toBe(false);
      expect(semver.satisfies('1.5.0', '<=2.0.0')).toBe(true);
      expect(semver.satisfies('2.5.0', '<=2.0.0')).toBe(false);
      expect(semver.satisfies('1.5.0', '<2.0.0')).toBe(true);
      expect(semver.satisfies('2.0.0', '<2.0.0')).toBe(false);

      // Exact
      expect(semver.satisfies('1.0.0', '1.0.0')).toBe(true);
      expect(semver.satisfies('1.0.1', '1.0.0')).toBe(false);
    });
  });

  describe('matchPattern', () => {
    it('matches wildcards and globs', () => {
      expect(matchPattern('any/path', '*')).toBe(true);
      expect(matchPattern('any/path', '**')).toBe(true);
      expect(matchPattern('api/users/list', 'api/**')).toBe(true);
      expect(matchPattern('api/users', 'api/*')).toBe(true);
      expect(matchPattern('api/users/profile', 'api/*')).toBe(false);
      expect(matchPattern('file.js', 'file.?s')).toBe(true);
      expect(matchPattern('other', 'api/*')).toBe(false);
    });
  });
});

describe('src/plugin-manager.js - Plugin Lifecycle & Dependencies', () => {
  let pm;

  beforeEach(() => {
    resetPluginManager();
    pm = createPluginManager();
  });

  it('manages singleton instance via getPluginManager and resetPluginManager', () => {
    const s1 = getPluginManager();
    const s2 = getPluginManager();
    expect(s1).toBe(s2);

    resetPluginManager();
    const s3 = getPluginManager();
    expect(s3).not.toBe(s1);
  });

  it('resolves dependency order and skips duplicates and invalid entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pA = { name: 'pluginA', dependencies: [] };
    const pB = { name: 'pluginB', dependencies: ['pluginA'] };
    const pC = { name: 'pluginC', dependencies: { pluginB: '^1.0.0' } };
    const unnamed = { dependencies: [] };
    const dup = { name: 'pluginA' };

    const sorted = pm._resolveDependencyOrder([pC, pA, unnamed, dup, pB]);

    expect(sorted.map((p) => p.name)).toEqual(['pluginA', 'pluginB', 'pluginC']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping plugin without name'),
      unnamed
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate plugin name "pluginA"')
    );

    warnSpy.mockRestore();
  });

  it('detects circular dependencies and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const p1 = { name: 'p1', dependencies: ['p2'] };
    const p2 = { name: 'p2', dependencies: ['p1'] };

    const sorted = pm._resolveDependencyOrder([p1, p2]);
    expect(sorted).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Circular dependency detected')
    );

    warnSpy.mockRestore();
  });

  it('warns on missing or incompatible dependencies during registration', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pluginWithMissing = {
      name: 'dependent',
      dependencies: ['missing-plugin'],
    };
    pm._validateDependencies(pluginWithMissing);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('requires "missing-plugin" but it\'s not loaded')
    );

    // Register dummy dep with incompatible version
    pm.plugins.set('old-dep', { name: 'old-dep', version: '1.0.0' });
    const pluginWithIncompatible = {
      name: 'requires-v2',
      dependencies: { 'old-dep': '^2.0.0' },
    };
    pm._validateDependencies(pluginWithIncompatible);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('requires "old-dep@^2.0.0" but found v1.0.0')
    );

    warnSpy.mockRestore();
  });

  it('registers plugins async with lifecycle hooks, disposers, and APIs', async () => {
    const mockApp = { get: vi.fn(), post: vi.fn() };
    const mockNunjucks = { addFilter: vi.fn() };
    const mockShutdown = { registerDisposer: vi.fn() };

    const disposerFn = vi.fn();
    const shutdownFn = vi.fn();

    const testPlugin = {
      name: 'test-plugin',
      version: '1.2.0',
      api: {
        greet: (name) => `Hello, ${name}`,
      },
      csp: {
        'script-src': ['https://cdn.example.com'],
      },
      setup: async (app) => {
        return disposerFn;
      },
      register: async (ctx) => {
        ctx.addHelper('sayHi', () => 'Hi!');
        ctx.addFilter('uppercase', (s) => s.toUpperCase());
        ctx.addRoute('GET', '/custom-test', () => {});
      },
      shutdown: shutdownFn,
    };

    await pm.register([testPlugin], {
      app: mockApp,
      nunjucksEnv: mockNunjucks,
      shutdownManager: mockShutdown,
      options: { db: { knex: {} } },
      middlewares: {},
    });

    expect(pm.hasPlugin('test-plugin')).toBe(true);
    expect(pm.getPlugin('test-plugin')).toBe(testPlugin);
    expect(pm.getPluginNames()).toEqual(['test-plugin']);

    // Check API binding
    const api = pm.getPluginAPI('test-plugin');
    expect(api.greet('World')).toBe('Hello, World');

    // Check helpers and filters
    const helpers = pm.getHelpers();
    expect(typeof helpers.sayHi).toBe('function');
    expect(helpers.sayHi()).toBe('Hi!');
    expect(mockNunjucks.addFilter).toHaveBeenCalledWith('uppercase', expect.any(Function));

    // Check CSP directives
    const csp = pm.getCspDirectives();
    expect(csp['script-src']).toContain('https://cdn.example.com');

    // Mount custom routes
    pm.mountCustomRoutes();
    expect(mockApp.get).toHaveBeenCalledWith('/custom-test', expect.any(Function));

    // Disposers
    expect(pm.getDisposers().length).toBeGreaterThan(0);
    await pm.dispose();
    expect(disposerFn).toHaveBeenCalledTimes(1);
    expect(pm.getDisposers()).toHaveLength(0);
  });

  it('registers plugins synchronously via registerSync', () => {
    const mockApp = {};
    const testPlugin = {
      name: 'sync-plugin',
      version: '1.0.0',
      setup: () => {},
      register: (ctx) => {
        ctx.onDispose(() => {});
      },
    };

    pm.registerSync([testPlugin], { app: mockApp });
    expect(pm.hasPlugin('sync-plugin')).toBe(true);
    expect(pm.getDisposers()).toHaveLength(1);
  });

  it('handles plugin setup and register errors gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const failingSetupPlugin = {
      name: 'failing-setup',
      api: { ping: () => 'pong' },
      setup: async () => {
        throw new Error('Setup boom');
      },
    };
    await pm.register([failingSetupPlugin], {});
    expect(pm.hasPlugin('failing-setup')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Plugin "failing-setup" setup() failed:'),
      'Setup boom'
    );

    const failingRegisterPlugin = {
      name: 'failing-reg',
      api: { ping: () => 'pong' },
      register: () => {
        throw new Error('Register boom');
      },
    };
    pm.registerSync([failingRegisterPlugin], {});
    expect(pm.hasPlugin('failing-reg')).toBe(false);

    warnSpy.mockRestore();
  });

  it('calls onRoutesReady and onReady hooks on plugins', async () => {
    const readyCalls = [];
    const pluginA = {
      name: 'pluginA',
      onRoutesReady: async (ctx) => {
        readyCalls.push('routesReadyA');
      },
      onReady: async (ctx) => {
        readyCalls.push('readyA');
      },
    };

    await pm.register([pluginA], {});
    pm.setRoutes([{ path: '/users', method: 'GET' }]);

    await pm.onRoutesReady({});
    await pm.onReady({});

    expect(readyCalls).toEqual(['routesReadyA', 'readyA']);
    expect(pm.routes).toEqual([{ path: '/users', method: 'GET' }]);
  });

  it('supports lazy plugin hydration in getPluginAPI', () => {
    const lazyPlugin = {
      name: 'lazy-plugin',
      isLazy: true,
      isHydrated: false,
      hydrate: () => {
        lazyPlugin.isHydrated = true;
        return {
          api: {
            compute: (x) => x * 2,
          },
        };
      },
    };

    pm.plugins.set('lazy-plugin', lazyPlugin);
    const api = pm.getPluginAPI('lazy-plugin');
    expect(typeof api.compute).toBe('function');
    expect(api.compute(21)).toBe(42);
    expect(lazyPlugin.isHydrated).toBe(true);
  });

  it('supports script injector API on plugin context', async () => {
    let capturedCtx = null;
    const injectorPlugin = {
      name: 'injector-plugin',
      register: (ctx) => {
        capturedCtx = ctx;
        ctx.injectHead('<meta name="author" content="Test">', { priority: 1, id: 'meta-author' });
        ctx.injectBody('<script>console.log("end");</script>', { priority: 10, id: 'body-script' });
        ctx.injectStyle('body { margin: 0; }', { id: 'body-css' });
        ctx.registerDevLink({ name: 'Docs', path: '/docs' });
        ctx.onShutdown(() => {});
      },
    };

    await pm.register([injectorPlugin], {});
    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx.getScriptInjector()).toBeDefined();
    expect(pm.getDisposers().length).toBeGreaterThan(0);
  });

  it('registers shutdown and dispose methods when no return disposer provided', async () => {
    const shutdownFn = vi.fn();
    const disposeFn = vi.fn();

    const pluginWithShutdown = {
      name: 'shutdown-plugin',
      shutdown: shutdownFn,
    };
    const pluginWithDispose = {
      name: 'dispose-plugin',
      dispose: disposeFn,
    };

    await pm.register([pluginWithShutdown, pluginWithDispose], {});
    expect(pm.getDisposers().length).toBe(2);

    await pm.dispose();
    expect(shutdownFn).toHaveBeenCalledTimes(1);
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it('catches and logs errors when a disposer throws during pm.dispose()', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    pm.registerDisposer('bad-disposer', () => {
      throw new Error('Disposer failed');
    });

    await pm.dispose();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Plugin "bad-disposer" disposer failed:'),
      'Disposer failed'
    );

    warnSpy.mockRestore();
  });
});
