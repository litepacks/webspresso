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
});
