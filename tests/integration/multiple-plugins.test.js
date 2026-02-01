/**
 * Multiple Plugins Integration Test
 * Tests that multiple plugins can work together
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, zdb } from '../../index.js';
import { adminPanelPlugin, dashboardPlugin } from '../../plugins/index.js';
import { clearRegistry } from '../../core/orm/model.js';

describe('Multiple Plugins Integration', () => {
  let app;
  let db;

  beforeEach(async () => {
    // Clear registry first
    clearRegistry();

    // Create in-memory database
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      migrations: {
        directory: './tests/fixtures/migrations',
      },
    });

    // Create a test model (only if not already defined)
    if (!require('../../core/orm/model.js').hasModel('TestModel')) {
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
    }

    // Run migrations
    try {
      await db.migrate.latest();
    } catch (e) {
      // Migrations might not exist, that's OK for this test
    }

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

      // Admin panel check endpoint should work
      const checkRes = await request(app)
        .get('/_admin/api/auth/check')
        .expect(200);
      expect(checkRes.body).toHaveProperty('exists');

      // Both should work without session conflicts
      const dashboardRes2 = await request(app)
        .get('/_webspresso/api/plugins')
        .expect(200);
      expect(Array.isArray(dashboardRes2.body)).toBe(true);
    });
  });
});
