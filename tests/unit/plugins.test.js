/**
 * Plugin System Tests
 */
const path = require('path');
const request = require('supertest');

const {
  PluginManager,
  createPluginManager,
  resetPluginManager
} = require('../../src/plugin-manager');
const { semver, matchPattern } = require('../../src/plugin-manager');
const { createApp } = require('../../src/server');
const sitemapPlugin = require('../../plugins/sitemap');
const analyticsPlugin = require('../../plugins/analytics');

describe('Plugin System', () => {
  describe('PluginManager', () => {
    let pm;

    beforeEach(() => {
      pm = createPluginManager();
    });

    it('should register a simple plugin', async () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        register: vi.fn()
      };

      await pm.register([plugin], { app: {}, nunjucksEnv: null });

      expect(pm.hasPlugin('test-plugin')).toBe(true);
      expect(plugin.register).toHaveBeenCalled();
    });

    it('should warn on duplicate plugin names instead of throwing', async () => {
      const plugin1 = { name: 'test', version: '1.0.0' };
      const plugin2 = { name: 'test', version: '2.0.0' };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await pm.register([plugin1, plugin2], {});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate plugin name')
      );
      expect(pm.hasPlugin('test')).toBe(true);
      warnSpy.mockRestore();
    });

    it('should warn on missing plugin name instead of throwing', async () => {
      const plugin = { version: '1.0.0' };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await pm.register([plugin], {});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('without name'),
        expect.anything()
      );
      warnSpy.mockRestore();
    });

    it('should resolve dependencies in correct order', async () => {
      const order = [];
      
      const pluginA = {
        name: 'plugin-a',
        version: '1.0.0',
        dependencies: { 'plugin-b': '^1.0.0' },
        register: () => order.push('a')
      };
      
      const pluginB = {
        name: 'plugin-b',
        version: '1.0.0',
        register: () => order.push('b')
      };

      // Register in wrong order - should still resolve correctly
      await pm.register([pluginA, pluginB], {});

      expect(order).toEqual(['b', 'a']);
    });

    it('should warn on missing dependency instead of throwing', async () => {
      const plugin = {
        name: 'test',
        version: '1.0.0',
        dependencies: { 'missing': '^1.0.0' }
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await pm.register([plugin], {});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('requires "missing"')
      );
      expect(pm.hasPlugin('test')).toBe(true);
      warnSpy.mockRestore();
    });

    it('should warn on version mismatch instead of throwing', async () => {
      const pluginA = {
        name: 'plugin-a',
        version: '1.0.0',
        dependencies: { 'plugin-b': '^2.0.0' }
      };
      
      const pluginB = {
        name: 'plugin-b',
        version: '1.0.0'
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await pm.register([pluginA, pluginB], {});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('requires "plugin-b@^2.0.0"')
      );
      expect(pm.hasPlugin('plugin-a')).toBe(true);
      expect(pm.hasPlugin('plugin-b')).toBe(true);
      warnSpy.mockRestore();
    });

    it('should warn on circular dependencies instead of throwing', async () => {
      const pluginA = {
        name: 'plugin-a',
        version: '1.0.0',
        dependencies: { 'plugin-b': '^1.0.0' }
      };
      
      const pluginB = {
        name: 'plugin-b',
        version: '1.0.0',
        dependencies: { 'plugin-a': '^1.0.0' }
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await pm.register([pluginA, pluginB], {});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Circular dependency')
      );
      warnSpy.mockRestore();
    });

    it('should expose plugin API', async () => {
      const plugin = {
        name: 'test',
        version: '1.0.0',
        api: {
          getData: () => 'test-data'
        }
      };

      await pm.register([plugin], {});

      const api = pm.getPluginAPI('test');
      expect(api.getData()).toBe('test-data');
    });

    it('should allow plugins to use other plugins', async () => {
      const pluginA = {
        name: 'provider',
        version: '1.0.0',
        api: {
          getValue: () => 42
        }
      };

      let receivedValue;
      const pluginB = {
        name: 'consumer',
        version: '1.0.0',
        dependencies: { 'provider': '^1.0.0' },
        register(ctx) {
          const provider = ctx.usePlugin('provider');
          receivedValue = provider.getValue();
        }
      };

      await pm.register([pluginA, pluginB], {});

      expect(receivedValue).toBe(42);
    });

    it('should register helpers', async () => {
      const plugin = {
        name: 'test',
        version: '1.0.0',
        register(ctx) {
          ctx.addHelper('testHelper', () => 'hello');
        }
      };

      await pm.register([plugin], {});

      const helpers = pm.getHelpers();
      expect(helpers.testHelper()).toBe('hello');
    });

    it('should call onRoutesReady hook', async () => {
      const onRoutesReady = vi.fn();
      const plugin = {
        name: 'test',
        version: '1.0.0',
        onRoutesReady
      };

      await pm.register([plugin], {});
      pm.setRoutes([{ type: 'ssr', pattern: '/' }]);
      await pm.onRoutesReady({});

      expect(onRoutesReady).toHaveBeenCalled();
    });

    it('should provide routes in context', async () => {
      let receivedRoutes;
      const plugin = {
        name: 'test',
        version: '1.0.0',
        onRoutesReady(ctx) {
          receivedRoutes = ctx.routes;
        }
      };

      await pm.register([plugin], {});
      pm.setRoutes([
        { type: 'ssr', pattern: '/', file: 'index.njk' },
        { type: 'api', pattern: '/api/health', file: 'api/health.get.js' }
      ]);
      await pm.onRoutesReady({});

      expect(receivedRoutes).toHaveLength(2);
      expect(receivedRoutes[0].pattern).toBe('/');
    });
  });

  describe('Semver Utilities', () => {
    describe('parse', () => {
      it('should parse valid version', () => {
        const v = semver.parse('1.2.3');
        expect(v).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
      });

      it('should parse version with prerelease', () => {
        const v = semver.parse('1.0.0-beta');
        expect(v).toEqual({ major: 1, minor: 0, patch: 0, prerelease: 'beta' });
      });

      it('should return null for invalid version', () => {
        expect(semver.parse('invalid')).toBeNull();
        expect(semver.parse('')).toBeNull();
        expect(semver.parse(null)).toBeNull();
      });
    });

    describe('satisfies', () => {
      it('should match exact version', () => {
        expect(semver.satisfies('1.0.0', '1.0.0')).toBe(true);
        expect(semver.satisfies('1.0.1', '1.0.0')).toBe(false);
      });

      it('should match caret range (^)', () => {
        expect(semver.satisfies('1.0.0', '^1.0.0')).toBe(true);
        expect(semver.satisfies('1.5.0', '^1.0.0')).toBe(true);
        expect(semver.satisfies('2.0.0', '^1.0.0')).toBe(false);
      });

      it('should match tilde range (~)', () => {
        expect(semver.satisfies('1.0.0', '~1.0.0')).toBe(true);
        expect(semver.satisfies('1.0.5', '~1.0.0')).toBe(true);
        expect(semver.satisfies('1.1.0', '~1.0.0')).toBe(false);
      });

      it('should match >= range', () => {
        expect(semver.satisfies('1.0.0', '>=1.0.0')).toBe(true);
        expect(semver.satisfies('2.0.0', '>=1.0.0')).toBe(true);
        expect(semver.satisfies('0.9.0', '>=1.0.0')).toBe(false);
      });

      it('should match wildcard', () => {
        expect(semver.satisfies('1.0.0', '*')).toBe(true);
        expect(semver.satisfies('999.0.0', '*')).toBe(true);
      });
    });
  });

  describe('Pattern Matching', () => {
    it('should match exact path', () => {
      expect(matchPattern('/about', '/about')).toBe(true);
      expect(matchPattern('/about', '/contact')).toBe(false);
    });

    it('should match wildcard patterns', () => {
      expect(matchPattern('/api/users', '/api/*')).toBe(true);
      expect(matchPattern('/api/users/123', '/api/**')).toBe(true);
      expect(matchPattern('/admin/dashboard', '/admin/*')).toBe(true);
    });

    it('should match ** for deep paths', () => {
      expect(matchPattern('/a/b/c/d', '/a/**')).toBe(true);
      expect(matchPattern('/a/b/c/d', '**')).toBe(true);
    });
  });
});

