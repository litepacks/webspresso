import { cleanupDir } from '../../utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';
const path = require('path');
const fs = require('fs');
const {
  setAppContext,
  getAppContext,
  getDb,
  hasDb,
  getShutdownManager,
  hasShutdownManager,
  getServiceRegistry,
  hasServiceRegistry,
  getEvents,
  hasEvents,
  getMailer,
  hasMailer,
  resetAppContext,
  attachDbMiddleware,
} = require('../../../src/app-context');
const { defineModule } = require('../../../src/modules/define-module');
const { discoverModuleDetails } = require('../../../src/modules/module-discovery');

describe('src/app-context.js', () => {
  beforeEach(() => {
    resetAppContext();
  });

  it('manages context getters and setters with informative errors', () => {
    expect(hasDb()).toBe(false);
    expect(() => getDb()).toThrow(/No database registered/);

    expect(hasShutdownManager()).toBe(false);
    expect(getShutdownManager()).toBeNull();

    expect(hasServiceRegistry()).toBe(false);
    expect(getServiceRegistry()).toBeNull();

    expect(hasEvents()).toBe(false);
    expect(getEvents()).toBeNull();

    expect(hasMailer()).toBe(false);
    expect(getMailer()).toBeNull();

    const mockDb = { name: 'knex-mock' };
    const mockShutdown = { registerDisposer: vi.fn() };
    const mockRegistry = { call: vi.fn() };
    const mockEvents = { emit: vi.fn() };
    const mockMailer = { send: vi.fn() };

    setAppContext({
      db: mockDb,
      shutdownManager: mockShutdown,
      serviceRegistry: mockRegistry,
      events: mockEvents,
      mailer: mockMailer,
    });

    expect(hasDb()).toBe(true);
    expect(getDb()).toBe(mockDb);
    expect(hasShutdownManager()).toBe(true);
    expect(getShutdownManager()).toBe(mockShutdown);
    expect(hasServiceRegistry()).toBe(true);
    expect(getServiceRegistry()).toBe(mockRegistry);
    expect(hasEvents()).toBe(true);
    expect(getEvents()).toBe(mockEvents);
    expect(hasMailer()).toBe(true);
    expect(getMailer()).toBe(mockMailer);

    resetAppContext();
    expect(hasDb()).toBe(false);
  });

  it('attaches db, events, mailer and service registry to request in attachDbMiddleware', () => {
    const mockDb = { id: 'db-1' };
    const mockEvents = { id: 'events-1' };
    const mockMailer = { id: 'mailer-1' };
    const mockRegistry = { call: vi.fn().mockReturnValue('service-result') };

    setAppContext({
      db: mockDb,
      events: mockEvents,
      mailer: mockMailer,
      serviceRegistry: mockRegistry,
    });

    const req = { context: { customKey: 123 } };
    const res = {};
    const next = vi.fn();

    attachDbMiddleware(req, res, next);

    expect(req.db).toBe(mockDb);
    expect(req.events).toBe(mockEvents);
    expect(req.mailer).toBe(mockMailer);
    expect(typeof req.service).toBe('function');

    const result = req.service('user.find', { id: 1 }, { opt: true });
    expect(result).toBe('service-result');
    expect(mockRegistry.call).toHaveBeenCalledWith(
      'user.find',
      { id: 1 },
      req.context,
      { opt: true }
    );
    expect(next).toHaveBeenCalledTimes(1);

    // Test without req.context (fallback object branch)
    const reqWithoutContext = {};
    attachDbMiddleware(reqWithoutContext, res, next);
    reqWithoutContext.service('user.fallback', { id: 2 });
    expect(mockRegistry.call).toHaveBeenCalledWith(
      'user.fallback',
      { id: 2 },
      expect.objectContaining({ req: reqWithoutContext, res, db: mockDb, events: mockEvents, mailer: mockMailer }),
      undefined
    );
  });
});

