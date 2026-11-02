/**
 * Advanced data exchange plugin unit and API tests
 * (Template generator, preview analyzer, custom column mapping, and format filtering)
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server.js';
import { createDatabase, defineModel, zdb, hasModel, getModel, clearRegistry } from '../../../index.js';
import { adminPanelPlugin, dataExchangePlugin } from '../../../plugins/index.js';
import ExcelJS from 'exceljs';
import {
  generateCsvTemplate,
  generateXlsxTemplate,
  resolveTemplateColumns,
} from '../../../plugins/data-exchange/template.js';
import {
  suggestColumnMatch,
  normalizeHeaderName,
  analyzeSpreadsheetPreview,
} from '../../../plugins/data-exchange/preview.js';
import { parseCsvToRows } from '../../../plugins/data-exchange/import.js';

describe.sequential('Data exchange advanced features', () => {
  let app;
  let db;
  let cachedCookie;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    const Customer = hasModel('Customer')
      ? getModel('Customer')
      : defineModel({
          name: 'Customer',
          table: 'customers',
          schema: zdb.schema({
            id: zdb.id(),
            full_name: zdb.string(),
            email_address: zdb.string(),
            balance: zdb.number({ default: 0 }),
            is_active: zdb.boolean({ default: true }),
            created_at: zdb.timestamp({ auto: 'create' }),
          }),
          admin: {
            enabled: true,
            label: 'Customers',
          },
        });
    db.registerModel(Customer);

    await db.knex.schema.createTable('customers', (table) => {
      table.bigIncrements('id');
      table.string('full_name');
      table.string('email_address');
      table.float('balance').defaultTo(0);
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at');
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

    await db.knex('admin_users').insert({
      email: 'admin@webspresso.io',
      password: '$2b$04$Wuy3PNKivlnz5etS8gSaoeMqE7OUaMbnKcBRjSD0AxL.Qrd5hTAAK',
      name: 'Admin',
      role: 'admin',
      active: true,
    });

    const result = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      viewsDir: './tests/fixtures/views',
      publicDir: './public',
      silent: true,
      server: { port: 0, shutdown: { enabled: false } },
      helmet: false,
      compression: false,
      cache: false,
      healthCheck: false,
      metrics: false,
      lazyRoutes: true,
      db,
      plugins: [
        adminPanelPlugin({ path: '/_admin', db }),
        dataExchangePlugin({ db, adminPath: '/_admin' }),
      ],
    });

    app = result.app;
    const loginRes = await request(app).post('/_admin/api/auth/login').send({
      email: 'admin@webspresso.io',
      password: 'password123',
    });
    cachedCookie = loginRes.headers['set-cookie'];
  });

  afterAll(async () => {
    if (db) await db.destroy();
    clearRegistry();
  });

  beforeEach(async () => {
    await db.knex('customers').delete();
  });

  describe('Template unit helpers', () => {
    it('resolves model columns excluding primary key and auto timestamps for insert mode', () => {
      const Customer = db.getModel('Customer');
      const cols = resolveTemplateColumns(Customer, 'insert');
      const names = cols.map(c => c.name);
      expect(names).toContain('full_name');
      expect(names).toContain('email_address');
      expect(names).toContain('balance');
      expect(names).toContain('is_active');
      expect(names).not.toContain('id');
      expect(names).not.toContain('created_at');
    });

    it('includes primary key when mode is upsert', () => {
      const Customer = db.getModel('Customer');
      const cols = resolveTemplateColumns(Customer, 'upsert');
      const names = cols.map(c => c.name);
      expect(names).toContain('id');
      expect(names).toContain('full_name');
    });

    it('generates CSV template with UTF-8 BOM and sample row', () => {
      const Customer = db.getModel('Customer');
      const csvStr = generateCsvTemplate(Customer, 'insert').toString('utf8');
      expect(csvStr.startsWith('\uFEFF')).toBe(true);
      expect(csvStr).toContain('full_name,email_address,balance,is_active');
      expect(csvStr).toContain('user@example.com');
    });

    it('generates styled XLSX template buffer', async () => {
      const Customer = db.getModel('Customer');
      const buf = await generateXlsxTemplate(Customer, 'insert');
      expect(Buffer.isBuffer(buf)).toBe(true);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      expect(ws.name).toBe('Customer Template');
      const headerRow = ws.getRow(1);
      expect(headerRow.getCell(1).font.bold).toBe(true);
      expect(ws.rowCount).toBe(2);
    });
  });

  describe('Preview & matching unit helpers', () => {
    it('normalizes header names for comparison', () => {
      expect(normalizeHeaderName('Full Name')).toBe('fullname');
      expect(normalizeHeaderName('email_address')).toBe('emailaddress');
      expect(normalizeHeaderName('Is-Active?')).toBe('isactive');
    });

    it('suggests column matches using aliases and normalized comparison', () => {
      const modelCols = ['full_name', 'email_address', 'balance', 'is_active'];
      expect(suggestColumnMatch('full_name', modelCols)).toBe('full_name');
      expect(suggestColumnMatch('Full Name', modelCols)).toBe('full_name');
      expect(suggestColumnMatch('Email', modelCols)).toBe('email_address');
      expect(suggestColumnMatch('Mail', modelCols)).toBe('email_address');
      expect(suggestColumnMatch('Active', modelCols)).toBe('is_active');
      expect(suggestColumnMatch('Amount', modelCols)).toBe('balance');
      expect(suggestColumnMatch('Completely Unknown Column', modelCols)).toBeNull();
    });

    it('analyzes CSV buffer preview and builds suggested mapping', async () => {
      const Customer = db.getModel('Customer');
      const csv = 'Full Name,E-Mail Address,Account Balance,Active\nJohn Doe,john@test.com,150.50,true\nJane Smith,jane@test.com,200.00,false\n';
      const preview = analyzeSpreadsheetPreview(Customer, parseCsvToRows(Buffer.from(csv)));

      expect(preview.fileHeaders).toEqual(['Full Name', 'E-Mail Address', 'Account Balance', 'Active']);
      expect(preview.totalRows).toBe(2);
      expect(preview.sampleRows).toHaveLength(2);
      expect(preview.sampleRows[0][0]).toBe('John Doe');
      expect(preview.suggestedMapping['Full Name']).toBe('full_name');
      expect(preview.suggestedMapping['E-Mail Address']).toBe('email_address');
      expect(preview.suggestedMapping['Account Balance']).toBe('balance');
      expect(preview.suggestedMapping['Active']).toBe('is_active');
    });
  });

  describe('API Endpoints integration', () => {
    it('GET /template/:model?format=csv returns downloadable CSV', async () => {
      const res = await request(app)
        .get('/_admin/api/data-exchange/template/Customer?format=csv')
        .set('Cookie', cachedCookie)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/Customer-template\.csv/);
      expect(res.text).toContain('full_name');
      expect(res.text).toContain('email_address');
    });

    it('GET /template/:model?format=xlsx returns downloadable Excel workbook', async () => {
      const res = await request(app)
        .get('/_admin/api/data-exchange/template/Customer?format=xlsx')
        .set('Cookie', cachedCookie)
        .buffer(true)
        .parse((r, cb) => {
          const data = [];
          r.on('data', c => data.push(c));
          r.on('end', () => cb(null, Buffer.concat(data)));
        })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/spreadsheetml/);
      expect(res.headers['content-disposition']).toMatch(/Customer-template\.xlsx/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      expect(wb.worksheets.length).toBe(1);
    });

    it('POST /preview/:model returns columns, preview samples and mapping', async () => {
      const csv = 'Customer Name,Email,Balance,Active Status\nAlice,alice@example.com,42.50,1\nBob,bob@example.com,99.00,0\n';
      const res = await request(app)
        .post('/_admin/api/data-exchange/preview/Customer')
        .set('Cookie', cachedCookie)
        .attach('file', Buffer.from(csv), 'test.csv')
        .expect(200);

      expect(res.body.fileHeaders).toEqual(['Customer Name', 'Email', 'Balance', 'Active Status']);
      expect(res.body.sampleRows).toHaveLength(2);
      expect(res.body.suggestedMapping['Customer Name']).toBe('full_name');
      expect(res.body.suggestedMapping['Email']).toBe('email_address');
      expect(res.body.suggestedMapping['Balance']).toBe('balance');
      expect(res.body.suggestedMapping['Active Status']).toBe('is_active');
    });

    it('POST /import/:model applies custom columnMapping', async () => {
      const csv = 'custom_user,custom_contact,custom_val\nCharlie,charlie@webspresso.io,500\n';
      const mapping = JSON.stringify({
        'custom_user': 'full_name',
        'custom_contact': 'email_address',
        'custom_val': 'balance',
      });

      const res = await request(app)
        .post('/_admin/api/data-exchange/import/Customer?mode=insert')
        .set('Cookie', cachedCookie)
        .field('columnMapping', mapping)
        .attach('file', Buffer.from(csv), 'custom.csv')
        .expect(200);

      expect(res.body.created).toBe(1);
      expect(res.body.failed).toBe(0);

      const repo = db.getRepository('Customer');
      const saved = await repo.query().where('email_address', 'charlie@webspresso.io').first();
      expect(saved).toBeTruthy();
      expect(saved.full_name).toBe('Charlie');
      expect(Number(saved.balance)).toBe(500);
    });

    it('GET /export/:model supports format=csv and columns filtering', async () => {
      const repo = db.getRepository('Customer');
      await repo.create({ full_name: 'David', email_address: 'david@webspresso.io', balance: 30 });

      const res = await request(app)
        .get('/_admin/api/data-exchange/export/Customer?format=csv&columns=full_name,email_address')
        .set('Cookie', cachedCookie)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toContain('full_name,email_address');
      expect(res.text).not.toContain('balance');
      expect(res.text).toContain('David,david@webspresso.io');
    });

    it('POST /export/:model supports format=xlsx and column selection payload', async () => {
      const repo = db.getRepository('Customer');
      await repo.create({ full_name: 'Eve', email_address: 'eve@webspresso.io', balance: 80 });

      const res = await request(app)
        .post('/_admin/api/data-exchange/export/Customer')
        .set('Cookie', cachedCookie)
        .send({ format: 'xlsx', columns: ['full_name', 'balance'], selectAll: true })
        .buffer(true)
        .parse((r, cb) => {
          const data = [];
          r.on('data', c => data.push(c));
          r.on('end', () => cb(null, Buffer.concat(data)));
        })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/spreadsheetml/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      const ws = wb.worksheets[0];
      const headerValues = ws.getRow(1).values.filter(Boolean);
      expect(headerValues).toEqual(['full_name', 'balance']);
    });
  });
});
