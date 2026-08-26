const path = require('path');
const z = require('zod');
const { createDatabase } = require('../../core/orm');
const { defineModel, clearRegistry } = require('../../core/orm/model');
const { createServiceRegistry } = require('../../src/services');
const { createExchangeServices } = require('../../src/services/builtins/exchange');
const { createApp } = require('../../src/server');
const { dataExchangePlugin } = require('../../plugins/data-exchange');

describe('Built-in Exchange Services (exchange.*)', () => {
  let db;
  let knex;
  let services;

  beforeAll(async () => {
    clearRegistry();

    const productSchema = z.object({
      id: z.number().optional(),
      sku: z.string(),
      title: z.string(),
      price: z.number().default(0),
      in_stock: z.boolean().default(true),
    });

    defineModel({
      name: 'Product',
      table: 'products',
      schema: productSchema,
      admin: { enabled: true },
    });

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = db.knex;

    await knex.schema.createTable('products', (table) => {
      table.increments('id').primary();
      table.string('sku').notNullable().unique();
      table.string('title').notNullable();
      table.float('price').defaultTo(0);
      table.boolean('in_stock').defaultTo(true);
    });

    // Seed sample records
    await knex('products').insert([
      { sku: 'PROD-1', title: 'Laptop', price: 999.99, in_stock: true },
      { sku: 'PROD-2', title: 'Mouse', price: 29.99, in_stock: true },
      { sku: 'PROD-3', title: 'Keyboard', price: 79.99, in_stock: false },
    ]);

    services = createServiceRegistry();
    const exchangeMap = createExchangeServices({ db });
    for (const [name, def] of Object.entries(exchangeMap)) {
      services.register(name, def);
    }
  });

  afterAll(async () => {
    clearRegistry();
    await knex.schema.dropTableIfExists('products');
    await knex.destroy();
  });

  describe('exchange.export', () => {
    it('should export model records to Excel .xlsx buffer', async () => {
      const result = await services.call(
        'exchange.export',
        { model: 'Product' },
        { db, auth: { user: { role: 'admin' } } }
      );

      expect(result.buffer).toBeDefined();
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.filename).toBe('Product_export.xlsx');
      expect(result.rowCount).toBe(3);
      expect(result.model).toBe('Product');
    });

    it('should filter export by specific IDs', async () => {
      const result = await services.call(
        'exchange.export',
        { model: 'Product', ids: [1, 2] },
        { db, auth: { user: { role: 'admin' } } }
      );

      expect(result.rowCount).toBe(2);
    });
  });

  describe('exchange.import', () => {
    it('should import new records from CSV text in insert mode', async () => {
      const csv = `sku,title,price,in_stock\nPROD-4,Monitor,299.99,true\nPROD-5,Headphones,89.50,false`;

      const result = await services.call(
        'exchange.import',
        { model: 'Product', csvText: csv, mode: 'insert' },
        { db, auth: { user: { role: 'admin' } } }
      );

      expect(result.success).toBe(true);
      expect(result.created).toBe(2);
      expect(result.failed).toBe(0);

      const inDb = await knex('products').where({ sku: 'PROD-4' }).first();
      expect(inDb).toBeDefined();
      expect(inDb.title).toBe('Monitor');
      expect(inDb.price).toBe(299.99);
    });

    it('should upsert records by sku in upsert mode', async () => {
      const csv = `sku,title,price,in_stock\nPROD-1,Ultra Laptop,1299.99,true\nPROD-6,Webcam,49.99,true`;

      const result = await services.call(
        'exchange.import',
        { model: 'Product', csvText: csv, mode: 'upsert', upsertKey: 'sku' },
        { db, auth: { user: { role: 'admin' } } }
      );

      expect(result.success).toBe(true);
      expect(result.updated).toBe(1); // PROD-1 was updated
      expect(result.created).toBe(1); // PROD-6 was inserted

      const updated = await knex('products').where({ sku: 'PROD-1' }).first();
      expect(updated.title).toBe('Ultra Laptop');
      expect(updated.price).toBe(1299.99);
    });
  });

  describe('dataExchangePlugin automatic registration', () => {
    it('should auto-register exchange.* services in createApp when plugin is loaded', async () => {
      const { app } = createApp({
        pagesDir: path.join(__dirname, '../fixtures/pages'),
        db,
        plugins: [
          dataExchangePlugin({ db }),
        ],
      });

      expect(app.serviceRegistry.has('exchange.export')).toBe(true);
      expect(app.serviceRegistry.has('exchange.import')).toBe(true);

      const res = await app.serviceRegistry.call(
        'exchange.export',
        { model: 'Product' },
        { db, auth: { user: { role: 'admin' } } }
      );

      expect(res.rowCount).toBeGreaterThanOrEqual(3);
    });
  });
});
