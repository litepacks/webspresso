import { describe, it, expect, vi } from 'vitest';
import { defineModule } from '../../../src/modules/define-module';

describe('defineModule Helper', () => {
  it('should validate module name and throw on invalid or empty names', () => {
    expect(() => defineModule({})).toThrow(/defineModule requires a valid non-empty "name" string/);
    expect(() => defineModule({ name: '' })).toThrow(/defineModule requires a valid non-empty "name" string/);
    expect(() => defineModule({ name: '   ' })).toThrow(/defineModule requires a valid non-empty "name" string/);
    expect(() => defineModule({ name: 123 })).toThrow(/defineModule requires a valid non-empty "name" string/);
  });

  it('should create a valid Webspresso module plugin factory', () => {
    const authModule = defineModule({
      name: 'auth',
      version: '2.0.0',
      description: 'Authentication module',
      imports: ['users'],
      dependencies: ['roles'],
      pages: { prefix: '/auth' },
      api: { prefix: '/api/auth' },
      exports: {
        validateToken: () => true,
      },
    });

    expect(typeof authModule).toBe('function');
    const plugin = authModule({ customOption: true });

    expect(plugin.name).toBe('auth');
    expect(plugin.version).toBe('2.0.0');
    expect(plugin.dependencies).toEqual(['users', 'roles']);
    expect(plugin.__isWebspressoModule).toBe(true);
    expect(plugin.api.validateToken()).toBe(true);
    expect(plugin.moduleConfig.customOption).toBe(true);
  });

  it('should execute onInit and register onDestroy disposer during register phase', () => {
    const onInit = vi.fn();
    const onDestroy = vi.fn();

    const testModule = defineModule({
      name: 'billing',
      onInit,
      onDestroy,
      services: {
        'charge': { handler: async () => ({ success: true }) },
      },
    });

    const plugin = testModule();
    const registeredDisposers = [];
    const serviceRegistryMap = new Map();

    const mockCtx = {
      app: {
        serviceRegistry: {
          has: (name) => serviceRegistryMap.has(name),
          register: (name, def) => serviceRegistryMap.set(name, def),
        },
      },
      middlewares: {},
      shutdownManager: {
        registerDisposer: (fn, meta) => registeredDisposers.push({ fn, meta }),
      },
    };

    plugin.register(mockCtx);

    expect(onInit).toHaveBeenCalledWith(mockCtx);
    expect(serviceRegistryMap.has('billing.charge')).toBe(true);
    expect(registeredDisposers.length).toBe(1);
    expect(registeredDisposers[0].meta.name).toBe('module:billing');
  });

  it('should register module middlewares with prefix', () => {
    const mwGuard = (req, res, next) => next();
    const testModule = defineModule({
      name: 'orders',
      middlewares: {
        guard: mwGuard,
      },
    });

    const plugin = testModule();
    const mockCtx = {
      middlewares: {},
    };

    plugin.register(mockCtx);
    expect(mockCtx.middlewares['orders.guard']).toBe(mwGuard);
  });

  it('should discover module details with discoverModuleDetails', () => {
    const path = require('path');
    const { discoverModuleDetails } = require('../../../src/modules/module-discovery');

    // 1. Non-existent path
    const emptyRes = discoverModuleDetails('/non/existent/path', 'fake');
    expect(emptyRes.services).toEqual({});
    expect(emptyRes.middlewares).toEqual({});

    // 2. Fullstack fixture auth module
    const authModulePath = path.resolve(__dirname, '../../fixtures/fullstack/src/modules/auth');
    const details = discoverModuleDetails(authModulePath, 'auth');

    expect(details.config).toBeDefined();
    expect(details.services['auth.login']).toBeDefined();
    expect(details.middlewares.authGuard).toBeDefined();
  });

  it('should handle edge cases in defineModule and register', () => {
    const fnModule = defineModule({
      name: 'edge',
      exports: null, // non-object
      services: {
        'already.qualified': () => true,
        'simple': () => true,
      },
      middlewares: {
        guard: (req, res, next) => next(),
      },
      onInit: 'not-a-function',
      onDestroy: () => {},
    });

    const plugin = fnModule();
    expect(plugin.api).toEqual({});

    // 1. ctx without app, middlewares, shutdownManager
    expect(() => plugin.register({})).not.toThrow();

    // 2. ctx with pre-existing service registration
    const existing = new Set(['edge.already.qualified']);
    const registered = [];
    const mockCtx = {
      app: {
        serviceRegistry: {
          has: (name) => existing.has(name),
          register: (name, def) => registered.push({ name, def }),
        },
      },
      middlewares: null,
      shutdownManager: null,
    };

    plugin.register(mockCtx);
    expect(registered.some((r) => r.name === 'edge.simple')).toBe(true);
    expect(registered.some((r) => r.name === 'edge.already.qualified')).toBe(false);
  });

  it('should cover all branches in discoverModuleDetails', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { discoverModuleDetails } = require('../../../src/modules/module-discovery');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-disc-test-'));

    try {
      // 1. Module with module.js returning config with services/middlewares
      const mod1Dir = path.join(tempDir, 'mod1');
      fs.mkdirSync(mod1Dir, { recursive: true });
      fs.writeFileSync(
        path.join(mod1Dir, 'module.js'),
        'module.exports = () => ({ moduleConfig: { services: { customService: () => {} }, middlewares: { customMw: () => {} } } });'
      );

      // Services folder with non-js and hyphenated name
      const sDir = path.join(mod1Dir, 'services');
      fs.mkdirSync(sDir);
      fs.writeFileSync(path.join(sDir, 'readme.txt'), 'ignore me');
      fs.writeFileSync(path.join(sDir, 'user-profile.js'), 'module.exports = () => "user-profile";');
      fs.writeFileSync(path.join(sDir, 'broken.js'), 'throw new Error("broken service");');

      // Middleware folder with non-js and broken file
      const mDir = path.join(mod1Dir, 'middleware');
      fs.mkdirSync(mDir);
      fs.writeFileSync(path.join(mDir, 'readme.txt'), 'ignore me');
      fs.writeFileSync(path.join(mDir, 'auth-check.js'), 'module.exports = (req, res, next) => next();');
      fs.writeFileSync(path.join(mDir, 'broken-mw.js'), 'throw new Error("broken mw");');

      const d1 = discoverModuleDetails(mod1Dir, 'mod1');
      expect(d1.config).toBeDefined();
      expect(d1.services['mod1.user-profile']).toBeDefined();
      expect(d1.services['mod1.userProfile']).toBeDefined();
      expect(d1.services['customService']).toBeDefined();
      expect(d1.middlewares['auth-check']).toBeDefined();
      expect(d1.middlewares['authCheck']).toBeDefined();
      expect(d1.middlewares['customMw']).toBeDefined();

      // 2. Broken config file
      const mod2Dir = path.join(tempDir, 'mod2');
      fs.mkdirSync(mod2Dir, { recursive: true });
      fs.writeFileSync(path.join(mod2Dir, 'mod2.module.js'), 'throw new Error("syntax error in config");');

      const d2 = discoverModuleDetails(mod2Dir, 'mod2');
      expect(d2.config).toBeNull();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
