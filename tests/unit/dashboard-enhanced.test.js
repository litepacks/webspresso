const path = require('path');
const http = require('http');
const {
  dashboardPlugin,
  devToolbarPlugin,
  devtoolsPlugin,
} = require('../../plugins');
const { createApp } = require('../../src/server');
const { createHelpers } = require('../../src/helpers');
const { profilerStorage } = require('../../src/dev/profiler');
const { defineModel, hasModel, unregisterModel } = require('../../core/orm/model');
const { z } = require('../../core/validation');
const { defineService, createServiceRegistry } = require('../../src/services');

describe('Enhanced Developer Dashboard & Dev Toolbar', () => {
  let app;
  let server;
  let baseUrl;

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
    if (hasModel('DevToolProduct')) {
      unregisterModel('DevToolProduct');
    }
  });

  describe('Plugin Exports & Aliases', () => {
    it('should export devToolbarPlugin and devtoolsPlugin aliases identical to dashboardPlugin', () => {
      expect(dashboardPlugin).toBeDefined();
      expect(devToolbarPlugin).toBeDefined();
      expect(devtoolsPlugin).toBeDefined();
      expect(devToolbarPlugin).toBe(dashboardPlugin);
      expect(devtoolsPlugin).toBe(dashboardPlugin);
    });
  });

  describe('Dashboard Extended APIs (/api/models, /api/services, /api/overview)', () => {
    beforeAll(async () => {
      if (hasModel('DevToolProduct')) {
        unregisterModel('DevToolProduct');
      }

      // Define a test model to ensure model collector detects it
      defineModel({
        name: 'DevToolProduct',
        table: 'devtool_products',
        schema: z.object({
          title: z.string(),
          price: z.number(),
        }),
        cache: 'smart',
        scopes: {
          softDelete: true,
        },
      });

      const fixturesDir = path.join(__dirname, '../fixtures');
      const instance = createApp({
        server: { port: 0 },
        pagesDir: path.join(fixturesDir, 'empty-pages'),
        viewsDir: path.join(fixturesDir, 'views'),
        plugins: [dashboardPlugin()],
        logging: false,
        cache: false,
        lazyRoutes: true,
      });

      instance.app.serviceRegistry.register(
        'devtool.checkout',
        defineService({
          schema: ({ z: schemaZ }) => ({ cartId: schemaZ.string() }),
          transaction: true,
          auth: 'admin',
          handler: async () => ({ status: 'ok' }),
        })
      );

      app = instance.app;
      server = instance.server || http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
    });

    afterAll(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
        server = null;
      }
      if (hasModel('DevToolProduct')) {
        unregisterModel('DevToolProduct');
      }
    });

    it('should return models list from /_webspresso/api/models', async () => {
      const res = await fetch(`${baseUrl}/_webspresso/api/models`);
      expect(res.status).toBe(200);
      const models = await res.json();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const found = models.find((m) => m.name === 'DevToolProduct');
      expect(found).toBeDefined();
      expect(found.table).toBe('devtool_products');
      expect(found.softDelete).toBe(true);
      expect(found.cache).toBe('smart');
      expect(found.columns).toContain('title');
      expect(found.columns).toContain('price');
    });

    it('should return services list from /_webspresso/api/services', async () => {
      const res = await fetch(`${baseUrl}/_webspresso/api/services`);
      expect(res.status).toBe(200);
      const services = await res.json();

      expect(Array.isArray(services)).toBe(true);
      expect(services.length).toBeGreaterThan(0);

      const found = services.find((s) => s.name === 'devtool.checkout');
      expect(found).toBeDefined();
      expect(found.transaction).toBe(true);
      expect(found.auth).toBe('admin');
      expect(found.hasSchema).toBe(true);
    });

    it('should return system overview metrics from /_webspresso/api/overview', async () => {
      const res = await fetch(`${baseUrl}/_webspresso/api/overview`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toHaveProperty('routesCount');
      expect(data).toHaveProperty('pluginsCount');
      expect(data).toHaveProperty('modelsCount');
      expect(data).toHaveProperty('servicesCount');
      expect(data).toHaveProperty('nodeVersion');
      expect(data).toHaveProperty('platform');
      expect(data).toHaveProperty('uptime');
      expect(typeof data.routesCount).toBe('number');
      expect(typeof data.modelsCount).toBe('number');
      expect(data.nodeVersion).toBe(process.version);
    });
  });

  describe('fsy.devToolbar() Floating In-Page DevTools', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should return empty string in production mode', () => {
      process.env.NODE_ENV = 'production';
      const helpers = createHelpers();
      const output = helpers.devToolbar();
      expect(output).toBe('');
    });

    it('should render interactive DevTools bar & drawer in development mode', () => {
      process.env.NODE_ENV = 'development';
      const helpers = createHelpers();
      const output = helpers.devToolbar();

      expect(output).toContain('id="webspresso-dev-toolbar"');
      expect(output).toContain('id="webspresso-dev-toolbar-toggle"');
      expect(output).toContain('id="webspresso-dev-toolbar-drawer"');
      expect(output).toContain('⚡ DEV');
      expect(output).toContain('Alt+D');
      expect(output).toContain('Dashboard');
      expect(output).toContain('Admin');
      expect(output).toContain('/_webspresso');
      expect(output).toContain('/_admin');
    });

    it('should render custom navigation links and request route info', () => {
      process.env.NODE_ENV = 'development';
      const req = {
        method: 'GET',
        url: '/products/42?ref=nav',
        path: '/products/42',
        route: { path: '/products/[id].njk' },
        query: { ref: 'nav' },
      };
      const helpers = createHelpers({ req });

      const output = helpers.devToolbar({
        links: [
          { label: 'SEO Checker', url: '/_seo' },
          { label: 'Grafana', url: 'https://grafana.local' },
        ],
      });

      expect(output).toContain('SEO Checker');
      expect(output).toContain('Grafana');
      expect(output).toContain('/products/42');
      expect(output).toContain('/products/[id].njk');
    });

    it('should render queries and N+1 warning banner when profiler storage is active', () => {
      process.env.NODE_ENV = 'development';
      const fakeStore = {
        queries: [
          { sql: 'SELECT * FROM users WHERE id = 1', durationMs: 1.5, table: 'users' },
          { sql: 'SELECT * FROM posts WHERE user_id = 1', durationMs: 2.1, table: 'posts' },
        ],
        nPlusOneWarnings: [
          {
            table: 'posts',
            count: 2,
            recommendation: 'Potential N+1 query pattern detected on table "posts". Consider eager loading with repo.query().include("posts")',
          },
        ],
      };

      let output;
      profilerStorage.run(fakeStore, () => {
        const helpers = createHelpers();
        output = helpers.devToolbar();
      });

      expect(output).toContain('2 queries');
      expect(output).toContain('⚠️ N+1 (1)');
      expect(output).toContain('SELECT * FROM users WHERE id = 1');
      expect(output).toContain('SELECT * FROM posts WHERE user_id = 1');
      expect(output).toContain('Potential N+1 Query Warning');
      expect(output).toContain('posts');
      expect(output).toContain('repo.query().include');
    });
  });
});
