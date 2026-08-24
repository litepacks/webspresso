const ormCacheAdminPlugin = require('../../plugins/orm-cache-admin');
const { generateOrmCacheAdminComponent } = require('../../plugins/orm-cache-admin/admin-component');

describe('ORM Cache Admin Plugin (plugins/orm-cache-admin)', () => {
  it('should throw if db option is missing', () => {
    expect(() => ormCacheAdminPlugin({})).toThrow('requires `db`');
  });

  it('should generate admin component string', () => {
    const code = generateOrmCacheAdminComponent();
    expect(typeof code).toBe('string');
    expect(code).toContain('ORM Cache');
  });

  it('should warn and skip if admin-panel plugin is missing', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const plugin = ormCacheAdminPlugin({ db: { cache: {} } });
      plugin.onRoutesReady({
        usePlugin: () => null,
      });

      expect(warnings.some(w => w.includes('admin-panel not found'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it('should warn and skip if db.cache is missing', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const plugin = ormCacheAdminPlugin({ db: {} });
      plugin.onRoutesReady({
        usePlugin: () => ({ registerModule: () => {} }),
      });

      expect(warnings.some(w => w.includes('db.cache is disabled'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it('should register orm-cache module with admin-panel when db.cache exists', () => {
    let registeredMod = null;
    const mockAdminApi = {
      registerModule(mod) {
        registeredMod = mod;
      },
    };

    const mockDb = {
      cache: {
        getStats: () => ({ hits: 10, misses: 2 }),
        purge: () => true,
        invalidate: () => true,
        resetMetrics: () => true,
      },
    };

    const plugin = ormCacheAdminPlugin({ db: mockDb });
    plugin.onRoutesReady({
      usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
    });

    expect(registeredMod).not.toBeNull();
    expect(registeredMod.id).toBe('orm-cache');
    expect(registeredMod.pages.length).toBe(1);
    expect(registeredMod.api.routes.length).toBe(4);
  });
});
