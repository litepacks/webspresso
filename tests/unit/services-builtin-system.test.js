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
    clearRegistry();

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
    clearRegistry();
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
});
