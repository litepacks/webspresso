/**
 * Unit tests for Admin Panel 3-state Column Sorting and per-column/per-model configurations
 */

const { createDatabase, defineModel, zdb, hasModel } = require('../../../core/orm');
const { createApp } = require('../../../index');
const supertest = require('supertest');
const adminPanelPlugin = require('../../../plugins/admin-panel');

describe('Admin Panel Column Sorting (3-State & Configuration)', () => {
  let db;
  let app;
  let adminCookie;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    if (!hasModel('ProductSortTest')) {
      defineModel({
        name: 'ProductSortTest',
        table: 'product_sort_tests',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string().config({ sortable: true }),
          price: zdb.float(),
          details: zdb.json(), // default non-sortable
          secret_notes: zdb.text().config({ sortable: false }), // explicitly non-sortable
          created_at: zdb.timestamp({ auto: 'create' }),
        }),
        admin: {
          enabled: true,
        },
      });
    }

    if (!hasModel('LimitedModelSortTest')) {
      defineModel({
        name: 'LimitedModelSortTest',
        table: 'limited_model_sort_tests',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string(),
          code: zdb.string(),
        }),
        admin: {
          enabled: true,
          sortableColumns: ['title'], // Only title is sortable
        },
      });
    }

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

    await db.knex.schema.createTable('product_sort_tests', (table) => {
      table.increments('id').primary();
      table.string('name');
      table.float('price');
      table.json('details');
      table.text('secret_notes');
      table.timestamp('created_at').defaultTo(db.knex.fn.now());
    });

    await db.knex.schema.createTable('limited_model_sort_tests', (table) => {
      table.increments('id').primary();
      table.string('title');
      table.string('code');
    });

    // Seed dummy data
    await db.getRepository('ProductSortTest').create({ name: 'Alpha', price: 10.0, secret_notes: 'a' });
    await db.getRepository('ProductSortTest').create({ name: 'Beta', price: 5.0, secret_notes: 'b' });
    await db.getRepository('ProductSortTest').create({ name: 'Gamma', price: 20.0, secret_notes: 'c' });

    const result = createApp({
      pagesDir: './tests/fixtures/pages',
      viewsDir: './tests/fixtures/views',
      publicDir: './public',
      db,
      plugins: [
        adminPanelPlugin({
          path: '/_admin',
          db,
        }),
      ],
    });

    app = result.app;

    // Perform setup to get admin cookie
    const setupRes = await supertest(app)
      .post('/_admin/api/auth/setup')
      .send({
        email: 'admin_sort@example.com',
        password: 'password123',
        name: 'Admin User',
      });

    if (setupRes.headers['set-cookie']) {
      adminCookie = setupRes.headers['set-cookie'];
    } else {
      const loginRes = await supertest(app)
        .post('/_admin/api/auth/login')
        .send({
          email: 'admin_sort@example.com',
          password: 'password123',
        });
      adminCookie = loginRes.headers['set-cookie'];
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  describe('Model metadata column sortable flag', () => {
    it('returns sortable: true for standard scalar fields and sortable: false for json/explicit non-sortable fields', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models/ProductSortTest')
        .set('Cookie', adminCookie)
        .expect(200);

      const nameCol = res.body.columns.find((c) => c.name === 'name');
      const priceCol = res.body.columns.find((c) => c.name === 'price');
      const detailsCol = res.body.columns.find((c) => c.name === 'details');
      const notesCol = res.body.columns.find((c) => c.name === 'secret_notes');

      expect(nameCol.sortable).toBe(true);
      expect(priceCol.sortable).toBe(true);
      expect(detailsCol.sortable).toBe(false);
      expect(notesCol.sortable).toBe(false);
    });

    it('respects model-level sortableColumns configuration', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models/LimitedModelSortTest')
        .set('Cookie', adminCookie)
        .expect(200);

      const titleCol = res.body.columns.find((c) => c.name === 'title');
      const codeCol = res.body.columns.find((c) => c.name === 'code');

      expect(titleCol.sortable).toBe(true);
      expect(codeCol.sortable).toBe(false);
    });
  });

  describe('Records List API sorting', () => {
    it('sorts by specified column ascending', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models/ProductSortTest/records?sort=price&order=asc')
        .set('Cookie', adminCookie)
        .expect(200);

      const prices = res.body.data.map((r) => r.price);
      expect(prices).toEqual([5.0, 10.0, 20.0]);
    });

    it('sorts by specified column descending', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models/ProductSortTest/records?sort=price&order=desc')
        .set('Cookie', adminCookie)
        .expect(200);

      const prices = res.body.data.map((r) => r.price);
      expect(prices).toEqual([20.0, 10.0, 5.0]);
    });

    it('ignores non-sortable column and falls back to default primary key descending', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models/ProductSortTest/records?sort=secret_notes&order=asc')
        .set('Cookie', adminCookie)
        .expect(200);

      const ids = res.body.data.map((r) => r.id);
      expect(ids).toEqual([3, 2, 1]);
    });
  });

  describe('Frontend 3-state sorting cycle logic', () => {
    it('cycles correctly: null -> asc -> desc -> null', () => {
      let sortColumn = null;
      let sortDirection = null;

      const toggleSort = (colName) => {
        let nextSort = colName;
        let nextDir = 'asc';
        if (sortColumn === colName) {
          if (sortDirection === 'asc') {
            nextDir = 'desc';
          } else if (sortDirection === 'desc') {
            nextSort = null;
            nextDir = null;
          }
        }
        sortColumn = nextSort;
        sortDirection = nextDir;
      };

      // State 1: Unsorted -> Click 'price'
      toggleSort('price');
      expect(sortColumn).toBe('price');
      expect(sortDirection).toBe('asc');

      // State 2: ASC -> Click 'price' again
      toggleSort('price');
      expect(sortColumn).toBe('price');
      expect(sortDirection).toBe('desc');

      // State 3: DESC -> Click 'price' again
      toggleSort('price');
      expect(sortColumn).toBeNull();
      expect(sortDirection).toBeNull();

      // Click 'name' -> starts at ASC
      toggleSort('name');
      expect(sortColumn).toBe('name');
      expect(sortDirection).toBe('asc');
    });
  });
});
