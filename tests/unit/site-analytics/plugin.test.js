/**
 * Site Analytics Plugin Unit Tests
 */
const siteAnalyticsPlugin = require('../../../plugins/site-analytics');
const { AdminRegistry } = require('../../../plugins/admin-panel/core/registry');

describe('Site Analytics Plugin', () => {
  describe('Plugin Factory', () => {
    it('should throw if db is not provided', () => {
      expect(() => siteAnalyticsPlugin({})).toThrow('requires a database instance');
    });

    it('should return a valid plugin object', () => {
      const plugin = siteAnalyticsPlugin({ db: { knex: {} } });
      expect(plugin.name).toBe('site-analytics');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.dependencies).toHaveProperty('admin-panel');
      expect(typeof plugin.register).toBe('function');
      expect(typeof plugin.onRoutesReady).toBe('function');
    });
  });

  describe('register()', () => {
    it('should add tracking middleware to the app', () => {
      const useCalls = [];
      const mockApp = { use: (mw) => useCalls.push(mw) };
      const addRouteCalls = [];
      const injectBodyCalls = [];
      const mockKnex = {
        client: { config: { client: 'better-sqlite3' } },
        schema: { hasTable: () => Promise.resolve(true) },
        fn: { now: () => 'NOW()' },
      };

      const plugin = siteAnalyticsPlugin({ db: { knex: mockKnex } });
      plugin.register({
        app: mockApp,
        usePlugin: () => null,
        addRoute: (method, path, ...handlers) => addRouteCalls.push({ method, path }),
        injectBody: (content) => injectBodyCalls.push(content),
      });

      expect(useCalls.length).toBe(1);
      expect(typeof useCalls[0]).toBe('function');
      expect(addRouteCalls.length).toBe(0);
      expect(injectBodyCalls.length).toBe(1);
      expect(injectBodyCalls[0]).toContain('window.onerror');
      expect(injectBodyCalls[0]).toContain('unhandledrejection');
    });
  });

  describe('onRoutesReady()', () => {
    it('should register page, menu item, client component, and API routes via registerModule', () => {
      const registry = new AdminRegistry();
      const routes = [];
      const requireAuthFn = (req, res, next) => next();
      const optionalAuthFn = (req, res, next) => next();
      const serveAdminPanelFn = (req, res) => res.send('ok');

      const { registerModule } = require('../../../plugins/admin-panel/core/admin-module');

      const ctx = {
        usePlugin: (name) => {
          if (name === 'admin-panel') {
            return {
              getRegistry: () => registry,
              getAdminPath: () => '/_admin',
              requireAuth: requireAuthFn,
              optionalAuth: optionalAuthFn,
              serveAdminPanel: serveAdminPanelFn,
              registerModule: (config) => registerModule(config, {
                registry,
                adminPath: '/_admin',
                ctx,
                requireAuth: requireAuthFn,
                optionalAuth: optionalAuthFn,
                serveAdminPanel: serveAdminPanelFn,
              }),
            };
          }
          return null;
        },
        addRoute: (method, path, ...handlers) => {
          routes.push({ method, path });
        },
      };

      const mockKnex = {
        client: { config: { client: 'better-sqlite3' } },
        schema: { hasTable: () => Promise.resolve(true) },
        fn: { now: () => 'NOW()' },
      };

      const plugin = siteAnalyticsPlugin({ db: { knex: mockKnex } });
      plugin.onRoutesReady(ctx);

      // Check page registered
      const page = registry.pages.get('analytics');
      expect(page).toBeTruthy();
      expect(page.title).toBe('Analytics');
      expect(page.path).toBe('/analytics');

      // Check menu item registered
      const menuItem = registry.menuItems.find(i => i.id === 'analytics');
      expect(menuItem).toBeTruthy();
      expect(menuItem.label).toBe('Analytics');

      // Check client component registered
      expect(registry.clientComponents.has('analytics')).toBe(true);
      const componentCode = registry.clientComponents.get('analytics');
      expect(componentCode).toContain('AnalyticsPage');

      // report-error + 8 data routes + 1 SPA route
      expect(routes.length).toBe(10);
      expect(routes.some((r) => r.path === '/_analytics/report-error' && r.method === 'post')).toBe(true);
      const apiPaths = routes.map(r => r.path);
      expect(apiPaths).toContain('/_admin/api/analytics/stats');
      expect(apiPaths).toContain('/_admin/api/analytics/views-over-time');
      expect(apiPaths).toContain('/_admin/api/analytics/top-pages');
      expect(apiPaths).toContain('/_admin/api/analytics/bot-activity');
      expect(apiPaths).toContain('/_admin/api/analytics/referrer-sources');
      expect(apiPaths).toContain('/_admin/api/analytics/countries');
      expect(apiPaths).toContain('/_admin/api/analytics/client-errors');
      expect(apiPaths).toContain('/_admin/api/analytics/recent');
      expect(apiPaths).toContain('/_admin/analytics');
    });

    it('should warn and skip if admin-panel plugin is not found', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ctx = {
        usePlugin: () => null,
        addRoute: vi.fn(),
      };

      const mockKnex = { client: { config: {} }, schema: {}, fn: {} };
      const plugin = siteAnalyticsPlugin({ db: { knex: mockKnex }, trackClientErrors: false });
      plugin.onRoutesReady(ctx);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('admin-panel plugin not found')
      );
      expect(ctx.addRoute).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
