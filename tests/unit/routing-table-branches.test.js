'use strict';

const path = require('path');
const fs = require('fs');

describe('Routing Table & Scan Routes Branch Coverage', () => {
  describe('plugins/site-analytics/tracking.js branch coverage', () => {
    const { createTrackingMiddleware } = require('../../plugins/site-analytics/tracking.js');

    it('exercises static asset exclusion, excluded prefixes, bot tracking, and batch flushing', async () => {
      const insertedRows = [];
      const mockKnex = vi.fn((table) => ({
        insert: vi.fn(async (rows) => {
          insertedRows.push(...rows);
        }),
      }));
      mockKnex.schema = {
        hasTable: vi.fn(async () => true),
      };
      mockKnex.fn = { now: () => new Date() };

      const mw = createTrackingMiddleware({
        knex: mockKnex,
        batchSize: 2,
        flushIntervalMs: 20,
        trackBots: false,
        excludePaths: ['/admin', '/api/internal'],
      });

      const next = vi.fn();

      // 1. Non-GET request
      await mw({ method: 'POST', path: '/contact', headers: {} }, {}, next);
      expect(next).toHaveBeenCalled();

      // 2. Static asset request
      await mw({ method: 'GET', path: '/style.css', headers: {} }, {}, next);

      // 3. Excluded prefix request
      await mw({ method: 'GET', path: '/admin/users', headers: {} }, {}, next);

      // 4. Bot request with trackBots=false
      await mw(
        {
          method: 'GET',
          path: '/articles',
          headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
        },
        {},
        next
      );
      expect(insertedRows.length).toBe(0);

      // 5. Valid tracked requests (reaching batchSize to trigger immediate flush)
      await mw(
        {
          method: 'GET',
          path: '/page1',
          headers: {
            'user-agent': 'Mozilla/5.0 Chrome',
            'cf-ipcountry': 'US',
            'referer': 'https://google.com',
          },
        },
        {},
        next
      );

      await mw(
        {
          method: 'GET',
          path: '/page2',
          headers: {
            'user-agent': 'Mozilla/5.0 Safari',
            'x-forwarded-for': '203.0.113.195',
          },
        },
        {},
        next
      );

      // Small delay for promise resolution
      await new Promise((r) => setTimeout(r, 40));
      expect(insertedRows.length).toBeGreaterThanOrEqual(2);
    });

    it('exercises batch insert failure and queue re-enqueueing limit', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockFailingKnex = vi.fn(() => ({
        insert: vi.fn(async () => {
          throw new Error('Database disk full');
        }),
      }));
      mockFailingKnex.schema = {
        hasTable: vi.fn(async () => true),
      };
      mockFailingKnex.fn = { now: () => new Date() };

      const mw = createTrackingMiddleware({
        knex: mockFailingKnex,
        batchSize: 1,
        flushIntervalMs: 60000,
      });

      // Should not throw or crash request lifecycle
      await mw(
        {
          method: 'GET',
          path: '/failing-test',
          headers: { 'user-agent': 'Mozilla/5.0' },
        },
        {},
        vi.fn()
      );

      await new Promise((r) => setTimeout(r, 20));
      consoleSpy.mockRestore();
    });
  });

  describe('src/file-router.js SSR streaming and hook error branch coverage', () => {
    const { mountPages } = require('../../src/file-router.js');

    it('exercises mountPages with custom hooks, content API, and 404 route handling', async () => {
      const routes = {};
      const mockApp = {
        get: vi.fn((p, ...handlers) => {
          routes[`GET ${p}`] = handlers[handlers.length - 1];
        }),
      };

      const mockNunjucks = {
        render: vi.fn((tpl, ctx) => `<html>Rendered ${tpl}</html>`),
        renderString: vi.fn((body, ctx) => `<html>String ${body}</html>`),
      };

      const { createPluginManager } = require('../../src/plugin-manager.js');
      const pluginManager = createPluginManager();

      const fixturesDir = path.join(__dirname, '../../tmp/test-file-router-ssr');
      fs.mkdirSync(fixturesDir, { recursive: true });

      // Create dummy 404.njk and page.njk
      fs.writeFileSync(path.join(fixturesDir, '404.njk'), '<h1>Not Found</h1>');
      fs.writeFileSync(
        path.join(fixturesDir, 'stream-page.njk'),
        '<h1>Streaming Page</h1>'
      );
      fs.writeFileSync(
        path.join(fixturesDir, 'stream-page.js'),
        `module.exports = {
          load: async (req, ctx) => ({
            __stream: true,
            title: 'Stream Title',
          }),
          meta: async (req, ctx) => ({
            description: 'Stream Desc',
          }),
        };`
      );

      const routerResult = mountPages(mockApp, {
        pagesDir: fixturesDir,
        nunjucks: mockNunjucks,
        pluginManager,
        db: { name: 'mock-db' },
        silent: true,
      });

      expect(routerResult).toBeDefined();

      // Invoke 404 route if mounted
      const handler404 = routes['GET /404'];
      if (handler404) {
        const res404 = {
          status: vi.fn(),
          send: vi.fn(),
          setHeader: vi.fn(),
        };
        const req404 = { path: '/404', query: {}, params: {}, headers: {}, get: () => null };
        await handler404(req404, res404, vi.fn());
        expect(res404.status).toHaveBeenCalledWith(404);
      }

      // Invoke stream-page route
      const handlerStream = routes['GET /stream-page'];
      if (handlerStream) {
        const resStream = {
          writeHead: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
          setHeader: vi.fn(),
          status: vi.fn().mockReturnThis(),
          send: vi.fn(),
          on: vi.fn(),
          once: vi.fn(),
          emit: vi.fn(),
        };
        const reqStream = { path: '/stream-page', query: {}, params: {}, headers: {}, get: () => null };
        await handlerStream(reqStream, resStream, vi.fn());
        expect(resStream.setHeader).toHaveBeenCalled();
      }

      fs.rmSync(fixturesDir, { recursive: true, force: true });
    });
  });

  describe('src/discovery/file-route-parser.js and scan-routes.js branch coverage', () => {
    const {
      parseFileRoute,
      isPrivateOrIgnored,
      normalizePrefix,
      transformDynamicSegment,
      scanDirSafely,
    } = require('../../src/discovery/file-route-parser.js');
    const { scanRoutes } = require('../../src/discovery/scan-routes.js');

    it('exercises transformDynamicSegment and normalizePrefix edge cases', () => {
      expect(transformDynamicSegment(null)).toBe('');
      expect(transformDynamicSegment('')).toBe('');
      expect(transformDynamicSegment(123)).toBe(123);
      expect(transformDynamicSegment('[...]')).toBe('*');
      expect(transformDynamicSegment('[...slug]')).toBe('*slug');
      expect(transformDynamicSegment('[]')).toBe('[]');
      expect(transformDynamicSegment('[id]')).toBe(':id');
      expect(transformDynamicSegment('static')).toBe('static');

      expect(normalizePrefix(null)).toBe('');
      expect(normalizePrefix('')).toBe('');
      expect(normalizePrefix('/')).toBe('');
      expect(normalizePrefix('///')).toBe('');
      expect(normalizePrefix('api/v1')).toBe('/api/v1');
      expect(normalizePrefix('api/v1/')).toBe('/api/v1');
      expect(normalizePrefix('/api/v1/')).toBe('/api/v1');
      expect(normalizePrefix('//api//v1//')).toBe('/api/v1');
      expect(normalizePrefix(123)).toBe('');
    });

    it('exercises isPrivateOrIgnored with various filenames', () => {
      expect(isPrivateOrIgnored(null)).toBe(true);
      expect(isPrivateOrIgnored('')).toBe(true);
      expect(isPrivateOrIgnored(123)).toBe(true);
      expect(isPrivateOrIgnored('.git')).toBe(true);
      expect(isPrivateOrIgnored('.DS_Store')).toBe(true);
      expect(isPrivateOrIgnored('_header.njk')).toBe(true);
      expect(isPrivateOrIgnored('file.tmp')).toBe(true);
      expect(isPrivateOrIgnored('file.swp')).toBe(true);
      expect(isPrivateOrIgnored('file.bak')).toBe(true);
      expect(isPrivateOrIgnored('file.js~')).toBe(true);
      expect(isPrivateOrIgnored('valid-route.js')).toBe(false);
      expect(isPrivateOrIgnored('valid.njk')).toBe(false);
    });

    it('exercises parseFileRoute with invalid methods, private segments, index, and prefixes', () => {
      expect(parseFileRoute(null)).toEqual({ path: '', method: '', isValid: false, isPrivate: false });
      expect(parseFileRoute('')).toEqual({ path: '', method: '', isValid: false, isPrivate: false });
      expect(parseFileRoute('_private/secret.js')).toEqual({ path: '', method: '', isValid: false, isPrivate: true });
      expect(parseFileRoute('notes.invalidmethod.js')).toEqual({
        path: '',
        method: 'invalidmethod',
        isValid: false,
        isPrivate: false,
        invalidMethod: true,
      });

      const indexRoute = parseFileRoute('index.js', { prefix: '/' });
      expect(indexRoute.path).toBe('/');
      expect(indexRoute.method).toBe('GET');

      const prefixedIndex = parseFileRoute('index.js', { prefix: '/api' });
      expect(prefixedIndex.path).toBe('/api');

      const customPrefixRoute = parseFileRoute('users/[id].delete.js', { prefix: '/v1' });
      expect(customPrefixRoute.path).toBe('/v1/users/:id');
      expect(customPrefixRoute.method).toBe('DELETE');
    });

    it('exercises scanDirSafely on non-existent directory and error throwing', () => {
      expect(scanDirSafely('/non-existent-dir-12345')).toEqual([]);
    });

    it('exercises scanRoutes with explicit pages, api, and modules directory options', () => {
      const tmpDir = path.join(__dirname, '../../tmp/test-scan-routes-custom');
      fs.mkdirSync(path.join(tmpDir, 'custom-pages'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'custom-api'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'custom-modules/auth/pages'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'custom-modules/auth/api'), { recursive: true });

      // Pages
      fs.writeFileSync(path.join(tmpDir, 'custom-pages/about.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(tmpDir, 'custom-pages/layout.njk'), '<html></html>'); // skipped njk
      fs.writeFileSync(path.join(tmpDir, 'custom-pages/home.njk'), '<h1>Home</h1>');
      fs.writeFileSync(path.join(tmpDir, 'custom-pages/home.js'), 'module.exports = {};'); // companion skipped

      // API
      fs.writeFileSync(path.join(tmpDir, 'custom-api/status.get.js'), 'module.exports = {};');

      // Module
      fs.writeFileSync(
        path.join(tmpDir, 'custom-modules/auth/module.config.js'),
        'module.exports = { name: "auth" };'
      );
      fs.writeFileSync(path.join(tmpDir, 'custom-modules/auth/pages/login.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(tmpDir, 'custom-modules/auth/api/token.post.js'), 'module.exports = {};');

      const descriptors = scanRoutes({
        rootDir: tmpDir,
        pages: { dir: path.join(tmpDir, 'custom-pages'), prefix: '/web' },
        api: { dir: path.join(tmpDir, 'custom-api'), prefix: '/v2/api' },
        modules: { dir: path.join(tmpDir, 'custom-modules') },
      });

      expect(descriptors.length).toBeGreaterThanOrEqual(4);
      expect(descriptors.find((d) => d.path === '/web/about')).toBeDefined();
      expect(descriptors.find((d) => d.path === '/v2/api/status')).toBeDefined();
      expect(descriptors.find((d) => d.path === '/auth/login')).toBeDefined();
      expect(descriptors.find((d) => d.path === '/api/auth/token')).toBeDefined();

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});