describe('Sitemap Plugin', () => {
  const fixturesDir = path.join(__dirname, '../fixtures');

  it('should create plugin with default options', () => {
    const plugin = sitemapPlugin();
    expect(plugin.name).toBe('sitemap');
    expect(plugin.version).toBe('2.0.0');
  });

  it('should expose API for dynamic URLs', () => {
    const plugin = sitemapPlugin();
    expect(typeof plugin.api.addUrl).toBe('function');
    expect(typeof plugin.api.exclude).toBe('function');
  });

  it('should register sitemap.xml route', async () => {
    const { app } = createApp({
      pagesDir: path.join(fixturesDir, 'pages'),
      viewsDir: path.join(fixturesDir, 'views'),
      plugins: [
        sitemapPlugin({ hostname: 'https://example.com' })
      ]
    });

    const res = await request(app).get('/sitemap.xml');
    
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/xml');
    expect(res.text).toContain('<?xml version="1.0"');
    expect(res.text).toContain('<urlset');
    expect(res.text).toContain('https://example.com/');
  });

  it('should register robots.txt route', async () => {
    const { app } = createApp({
      pagesDir: path.join(fixturesDir, 'pages'),
      viewsDir: path.join(fixturesDir, 'views'),
      plugins: [
        sitemapPlugin({ hostname: 'https://example.com', robots: true })
      ]
    });

    const res = await request(app).get('/robots.txt');
    
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/plain');
    expect(res.text).toContain('User-agent: *');
    expect(res.text).toContain('Sitemap: https://example.com/sitemap.xml');
  });

  it('should exclude patterns from sitemap', async () => {
    const { app } = createApp({
      pagesDir: path.join(fixturesDir, 'pages'),
      viewsDir: path.join(fixturesDir, 'views'),
      plugins: [
        sitemapPlugin({ 
          hostname: 'https://example.com',
          exclude: ['/api/*', '/about']
        })
      ]
    });

    const res = await request(app).get('/sitemap.xml');
    
    expect(res.text).not.toContain('/api/');
    expect(res.text).not.toContain('/about');
  });

  it('should add i18n hreflang tags when enabled', async () => {
    const { app } = createApp({
      pagesDir: path.join(fixturesDir, 'pages'),
      viewsDir: path.join(fixturesDir, 'views'),
      plugins: [
        sitemapPlugin({ 
          hostname: 'https://example.com',
          i18n: true,
          locales: ['en', 'tr']
        })
      ]
    });

    const res = await request(app).get('/sitemap.xml');
    
    expect(res.text).toContain('xmlns:xhtml');
    expect(res.text).toContain('xhtml:link');
    expect(res.text).toContain('hreflang="en"');
    expect(res.text).toContain('hreflang="tr"');
  });
});

