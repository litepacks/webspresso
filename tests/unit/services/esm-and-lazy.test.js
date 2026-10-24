const {
  createTempDir,
  cleanupDir
} = require('../../utils');

'use strict';

const fs = require('fs');
const path = require('path');
const {
  ServiceRegistry,
  createServiceRegistry,
  createServiceRegistryAsync,
  defineService,
  loadModuleSync,
  loadModuleAsync,
  extractModuleExport,
} = require('../../../src/services');
const { ConfigurationError, NotFoundError } = require('../../../core/errors');

describe('Services ESM, Dynamic Import & Lazy Loading', () => {
  let tempDir;

  beforeAll(() => {
    tempDir = createTempDir('webspresso-services-esm-test');
  });

  afterAll(() => {
    cleanupDir(tempDir);
  });

  describe('1. Module Loader & Export Normalization (extractModuleExport)', () => {
    it('normalizes CommonJS object export with handler', () => {
      const mod = { handler: async (input) => input.x * 2 };
      const extracted = extractModuleExport(mod);
      expect(extracted).toBe(mod);
    });

    it('normalizes CommonJS raw function export', () => {
      const fn = async (input) => input.x + 1;
      const extracted = extractModuleExport(fn);
      expect(extracted).toBe(fn);
    });

    it('normalizes ESM default export with handler object', () => {
      const def = { handler: async (input) => input.text.toUpperCase() };
      const mod = { default: def };
      const extracted = extractModuleExport(mod);
      expect(extracted).toBe(def);
    });

    it('normalizes ESM default export with function', () => {
      const fn = async (input) => `hello ${input.name}`;
      const mod = { default: fn };
      const extracted = extractModuleExport(mod);
      expect(extracted).toBe(fn);
    });

    it('normalizes ESM named export with handler', () => {
      const handler = async (input) => input.a + input.b;
      const mod = { handler };
      const extracted = extractModuleExport(mod);
      expect(extracted).toBe(mod);
      expect(extracted.handler).toBe(handler);
    });

    it('normalizes ESM named export with service definition', () => {
      const service = { handler: async (input) => input.val * 10 };
      const mod = { service };
      const extracted = extractModuleExport(mod);
      expect(extracted).toBe(service);
    });

    it('normalizes Babel / TypeScript __esModule export', () => {
      const def = { handler: async () => 'ok' };
      const mod = { __esModule: true, default: def };
      const extracted = extractModuleExport(mod);
      expect(extracted).toBe(def);
    });

    it('normalizes handler aliases (execute and run)', () => {
      const executeFn = async (input) => input.x * 3;
      const mod1 = { execute: executeFn };
      const extracted1 = extractModuleExport(mod1);
      expect(extracted1.handler).toBe(executeFn);

      const runFn = async (input) => input.y + 5;
      const mod2 = { run: runFn };
      const extracted2 = extractModuleExport(mod2);
      expect(extracted2.handler).toBe(runFn);

      const mod3 = { default: { execute: executeFn } };
      const extracted3 = extractModuleExport(mod3);
      expect(extracted3.handler).toBe(executeFn);
    });

    it('unwraps nested transpiled default.default export', () => {
      const def = { handler: async () => 'nested-ok' };
      const mod = { __esModule: true, default: { __esModule: true, default: def } };
      const extracted = extractModuleExport(mod);
      expect(extracted).toBe(def);
    });

    it('unwraps frozen ESM module namespace object to plain object', () => {
      const frozenModule = Object.freeze({
        __esModule: true,
        default: Object.freeze({ handler: async () => 'frozen-ok' }),
      });
      const extracted = extractModuleExport(frozenModule);
      expect(typeof extracted.handler).toBe('function');
    });

    it('normalizes named service export with execute or run alias', () => {
      const execFn = async () => 'exec-ok';
      const mod1 = { service: { execute: execFn } };
      const extracted1 = extractModuleExport(mod1);
      expect(extracted1.handler).toBe(execFn);

      const runFn = async () => 'run-ok';
      const mod2 = { service: { run: runFn } };
      const extracted2 = extractModuleExport(mod2);
      expect(extracted2.handler).toBe(runFn);
    });

    it('falls back to default export when default is not a handler object', () => {
      const mod = { default: 'primitive-default' };
      expect(extractModuleExport(mod)).toBe('primitive-default');
    });

    it('loadModuleAsync loads commonjs module with isDev: true', async () => {
      const sampleFile = path.join(tempDir, 'dev-sample.cjs');
      fs.writeFileSync(sampleFile, 'module.exports = { handler: async () => "dev-v1" };');
      const loaded = await loadModuleAsync(sampleFile, { isDev: true });
      expect(loaded).toBeDefined();
      expect(typeof loaded.handler).toBe('function');
    });

    it('handles null and undefined gracefully', () => {
      expect(extractModuleExport(null)).toBeNull();
      expect(extractModuleExport(undefined)).toBeUndefined();
    });
  });

  describe('2. Programmatic Lazy Service Registration (registerLazy)', () => {
    it('registers a lazy service and resolves it on demand via execute()', async () => {
      const registry = new ServiceRegistry();
      let loaderCalled = 0;

      registry.registerLazy('billing.calculateTax', async () => {
        loaderCalled++;
        return defineService({
          schema: ({ z }) => ({
            amount: z.number(),
            rate: z.number(),
          }),
          handler: async ({ amount, rate }) => amount * rate,
        });
      });

      expect(registry.has('billing.calculateTax')).toBe(true);
      expect(registry.list()).toContain('billing.calculateTax');
      expect(registry.get('billing.calculateTax')).toBeUndefined();
      expect(loaderCalled).toBe(0);

      // Execute on demand
      const tax = await registry.execute('billing.calculateTax', { amount: 100, rate: 0.18 });
      expect(tax).toBe(18);
      expect(loaderCalled).toBe(1);

      // Second execution uses cached materialized service definition without calling loader
      const tax2 = await registry.execute('billing.calculateTax', { amount: 200, rate: 0.18 });
      expect(tax2).toBe(36);
      expect(loaderCalled).toBe(1);

      // Direct synchronous get() now returns the materialized definition
      expect(registry.get('billing.calculateTax')).toBeDefined();
    });

    it('deduplicates concurrent getAsync calls on lazy services (stampede protection)', async () => {
      const registry = new ServiceRegistry();
      let loaderCalled = 0;

      registry.registerLazy('concurrent.service', async () => {
        loaderCalled++;
        await new Promise((r) => setTimeout(r, 20));
        return { handler: async (input) => `result-${input.val}` };
      });

      // Fire 5 concurrent requests simultaneously
      const [res1, res2, res3, res4, res5] = await Promise.all([
        registry.getAsync('concurrent.service'),
        registry.getAsync('concurrent.service'),
        registry.getAsync('concurrent.service'),
        registry.getAsync('concurrent.service'),
        registry.getAsync('concurrent.service'),
      ]);

      expect(loaderCalled).toBe(1);
      expect(res1).toBe(res2);
      expect(res2).toBe(res3);
      expect(res1.name).toBe('concurrent.service');
    });

    it('registers lazy service with aliases', async () => {
      const registry = new ServiceRegistry();

      registry.registerLazy(
        'order-items.summary',
        async () => ({
          handler: async (input) => ({ count: input.items.length }),
        }),
        { aliases: ['orderItems.summary'] }
      );

      expect(registry.has('order-items.summary')).toBe(true);
      expect(registry.has('orderItems.summary')).toBe(true);

      const res = await registry.execute('orderItems.summary', { items: [1, 2, 3] });
      expect(res).toEqual({ count: 3 });
    });

    it('rejects duplicate lazy service registration without overwrite: true', () => {
      const registry = new ServiceRegistry();
      registry.registerLazy('test.dup', async () => ({ handler: async () => 'first' }));

      expect(() => {
        registry.registerLazy('test.dup', async () => ({ handler: async () => 'second' }));
      }).toThrow(ConfigurationError);

      // Allows with overwrite: true
      expect(() => {
        registry.registerLazy('test.dup', async () => ({ handler: async () => 'second' }), {
          overwrite: true,
        });
      }).not.toThrow();
    });

    it('unregisters a lazy service properly', () => {
      const registry = new ServiceRegistry();
      registry.registerLazy('temp.lazy', async () => ({ handler: async () => 'val' }));

      expect(registry.has('temp.lazy')).toBe(true);
      expect(registry.unregister('temp.lazy')).toBe(true);
      expect(registry.has('temp.lazy')).toBe(false);
      expect(registry.unregister('temp.lazy')).toBe(false);
    });
  });

  describe('3. Native ESM (.mjs) Services & Dynamic Import', () => {
    let esmDir;

    beforeAll(() => {
      esmDir = path.join(tempDir, 'esm-services');
      fs.mkdirSync(esmDir, { recursive: true });

      // Create an ESM service file with .mjs
      const esmServiceContent = `
        export default {
          schema: ({ z }) => ({
            query: z.string(),
          }),
          handler: async ({ query }) => {
            return { result: 'esm search: ' + query };
          }
        };
      `;
      fs.writeFileSync(path.join(esmDir, 'search.mjs'), esmServiceContent, 'utf8');

      // Create an ESM service with named export
      const namedEsmContent = `
        export const handler = async (input) => {
          return { sum: input.x + input.y };
        };
      `;
      fs.writeFileSync(path.join(esmDir, 'add.mjs'), namedEsmContent, 'utf8');

      // Create a CJS service in the same dir
      const cjsServiceContent = `
        module.exports = {
          handler: async (input) => ({ cjs: true, val: input.val }),
        };
      `;
      fs.writeFileSync(path.join(esmDir, 'sync.js'), cjsServiceContent, 'utf8');
    });

    it('synchronous load() discovers .mjs files and safely defers them to lazy execution without throwing ERR_REQUIRE_ESM', async () => {
      const registry = new ServiceRegistry({ servicesDir: esmDir });

      // Synchronous load does not crash on .mjs files!
      expect(() => registry.load()).not.toThrow();

      expect(registry.has('search')).toBe(true);
      expect(registry.has('add')).toBe(true);
      expect(registry.has('sync')).toBe(true);

      // Synchronous CJS service is materialized immediately
      expect(registry.get('sync')).toBeDefined();

      // ESM services are deferred
      expect(registry.get('search')).toBeUndefined();

      // Calling execute() dynamically imports and executes ESM service smoothly
      const searchRes = await registry.execute('search', { query: 'webspresso' });
      expect(searchRes).toEqual({ result: 'esm search: webspresso' });

      // Named ESM export executes smoothly
      const addRes = await registry.execute('add', { x: 15, y: 25 });
      expect(addRes).toEqual({ sum: 40 });

      // CJS service also executes
      const cjsRes = await registry.execute('sync', { val: 'test' });
      expect(cjsRes).toEqual({ cjs: true, val: 'test' });
    });

    it('asynchronous loadAsync() loads both CJS and ESM services ahead of time', async () => {
      const registry = new ServiceRegistry({ servicesDir: esmDir });

      await registry.loadAsync();

      expect(registry.has('search')).toBe(true);
      expect(registry.has('add')).toBe(true);
      expect(registry.has('sync')).toBe(true);

      // All services are materialized ahead of time
      expect(registry.get('search')).toBeDefined();
      expect(registry.get('add')).toBeDefined();
      expect(registry.get('sync')).toBeDefined();

      const searchRes = await registry.execute('search', { query: 'async' });
      expect(searchRes).toEqual({ result: 'esm search: async' });
    });

    it('createServiceRegistryAsync factory creates and asynchronously loads all services', async () => {
      const registry = await createServiceRegistryAsync({ servicesDir: esmDir });

      expect(registry.has('search')).toBe(true);
      expect(registry.get('search')).toBeDefined();

      const res = await registry.execute('search', { query: 'factory' });
      expect(res).toEqual({ result: 'esm search: factory' });
    });

    it('reloadAsync() refreshes all services including ESM', async () => {
      const registry = await createServiceRegistryAsync({ servicesDir: esmDir });
      expect(registry.has('search')).toBe(true);

      await registry.reloadAsync();
      expect(registry.has('search')).toBe(true);
      expect(registry.get('search')).toBeDefined();
    });
  });

  describe('4. Zero-Cold-Start Lazy Mode (lazy: true)', () => {
    let lazyDir;

    beforeAll(() => {
      lazyDir = path.join(tempDir, 'lazy-services');
      fs.mkdirSync(lazyDir, { recursive: true });

      fs.writeFileSync(
        path.join(lazyDir, 'heavy-report.js'),
        `
        let initialized = false;
        module.exports = {
          handler: async () => {
            initialized = true;
            return { initialized };
          }
        };
        `,
        'utf8'
      );

      fs.writeFileSync(
        path.join(lazyDir, 'user-profile.js'),
        `
        module.exports = {
          handler: async (input) => ({ userId: input.id }),
        };
        `,
        'utf8'
      );
    });

    it('loads zero module files into require.cache when lazy: true is configured', async () => {
      const registry = createServiceRegistry({
        servicesDir: lazyDir,
        lazy: true,
      });

      expect(registry.has('heavy-report')).toBe(true);
      expect(registry.has('user-profile')).toBe(true);
      expect(registry.list()).toEqual(expect.arrayContaining(['heavy-report', 'user-profile']));

      // In lazy mode, definitions are not yet in this.services
      expect(registry.services.size).toBe(0);
      expect(registry.lazyServices.size).toBe(2);

      // On first execute, service is loaded on demand
      const user = await registry.execute('user-profile', { id: 42 });
      expect(user).toEqual({ userId: 42 });

      expect(registry.services.size).toBe(1);
      expect(registry.lazyServices.size).toBe(1);

      // Second service remains unloaded until requested
      expect(registry.services.has('heavy-report')).toBe(false);
      const report = await registry.execute('heavy-report', {});
      expect(report).toEqual({ initialized: true });
      expect(registry.services.size).toBe(2);
      expect(registry.lazyServices.size).toBe(0);
    });

    it('supports synchronous get() for lazy CJS services on demand', () => {
      const registry = createServiceRegistry({
        servicesDir: lazyDir,
        lazy: true,
      });

      expect(registry.services.has('user-profile')).toBe(false);
      // Synchronous get() on a lazy CJS service materializes it on the fly
      const def = registry.get('user-profile');
      expect(def).toBeDefined();
      expect(typeof def.handler).toBe('function');
      expect(registry.services.has('user-profile')).toBe(true);
    });
  });

  describe('5. Error Handling & Edge Cases', () => {
    it('throws ConfigurationError for invalid lazy loader argument', () => {
      const registry = new ServiceRegistry();
      expect(() => {
        registry.registerLazy('bad.loader', 12345);
      }).toThrow(ConfigurationError);
    });

    it('throws NotFoundError with code SERVICE_NOT_FOUND when executing unknown service', async () => {
      const registry = new ServiceRegistry();
      await expect(registry.execute('missing.service')).rejects.toThrow(NotFoundError);
      try {
        await registry.execute('missing.service');
      } catch (err) {
        expect(err.code).toBe('SERVICE_NOT_FOUND');
        expect(err.service).toBe('missing.service');
      }
    });

    it('throws ConfigurationError when service file exports missing handler', async () => {
      const invalidDir = path.join(tempDir, 'invalid-services');
      fs.mkdirSync(invalidDir, { recursive: true });
      fs.writeFileSync(path.join(invalidDir, 'no-handler.js'), 'module.exports = { notHandler: 123 };');

      const registry = new ServiceRegistry({ servicesDir: invalidDir });
      expect(() => registry.load()).toThrow(ConfigurationError);
    });
  });
});
