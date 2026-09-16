const path = require('path');
const z = require('zod');
const { createDatabase } = require('../../core/orm');
const { defineModel, clearRegistry } = require('../../core/orm/model');
const { createAuthTokensTable, createAuthToken, createKnexAuthTokensAdapter, TOKEN_TYPES, dropAuthTokensTable } = require('../../core/auth/tokens');
const { createServiceRegistry } = require('../../src/services');
const { createSystemServices } = require('../../src/services/builtins/system');
const { createApp } = require('../../src/server');

describe('Built-in System Services (system.*)', () => {
  let db;
  let knex;
  let services;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: true,
    });
    knex = db.knex;

    await createAuthTokensTable(knex);

    // Create a mock audit_logs table
    await knex.schema.createTable('audit_logs', (table) => {
      table.increments('id').primary();
      table.string('action');
      table.timestamp('created_at');
    });

    services = createServiceRegistry();
    const systemMap = createSystemServices({
      db,
      serviceRegistry: services,
    });
    for (const [name, def] of Object.entries(systemMap)) {
      services.register(name, def);
    }
  });

  afterAll(async () => {
    await dropAuthTokensTable(knex);
    await knex.schema.dropTableIfExists('audit_logs');
    await knex.destroy();
  });

  describe('system.health', () => {
    it('should return health status, memory stats, and database latency', async () => {
      const health = await services.call('system.health', {}, { db });

      expect(health.status).toBe('ok');
      expect(health.database.status).toBe('connected');
      expect(typeof health.database.latencyMs).toBe('number');
      expect(health.memory).toBeDefined();
      expect(health.memory.heapUsed).toContain('MB');
      expect(health.uptime).toBeGreaterThan(0);
      expect(health.timestamp).toBeDefined();
    });
  });

  describe('system.cleanup', () => {
    it('should purge expired auth tokens and old audit logs', async () => {
      const adapter = createKnexAuthTokensAdapter(knex);

      // Create an already expired token (ttlMs: -1000)
      await createAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, 1, -1000);

      // Create an old audit log (100 days old) and a recent audit log
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      await knex('audit_logs').insert([
        { action: 'old_event', created_at: oldDate },
        { action: 'recent_event', created_at: new Date() },
      ]);

      const cleanup = await services.call(
        'system.cleanup',
        { olderThanDays: 90 },
        { db, auth: { user: { role: 'admin' } } }
      );

      expect(cleanup.success).toBe(true);
      expect(cleanup.purged.authTokens).toBeGreaterThanOrEqual(1);
      expect(cleanup.purged.auditLogs).toBe(1);

      const remainingLogs = await knex('audit_logs').select();
      expect(remainingLogs).toHaveLength(1);
      expect(remainingLogs[0].action).toBe('recent_event');
    });
  });

  describe('system.cache-flush', () => {
    it('should flush ORM and service caches', async () => {
      const result = await services.call(
        'system.cache-flush',
        { scope: 'all' },
        { db, auth: { user: { role: 'admin' } } }
      );

      expect(result.success).toBe(true);
      expect(result.ormCachePurged).toBe(true);
      expect(result.serviceCacheCleared).toBe(true);
    });
  });

  describe('system.info', () => {
    it('should return system diagnostics and registered services', async () => {
      const info = await services.call(
        'system.info',
        {},
        { db, auth: { user: { role: 'admin' } } }
      );

      expect(info.nodeVersion).toBe(process.version);
      expect(info.platform).toBeDefined();
      expect(info.pid).toBe(process.pid);
      expect(Array.isArray(info.services)).toBe(true);
      expect(info.services).toContain('system.health');
    });
  });

  describe('createApp automatic registration', () => {
    it('should auto-register system.* services in createApp', async () => {
      const { app } = createApp({
        pagesDir: path.join(__dirname, '../fixtures/pages'),
        db,
      });

      expect(app.serviceRegistry.has('system.health')).toBe(true);
      expect(app.serviceRegistry.has('system.cleanup')).toBe(true);
      expect(app.serviceRegistry.has('system.cache-flush')).toBe(true);
      expect(app.serviceRegistry.has('system.info')).toBe(true);

      const health = await app.serviceRegistry.call('system.health', {}, { db });
      expect(health.status).toBe('ok');
    });
  });

  describe('system.* edge cases & branch coverage', () => {
    it('should cover system.health disconnected, error, and cache stats', async () => {
      // 1. No db service instance
      const noDbRegistry = createServiceRegistry();
      const noDbMap = createSystemServices({});
      for (const [n, d] of Object.entries(noDbMap)) noDbRegistry.register(n, d);

      const emptyHealth = await noDbRegistry.call('system.health', {});
      expect(emptyHealth.status).toBe('ok');
      expect(emptyHealth.database.status).toBe('disconnected');

      // 2. Broken db
      const brokenDb = {
        knex: {
          raw: async () => {
            throw new Error('Connection refused');
          },
        },
      };
      const brokenHealth = await services.call('system.health', {}, { db: brokenDb });
      expect(brokenHealth.status).toBe('degraded');
      expect(brokenHealth.database.status).toBe('error');

      // 3. Db with cache stats
      const cachedDb = {
        knex: { raw: async () => [1] },
        cache: { stats: () => ({ hits: 10, misses: 2 }) },
      };
      const cacheHealth = await services.call('system.health', {}, { db: cachedDb });
      expect(cacheHealth.cache).toEqual({ hits: 10, misses: 2 });
    });

    it('should cover system.cleanup missing db, missing tables, and opt-outs', async () => {
      // Missing db
      const noDbRegistry = createServiceRegistry();
      const noDbMap = createSystemServices({});
      for (const [n, d] of Object.entries(noDbMap)) noDbRegistry.register(n, d);

      await expect(
        noDbRegistry.call('system.cleanup', {}, { auth: { user: { role: 'admin' } } })
      ).rejects.toThrow('Database instance is required for system.cleanup');

      // Opt out of purges
      const noPurge = await services.call(
        'system.cleanup',
        { purgeAuthTokens: false, purgeAuditLogs: false },
        { db, auth: { user: { role: 'admin' } } }
      );
      expect(noPurge.success).toBe(true);
      expect(noPurge.purged.authTokens).toBeUndefined();
      expect(noPurge.purged.auditLogs).toBeUndefined();

      // Db with missing tables or errors
      const fakeDb = {
        schema: {
          hasTable: async () => false,
        },
      };
      const fakeCleanup = await services.call(
        'system.cleanup',
        {},
        { db: fakeDb, auth: { user: { role: 'admin' } } }
      );
      expect(fakeCleanup.purged.authTokens).toBe(0);
      expect(fakeCleanup.purged.auditLogs).toBe(0);
    });

    it('should cover system.cache-flush scopes and models', async () => {
      // 1. scope: 'orm' with model
      const purgeMock = vi.fn();
      const ormDb = { cache: { purge: purgeMock } };
      const ormRes = await services.call(
        'system.cache-flush',
        { scope: 'orm', model: 'User' },
        { db: ormDb, auth: { user: { role: 'admin' } } }
      );
      expect(ormRes.ormCachePurged).toBe(true);
      expect(purgeMock).toHaveBeenCalledWith('User');

      // 2. scope: 'orm' with clear() fallback
      const clearMock = vi.fn();
      const clearDb = { cache: { clear: clearMock } };
      await services.call(
        'system.cache-flush',
        { scope: 'orm' },
        { db: clearDb, auth: { user: { role: 'admin' } } }
      );
      expect(clearMock).toHaveBeenCalled();

      // 3. scope: 'services'
      const svcRes = await services.call(
        'system.cache-flush',
        { scope: 'services' },
        { db: null, auth: { user: { role: 'admin' } } }
      );
      expect(svcRes.serviceCacheCleared).toBe(true);
    });

    it('should cover system.info with models, plugins, and custom registries', async () => {
      const mockPm = {
        plugins: new Map([['authPlugin', {}], ['adminPlugin', {}]]),
      };
      const mockDb = {
        getAllModelInstances: () => [{ name: 'User' }, { name: 'Post' }],
      };

      const info = await services.call(
        'system.info',
        {},
        { db: mockDb, pluginManager: mockPm, auth: { user: { role: 'admin' } } }
      );

      expect(info.models).toEqual(['User', 'Post']);
      expect(info.plugins).toEqual(['authPlugin', 'adminPlugin']);
    });
  });
});