describe('src/modules/define-module.js', () => {
  it('throws when module name is missing or invalid', () => {
    expect(() => defineModule({})).toThrow(/requires a valid non-empty "name"/);
    expect(() => defineModule({ name: '   ' })).toThrow(/requires a valid non-empty "name"/);
    expect(() => defineModule({ name: 123 })).toThrow(/requires a valid non-empty "name"/);
  });

  it('creates a module plugin factory with metadata and dependencies', () => {
    const factory = defineModule({
      name: 'billing',
      version: '2.0.0',
      description: 'Billing & Subscriptions',
      imports: ['auth'],
      dependencies: ['analytics'],
      exports: {
        getPlan: () => 'pro',
      },
    });

    const plugin = factory({ customSetting: true });
    expect(plugin.name).toBe('billing');
    expect(plugin.version).toBe('2.0.0');
    expect(plugin.description).toBe('Billing & Subscriptions');
    expect(plugin.dependencies).toEqual(['auth', 'analytics']);
    expect(plugin.__isWebspressoModule).toBe(true);
    expect(plugin.moduleConfig.customSetting).toBe(true);
    expect(plugin.api.getPlan()).toBe('pro');
  });

  it('registers module services, middlewares, and lifecycle hooks with context', () => {
    const onInit = vi.fn();
    const onDestroy = vi.fn();

    const factory = defineModule({
      name: 'catalog',
      services: {
        'list': { handler: () => [] },
        'item.get': { handler: () => ({}) },
      },
      middlewares: {
        guard: (req, res, next) => next(),
      },
      onInit,
      onDestroy,
    });

    const plugin = factory();

    const mockServiceRegistry = {
      has: vi.fn().mockReturnValue(false),
      register: vi.fn(),
    };
    const mockShutdownManager = {
      registerDisposer: vi.fn(),
    };
    const ctx = {
      app: { serviceRegistry: mockServiceRegistry },
      middlewares: {},
      shutdownManager: mockShutdownManager,
    };

    plugin.register(ctx);

    // Services registered with prefix or preserved if already dot-qualified
    expect(mockServiceRegistry.register).toHaveBeenCalledWith(
      'catalog.list',
      expect.any(Object)
    );
    expect(mockServiceRegistry.register).toHaveBeenCalledWith(
      'item.get',
      expect.any(Object)
    );

    // Middlewares registered
    expect(ctx.middlewares['catalog.guard']).toBeDefined();

    // Lifecycle hooks
    expect(onInit).toHaveBeenCalledWith(ctx);
    expect(mockShutdownManager.registerDisposer).toHaveBeenCalledWith(onDestroy, {
      name: 'module:catalog',
    });
  });
});

describe('src/modules/module-discovery.js', () => {
  it('returns empty structure for non-existent module path', () => {
    const discovered = discoverModuleDetails('/path/that/does/not/exist', 'ghost');
    expect(discovered.services).toEqual({});
    expect(discovered.middlewares).toEqual({});
    expect(discovered.config).toBeNull();
  });

  it('discovers services, middlewares, and configuration from module folder structure', () => {
    const tempModDir = path.resolve(__dirname, '../../../.gemini-temp-module-test');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      fs.mkdirSync(path.join(tempModDir, 'services'), { recursive: true });
      fs.mkdirSync(path.join(tempModDir, 'middleware'), { recursive: true });

      // 1. Config exported as function returning moduleConfig
      fs.writeFileSync(
        path.join(tempModDir, 'test-mod.module.js'),
        'module.exports = () => ({ moduleConfig: { description: "Test Module", services: { "direct.svc": {} }, middlewares: { "directMw": () => {} } } });'
      );

      // 2. Normal service and camelCase alias
      fs.writeFileSync(
        path.join(tempModDir, 'services', 'find-user.js'),
        'module.exports = { execute: async () => ({ id: 1 }) };'
      );

      // 3. Corrupt service throwing error
      fs.writeFileSync(
        path.join(tempModDir, 'services', 'broken-service.js'),
        'throw new Error("Cannot load service");'
      );

      // 4. Non-js file in services
      fs.writeFileSync(
        path.join(tempModDir, 'services', 'notes.txt'),
        'some text'
      );

      // 5. Middleware in middleware/ folder
      fs.writeFileSync(
        path.join(tempModDir, 'middleware', 'auth-check.js'),
        'module.exports = (req, res, next) => next();'
      );

      // 6. Corrupt middleware throwing error
      fs.writeFileSync(
        path.join(tempModDir, 'middleware', 'broken-mw.js'),
        'throw new Error("Cannot load middleware");'
      );

      const discovered = discoverModuleDetails(tempModDir, 'test-mod');
      expect(discovered.config.description).toBe('Test Module');
      expect(discovered.services['test-mod.find-user']).toBeDefined();
      expect(discovered.services['test-mod.findUser']).toBeDefined();
      expect(discovered.services['direct.svc']).toBeDefined(); // merged from config
      expect(discovered.middlewares['auth-check']).toBeDefined();
      expect(discovered.middlewares['authCheck']).toBeDefined();
      expect(discovered.middlewares['directMw']).toBeDefined(); // merged from config

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error loading module service'),
        expect.any(String)
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error loading module middleware'),
        expect.any(String)
      );
    } finally {
      warnSpy.mockRestore();
      if (fs.existsSync(tempModDir)) {
        fs.rmSync(tempModDir, { recursive: true, force: true });
      }
    }
  });

  it('handles module.js or index.js candidate configs and config load errors', () => {
    const tempDir = path.resolve(__dirname, '../../../.gemini-temp-module-candidate');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      fs.mkdirSync(tempDir, { recursive: true });
      // Broken module.js throwing error
      fs.writeFileSync(path.join(tempDir, 'module.js'), 'throw new Error("Bad config");');

      const discovered = discoverModuleDetails(tempDir, 'broken-mod');
      expect(discovered.config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error loading module config'),
        expect.any(String)
      );
    } finally {
      warnSpy.mockRestore();
      cleanupDir(tempDir);
    }
  });
});
