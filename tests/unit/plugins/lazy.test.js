import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { createApp, lazyPlugin, adminPanelPlugin, createDatabase, defineModel, zdb, clearRegistry } from '../../../index';

describe('On-Demand / Lazy Plugins (lazyPlugin)', () => {
  let tempDir;
  let db;

  beforeEach(async () => {
    clearRegistry();
    tempDir = path.join(__dirname, '../../fixtures/temp-lazy-plugin-' + Date.now());
    fs.mkdirSync(path.join(tempDir, 'views'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });

    fs.writeFileSync(
      path.join(tempDir, 'views', 'layout.njk'),
      '<!DOCTYPE html><html><body>{% block content %}{% endblock %}</body></html>'
    );
    fs.writeFileSync(
      path.join(tempDir, 'pages', 'index.njk'),
      '<h1>Public Home</h1>'
    );

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const TestItem = defineModel({
      name: 'TestItem',
      table: 'test_items',
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(),
      }),
    });
    db.registerModel(TestItem);
    await db.knex.schema.createTable('test_items', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
    });
  });

  afterEach(async () => {
    if (db && typeof db.close === 'function') {
      await db.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create a lazy plugin definition with isLazy: true and isHydrated: false', () => {
    const factory = vi.fn(() => ({
      name: 'test-plugin',
      version: '1.2.3',
      api: { ping: () => 'pong' },
    }));

    const lazy = lazyPlugin(factory, {
      name: 'test-plugin',
      prefix: '/test-plugin',
      services: ['test.service'],
    });

    expect(lazy.name).toBe('test-plugin');
    expect(lazy.isLazy).toBe(true);
    expect(lazy.isHydrated).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it('should not call plugin factory or mount inner routes during createApp startup', async () => {
    const factory = vi.fn(() => ({
      name: 'heavy-plugin',
      register: vi.fn(),
      onRoutesReady: (ctx) => {
        ctx.addRoute('get', '/heavy/status', (req, res) => res.json({ ready: true }));
      },
    }));

    const lazy = lazyPlugin(factory, {
      name: 'heavy-plugin',
      prefix: '/heavy',
    });

    const { app } = createApp({
      rootDir: tempDir,
      viewsDir: path.join(tempDir, 'views'),
      pagesDir: path.join(tempDir, 'pages'),
      plugins: [lazy],
      logging: false,
    });

    // Verify factory has NOT been called during server initialization
    expect(factory).not.toHaveBeenCalled();
    expect(lazy.isHydrated).toBe(false);

    // Requesting a public route does not trigger hydration
    const resPublic = await request(app).get('/');
    expect(resPublic.status).toBe(200);
    expect(resPublic.text).toContain('Public Home');
    expect(factory).not.toHaveBeenCalled();
    expect(lazy.isHydrated).toBe(false);
  });

  it('should trigger hydration on first request matching URL prefix', async () => {
    const factory = vi.fn(() => ({
      name: 'heavy-plugin',
      onRoutesReady: (ctx) => {
        ctx.addRoute('get', '/heavy/status', (req, res) => res.json({ ready: true, count: 42 }));
        ctx.addRoute('get', '/heavy/items/:id', (req, res) => res.json({ id: req.params.id }));
      },
    }));

    const onHydrateCallback = vi.fn();

    const lazy = lazyPlugin(factory, {
      name: 'heavy-plugin',
      prefix: '/heavy',
      onHydrate: onHydrateCallback,
    });

    const { app } = createApp({
      rootDir: tempDir,
      viewsDir: path.join(tempDir, 'views'),
      pagesDir: path.join(tempDir, 'pages'),
      plugins: [lazy],
      logging: false,
    });

    expect(lazy.isHydrated).toBe(false);

    // First request to prefix triggers hydration
    const res = await request(app).get('/heavy/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true, count: 42 });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(onHydrateCallback).toHaveBeenCalledTimes(1);
    expect(lazy.isHydrated).toBe(true);

    // Subsequent requests use already hydrated router
    const res2 = await request(app).get('/heavy/items/99');
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ id: '99' });

    // Factory should still have been called exactly once
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should trigger hydration on on-demand service execution', async () => {
    const factory = vi.fn(() => ({
      name: 'service-plugin',
      register: (ctx) => {
        if (ctx.app && ctx.app.serviceRegistry) {
          ctx.app.serviceRegistry.register('service-plugin.echo', {
            handler: async (input) => ({ echo: input.text.toUpperCase() }),
          }, { overwrite: true });
        }
      },
    }));

    const lazy = lazyPlugin(factory, {
      name: 'service-plugin',
      services: ['service-plugin.echo'],
    });

    const { app, getAppContext } = createApp({
      rootDir: tempDir,
      viewsDir: path.join(tempDir, 'views'),
      pagesDir: path.join(tempDir, 'pages'),
      plugins: [lazy],
      logging: false,
    });

    expect(lazy.isHydrated).toBe(false);
    expect(app.serviceRegistry.has('service-plugin.echo')).toBe(true);

    // Executing the service triggers hydration
    const result = await app.serviceRegistry.execute('service-plugin.echo', { text: 'hello lazy' });
    expect(result).toEqual({ echo: 'HELLO LAZY' });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(lazy.isHydrated).toBe(true);
  });

  it('should trigger hydration on inter-plugin API access via Proxy', async () => {
    const factory = vi.fn(() => ({
      name: 'api-plugin',
      api: {
        computeSecret(x) {
          return x * 10;
        },
      },
    }));

    const lazy = lazyPlugin(factory, {
      name: 'api-plugin',
    });

    const { pluginManager } = createApp({
      rootDir: tempDir,
      viewsDir: path.join(tempDir, 'views'),
      pagesDir: path.join(tempDir, 'pages'),
      plugins: [lazy],
      logging: false,
    });

    expect(lazy.isHydrated).toBe(false);

    // Access API method
    const api = pluginManager.getPluginAPI('api-plugin');
    expect(api).toBeDefined();

    const value = api.computeSecret(5);
    expect(value).toBe(50);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(lazy.isHydrated).toBe(true);
  });

  it('should work seamlessly with adminPanelPlugin({ lazy: true })', async () => {
    const { app } = createApp({
      rootDir: tempDir,
      viewsDir: path.join(tempDir, 'views'),
      pagesDir: path.join(tempDir, 'pages'),
      db,
      plugins: [
        adminPanelPlugin({
          db,
          lazy: true,
        }),
      ],
      logging: false,
    });

    const adminPlugin = app.pluginManager?.getPlugin('admin-panel');
    expect(adminPlugin).toBeDefined();
    expect(adminPlugin.isLazy).toBe(true);
    expect(adminPlugin.isHydrated).toBe(false);

    // Public request does not trigger admin hydration
    const resPublic = await request(app).get('/');
    expect(resPublic.status).toBe(200);
    expect(adminPlugin.isHydrated).toBe(false);

    // Requesting /_admin triggers hydration and serves admin HTML
    const resAdmin = await request(app).get('/_admin');
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.headers['content-type']).toContain('text/html');
    expect(resAdmin.text).toContain('<!DOCTYPE html>');
    expect(resAdmin.text).toContain('/_admin');

    expect(adminPlugin.isHydrated).toBe(true);
  });

  it('should execute cleanup disposers registered during hydration upon shutdown', async () => {
    const disposer = vi.fn();
    const factory = vi.fn(() => ({
      name: 'disposable-plugin',
      register: (ctx) => {
        ctx.onDispose(disposer);
      },
      onRoutesReady: (ctx) => {
        ctx.addRoute('get', '/disp/ping', (req, res) => res.send('pong'));
      },
    }));

    const lazy = lazyPlugin(factory, {
      name: 'disposable-plugin',
      prefix: '/disp',
    });

    const { app, shutdownManager } = createApp({
      rootDir: tempDir,
      viewsDir: path.join(tempDir, 'views'),
      pagesDir: path.join(tempDir, 'pages'),
      plugins: [lazy],
      logging: false,
    });

    // Trigger hydration
    await request(app).get('/disp/ping');
    expect(lazy.isHydrated).toBe(true);

    // Shutdown app
    await shutdownManager.close('test');
    expect(disposer).toHaveBeenCalledTimes(1);
  });

  describe('Lazy Plugin Deep Proxy, Lifecycle Hooks & Services Scenarios', () => {
    it('initializes lazy plugin with name, handles empty prefixes, and supports idempotent hydration', () => {
      let initCount = 0;
      const targetPlugin = {
        name: 'test-target',
        version: '1.2.3',
        register: vi.fn(),
      };
      const factory = vi.fn(() => {
        initCount++;
        return targetPlugin;
      });

      const lazy = lazyPlugin(factory, { name: 'test-target' });
      expect(lazy.name).toBe('test-target');
      expect(lazy.version).toBe('1.0.0');
      expect(lazy.isHydrated).toBe(false);

      // Hydrate manually returns realPlugin
      const p1 = lazy.hydrate();
      const p2 = lazy.hydrate();
      expect(p1).toBe(p2);
      expect(p1).toBe(targetPlugin);
      expect(initCount).toBe(1);
      expect(lazy.isHydrated).toBe(true);
    });

    it('forwards lifecycle hooks to target plugin if defined', async () => {
      const onRoutesReadyMock = vi.fn();
      const targetPlugin = {
        name: 'hooked-plugin',
        onRoutesReady: onRoutesReadyMock,
      };

      const lazy = lazyPlugin(() => targetPlugin, { name: 'hooked-plugin' });
      const mockCtx = { app: {}, routes: [] };

      // Before hydration: onRoutesReady should buffer or prepare
      lazy.onRoutesReady(mockCtx);
      expect(onRoutesReadyMock).not.toHaveBeenCalled();

      // Trigger hydration
      lazy.hydrate();
      expect(onRoutesReadyMock).toHaveBeenCalledWith(
        expect.objectContaining({ app: mockCtx.app, routes: mockCtx.routes })
      );
    });

    it('handles lazy service proxies, helper proxies, and event triggers', async () => {
      let hydratedBy = null;
      const registeredServices = new Map();
      const registeredHelpers = new Map();
      const eventHandlers = new Map();

      const mockCtx = {
        app: {
          events: {
            on: (event, fn) => eventHandlers.set(event, fn),
          },
          serviceRegistry: {
            has: (name) => registeredServices.has(name),
            register: (name, def) => registeredServices.set(name, def),
            get: (name) => registeredServices.get(name),
          },
        },
        addHelper: (name, fn) => registeredHelpers.set(name, fn),
      };

      const target = {
        name: 'rich-plugin',
        register: () => {
          hydratedBy = 'triggered';
        },
      };

      const lazy = lazyPlugin(() => target, {
        name: 'rich-plugin',
        services: ['lazyService'],
        helpers: ['lazyHelper'],
        events: ['lazy:trigger'],
      });

      lazy.register(mockCtx);

      // 1. Service proxy invocation triggers hydration
      const svcDef = registeredServices.get('lazyService');
      expect(svcDef).toBeDefined();
      expect(typeof svcDef.handler).toBe('function');
      await svcDef.handler('input1', {});
      expect(hydratedBy).toBe('triggered');

      // 2. Helper proxy invocation
      const helperFn = registeredHelpers.get('lazyHelper');
      expect(typeof helperFn).toBe('function');

      // 3. Event handler trigger
      const eventFn = eventHandlers.get('lazy:trigger');
      expect(typeof eventFn).toBe('function');
      eventFn();
      expect(lazy.isHydrated).toBe(true);
    });
  });
});
