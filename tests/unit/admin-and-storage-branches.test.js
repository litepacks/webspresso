import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';

describe('Admin Panel & Storage Branch Coverage', () => {
  describe('plugins/admin-panel/core/api-extensions.js handlers', () => {
    const { createExtensionApiHandlers } = require('../../plugins/admin-panel/core/api-extensions.js');

    it('exercises bulkUpdateFieldHandler, dashboardStatsHandler, settings, exportHandler, activityLogHandler', async () => {
      const mockModel = {
        name: 'Product',
        table: 'products',
        primaryKey: 'id',
        hidden: ['cost_price'],
        admin: { enabled: true, label: 'Products', icon: 'box' },
        columns: new Map([
          ['id', { type: 'integer', primary: true }],
          ['status', { type: 'enum', enumValues: ['in_stock', 'out_of_stock'] }],
          ['featured', { type: 'boolean' }],
          ['published_at', { type: 'datetime', nullable: true }],
          ['created_at', { type: 'datetime', auto: 'create' }],
          ['cost_price', { type: 'decimal' }],
        ]),
      };

      const mockRepo = {
        count: vi.fn().mockResolvedValue(100),
        query: vi.fn(() => ({
          orderBy: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ created_at: new Date(), updated_at: new Date() }),
          select: vi.fn().mockReturnThis(),
          list: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
        })),
        findById: vi.fn(async (id) => ({
          id,
          status: 'in_stock',
          featured: true,
          published_at: new Date(),
          cost_price: 10,
        })),
        findAll: vi.fn(async () => [
          { id: 1, status: 'in_stock', featured: true, published_at: new Date() },
        ]),
        update: vi.fn().mockResolvedValue(true),
      };

      const mockDb = {
        getModel: vi.fn((name) => (name === 'Product' ? mockModel : null)),
        getAllModels: vi.fn(() => [mockModel]),
        getRepository: vi.fn(() => mockRepo),
        knex: Object.assign(
          vi.fn(() => {
            const queryObj = {
              count: vi.fn().mockReturnThis(),
              first: vi.fn().mockResolvedValue({ count: 5 }),
              orderBy: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              offset: vi.fn().mockResolvedValue([{ id: 1, action: 'login', created_at: new Date() }]),
            };
            return queryObj;
          }),
          {
            schema: {
              hasTable: vi.fn().mockResolvedValue(true),
            },
          }
        ),
      };

      const mockRegistry = {
        toClientConfig: vi.fn(() => ({})),
        settings: { siteName: 'Webspresso' },
        widgets: new Map(),
        actions: new Map(),
        bulkActions: new Map(),
      };

      const handlers = createExtensionApiHandlers({
        registry: mockRegistry,
        db: mockDb,
        path: '/_admin',
      });

      // 1. bulkUpdateFieldHandler - boolean, enum, datetime, errors
      const resBulk1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.bulkUpdateFieldHandler({ params: { model: 'Product' }, body: {} }, resBulk1);
      expect(resBulk1.status).toHaveBeenCalledWith(400);

      // Model not found
      const resBulk2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.bulkUpdateFieldHandler({ params: { model: 'Unknown' }, body: { field: 'status' } }, resBulk2);
      expect(resBulk2.status).toHaveBeenCalledWith(404);

      // Non-updatable field
      const resBulk3 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.bulkUpdateFieldHandler(
        { params: { model: 'Product' }, body: { field: 'created_at', value: 'now' } },
        resBulk3
      );
      expect(resBulk3.status).toHaveBeenCalledWith(400);

      // Enum invalid value
      const resBulk4 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.bulkUpdateFieldHandler(
        { params: { model: 'Product' }, body: { field: 'status', value: 'invalid_enum' } },
        resBulk4
      );
      expect(resBulk4.status).toHaveBeenCalledWith(400);

      // Boolean update with specific IDs
      const resBulk5 = { json: vi.fn() };
      await handlers.bulkUpdateFieldHandler(
        { params: { model: 'Product' }, body: { field: 'featured', value: 'true', ids: [1, 2] } },
        resBulk5
      );
      expect(mockRepo.update).toHaveBeenCalledWith(1, { featured: true });
      expect(resBulk5.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Datetime update with selectAll mode
      const resBulk6 = { json: vi.fn() };
      await handlers.bulkUpdateFieldHandler(
        { params: { model: 'Product' }, body: { field: 'published_at', value: '2026-05-01T12:00', selectAll: true } },
        resBulk6
      );
      expect(resBulk6.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // 2. dashboardStatsHandler
      const resStats = { json: vi.fn() };
      await handlers.dashboardStatsHandler({}, resStats);
      expect(resStats.json).toHaveBeenCalledWith({
        stats: expect.objectContaining({
          Product: expect.objectContaining({ name: 'Product', count: 100 }),
        }),
      });

      // 3. settingsGetHandler & settingsUpdateHandler
      const resSetGet = { json: vi.fn() };
      handlers.settingsGetHandler({}, resSetGet);
      expect(resSetGet.json).toHaveBeenCalledWith({ settings: { siteName: 'Webspresso' } });

      const resSetUp = { json: vi.fn() };
      handlers.settingsUpdateHandler({ body: { brandColor: '#ff0000' } }, resSetUp);
      expect(resSetUp.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(mockRegistry.settings.brandColor).toBe('#ff0000');

      // 4. exportHandler - CSV & JSON
      const resExpCsv = {
        setHeader: vi.fn(),
        json: vi.fn(),
      };
      await handlers.exportHandler(
        { params: { model: 'Product' }, query: { format: 'csv', ids: '1,2' } },
        resExpCsv
      );
      expect(resExpCsv.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(resExpCsv.json).toHaveBeenCalledWith(expect.objectContaining({ format: 'csv' }));

      const resExpJson = { json: vi.fn() };
      await handlers.exportHandler(
        { params: { model: 'Product' }, query: { format: 'json' } },
        resExpJson
      );
      expect(resExpJson.json).toHaveBeenCalledWith(expect.objectContaining({ model: 'Product' }));

      // 5. activityLogHandler
      const resAct = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.activityLogHandler({ query: { page: 1, perPage: 10 } }, resAct);
      expect(resAct.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.any(Array),
      }));
    });
  });

  describe('core/queue/adapters/redis.js full lifecycle', () => {
    const { RedisQueueAdapter } = require('../../core/queue/adapters/redis.js');
    const { Job } = require('../../core/queue/job.js');

    it('exercises dequeue, complete, fail, retry, and getJob', async () => {
      const storage = new Map();
      const mockClient = {
        set: vi.fn((k, v) => { storage.set(k, v); return 'OK'; }),
        get: vi.fn(async (k) => storage.get(k) || null),
        del: vi.fn((k) => { storage.delete(k); return 1; }),
        zadd: vi.fn().mockResolvedValue(1),
        zcard: vi.fn().mockResolvedValue(1),
        scard: vi.fn().mockResolvedValue(1),
        sadd: vi.fn().mockResolvedValue(1),
        srem: vi.fn().mockResolvedValue(1),
        zrangebyscore: vi.fn().mockResolvedValue(['job-123']),
        zrem: vi.fn().mockResolvedValue(1),
      };

      const adapter = new RedisQueueAdapter({ client: mockClient });

      const testJob = new Job({
        id: 'job-123',
        name: 'sync-user',
        data: { id: 1 },
      });

      // Enqueue
      await adapter.enqueue(testJob);
      expect(mockClient.set).toHaveBeenCalled();

      // Dequeue
      const dequeued = await adapter.dequeue('worker-1');
      expect(dequeued).toBeDefined();

      // Complete
      await adapter.complete('job-123', { success: true });
      expect(mockClient.sadd).toHaveBeenCalled();

      // Fail
      await adapter.fail('job-123', new Error('Task crashed'));
      expect(mockClient.sadd).toHaveBeenCalled();

      // Retry
      const retried = await adapter.retry('job-123', 5000, new Error('Temporary'));
      expect(retried).toBeDefined();

      // Get job
      const fetched = await adapter.getJob('job-123');
      expect(fetched).toBeDefined();
    });
  });

  describe('plugins/rest-resources/index.js branch coverage', () => {
    const restResourcePlugin = require('../../plugins/rest-resources/index.js');
    const {
      pluralizeSegment,
      parseIncludeParam,
      parseSortParams,
      applyColumnFilters,
    } = restResourcePlugin;

    it('registers REST endpoints and tests helper methods', () => {
      const mockModel = {
        name: 'Article',
        table: 'articles',
        primaryKey: 'id',
        columns: new Map([
          ['id', { type: 'integer', primary: true }],
          ['title', { type: 'string' }],
          ['views', { type: 'integer' }],
          ['created_at', { type: 'datetime' }],
        ]),
        relations: {
          author: { type: 'belongsTo' },
          tags: { type: 'hasMany' },
        },
        rest: { enabled: true },
      };

      expect(pluralizeSegment('User')).toBe('users');
      expect(pluralizeSegment('Company')).toBe('companies');
      expect(pluralizeSegment('Box')).toBe('boxes');

      expect(parseIncludeParam(mockModel, 'author,tags')).toEqual(['author', 'tags']);
      expect(parseIncludeParam(mockModel, '')).toEqual([]);
      expect(parseIncludeParam(mockModel, null)).toEqual([]);

      expect(parseSortParams(mockModel, 'created_at', 'desc')).toEqual([{ column: 'created_at', direction: 'desc' }]);
      expect(parseSortParams(mockModel, '-views,title')).toEqual([
        { column: 'views', direction: 'desc' },
        { column: 'title', direction: 'asc' },
      ]);

      // Filter helpers
      const mockBuilder = {
        where: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        whereBetween: vi.fn().mockReturnThis(),
      };
      const mockFilterModel = {
        columns: new Map([
          ['name', { type: 'string' }],
          ['age', { type: 'integer' }],
        ]),
      };

      applyColumnFilters(mockBuilder, mockBuilder, mockFilterModel, { query: { name: 'Alice', age: { gt: 18 } } });
      expect(mockBuilder.where).toHaveBeenCalled();

      const mockApp = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        use: vi.fn(),
      };

      const plugin = restResourcePlugin({ prefix: '/api/v1' });
      expect(plugin.name).toBe('rest-resources');

      const ctx = {
        app: mockApp,
        db: {
          getAllModels: vi.fn(() => [mockModel]),
        },
        addRoute: vi.fn(),
      };

      plugin.onRoutesReady(ctx);
      expect(ctx.addRoute).toHaveBeenCalled();
    });
  });

  describe('src/file-router.js comprehensive branch coverage', () => {
    const {
      filePathToRoute,
      extractMethodFromFilename,
      detectLocale,
      createTranslator,
      routeRegistrationMeta,
      compareRouteRegistrationOrder,
      parseNjkFrontmatter,
      frontmatterToPatches,
      loadNjkRouteTemplate,
      clearNjkFrontmatterCaches,
    } = require('../../src/file-router.js');

    it('exercises filePathToRoute and extractMethodFromFilename', () => {
      expect(filePathToRoute('index.njk', '.njk')).toBe('/');
      expect(filePathToRoute('about/index.njk', '.njk')).toBe('/about');
      expect(filePathToRoute('users/[id].njk', '.njk')).toBe('/users/:id');
      expect(filePathToRoute('docs/[...slug].njk', '.njk')).toBe('/docs/*slug');
      expect(filePathToRoute('blog/[category]/[id].njk', '.njk')).toBe('/blog/:category/:id');

      expect(extractMethodFromFilename('users.get.js')).toEqual({ method: 'get', baseName: 'users' });
      expect(extractMethodFromFilename('users.post.js')).toEqual({ method: 'post', baseName: 'users' });
      expect(extractMethodFromFilename('users.delete.js')).toEqual({ method: 'delete', baseName: 'users' });
      expect(extractMethodFromFilename('users.patch.js')).toEqual({ method: 'patch', baseName: 'users' });
      expect(extractMethodFromFilename('users.put.js')).toEqual({ method: 'put', baseName: 'users' });
      expect(extractMethodFromFilename('users.js')).toEqual({ method: 'get', baseName: 'users' });
    });

    it('exercises detectLocale and createTranslator', () => {
      const origLocales = process.env.SUPPORTED_LOCALES;
      process.env.SUPPORTED_LOCALES = 'en,tr,de,es';

      const mockReq = (query = {}, headers = {}) => ({
        query,
        headers,
        get: (h) => headers[h.toLowerCase()] || headers[h],
      });

      // Query param
      expect(detectLocale(mockReq({ lang: 'tr' }))).toBe('tr');
      // Accept-Language
      expect(detectLocale(mockReq({}, { 'accept-language': 'es-ES,es;q=0.9,en;q=0.8' }))).toBe('es');
      // Invalid candidate / unsupported fallback
      expect(detectLocale(mockReq({ lang: 'invalid_long_locale_name_exceeding_max_len' }))).toBe('en');

      if (origLocales) {
        process.env.SUPPORTED_LOCALES = origLocales;
      } else {
        delete process.env.SUPPORTED_LOCALES;
      }

      // Translator
      const translations = {
        welcome: 'Hoşgeldiniz {{name}}',
        messages: {
          unread: '{{count}} okunmamış mesaj',
        },
      };
      const t = createTranslator(translations, { locale: 'tr' });

      expect(t('welcome', { name: 'Ahmet' })).toBe('Hoşgeldiniz Ahmet');
      expect(t('messages.unread', { count: 3 })).toBe('3 okunmamış mesaj');
      expect(t('fallback', 'Default text')).toBe('Default text');
      expect(t('nonexistent')).toBe('nonexistent');
    });

    it('exercises route order comparison and frontmatter parser', () => {
      const r1 = routeRegistrationMeta('/users/profile', 'users/profile.njk');
      const r2 = routeRegistrationMeta('/users/:id', 'users/[id].njk');
      const r3 = routeRegistrationMeta('/docs/*slug', 'docs/[...slug].njk');

      expect(compareRouteRegistrationOrder(r1, r2)).toBeLessThan(0); // static comes before dynamic
      expect(compareRouteRegistrationOrder(r2, r3)).toBeLessThan(0); // dynamic comes before catch-all

      // Frontmatter
      const rawNjk = `---
title: My Page
layout: layouts/custom.njk
middleware: ['auth']
---
<h1>Page Content</h1>`;

      const parsed = parseNjkFrontmatter(rawNjk);
      expect(parsed.fm.title).toBe('My Page');
      expect(parsed.fm.layout).toBe('layouts/custom.njk');
      expect(parsed.body.trim()).toBe('<h1>Page Content</h1>');

      const patches = frontmatterToPatches(parsed.fm);
      expect(patches.metaPatch.title).toBe('My Page');

      clearNjkFrontmatterCaches();
    });
  });

  describe('src/server.js createApp lifecycle and configuration', () => {
    const { createApp } = require('../../src/server.js');

    it('exercises createApp in dev mode with custom error pages and shutdown hooks', async () => {
      const custom404 = vi.fn((req, res) => res.status(404).send('Custom 404'));
      const custom500 = vi.fn((err, req, res, ctx) => res.status(500).send('Custom 500'));

      const { app, nunjucksEnv, shutdownManager } = createApp({
        dev: true,
        pagesDir: path.join(process.cwd(), 'pages'),
        errorPages: {
          notFound: custom404,
          serverError: custom500,
        },
        server: {
          compression: true,
          shutdown: { enabled: true, timeout: 5000 },
        },
      });

      expect(app).toBeDefined();
      expect(nunjucksEnv).toBeDefined();
      expect(shutdownManager).toBeDefined();

      expect(app.isShuttingDown).toBe(false);
      app.onShutdown(vi.fn());
      app.enableShutdownHooks();
      app.disableShutdownHooks();
    });
  });
});
