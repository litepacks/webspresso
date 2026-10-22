const {
  createMockAdminRegistry,
  createMockAdminDeps,
  createMockPluginContext,
} = require('../utils/admin');

describe('Test Utilities - Admin Panel & Plugin Mocks (Step 7)', () => {
  describe('createMockAdminRegistry', () => {
    it('creates an initialized AdminRegistry instance with extension collections', () => {
      const registry = createMockAdminRegistry();
      expect(registry).toBeDefined();
      expect(registry.pages instanceof Map).toBe(true);
      expect(registry.widgets instanceof Map).toBe(true);
      expect(registry.actions instanceof Map).toBe(true);
      expect(registry.bulkActions instanceof Map).toBe(true);
    });
  });

  describe('createMockAdminDeps', () => {
    it('creates admin dependencies with route recorder and auth middleware mocks', () => {
      const deps = createMockAdminDeps();
      expect(deps.adminPath).toBe('/_admin');
      expect(deps.registry).toBeDefined();
      expect(Array.isArray(deps._routes)).toBe(true);

      const nextSpy = vi.fn();
      deps.requireAuth({}, {}, nextSpy);
      expect(nextSpy).toHaveBeenCalledTimes(1);

      const sendSpy = vi.fn();
      deps.serveAdminPanel({}, { send: sendSpy });
      expect(sendSpy).toHaveBeenCalledWith('ok');

      deps.ctx.addRoute('GET', '/custom', () => {});
      expect(deps._routes).toHaveLength(1);
      expect(deps._routes[0].method).toBe('GET');
      expect(deps._routes[0].path).toBe('/custom');
    });

    it('accepts custom registry override', () => {
      const customRegistry = createMockAdminRegistry();
      const deps = createMockAdminDeps(customRegistry);
      expect(deps.registry).toBe(customRegistry);
    });
  });

  describe('createMockPluginContext', () => {
    it('creates a plugin registration context with routes, disposers, and helpers', () => {
      const ctx = createMockPluginContext();

      expect(ctx.app).toBeDefined();
      expect(ctx.middlewares).toEqual({});

      ctx.addRoute('POST', '/api/plugin-test', (req, res) => {});
      expect(ctx.routes).toHaveLength(1);
      expect(ctx.routes[0]).toEqual({
        method: 'post',
        path: '/api/plugin-test',
        handlers: expect.any(Array),
      });

      const cleanupFn = vi.fn();
      ctx.onDispose(cleanupFn);
      expect(ctx.disposers).toContain(cleanupFn);

      const helperFn = () => {};
      ctx.addRequestHelper(helperFn);
      expect(ctx.requestHelpers).toContain(helperFn);
    });
  });
});
