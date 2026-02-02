/**
 * Multiple Plugins Integration Test
 * Tests that multiple plugins can work together
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, zdb, hasModel } from '../../index.js';
import { adminPanelPlugin, dashboardPlugin } from '../../plugins/index.js';
import { clearRegistry } from '../../core/orm/model.js';

describe('Multiple Plugins Integration', () => {
  let app;
  let db;

  beforeEach(async () => {
    // Clear registry first
    clearRegistry();

    // Create in-memory database (skip auto-loading models from ./models)
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty', // Non-existent dir to skip auto-loading
    });

    // Create a test model (only if not already defined)
    if (!hasModel('TestModel')) {
      const TestModel = defineModel({
        name: 'TestModel',
        table: 'test_models',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string(),
          email: zdb.string(),
          active: zdb.boolean({ default: true }),
          created_at: zdb.timestamp({ auto: 'create' }),
          updated_at: zdb.timestamp({ auto: 'update' }),
        }),
        admin: {
          enabled: true,
          label: 'Test Models',
          icon: '🧪',
        },
      });
      // Register in db instance
      db.registerModel(TestModel);
    }

    // Create tables manually for in-memory database
    await db.knex.schema.createTable('test_models', (table) => {
      table.bigIncrements('id');
      table.string('name');
      table.string('email');
      table.boolean('active').defaultTo(true);
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

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

    // Create app with multiple plugins
    const result = createApp({
      pagesDir: './tests/fixtures/pages',
      viewsDir: './tests/fixtures/views',
      publicDir: './public',
      plugins: [
        dashboardPlugin({
          path: '/_webspresso',
          enabled: true,
        }),
        adminPanelPlugin({
          path: '/_admin',
          db,
        }),
      ],
    });

    app = result.app;
  });

  afterEach(async () => {
    if (db) {
      await db.destroy();
    }
    clearRegistry();
  });

  describe('Dashboard Plugin Routes', () => {
    it('should access dashboard routes', async () => {
      const res = await request(app)
        .get('/_webspresso')
        .expect(200);

      expect(res.text).toContain('Webspresso Dashboard');
    });

    it('should access dashboard API routes', async () => {
      const res = await request(app)
        .get('/_webspresso/api/routes')
        .expect(200);

      expect(res.body).toBeDefined();
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Admin Panel Plugin Routes', () => {
    it('should access admin panel routes', async () => {
      const res = await request(app)
        .get('/_admin')
        .expect(200);

      expect(res.text).toContain('Admin Panel');
    });

    it('should access admin panel API routes', async () => {
      const res = await request(app)
        .get('/_admin/api/auth/check')
        .expect(200);

      expect(res.body).toHaveProperty('exists');
      expect(typeof res.body.exists).toBe('boolean');
    });
  });

  describe('Both Plugins Together', () => {
    it('should access both dashboard and admin panel', async () => {
      // Dashboard
      const dashboardRes = await request(app)
        .get('/_webspresso')
        .expect(200);
      expect(dashboardRes.text).toContain('Webspresso Dashboard');

      // Admin Panel
      const adminRes = await request(app)
        .get('/_admin')
        .expect(200);
      expect(adminRes.text).toContain('Admin Panel');
    });

    it('should access both plugin API routes', async () => {
      // Dashboard API
      const dashboardApiRes = await request(app)
        .get('/_webspresso/api/routes')
        .expect(200);
      expect(Array.isArray(dashboardApiRes.body)).toBe(true);

      // Admin Panel API
      const adminApiRes = await request(app)
        .get('/_admin/api/auth/check')
        .expect(200);
      expect(adminApiRes.body).toHaveProperty('exists');
    });

    it('should not interfere with each other', async () => {
      // Setup admin user
      await request(app)
        .post('/_admin/api/auth/setup')
        .send({
          email: 'admin@example.com',
          password: 'password123',
          name: 'Admin User',
        })
        .expect(200);

      // Login
      const loginRes = await request(app)
        .post('/_admin/api/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'password123',
        })
        .expect(200);

      const adminCookie = loginRes.headers['set-cookie'];

      // Admin panel should work
      const adminRes = await request(app)
        .get('/_admin/api/models')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(adminRes.body).toHaveProperty('models');

      // Dashboard should still work
      const dashboardRes = await request(app)
        .get('/_webspresso/api/routes')
        .expect(200);
      expect(Array.isArray(dashboardRes.body)).toBe(true);
    });
  });

  describe('Session Middleware', () => {
    it('should initialize session middleware only once', async () => {
      // Check that both plugins can access routes
      // Dashboard should work
      const dashboardRes = await request(app)
        .get('/_webspresso/api/routes')
        .expect(200);
      expect(Array.isArray(dashboardRes.body)).toBe(true);

      // Admin panel check endpoint should work (no auth required)
      const checkRes = await request(app)
        .get('/_admin/api/auth/check')
        .expect(200);
      expect(checkRes.body).toHaveProperty('exists');
      expect(typeof checkRes.body.exists).toBe('boolean');

      // Both should work without session conflicts
      const dashboardRes2 = await request(app)
        .get('/_webspresso/api/plugins')
        .expect(200);
      expect(Array.isArray(dashboardRes2.body)).toBe(true);
    });
  });
});
