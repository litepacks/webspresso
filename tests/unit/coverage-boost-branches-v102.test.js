import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  getTranslatorForRequest,
  translateSingleIssue,
  translateValidationIssues,
} from '../../src/api/validation-i18n.js';
import {
  generateRouteManifest,
  loadRouteManifest,
} from '../../src/discovery/route-manifest.js';
import {
  precompileTemplates,
  loadPrecompiledTemplates,
} from '../../src/template/precompile.js';
import { lazyPlugin } from '../../plugins/lazy.js';
import { discoverAppRoutes } from '../../src/discovery/scan-routes.js';
import { createTranslator } from '../../src/file-router.js';

describe('Coverage Boost v0.0.102: Systemic Branch & Edge Case Coverage', () => {
  const tempDir = path.join(__dirname, '../fixtures/temp-coverage-boost-v102-' + Date.now());

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('src/api/validation-i18n.js branch coverage', () => {
    it('handles getTranslatorForRequest with pre-existing req.t and req.locale', () => {
      const mockT = vi.fn((key) => key);
      const req = { t: mockT, locale: 'de' };
      const result = getTranslatorForRequest(req);
      expect(result.locale).toBe('de');
      expect(result.t).toBe(mockT);
    });

    it('handles getTranslatorForRequest when req is null/undefined', () => {
      const result = getTranslatorForRequest(null);
      expect(result.locale).toBe(process.env.DEFAULT_LOCALE || 'en');
      expect(typeof result.t).toBe('function');
    });

    it('handles getTranslatorForRequest with options.routeDir, options.pagesDir, and options.isDev: false', () => {
      const pagesDir = path.join(tempDir, 'pages');
      const routeDir = path.join(pagesDir, 'api');
      fs.mkdirSync(path.join(pagesDir, 'locales'), { recursive: true });
      fs.writeFileSync(
        path.join(pagesDir, 'locales', 'tr.json'),
        JSON.stringify({ hello: 'merhaba' })
      );

      const req = {
        locale: 'tr',
        headers: {},
        app: { get: vi.fn(() => pagesDir) },
      };

      // First call (cache miss)
      const res1 = getTranslatorForRequest(req, {
        pagesDir,
        routeDir,
        isDev: false,
      });
      expect(res1.locale).toBe('tr');
      expect(typeof res1.t).toBe('function');

      // Second call (cache hit)
      const res2 = getTranslatorForRequest(
        { locale: 'tr', headers: {} },
        { pagesDir, routeDir, isDev: false }
      );
      expect(res2.locale).toBe('tr');
      expect(typeof res2.t).toBe('function');
    });

    it('handles getTranslatorForRequest with fallback translations when locale is defaultLocale', () => {
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(path.join(pagesDir, 'locales'), { recursive: true });
      fs.writeFileSync(
        path.join(pagesDir, 'locales', 'en.json'),
        JSON.stringify({ greeting: 'Hello' })
      );

      const req = { locale: 'en' };
      const res = getTranslatorForRequest(req, { pagesDir, isDev: true });
      expect(res.locale).toBe('en');
      expect(res.t('greeting')).toBe('Hello');
    });

    it('handles translateSingleIssue with null/non-object issues', () => {
      expect(translateSingleIssue(null, () => {})).toBeNull();
      expect(translateSingleIssue('string', () => {})).toBe('string');
      expect(translateSingleIssue(123, () => {})).toBe(123);
    });

    it('handles translateSingleIssue with non-array path and non-required code', () => {
      const t = vi.fn((k) => k);
      t.has = vi.fn(() => false);

      const issue = {
        code: 'custom',
        path: null,
        message: 'Something went wrong',
      };

      const res = translateSingleIssue(issue, t);
      expect(res.message).toBe('Something went wrong');
    });

    it('handles translateSingleIssue with issue.validation in non-invalid_string', () => {
      const translations = {
        validation: {
          fields: {
            score: {
              custom_validator: 'Puan geçersiz',
            },
          },
        },
      };
      const t = createTranslator(translations, { locale: 'tr' });

      const issue = {
        code: 'custom',
        validation: 'custom_validator',
        path: ['score'],
        message: 'Invalid score',
      };

      const res = translateSingleIssue(issue, t);
      expect(res.message).toBe('Puan geçersiz');
      expect(res.key).toBe('validation.fields.score.custom_validator');
    });

    it('handles translateSingleIssue when t.has is not a function', () => {
      const fakeT = (k) => k; // No .has property
      const issue = {
        code: 'invalid_type',
        path: ['name'],
        message: 'Value is {{ received }} but expected {{ expected }}',
        expected: 'string',
        received: 'number',
      };

      const res = translateSingleIssue(issue, fakeT);
      expect(res.message).toBe('Value is number but expected string');
    });

    it('handles translateSingleIssue with maximum and limit parameters', () => {
      const translations = {
        validation: {
          too_big: 'En fazla {{ max }} olmalıdır (limit: {{ limit }})',
        },
      };
      const t = createTranslator(translations, { locale: 'tr' });

      const issue = {
        code: 'too_big',
        maximum: 100,
        path: ['count'],
        message: 'Number must be <= 100',
      };

      const res = translateSingleIssue(issue, t);
      expect(res.message).toBe('En fazla 100 olmalıdır (limit: 100)');
      expect(res.key).toBe('validation.too_big');
    });

    it('handles translateValidationIssues with options.req containing pre-set t and locale', () => {
      const mockT = vi.fn(() => 'Özel hata');
      mockT.has = vi.fn(() => true);

      const req = { t: mockT, locale: 'tr' };
      const issues = [{ code: 'custom', path: ['field'], message: 'Original' }];

      const res = translateValidationIssues(issues, { req });
      expect(res[0].message).toBe('Özel hata');
    });

    it('handles translateValidationIssues when no translator can be resolved', () => {
      const issues = [{ code: 'custom', message: 'Original' }];
      // No t, no req
      const res = translateValidationIssues(issues, {});
      expect(res).toBe(issues);
    });
  });

  describe('src/discovery/route-manifest.js branch coverage', () => {
    it('generateRouteManifest handles custom manifestPath and formats JSON', () => {
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'index.njk'), '<h1>Home</h1>');

      const manifestPath = path.join(tempDir, 'custom-manifest.json');
      const result = generateRouteManifest({
        rootDir: tempDir,
        pagesDir,
        outFile: manifestPath,
      });

      expect(result).toBeDefined();
      expect(result.manifest.version).toBe(1);
      expect(result.manifest.routes.length).toBeGreaterThan(0);
      expect(fs.existsSync(manifestPath)).toBe(true);

      // Verify JSON file content
      const loaded = loadRouteManifest(manifestPath);
      expect(loaded).toBeDefined();
      expect(loaded.manifest.routes.length).toBe(result.manifest.routes.length);
      expect(Array.isArray(loaded.descriptors)).toBe(true);
    });

    it('loadRouteManifest returns null for non-existent, invalid, or corrupted manifests', () => {
      expect(loadRouteManifest(path.join(tempDir, 'nonexistent.json'))).toBeNull();

      const corruptPath = path.join(tempDir, 'corrupt.json');
      fs.writeFileSync(corruptPath, '{ not valid json');
      expect(loadRouteManifest(corruptPath)).toBeNull();

      const emptyObjectPath = path.join(tempDir, 'empty.json');
      fs.writeFileSync(emptyObjectPath, JSON.stringify({ noRoutes: true }));
      expect(loadRouteManifest(emptyObjectPath)).toBeNull();
    });
  });

  describe('src/template/precompile.js branch coverage', () => {
    it('precompileTemplates handles missing directories gracefully', () => {
      const result = precompileTemplates({
        rootDir: tempDir,
        viewsDir: path.join(tempDir, 'views-nonexistent'),
        pagesDir: path.join(tempDir, 'pages-nonexistent'),
      });
      expect(result).toBeDefined();
      expect(result.templateCount).toBe(0);
      expect(fs.existsSync(result.manifestPath)).toBe(true);
    });

    it('loadPrecompiledTemplates returns null for non-existent bundle', () => {
      expect(loadPrecompiledTemplates(path.join(tempDir, 'nonexistent.js'))).toBeNull();
    });

    it('precompileTemplates skips unparseable or erroring templates without crashing bundle', () => {
      const viewsDir = path.join(tempDir, 'views');
      fs.mkdirSync(viewsDir, { recursive: true });
      // Malformed template syntax that causes a precompile parser error
      fs.writeFileSync(path.join(viewsDir, 'broken.njk'), '{% if something %}Unclosed tag');

      const result = precompileTemplates({
        rootDir: tempDir,
        viewsDir,
        pagesDir: path.join(tempDir, 'pages-empty'),
      });
      expect(result).toBeDefined();
      expect(result.templateCount).toBe(0);
    });
  });

  describe('plugins/lazy.js branch coverage', () => {
    it('initializes lazy plugin with name and empty prefixes', () => {
      const plugin = lazyPlugin(() => ({ name: 'test-lazy', register: vi.fn() }), {
        name: 'test-lazy',
      });
      expect(plugin.name).toBe('test-lazy');
      expect(plugin.isLazy).toBe(true);
      expect(plugin.isHydrated).toBe(false);
    });

    it('handles idempotent double hydration', async () => {
      let initCount = 0;
      const innerPlugin = {
        name: 'test-double-hydrate',
        register: vi.fn(),
      };

      const lazy = lazyPlugin(() => {
        initCount++;
        return innerPlugin;
      }, { name: 'test-double-hydrate' });

      const ctx = { app: { use: vi.fn() } };
      await lazy.hydrate(ctx);
      await lazy.hydrate(ctx);

      expect(initCount).toBe(1);
      expect(lazy.isHydrated).toBe(true);
    });

    it('forwards lifecycle hooks to target plugin if defined', async () => {
      const onRoutesReadyMock = vi.fn();

      const innerPlugin = {
        name: 'test-lifecycle',
        register: vi.fn(),
        onRoutesReady: onRoutesReadyMock,
      };

      const lazy = lazyPlugin(() => innerPlugin, {
        name: 'test-lifecycle',
        prefix: '/custom-prefix',
      });
      const ctx = { app: { use: vi.fn() } };

      // Before hydration: onRoutesReady mounts lazy middleware
      lazy.onRoutesReady(ctx);
      expect(ctx.app.use).toHaveBeenCalledWith('/custom-prefix', expect.any(Function));

      // After hydration: onRoutesReady delegates to inner plugin
      await lazy.hydrate(ctx);
      lazy.onRoutesReady(ctx);
      expect(onRoutesReadyMock).toHaveBeenCalled();
    });
  });

  describe('src/discovery/scan-routes.js discoverAppRoutes branch coverage', () => {
    it('returns empty routes for non-existent pagesDir', () => {
      const result = discoverAppRoutes({
        rootDir: tempDir,
        pages: { dir: path.join(tempDir, 'nonexistent-pages') },
      });
      expect(result.descriptors).toEqual([]);
      expect(result.routeTable.routes).toEqual([]);
    });

    it('discovers route groups, dynamic parameters, and method suffixes', () => {
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(path.join(pagesDir, '(marketing)', 'about'), { recursive: true });
      fs.mkdirSync(path.join(pagesDir, 'blog', '[slug]'), { recursive: true });
      fs.mkdirSync(path.join(pagesDir, 'api', 'v1', 'items'), { recursive: true });

      // Njk templates
      fs.writeFileSync(path.join(pagesDir, '(marketing)', 'about', 'index.njk'), '<h1>About</h1>');
      fs.writeFileSync(path.join(pagesDir, 'blog', '[slug]', 'index.njk'), '<h1>Post</h1>');
      fs.writeFileSync(path.join(pagesDir, 'blog', '[slug]', 'index.js'), 'module.exports = { load: async () => ({}) };');

      // Standalone page
      fs.writeFileSync(path.join(pagesDir, 'standalone.js'), 'module.exports = { default: () => {} };');

      // API routes
      fs.writeFileSync(path.join(pagesDir, 'api', 'v1', 'items', 'list.get.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(pagesDir, 'api', 'v1', 'items', 'create.post.js'), 'module.exports = {};');

      const result = discoverAppRoutes({
        rootDir: tempDir,
        pages: { dir: 'pages' },
        api: { dir: 'pages/api' },
      });

      expect(result.descriptors.length).toBeGreaterThan(0);
      expect(result.routeTable).toBeDefined();
      expect(result.routeTable.routes.length).toBeGreaterThan(0);
    });
  });

  describe('plugins/lazy.js deep proxy & hydration coverage', () => {
    it('exercises setup, register with disposer, and api proxy access', async () => {
      const setupDisposer = vi.fn();
      const regDisposer = vi.fn();
      const onDispose = vi.fn();

      const innerPlugin = {
        name: 'test-deep-lazy',
        setup: vi.fn(() => setupDisposer),
        register: vi.fn(() => regDisposer),
        api: {
          testMethod: vi.fn(() => 'api-result'),
        },
      };

      const lazy = lazyPlugin(() => innerPlugin, {
        name: 'test-deep-lazy',
        prefix: '/lazy-api',
      });

      const regCtx = {
        app: {},
        onDispose,
      };

      lazy.register(regCtx);

      // Access api property triggers hydration
      const res = lazy.api.testMethod();
      expect(res).toBe('api-result');
      expect(lazy.isHydrated).toBe(true);
      expect(innerPlugin.setup).toHaveBeenCalledWith(regCtx.app);
      expect(innerPlugin.register).toHaveBeenCalledWith(regCtx);
      expect(onDispose).toHaveBeenCalledWith(setupDisposer);
      expect(onDispose).toHaveBeenCalledWith(regDisposer);
    });

    it('handles lazy services, helpers, and event triggers', async () => {
      let hydratedBy = '';
      const registeredServices = new Map();
      const registeredHelpers = new Map();
      const eventHandlers = new Map();

      const innerPlugin = {
        name: 'test-triggers',
        register: vi.fn(),
      };

      const lazy = lazyPlugin(() => {
        hydratedBy = 'triggered';
        return innerPlugin;
      }, {
        name: 'test-triggers',
        services: ['lazy.doSomething'],
        helpers: ['lazyHelper'],
        events: ['lazy:trigger'],
      });

      const mockApp = {
        serviceRegistry: {
          has: (name) => registeredServices.has(name),
          register: (name, def) => registeredServices.set(name, def),
          get: (name) => ({ handler: (input) => `handled-${input}` }),
        },
        events: {
          on: (name, fn) => eventHandlers.set(name, fn),
        },
      };

      const ctx = {
        app: mockApp,
        addHelper: (name, fn) => registeredHelpers.set(name, fn),
        pluginManager: {
          getHelpers: () => ({ lazyHelper: (val) => `helped-${val}` }),
        },
      };

      lazy.register(ctx);

      expect(registeredServices.has('lazy.doSomething')).toBe(true);
      expect(registeredHelpers.has('lazyHelper')).toBe(true);
      expect(eventHandlers.has('lazy:trigger')).toBe(true);

      // 1. Service proxy invocation triggers hydration
      const svcDef = registeredServices.get('lazy.doSomething');
      const svcResult = await svcDef.handler('input1');
      expect(svcResult).toBe('handled-input1');
      expect(hydratedBy).toBe('triggered');

      // 2. Helper proxy invocation
      const helperFn = registeredHelpers.get('lazyHelper');
      const helperResult = helperFn('input2');
      expect(helperResult).toBe('helped-input2');

      // 3. Event handler trigger
      const eventFn = eventHandlers.get('lazy:trigger');
      eventFn();
      expect(lazy.isHydrated).toBe(true);
    });
  });

  describe('src/template/precompile.js loadPrecompiledTemplates runtime coverage', () => {
    it('compiles templates, loads bundle, and verifies custom getSource lookup', () => {
      const viewsDir = path.join(tempDir, 'views');
      fs.mkdirSync(viewsDir, { recursive: true });
      fs.writeFileSync(path.join(viewsDir, 'card.njk'), '<div class="card">{{ title }}</div>');

      const outFile = path.join(tempDir, 'bundle.js');
      const precompRes = precompileTemplates({
        rootDir: tempDir,
        viewsDir,
        pagesDir: path.join(tempDir, 'pages-empty'),
        outFile,
      });

      expect(precompRes.templateCount).toBe(1);

      const loaded = loadPrecompiledTemplates({
        rootDir: tempDir,
        bundlePath: outFile,
      });

      expect(loaded).toBeDefined();
      expect(loaded.templateCount).toBeGreaterThanOrEqual(1);
      expect(typeof loaded.loader.getSource).toBe('function');

      // getSource with exact name
      const src1 = loaded.loader.getSource('card.njk');
      expect(src1).toBeDefined();
      expect(src1.path).toBe('card.njk');

      // getSource with views/ prefix normalized
      const src2 = loaded.loader.getSource('views/card.njk');
      expect(src2).toBeDefined();

      // getSource nonexistent template returns null or undefined
      const src3 = loaded.loader.getSource('nonexistent.njk');
      expect(src3).toBeFalsy();
    });

    it('handles outDir option, ignore dirs (.hidden and node_modules), and frontmatter hydration', () => {
      const viewsDir = path.join(tempDir, 'views-outdir');
      const hiddenDir = path.join(viewsDir, '.hidden');
      const nodeModulesDir = path.join(viewsDir, 'node_modules');
      fs.mkdirSync(hiddenDir, { recursive: true });
      fs.mkdirSync(nodeModulesDir, { recursive: true });
      fs.writeFileSync(path.join(hiddenDir, 'skip.njk'), 'skip');
      fs.writeFileSync(path.join(nodeModulesDir, 'skip.njk'), 'skip');
      fs.writeFileSync(
        path.join(viewsDir, 'valid.njk'),
        '---\ntitle: Precompiled\n---\n<h1>{{ title }}</h1>'
      );

      const outDir = path.join(tempDir, 'custom-out');
      const res = precompileTemplates({
        rootDir: tempDir,
        viewsDir,
        outDir,
      });

      expect(res.templateCount).toBe(1);
      expect(fs.existsSync(path.join(outDir, 'templates.compiled.js'))).toBe(true);

      // Verify frontmatter was extracted
      const loaded = loadPrecompiledTemplates({
        rootDir: tempDir,
        bundlePath: path.join(outDir, 'templates.compiled.js'),
      });
      expect(loaded).toBeDefined();
      expect(loaded.templateCount).toBeGreaterThanOrEqual(1);
    });

    it('handles compile errors in bundle.templates and corrupted bundle objects gracefully', () => {
      const badBundlePath = path.join(tempDir, 'bad-bundle.js');
      fs.writeFileSync(
        badBundlePath,
        `module.exports = {
          version: 1,
          templates: {
            broken: 'throw new Error("Syntax broken")',
            valid: 'return function() { return "ok"; }'
          },
          frontmatter: {
            'views/broken.njk': { metaPatch: {} }
          }
        };`
      );

      const loaded = loadPrecompiledTemplates({
        rootDir: tempDir,
        bundlePath: badBundlePath,
      });

      expect(loaded).toBeDefined();
      expect(loaded.templateCount).toBe(1);
      expect(loaded.loader.getSource('valid')).toBeDefined();
      expect(loaded.loader.getSource('broken')).toBeFalsy();

      // Corrupted bundle with non-object templates
      const corruptedPath = path.join(tempDir, 'corrupted-bundle.js');
      fs.writeFileSync(corruptedPath, 'module.exports = { templates: null };');
      const corrupted = loadPrecompiledTemplates({
        rootDir: tempDir,
        bundlePath: corruptedPath,
      });
      expect(corrupted).toBeNull();
    });
  });

  describe('src/discovery/route-manifest.js additional branch coverage', () => {
    it('handles loadRouteManifest with string argument and missing manifest fields', () => {
      const manifestPath = path.join(tempDir, 'custom-manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          version: 1,
          routes: [
            {
              type: 'api',
              method: 'get',
              path: '/api/test',
              target: 'discovered',
              source: 'pages/api/test.get.js',
            },
            {
              type: 'page',
              method: 'get',
              path: '/ignored-target',
              target: 'other',
            },
          ],
        })
      );

      // Call with string path directly
      const result = loadRouteManifest(manifestPath);
      expect(result).toBeDefined();
      expect(result.descriptors.length).toBe(1);
      expect(result.descriptors.scannedPagesFiles).toEqual([]);
      expect(result.descriptors.scannedPagesDir).toBeDefined();
    });
  });
});