describe('Analytics Plugin', () => {
  it('should create plugin with options', () => {
    const plugin = analyticsPlugin({
      google: { measurementId: 'G-TEST123' }
    });
    
    expect(plugin.name).toBe('analytics');
    expect(plugin.version).toBe('1.0.0');
  });

  it('should register gtag helper', async () => {
    const pm = createPluginManager();
    const plugin = analyticsPlugin({
      google: { measurementId: 'G-TEST123' }
    });

    await pm.register([plugin], {});
    const helpers = pm.getHelpers();

    const script = helpers.gtag();
    expect(script).toContain('G-TEST123');
    expect(script).toContain('gtag/js');
    expect(script).toContain("gtag('config'");
  });

  it('should register yandexMetrika helper', async () => {
    const pm = createPluginManager();
    const plugin = analyticsPlugin({
      yandex: { counterId: '12345678' }
    });

    await pm.register([plugin], {});
    const helpers = pm.getHelpers();

    const script = helpers.yandexMetrika();
    expect(script).toContain('12345678');
    expect(script).toContain('yandex.ru/metrika');
    expect(script).toContain('ym(');
  });

  it('should register bingUET helper', async () => {
    const pm = createPluginManager();
    const plugin = analyticsPlugin({
      bing: { uetId: '87654321' }
    });

    await pm.register([plugin], {});
    const helpers = pm.getHelpers();

    const script = helpers.bingUET();
    expect(script).toContain('87654321');
    expect(script).toContain('bat.bing.com');
  });

  it('should register verificationTags helper', async () => {
    const pm = createPluginManager();
    const plugin = analyticsPlugin({
      google: { verificationCode: 'google-code' },
      yandex: { verificationCode: 'yandex-code' },
      bing: { verificationCode: 'bing-code' }
    });

    await pm.register([plugin], {});
    const helpers = pm.getHelpers();

    const tags = helpers.verificationTags();
    expect(tags).toContain('google-site-verification');
    expect(tags).toContain('google-code');
    expect(tags).toContain('yandex-verification');
    expect(tags).toContain('yandex-code');
    expect(tags).toContain('msvalidate.01');
    expect(tags).toContain('bing-code');
  });

  it('should register allAnalytics helper', async () => {
    const pm = createPluginManager();
    const plugin = analyticsPlugin({
      google: { measurementId: 'G-TEST' },
      yandex: { counterId: '123' },
      bing: { uetId: '456' }
    });

    await pm.register([plugin], {});
    const helpers = pm.getHelpers();

    const all = helpers.allAnalytics();
    expect(all).toContain('gtag/js');
    expect(all).toContain('yandex.ru/metrika');
    expect(all).toContain('bat.bing.com');
  });

  it('should return empty string for unconfigured trackers', async () => {
    const pm = createPluginManager();
    const plugin = analyticsPlugin({});

    await pm.register([plugin], {});
    const helpers = pm.getHelpers();

    expect(helpers.gtag()).toBe('');
    expect(helpers.yandexMetrika()).toBe('');
    expect(helpers.bingUET()).toBe('');
    expect(helpers.verificationTags()).toBe('');
  });

  it('should include Google Ads ID when provided', async () => {
    const pm = createPluginManager();
    const plugin = analyticsPlugin({
      google: { measurementId: 'G-TEST', adsId: 'AW-TEST' }
    });

    await pm.register([plugin], {});
    const helpers = pm.getHelpers();

    const script = helpers.gtag();
    expect(script).toContain('G-TEST');
    expect(script).toContain('AW-TEST');
  });

  it('should register GTM helpers', async () => {
    const pm = createPluginManager();
    const plugin = analyticsPlugin({
      gtm: { containerId: 'GTM-TEST123' }
    });

    await pm.register([plugin], {});
    const helpers = pm.getHelpers();

    expect(helpers.gtm()).toContain('GTM-TEST123');
    expect(helpers.gtm()).toContain('googletagmanager.com/gtm.js');
    expect(helpers.gtmNoscript()).toContain('GTM-TEST123');
    expect(helpers.gtmNoscript()).toContain('noscript');
  });

  it('should register Facebook Pixel helper', async () => {
    const pm = createPluginManager();
    const plugin = analyticsPlugin({
      facebook: { pixelId: 'FB-123456' }
    });

    await pm.register([plugin], {});
    const helpers = pm.getHelpers();

    const script = helpers.facebookPixel();
    expect(script).toContain('FB-123456');
    expect(script).toContain('fbevents.js');
    expect(script).toContain('PageView');
  });
});

