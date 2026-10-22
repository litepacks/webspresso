'use strict';

const path = require('path');
const coreServices = require('../../../core/services');
const srcServices = require('../../../src/services');
const core = require('../../../core');
const root = require('../../../index');
const pkg = require('../../../package.json');

describe('Core Services Layer & Export Parity (core/services)', () => {
  describe('1. Module Contract & Export Parity', () => {
    it('core/services exports all core service functions and classes', () => {
      expect(typeof coreServices.defineService).toBe('function');
      expect(typeof coreServices.service).toBe('function');
      expect(coreServices.service).toBe(coreServices.defineService);
      expect(typeof coreServices.createServiceRegistry).toBe('function');
      expect(typeof coreServices.ServiceRegistry).toBe('function');
      expect(typeof coreServices.executeService).toBe('function');
      expect(typeof coreServices.composeMiddleware).toBe('function');
      expect(typeof coreServices.discoverServices).toBe('function');
      expect(typeof coreServices.filePathToServiceName).toBe('function');
      expect(typeof coreServices.toCamelCase).toBe('function');
      expect(typeof coreServices.validateServiceInput).toBe('function');
      expect(typeof coreServices.memoize).toBe('function');
      expect(typeof coreServices.parseTtlMs).toBe('function');
      expect(typeof coreServices.stableCacheKey).toBe('function');
      expect(typeof coreServices.sanitizeInput).toBe('function');
      expect(typeof coreServices.maskSensitiveData).toBe('function');
      expect(typeof coreServices.createServiceRegistryAsync).toBe('function');
      expect(typeof coreServices.loadModuleSync).toBe('function');
      expect(typeof coreServices.loadModuleAsync).toBe('function');
      expect(typeof coreServices.extractModuleExport).toBe('function');
    });

    it('core/services provides lazy getters for all built-in service creators', () => {
      expect(typeof coreServices.createAuthServices).toBe('function');
      expect(typeof coreServices.createMailServices).toBe('function');
      expect(typeof coreServices.createMediaServices).toBe('function');
      expect(typeof coreServices.createFileManagerServices).toBe('function');
      expect(typeof coreServices.createSystemServices).toBe('function');
      expect(typeof coreServices.createExchangeServices).toBe('function');
    });

    it('core/services matches src/services exports 1:1', () => {
      const srcKeys = Object.keys(srcServices);
      for (const key of srcKeys) {
        expect(coreServices[key]).toBe(srcServices[key]);
      }
    });

    it('core/index.js re-exports services namespace and top-level helpers with exact identity', () => {
      expect(core.services).toBe(coreServices);
      expect(core.defineService).toBe(coreServices.defineService);
      expect(core.service).toBe(coreServices.service);
      expect(core.createServiceRegistry).toBe(coreServices.createServiceRegistry);
      expect(core.ServiceRegistry).toBe(coreServices.ServiceRegistry);
      expect(core.executeService).toBe(coreServices.executeService);
      expect(core.composeMiddleware).toBe(coreServices.composeMiddleware);
      expect(core.discoverServices).toBe(coreServices.discoverServices);
      expect(core.filePathToServiceName).toBe(coreServices.filePathToServiceName);
      expect(core.toCamelCase).toBe(coreServices.toCamelCase);
      expect(core.validateServiceInput).toBe(coreServices.validateServiceInput);
      expect(core.memoize).toBe(coreServices.memoize);
      expect(core.parseTtlMs).toBe(coreServices.parseTtlMs);
      expect(core.stableCacheKey).toBe(coreServices.stableCacheKey);
      expect(core.sanitizeInput).toBe(coreServices.sanitizeInput);
      expect(core.maskSensitiveData).toBe(coreServices.maskSensitiveData);
      expect(core.createServiceRegistryAsync).toBe(coreServices.createServiceRegistryAsync);
      expect(core.loadModuleSync).toBe(coreServices.loadModuleSync);
      expect(core.loadModuleAsync).toBe(coreServices.loadModuleAsync);
      expect(core.extractModuleExport).toBe(coreServices.extractModuleExport);
    });

    it('root index.js re-exports services namespace and top-level helpers with exact identity', () => {
      expect(root.services).toBe(coreServices);
      expect(root.defineService).toBe(coreServices.defineService);
      expect(root.service).toBe(coreServices.service);
      expect(root.createServiceRegistry).toBe(coreServices.createServiceRegistry);
      expect(root.ServiceRegistry).toBe(coreServices.ServiceRegistry);
      expect(root.executeService).toBe(coreServices.executeService);
      expect(root.discoverServices).toBe(coreServices.discoverServices);
    });
  });

  describe('2. Package.json Subpath Exports Declaration', () => {
    it('defines ./services pointing to ./core/services/index.js with TypeScript types', () => {
      expect(pkg.exports).toBeDefined();
      expect(pkg.exports['./services']).toEqual({
        types: './index.d.ts',
        default: './core/services/index.js',
      });
    });

    it('defines ./core/services pointing to ./core/services/index.js with TypeScript types', () => {
      expect(pkg.exports['./core/services']).toEqual({
        types: './index.d.ts',
        default: './core/services/index.js',
      });
    });

    it('preserves existing ./plugins/* subpath export alongside services', () => {
      expect(pkg.exports['./plugins/*']).toBe('./plugins/*/index.js');
    });
  });

  describe('3. Functional Service Pipeline via core/services', () => {
    it('defines and executes a service with validation and execution context', async () => {
      const { defineService, createServiceRegistry } = coreServices;

      const registry = createServiceRegistry({ autoLoad: false });

      const greetService = defineService({
        schema: ({ z }) => ({
          name: z.string().min(2),
        }),
        handler: async (input, ctx) => {
          return {
            greeting: `Hello, ${input.name}!`,
            tenantId: ctx?.tenantId || null,
          };
        },
      });

      registry.register('user.greet', greetService);

      const result = await registry.execute('user.greet', { name: 'Alice' }, { tenantId: 'tenant-123' });

      expect(result).toEqual({
        greeting: 'Hello, Alice!',
        tenantId: 'tenant-123',
      });
    });

    it('rejects invalid input according to schema', async () => {
      const { defineService, createServiceRegistry } = coreServices;
      const registry = createServiceRegistry({ autoLoad: false });

      registry.register(
        'math.multiply',
        defineService({
          schema: ({ z }) => ({
            a: z.number(),
            b: z.number(),
          }),
          handler: async ({ a, b }) => a * b,
        })
      );

      await expect(
        registry.execute('math.multiply', { a: 'not-a-number', b: 5 })
      ).rejects.toThrow();
    });
  });
});
