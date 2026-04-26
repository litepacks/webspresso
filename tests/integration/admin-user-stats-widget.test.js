/**
 * User Statistics dashboard widget (userManagement)
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, zdb, hasModel } from '../../index.js';
import { adminPanelPlugin } from '../../plugins/index.js';
import { clearRegistry } from '../../core/orm/model.js';

describe('Admin User Statistics widget', () => {
  let app;
  let db;

  beforeEach(async () => {
    clearRegistry();

    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    if (!hasModel('User')) {
      const User = defineModel({
        name: 'User',
        table: 'users',
        schema: zdb.schema({
          id: zdb.id(),
          email: zdb.string({ unique: true, maxLength: 255 }),
          password: zdb.string({ maxLength: 255 }),
          name: zdb.string({ maxLength: 255, nullable: true }),
          role: zdb.string({ maxLength: 50, default: 'user' }),
          active: zdb.boolean({ default: true }),
          created_at: zdb.timestamp({ auto: 'create' }),
          updated_at: zdb.timestamp({ auto: 'update' }),
        }),
        admin: { enabled: true, label: 'Users' },
        hidden: ['password'],
      });
      db.registerModel(User);
    }

    await db.knex.schema.createTable('users', (table) => {
      table.bigIncrements('id').primary();
      table.string('email', 255).unique();
      table.string('password', 255);
      table.string('name', 255).nullable();
      table.string('role', 50).defaultTo('user');
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

    await db.knex('users').insert([
      {
        email: 'u1@test.com',
        password: 'x',
        name: 'One',
        role: 'user',
        active: 1,
        created_at: db.knex.fn.now(),
        updated_at: db.knex.fn.now(),
      },
      {
        email: 'admin@test.com',
        password: 'x',
        name: 'Admin',
        role: 'admin',
        active: 1,
        created_at: db.knex.fn.now(),
        updated_at: db.knex.fn.now(),
      },
    ]);

    const result = createApp({
      pagesDir: './tests/fixtures/pages',
      viewsDir: './tests/fixtures/views',
      publicDir: './public',
      db,
      plugins: [
        adminPanelPlugin({
          path: '/_admin',
          db,
          userManagement: { enabled: true, model: 'User' },
        }),
      ],
    });

    app = result.app;
  });

  afterEach(async () => {
    if (db) await db.destroy();
    clearRegistry();
  });

  async function adminCookie() {
    await request(app).post('/_admin/api/auth/setup').send({
      email: 'panel@example.com',
      password: 'password123',
      name: 'Panel',
    });
    const loginRes = await request(app).post('/_admin/api/auth/login').send({
      email: 'panel@example.com',
      password: 'password123',
    });
    return loginRes.headers['set-cookie'];
  }

  it('returns user-stats widget data with correct counts (SQLite booleans)', async () => {
    const cookie = await adminCookie();
    const res = await request(app)
      .get('/_admin/api/extensions/widgets/user-stats/data')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.error).toBeUndefined();
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.active).toBe(2);
    expect(res.body.data.inactive).toBe(0);
    expect(res.body.data.admins).toBe(1);
    expect(typeof res.body.data.recentUsers).toBe('number');
    expect(res.body.data.recentUsers).toBeGreaterThanOrEqual(2);
  });
});
