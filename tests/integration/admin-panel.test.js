/**
 * Admin Panel Integration Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, zdb, hasModel } from '../../index.js';
import { adminPanelPlugin } from '../../plugins/index.js';
import { clearRegistry } from '../../core/orm/model.js';

describe('Admin Panel Integration', () => {
  let app;
  let db;
  let server;

  beforeEach(async () => {
    clearRegistry();

    // Create in-memory database (skip auto-loading models)
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

    // Create app with admin panel
    const result = createApp({
      pagesDir: './tests/fixtures/pages',
      viewsDir: './tests/fixtures/views',
      publicDir: './public',
      plugins: [
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

  describe('Setup Flow', () => {
    it('should check if admin exists', async () => {
      const res = await request(app)
        .get('/_admin/api/auth/check')
        .expect(200);

      expect(res.body).toHaveProperty('exists');
      expect(typeof res.body.exists).toBe('boolean');
    });

    it('should setup first admin user', async () => {
      const res = await request(app)
        .post('/_admin/api/auth/setup')
        .send({
          email: 'admin@example.com',
          password: 'password123',
          name: 'Admin User',
        })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.user).toHaveProperty('email', 'admin@example.com');
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('should not allow setup if admin already exists', async () => {
      // Create first admin
      await request(app)
        .post('/_admin/api/auth/setup')
        .send({
          email: 'admin@example.com',
          password: 'password123',
          name: 'Admin User',
        });

      // Try to create another
      const res = await request(app)
        .post('/_admin/api/auth/setup')
        .send({
          email: 'admin2@example.com',
          password: 'password123',
          name: 'Admin User 2',
        })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Authentication', () => {
    let adminCookie;

    beforeEach(async () => {
      // Setup admin
      const setupRes = await request(app)
        .post('/_admin/api/auth/setup')
        .send({
          email: 'admin@example.com',
          password: 'password123',
          name: 'Admin User',
        });

      adminCookie = setupRes.headers['set-cookie'];
    });

    it('should login with correct credentials', async () => {
      const res = await request(app)
        .post('/_admin/api/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'password123',
        })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.user).toHaveProperty('email', 'admin@example.com');
    });

    it('should reject login with wrong password', async () => {
      const res = await request(app)
        .post('/_admin/api/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'wrong',
        })
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });

    it('should get current user when authenticated', async () => {
      const res = await request(app)
        .get('/_admin/api/auth/me')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toHaveProperty('email', 'admin@example.com');
    });

    it('should reject unauthenticated requests to protected routes', async () => {
      const res = await request(app)
        .get('/_admin/api/models')
        .expect(401);

      expect(res.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should logout user', async () => {
      const res = await request(app)
        .post('/_admin/api/auth/logout')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('Model API', () => {
    let adminCookie;

    beforeEach(async () => {
      // Setup and login
      await request(app)
        .post('/_admin/api/auth/setup')
        .send({
          email: 'admin@example.com',
          password: 'password123',
          name: 'Admin User',
        });

      const loginRes = await request(app)
        .post('/_admin/api/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'password123',
        });

      adminCookie = loginRes.headers['set-cookie'];
    });

    it('should list enabled models', async () => {
      const res = await request(app)
        .get('/_admin/api/models')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toHaveProperty('models');
      expect(Array.isArray(res.body.models)).toBe(true);
      expect(res.body.models.length).toBeGreaterThan(0);
    });

    it('should get model metadata', async () => {
      const res = await request(app)
        .get('/_admin/api/models/TestModel')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toHaveProperty('name', 'TestModel');
      expect(res.body).toHaveProperty('columns');
      expect(Array.isArray(res.body.columns)).toBe(true);
    });

    it('should return 404 for non-existent model', async () => {
      const res = await request(app)
        .get('/_admin/api/models/NonExistent')
        .set('Cookie', adminCookie)
        .expect(404);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Record API', () => {
    let adminCookie;
    let testRepo;

    beforeEach(async () => {
      // Setup and login
      await request(app)
        .post('/_admin/api/auth/setup')
        .send({
          email: 'admin@example.com',
          password: 'password123',
          name: 'Admin User',
        });

      const loginRes = await request(app)
        .post('/_admin/api/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'password123',
        });

      adminCookie = loginRes.headers['set-cookie'];

      // Get test model repository
      testRepo = db.getRepository('TestModel');
    });

    it('should list records', async () => {
      // Create a test record
      await testRepo.create({
        name: 'Test Record',
        email: 'test@example.com',
        active: true,
      });

      const res = await request(app)
        .get('/_admin/api/models/TestModel/records')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should get single record', async () => {
      const record = await testRepo.create({
        name: 'Test Record',
        email: 'test@example.com',
        active: true,
      });

      const res = await request(app)
        .get(`/_admin/api/models/TestModel/records/${record.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('id', record.id);
    });

    it('should create record', async () => {
      const res = await request(app)
        .post('/_admin/api/models/TestModel/records')
        .set('Cookie', adminCookie)
        .send({
          name: 'New Record',
          email: 'new@example.com',
          active: true,
        })
        .expect(201);

      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('name', 'New Record');
    });

    it('should update record', async () => {
      const record = await testRepo.create({
        name: 'Test Record',
        email: 'test@example.com',
        active: true,
      });

      const res = await request(app)
        .put(`/_admin/api/models/TestModel/records/${record.id}`)
        .set('Cookie', adminCookie)
        .send({
          name: 'Updated Record',
        })
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('name', 'Updated Record');
    });

    it('should delete record', async () => {
      const record = await testRepo.create({
        name: 'Test Record',
        email: 'test@example.com',
        active: true,
      });

      const res = await request(app)
        .delete(`/_admin/api/models/TestModel/records/${record.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);

      // Verify deleted
      const deleted = await testRepo.findById(record.id);
      expect(deleted).toBeNull();
    });
  });
});
