/**
 * Unit & Integration tests for Admin Panel Lifecycle Hooks (Admin Hooks DX)
 * Verifies beforeCreate, afterCreate, beforeUpdate, afterUpdate,
 * beforeDelete, afterDelete, beforeRestore, afterRestore, onRecordView, onDashboardLoad.
 */

const path = require('path');
const { createDatabase, defineModel, zdb, hasModel } = require('../../../core/orm');
const { createApp } = require('../../../index');
const supertest = require('supertest');
const adminPanelPlugin = require('../../../plugins/admin-panel');

describe('Admin Panel Lifecycle Hooks (Admin Hooks DX)', () => {
  let db;
  let app;
  let request;
  let adminCookie;
  let pluginInstance;

  // Track hook executions
  const hookLog = [];

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: path.join(__dirname, '../../fixtures/models-empty'),
    });

    if (!hasModel('HookTestProduct')) {
      defineModel({
        name: 'HookTestProduct',
        table: 'hook_test_products',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string(),
          slug: zdb.string().optional(),
          price: zdb.integer().default(0),
          deleted_at: zdb.timestamp().optional(),
        }),
        scopes: {
          softDelete: true,
        },
        admin: {
          enabled: true,
          label: 'Hook Products',
          hooks: {
            beforeCreate: async (ctx) => {
              hookLog.push({ hook: 'model.beforeCreate', model: ctx.model, data: { ...ctx.data } });
              // Auto-generate slug if missing
              if (!ctx.data.slug && ctx.data.name) {
                ctx.data.slug = ctx.data.name.toLowerCase().replace(/\s+/g, '-');
              }
              // Custom validation: reject price < 0
              if (ctx.data.price < 0) {
                throw new Error('Price cannot be negative');
              }
            },
            afterCreate: async (ctx) => {
              hookLog.push({ hook: 'model.afterCreate', model: ctx.model, recordId: ctx.record?.id });
            },
            beforeUpdate: async (ctx) => {
              hookLog.push({ hook: 'model.beforeUpdate', model: ctx.model, id: ctx.id, data: { ...ctx.data } });
              if (ctx.data.price !== undefined && ctx.data.price < 0) {
                throw new Error('Price cannot be negative on update');
              }
            },
            afterUpdate: async (ctx) => {
              hookLog.push({ hook: 'model.afterUpdate', model: ctx.model, id: ctx.id, recordId: ctx.record?.id });
            },
            beforeDelete: async (ctx) => {
              hookLog.push({ hook: 'model.beforeDelete', model: ctx.model, id: ctx.id });
              if (String(ctx.id) === '999') {
                throw new Error('Cannot delete protected record 999');
              }
            },
            afterDelete: async (ctx) => {
              hookLog.push({ hook: 'model.afterDelete', model: ctx.model, id: ctx.id });
            },
            beforeRestore: async (ctx) => {
              hookLog.push({ hook: 'model.beforeRestore', model: ctx.model, id: ctx.id });
            },
            afterRestore: async (ctx) => {
              hookLog.push({ hook: 'model.afterRestore', model: ctx.model, id: ctx.id });
            },
          },
        },
      });
    }

    if (!hasModel('HookOtherModel')) {
      defineModel({
        name: 'HookOtherModel',
        table: 'hook_other_models',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string(),
        }),
        admin: {
          enabled: true,
        },
      });
    }

    // Database tables setup
    await db.knex.schema.createTable('admin_users', (table) => {
      table.bigIncrements('id');
      table.string('email').unique();
      table.string('password');
      table.string('name');
      table.string('role').defaultTo('admin');
      table.boolean('active').defaultTo(true);
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    await db.knex.schema.createTable('hook_test_products', (table) => {
      table.increments('id').primary();
      table.string('name');
      table.string('slug');
      table.integer('price').defaultTo(0);
      table.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('hook_other_models', (table) => {
      table.increments('id').primary();
      table.string('title');
    });

    // Seed test data
    await db.knex('hook_test_products').insert([
      { id: 10, name: 'Existing Item', slug: 'existing-item', price: 100 },
      { id: 20, name: 'To Delete', slug: 'to-delete', price: 200 },
    ]);

    pluginInstance = adminPanelPlugin({
      path: '/_admin',
      db,
      auth: { enabled: true },
    });

    // Register global programmatic hooks on plugin API
    pluginInstance.api.registerHook('onRecordView', async (ctx) => {
      hookLog.push({ hook: 'global.onRecordView', model: ctx.model, id: ctx.id });
    });

    pluginInstance.api.registerHook('onDashboardLoad', async (ctx) => {
      hookLog.push({ hook: 'global.onDashboardLoad', modelsCount: Object.keys(ctx.stats).length });
    });

    const result = createApp({
      rootDir: path.join(__dirname, '../../..'),
      pagesDir: path.join(__dirname, '../../fixtures/empty-pages'),
      viewsDir: path.join(__dirname, '../../fixtures/views'),
      publicDir: path.join(__dirname, '../../../public'),
      silent: true,
      server: { port: 0, shutdown: { enabled: false } },
      helmet: false,
      compression: false,
      cache: false,
      healthCheck: false,
      metrics: false,
      lazyRoutes: true,
      db,
      plugins: [pluginInstance],
    });

    app = result.app;
    request = supertest(app);

    await db.knex('admin_users').insert({
      email: 'hooks_admin@test.com',
      password: '$2b$04$N/d4yPWhY79UBNMVL9BHluQkbufRToZLdzI3VWmz0Aa3Fr9mvMcK2',
      name: 'Hooks Admin',
      role: 'admin',
      active: true,
    });

    const loginRes = await request
      .post('/_admin/api/auth/login')
      .send({
        email: 'hooks_admin@test.com',
        password: 'Password123!',
      })
      .expect(200);

    adminCookie = loginRes.headers['set-cookie'];
  });

  beforeEach(() => {
    hookLog.length = 0;
  });

  describe('createRecordHandler hooks (beforeCreate & afterCreate)', () => {
    it('executes beforeCreate and afterCreate, and allows data enrichment in beforeCreate', async () => {
      const res = await request
        .post('/_admin/api/models/HookTestProduct/records')
        .set('Cookie', adminCookie)
        .send({
          name: 'Super Gadget',
          price: 50,
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.name).toBe('Super Gadget');
      // Slug was enriched by beforeCreate hook!
      expect(res.body.data.slug).toBe('super-gadget');

      // Verify hookLog
      expect(hookLog.some((h) => h.hook === 'model.beforeCreate' && h.model === 'HookTestProduct')).toBe(true);
      expect(hookLog.some((h) => h.hook === 'model.afterCreate' && h.recordId === res.body.data.id)).toBe(true);
    });

    it('rejects creation if beforeCreate throws an error', async () => {
      const res = await request
        .post('/_admin/api/models/HookTestProduct/records')
        .set('Cookie', adminCookie)
        .send({
          name: 'Invalid Item',
          price: -10,
        })
        .expect(400);

      expect(res.body.error).toBe('Price cannot be negative');
      // afterCreate should NOT have run
      expect(hookLog.some((h) => h.hook === 'model.afterCreate')).toBe(false);
    });
  });

  describe('updateRecordHandler hooks (beforeUpdate & afterUpdate)', () => {
    it('executes beforeUpdate and afterUpdate on successful update', async () => {
      const res = await request
        .put('/_admin/api/models/HookTestProduct/records/10')
        .set('Cookie', adminCookie)
        .send({
          price: 150,
        })
        .expect(200);

      expect(res.body.data.price).toBe(150);

      expect(hookLog.some((h) => h.hook === 'model.beforeUpdate' && String(h.id) === '10')).toBe(true);
      expect(hookLog.some((h) => h.hook === 'model.afterUpdate' && String(h.recordId) === '10')).toBe(true);
    });

    it('rejects update if beforeUpdate throws an error', async () => {
      const res = await request
        .put('/_admin/api/models/HookTestProduct/records/10')
        .set('Cookie', adminCookie)
        .send({
          price: -50,
        })
        .expect(400);

      expect(res.body.error).toBe('Price cannot be negative on update');
      expect(hookLog.some((h) => h.hook === 'model.afterUpdate')).toBe(false);
    });
  });

  describe('deleteRecordHandler & restoreRecordHandler hooks', () => {
    it('executes beforeDelete and afterDelete on deletion', async () => {
      await request
        .delete('/_admin/api/models/HookTestProduct/records/20')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(hookLog.some((h) => h.hook === 'model.beforeDelete' && String(h.id) === '20')).toBe(true);
      expect(hookLog.some((h) => h.hook === 'model.afterDelete' && String(h.id) === '20')).toBe(true);

      // Verify soft-deleted
      const rec = await db.getRepository('HookTestProduct').findById(20);
      expect(rec).toBeNull();
    });

    it('executes beforeRestore and afterRestore on restoring soft-deleted record', async () => {
      const res = await request
        .post('/_admin/api/models/HookTestProduct/records/20/restore')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(hookLog.some((h) => h.hook === 'model.beforeRestore' && String(h.id) === '20')).toBe(true);
      expect(hookLog.some((h) => h.hook === 'model.afterRestore' && String(h.id) === '20')).toBe(true);
    });
  });

  describe('recordHandler hook (onRecordView)', () => {
    it('executes onRecordView when a record is viewed', async () => {
      await request
        .get('/_admin/api/models/HookTestProduct/records/10')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(hookLog.some((h) => h.hook === 'global.onRecordView' && h.model === 'HookTestProduct' && String(h.id) === '10')).toBe(true);
    });
  });

  describe('dashboardStatsHandler hook (onDashboardLoad)', () => {
    it('executes onDashboardLoad when dashboard stats are requested', async () => {
      const res = await request
        .get('/_admin/api/extensions/dashboard/stats')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.stats).toBeDefined();
      expect(hookLog.some((h) => h.hook === 'global.onDashboardLoad')).toBe(true);
    });
  });

  describe('Model-Level Hook Isolation', () => {
    it('does not trigger HookTestProduct hooks when mutating HookOtherModel', async () => {
      await request
        .post('/_admin/api/models/HookOtherModel/records')
        .set('Cookie', adminCookie)
        .send({ title: 'Other Title' })
        .expect(201);

      // HookTestProduct hooks must not have run
      expect(hookLog.some((h) => h.hook === 'model.beforeCreate')).toBe(false);
      expect(hookLog.some((h) => h.hook === 'model.afterCreate')).toBe(false);
    });
  });

  afterAll(async () => {
    if (db?.knex?.destroy) {
      await db.knex.destroy();
    }
  });
});
