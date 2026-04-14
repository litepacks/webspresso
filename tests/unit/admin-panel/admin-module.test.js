/**
 * Admin Module Registration System Tests
 */
const { registerModule } = require('../../../plugins/admin-panel/core/admin-module');
const { AdminRegistry } = require('../../../plugins/admin-panel/core/registry');

function createMockDeps(registryOverride) {
  const registry = registryOverride || new AdminRegistry();
  const routes = [];

  return {
    registry,
    adminPath: '/_admin',
    ctx: {
      addRoute: (method, path, ...handlers) => {
        routes.push({ method, path, handlers });
      },
    },
    requireAuth: function requireAuth(req, res, next) { next(); },
    optionalAuth: function optionalAuth(req, res, next) { next(); },
    serveAdminPanel: function serveAdminPanel(req, res) { res.send('ok'); },
    _routes: routes,
  };
}

describe('registerModule', () => {
  describe('validation', () => {
    it('should throw if config is not an object', () => {
      const deps = createMockDeps();
      expect(() => registerModule(null, deps)).toThrow('requires a config object');
      expect(() => registerModule('string', deps)).toThrow('requires a config object');
    });

    it('should throw if id is missing', () => {
      const deps = createMockDeps();
      expect(() => registerModule({}, deps)).toThrow('requires a string "id"');
    });

    it('should throw if id is not a string', () => {
      const deps = createMockDeps();
      expect(() => registerModule({ id: 123 }, deps)).toThrow('requires a string "id"');
    });

    it('should accept a config with only an id (no pages, menu, api, widgets)', () => {
      const deps = createMockDeps();
      expect(() => registerModule({ id: 'empty-module' }, deps)).not.toThrow();
    });
  });

  describe('pages', () => {
    it('should register a page in the registry', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'test',
        pages: [{
          id: 'test-page',
          title: 'Test Page',
          path: '/test',
          icon: 'chart',
        }],
      }, deps);

      const page = deps.registry.pages.get('test-page');
      expect(page).toBeTruthy();
      expect(page.title).toBe('Test Page');
      expect(page.path).toBe('/test');
      expect(page.icon).toBe('chart');
    });

    it('should default page id to module id when not specified', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'analytics',
        pages: [{
          title: 'Analytics',
          path: '/analytics',
          icon: 'chart',
        }],
      }, deps);

      expect(deps.registry.pages.has('analytics')).toBe(true);
    });

    it('should register a client component when component is provided', () => {
      const deps = createMockDeps();
      const componentCode = 'window.__customPages["test"] = { view: () => "hello" };';

      registerModule({
        id: 'test',
        pages: [{
          id: 'test',
          title: 'Test',
          path: '/test',
          component: componentCode,
        }],
      }, deps);

      expect(deps.registry.clientComponents.has('test')).toBe(true);
      expect(deps.registry.clientComponents.get('test')).toBe(componentCode);
    });

    it('should not register a client component when component is omitted', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'test',
        pages: [{
          id: 'test',
          title: 'Test',
          path: '/test',
        }],
      }, deps);

      expect(deps.registry.clientComponents.has('test')).toBe(false);
    });

    it('should add an SPA route for each page', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'test',
        pages: [{
          id: 'test',
          title: 'Test',
          path: '/test',
        }],
      }, deps);

      const spaRoute = deps._routes.find(r => r.path === '/_admin/test');
      expect(spaRoute).toBeTruthy();
      expect(spaRoute.method).toBe('get');
      expect(spaRoute.handlers).toContain(deps.optionalAuth);
      expect(spaRoute.handlers).toContain(deps.serveAdminPanel);
    });

    it('should register multiple pages', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'multi',
        pages: [
          { id: 'page-a', title: 'Page A', path: '/page-a' },
          { id: 'page-b', title: 'Page B', path: '/page-b' },
        ],
      }, deps);

      expect(deps.registry.pages.has('page-a')).toBe(true);
      expect(deps.registry.pages.has('page-b')).toBe(true);

      const spaPaths = deps._routes.map(r => r.path);
      expect(spaPaths).toContain('/_admin/page-a');
      expect(spaPaths).toContain('/_admin/page-b');
    });

    it('should throw if pages is not an array', () => {
      const deps = createMockDeps();
      expect(() => registerModule({
        id: 'test',
        pages: 'not-an-array',
      }, deps)).toThrow('pages must be an array');
    });

    it('should throw if page is missing title or path', () => {
      const deps = createMockDeps();
      expect(() => registerModule({
        id: 'test',
        pages: [{ id: 'bad', title: 'No Path' }],
      }, deps)).toThrow('requires title and path');

      expect(() => registerModule({
        id: 'test2',
        pages: [{ id: 'bad', path: '/no-title' }],
      }, deps)).toThrow('requires title and path');
    });

    it('should pass description and permission to the registry', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'test',
        pages: [{
          id: 'test',
          title: 'Test',
          path: '/test',
          description: 'A test page',
          permission: 'admin',
        }],
      }, deps);

      const page = deps.registry.pages.get('test');
      expect(page.description).toBe('A test page');
      expect(page.permission).toBe('admin');
    });
  });

  describe('menu', () => {
    it('should register menu items', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'test',
        menu: [{
          id: 'test-menu',
          label: 'Test',
          path: '/test',
          icon: 'chart',
          order: 5,
        }],
      }, deps);

      const item = deps.registry.menuItems.find(i => i.id === 'test-menu');
      expect(item).toBeTruthy();
      expect(item.label).toBe('Test');
      expect(item.order).toBe(5);
    });

    it('should register multiple menu items', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'test',
        menu: [
          { id: 'item-a', label: 'A', path: '/a' },
          { id: 'item-b', label: 'B', path: '/b' },
        ],
      }, deps);

      expect(deps.registry.menuItems.find(i => i.id === 'item-a')).toBeTruthy();
      expect(deps.registry.menuItems.find(i => i.id === 'item-b')).toBeTruthy();
    });

    it('should throw if menu is not an array', () => {
      const deps = createMockDeps();
      expect(() => registerModule({
        id: 'test',
        menu: { not: 'array' },
      }, deps)).toThrow('menu must be an array');
    });
  });

  describe('menuGroups', () => {
    it('should register menu groups', () => {
      const deps = createMockDeps();
      registerModule({
        id: 'test',
        menuGroups: {
          tools: { label: 'Tools', icon: 'tool', order: 50 },
        },
      }, deps);

      const group = deps.registry.menuGroups.get('tools');
      expect(group).toBeTruthy();
      expect(group.label).toBe('Tools');
      expect(group.icon).toBe('tool');
    });

    it('should throw if menuGroups is not an object', () => {
      const deps = createMockDeps();
      expect(() => registerModule({
        id: 'test',
        menuGroups: ['not-an-object'],
      }, deps)).toThrow('menuGroups must be an object');
    });
  });

  describe('api', () => {
    it('should register API routes with prefix', () => {
      const handler = (req, res) => res.json({});
      const deps = createMockDeps();

      registerModule({
        id: 'test',
        api: {
          prefix: '/test',
          routes: [
            { method: 'get', path: '/data', handler },
          ],
        },
      }, deps);

      const route = deps._routes.find(r => r.path === '/_admin/api/test/data');
      expect(route).toBeTruthy();
      expect(route.method).toBe('get');
      expect(route.handlers).toContain(deps.requireAuth);
      expect(route.handlers).toContain(handler);
    });

    it('should default method to get', () => {
      const handler = (req, res) => {};
      const deps = createMockDeps();

      registerModule({
        id: 'test',
        api: {
          prefix: '/test',
          routes: [{ path: '/data', handler }],
        },
      }, deps);

      const route = deps._routes.find(r => r.path === '/_admin/api/test/data');
      expect(route.method).toBe('get');
    });

    it('should use requireAuth by default', () => {
      const handler = (req, res) => {};
      const deps = createMockDeps();

      registerModule({
        id: 'test',
        api: {
          routes: [{ path: '/data', handler }],
        },
      }, deps);

      const route = deps._routes[0];
      expect(route.handlers).toContain(deps.requireAuth);
    });

    it('should use optionalAuth when api.auth is false', () => {
      const handler = (req, res) => {};
      const deps = createMockDeps();

      registerModule({
        id: 'test',
        api: {
          auth: false,
          routes: [{ path: '/data', handler }],
        },
      }, deps);

      const route = deps._routes[0];
      expect(route.handlers).toContain(deps.optionalAuth);
      expect(route.handlers).not.toContain(deps.requireAuth);
    });

    it('should allow per-route auth override', () => {
      const handler1 = (req, res) => {};
      const handler2 = (req, res) => {};
      const deps = createMockDeps();

      registerModule({
        id: 'test',
        api: {
          routes: [
            { path: '/public', handler: handler1, auth: false },
            { path: '/private', handler: handler2, auth: true },
          ],
        },
      }, deps);

      const publicRoute = deps._routes.find(r => r.path === '/_admin/api/public');
      const privateRoute = deps._routes.find(r => r.path === '/_admin/api/private');

      expect(publicRoute.handlers).toContain(deps.optionalAuth);
      expect(privateRoute.handlers).toContain(deps.requireAuth);
    });

    it('should work without a prefix', () => {
      const handler = (req, res) => {};
      const deps = createMockDeps();

      registerModule({
        id: 'test',
        api: {
          routes: [{ path: '/standalone', handler }],
        },
      }, deps);

      const route = deps._routes.find(r => r.path === '/_admin/api/standalone');
      expect(route).toBeTruthy();
    });

    it('should support multiple HTTP methods', () => {
      const getHandler = (req, res) => {};
      const postHandler = (req, res) => {};
      const deleteHandler = (req, res) => {};
      const deps = createMockDeps();

      registerModule({
        id: 'test',
        api: {
          prefix: '/items',
          routes: [
            { method: 'get', path: '/', handler: getHandler },
            { method: 'post', path: '/', handler: postHandler },
            { method: 'delete', path: '/:id', handler: deleteHandler },
          ],
        },
      }, deps);

      expect(deps._routes[0].method).toBe('get');
      expect(deps._routes[1].method).toBe('post');
      expect(deps._routes[2].method).toBe('delete');
    });

    it('should throw if api.routes is not an array', () => {
      const deps = createMockDeps();
      expect(() => registerModule({
        id: 'test',
        api: { routes: 'not-array' },
      }, deps)).toThrow('api.routes must be an array');
    });

    it('should throw if a route is missing path or handler', () => {
      const deps = createMockDeps();
      expect(() => registerModule({
        id: 'test',
        api: {
          routes: [{ path: '/data' }],
        },
      }, deps)).toThrow(/requires path \(string/);

      expect(() => registerModule({
        id: 'test2',
        api: {
          routes: [{ handler: () => {} }],
        },
      }, deps)).toThrow(/requires path \(string/);
    });

    it('should allow empty string path for prefix root', () => {
      const handler = (req, res) => {};
      const deps = createMockDeps();
      registerModule({
        id: 'audit',
        api: {
          prefix: '/audit-logs',
          routes: [{ method: 'get', path: '', handler }],
        },
      }, deps);
      expect(deps._routes[0].path).toBe('/_admin/api/audit-logs');
    });
  });

  describe('widgets', () => {
    it('should register widgets in the registry', () => {
      const loader = async () => ({ count: 42 });
      const deps = createMockDeps();

      registerModule({
        id: 'test',
        widgets: [{
          id: 'test-widget',
          title: 'Test Widget',
          size: 'md',
          order: 10,
          dataLoader: loader,
        }],
      }, deps);

      const widget = deps.registry.widgets.get('test-widget');
      expect(widget).toBeTruthy();
      expect(widget.title).toBe('Test Widget');
      expect(widget.size).toBe('md');
      expect(widget.order).toBe(10);
    });

    it('should throw if widgets is not an array', () => {
      const deps = createMockDeps();
      expect(() => registerModule({
        id: 'test',
        widgets: 'not-array',
      }, deps)).toThrow('widgets must be an array');
    });

    it('should throw if a widget is missing id', () => {
      const deps = createMockDeps();
      expect(() => registerModule({
        id: 'test',
        widgets: [{ title: 'No ID' }],
      }, deps)).toThrow('requires an id');
    });
  });

  describe('full module registration', () => {
    it('should register pages, menu, api, and widgets together', () => {
      const handler = (req, res) => {};
      const loader = async () => ({});
      const deps = createMockDeps();

      registerModule({
        id: 'analytics',

        pages: [{
          id: 'analytics',
          title: 'Analytics',
          path: '/analytics',
          icon: 'chart',
          component: 'window.__customPages["analytics"] = {};',
        }],

        menu: [{
          id: 'analytics',
          label: 'Analytics',
          path: '/analytics',
          icon: 'chart',
          order: 2,
        }],

        menuGroups: {
          monitoring: { label: 'Monitoring', icon: 'activity', order: 50 },
        },

        api: {
          prefix: '/analytics',
          routes: [
            { method: 'get', path: '/stats', handler },
            { method: 'get', path: '/recent', handler },
          ],
        },

        widgets: [{
          id: 'analytics-summary',
          title: 'Analytics Summary',
          size: 'md',
          order: 5,
          dataLoader: loader,
        }],
      }, deps);

      // Page
      expect(deps.registry.pages.has('analytics')).toBe(true);
      expect(deps.registry.clientComponents.has('analytics')).toBe(true);

      // Menu
      const menuItem = deps.registry.menuItems.find(i => i.id === 'analytics');
      expect(menuItem).toBeTruthy();

      // Menu group
      expect(deps.registry.menuGroups.has('monitoring')).toBe(true);

      // API routes (2 API + 1 SPA)
      expect(deps._routes.length).toBe(3);
      const apiPaths = deps._routes.map(r => r.path);
      expect(apiPaths).toContain('/_admin/api/analytics/stats');
      expect(apiPaths).toContain('/_admin/api/analytics/recent');
      expect(apiPaths).toContain('/_admin/analytics');

      // Widget
      expect(deps.registry.widgets.has('analytics-summary')).toBe(true);
    });
  });
});
