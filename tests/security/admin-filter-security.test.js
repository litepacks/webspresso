const request = require('supertest');
const { createApp, createDatabase, defineModel, zdb, hasModel } = require('../../index.js');
const { adminPanelPlugin } = require('../../plugins/admin-panel');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');

describe('Security: Admin Panel Filter Column Injection', () => {
  let app;
  let db;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    if (!hasModel('SecProduct')) {
      const SecProduct = defineModel({
        name: 'SecProduct',
        table: 'sec_products',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string(),
          price: zdb.integer(),
        }),
        admin: {
          enabled: true,
        },
      });
      db.registerModel(SecProduct);
    }

    await db.knex.schema.createTable('sec_products', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
      table.integer('price').notNullable();
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

    await db.knex('sec_products').insert([
      { id: 1, title: 'Safe Item', price: 100 },
      { id: 2, title: 'Secret Item', price: 200 },
    ]);

    const result = createApp({
      pagesDir: PAGES_DIR,
      db,
      plugins: [
        adminPanelPlugin({
          db,
          path: '/_admin',
        }),
      ],
    });
    app = result.app;
  });

  afterAll(async () => {
    if (db && db.knex) {
      await db.knex.destroy();
    }
  });

  it('should ignore malicious / non-existent filter column names and not inject them into query', async () => {
    const agent = request.agent(app);

    // Setup first admin user
    await agent.post('/_admin/api/auth/setup').send({
      email: 'admin@sec.com',
      password: 'password123',
      name: 'Admin',
    }).expect(200);

    // Send request with an injected filter parameter on a non-existent column
    const res = await agent
      .get('/_admin/api/models/SecProduct/records?filter[non_existent_col][op]=equals&filter[non_existent_col][value]=test')
      .expect(200);

    expect(res.body.data).toHaveLength(2);
  });
});
