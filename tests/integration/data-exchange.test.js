/**
 * Data exchange plugin integration tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, zdb, hasModel } from '../../index.js';
import { adminPanelPlugin, dataExchangePlugin } from '../../plugins/index.js';
import { clearRegistry } from '../../core/orm/model.js';
import ExcelJS from 'exceljs';

describe('Data exchange plugin', () => {
  let app;
  let db;

  beforeEach(async () => {
    clearRegistry();

    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

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
        },
      });
      db.registerModel(TestModel);
    }

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

    const result = createApp({
      pagesDir: './tests/fixtures/pages',
      viewsDir: './tests/fixtures/views',
      publicDir: './public',
      db,
      plugins: [
        adminPanelPlugin({ path: '/_admin', db }),
        dataExchangePlugin({ db, adminPath: '/_admin' }),
      ],
    });

    app = result.app;
  });

  afterEach(async () => {
    if (db) await db.destroy();
    clearRegistry();
  });

  async function loginCookie() {
    await request(app).post('/_admin/api/auth/setup').send({
      email: 'admin@example.com',
      password: 'password123',
      name: 'Admin',
    });
    const loginRes = await request(app).post('/_admin/api/auth/login').send({
      email: 'admin@example.com',
      password: 'password123',
    });
    return loginRes.headers['set-cookie'];
  }

  it('rejects export without auth', async () => {
    await request(app).get('/_admin/api/data-exchange/export/TestModel').expect(401);
  });

  it('exports xlsx for admin user', async () => {
    const cookie = await loginCookie();
    const repo = db.getRepository('TestModel');
    await repo.create({ name: 'A', email: 'a@ex.com', active: true });

    const res = await request(app)
      .post('/_admin/api/data-exchange/export/TestModel')
      .set('Cookie', cookie)
      .send({ selectAll: true, filters: {} })
      .buffer(true)
      .parse((res, cb) => {
        const data = [];
        res.on('data', (c) => data.push(c));
        res.on('end', () => cb(null, Buffer.concat(data)));
      })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/spreadsheet/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(1).values[1]).toBe('id');
    expect(sheet.rowCount).toBeGreaterThanOrEqual(2);
  });

  it('imports csv (insert)', async () => {
    const cookie = await loginCookie();
    const csv = 'name,email,active\nImported,imp@ex.com,1\n';

    const res = await request(app)
      .post('/_admin/api/data-exchange/import/TestModel?mode=insert')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(csv), 'rows.csv')
      .expect(200);

    expect(res.body.created).toBe(1);
    expect(res.body.failed).toBe(0);

    const repo = db.getRepository('TestModel');
    const row = await repo.query().where('email', 'imp@ex.com').first();
    expect(row).toBeTruthy();
    expect(row.name).toBe('Imported');
  });

  it('imports xlsx (upsert by id)', async () => {
    const cookie = await loginCookie();
    const repo = db.getRepository('TestModel');
    const created = await repo.create({ name: 'Old', email: 'u@ex.com', active: true });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['id', 'name', 'email', 'active']);
    ws.addRow([created.id, 'New', 'u@ex.com', 0]);
    const buf = await wb.xlsx.writeBuffer();

    const res = await request(app)
      .post('/_admin/api/data-exchange/import/TestModel?mode=upsert&upsertKey=id')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(buf), 'u.xlsx')
      .expect(200);

    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(0);

    const again = await repo.findById(created.id);
    expect(again.name).toBe('New');
    expect(Boolean(again.active)).toBe(false);
  });
});