describe('Plugin Integration', () => {
  const fixturesDir = path.join(__dirname, '../fixtures');

  it('should integrate plugins with createApp', async () => {
    const { app, pluginManager } = createApp({
      pagesDir: path.join(fixturesDir, 'pages'),
      viewsDir: path.join(fixturesDir, 'views'),
      plugins: [
        {
          name: 'test-plugin',
          version: '1.0.0',
          register(ctx) {
            ctx.addHelper('testValue', () => 'integrated');
          }
        }
      ]
    });

    expect(pluginManager.hasPlugin('test-plugin')).toBe(true);
    expect(pluginManager.getHelpers().testValue()).toBe('integrated');
  });

  it('should work without plugins', () => {
    const { app, pluginManager } = createApp({
      pagesDir: path.join(fixturesDir, 'pages'),
      viewsDir: path.join(fixturesDir, 'views')
    });

    expect(pluginManager.getPluginNames()).toEqual([]);
  });
});

describe('Dashboard Plugin', () => {
  const dashboardPlugin = require('../../plugins/dashboard');
  const fixturesDir = path.join(__dirname, '../fixtures');

  it('should create plugin with default options', () => {
    const plugin = dashboardPlugin();

    expect(plugin.name).toBe('dashboard');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.onRoutesReady).toBeTypeOf('function');
  });

  it('should be disabled in production by default', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const plugin = dashboardPlugin();
    const mockCtx = {
      app: { get: vi.fn() },
      routes: [],
      options: {},
      addRoute: vi.fn()
    };

    plugin.onRoutesReady(mockCtx);

    // Should not add any routes in production
    expect(mockCtx.addRoute).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  it('should register dashboard route in development', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const plugin = dashboardPlugin();
    const addedRoutes = [];
    const mockCtx = {
      app: {},
      routes: [
        { type: 'ssr', method: 'get', pattern: '/', file: 'index.njk', isDynamic: false }
      ],
      options: {},
      addRoute: (method, path, handler) => addedRoutes.push({ method, path })
    };

    plugin.onRoutesReady(mockCtx);

    // Should add dashboard routes
    expect(addedRoutes).toContainEqual({ method: 'get', path: '/_webspresso' });
    expect(addedRoutes).toContainEqual({ method: 'get', path: '/_webspresso/api/routes' });
    expect(addedRoutes).toContainEqual({ method: 'get', path: '/_webspresso/api/plugins' });
    expect(addedRoutes).toContainEqual({ method: 'get', path: '/_webspresso/api/config' });

    process.env.NODE_ENV = originalEnv;
  });

  it('should allow custom dashboard path', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const plugin = dashboardPlugin({ path: '/_admin' });
    const addedRoutes = [];
    const mockCtx = {
      app: {},
      routes: [],
      options: {},
      addRoute: (method, path, handler) => addedRoutes.push({ method, path })
    };

    plugin.onRoutesReady(mockCtx);

    expect(addedRoutes).toContainEqual({ method: 'get', path: '/_admin' });
    expect(addedRoutes).toContainEqual({ method: 'get', path: '/_admin/api/routes' });

    process.env.NODE_ENV = originalEnv;
  });

  it('should force enable in production when enabled option is true', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const plugin = dashboardPlugin({ enabled: true });
    const addedRoutes = [];
    const mockCtx = {
      app: {},
      routes: [],
      options: {},
      addRoute: (method, path, handler) => addedRoutes.push({ method, path })
    };

    plugin.onRoutesReady(mockCtx);

    // Should add routes even in production
    expect(addedRoutes.length).toBeGreaterThan(0);

    process.env.NODE_ENV = originalEnv;
  });

  it('should integrate with createApp', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const { app, pluginManager } = createApp({
      pagesDir: path.join(fixturesDir, 'pages'),
      viewsDir: path.join(fixturesDir, 'views'),
      plugins: [dashboardPlugin()]
    });

    expect(pluginManager.hasPlugin('dashboard')).toBe(true);

    // Test dashboard endpoint
    const res = await request(app)
      .get('/_webspresso')
      .expect(200);

    expect(res.text).toContain('Webspresso Dashboard');
    expect(res.text).toContain('mithril');

    process.env.NODE_ENV = originalEnv;
  });

  it('should return JSON for API routes endpoint', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const { app } = createApp({
      pagesDir: path.join(fixturesDir, 'pages'),
      viewsDir: path.join(fixturesDir, 'views'),
      plugins: [dashboardPlugin()]
    });

    const res = await request(app)
      .get('/_webspresso/api/routes')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(Array.isArray(res.body)).toBe(true);

    process.env.NODE_ENV = originalEnv;
  });

  it('should return JSON for API config endpoint', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const { app } = createApp({
      pagesDir: path.join(fixturesDir, 'pages'),
      viewsDir: path.join(fixturesDir, 'views'),
      plugins: [dashboardPlugin()]
    });

    const res = await request(app)
      .get('/_webspresso/api/config')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(res.body).toHaveProperty('env');
    expect(res.body).toHaveProperty('i18n');
    expect(res.body).toHaveProperty('server');

    process.env.NODE_ENV = originalEnv;
  });
});

