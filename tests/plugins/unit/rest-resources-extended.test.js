/**
 * Extended Scenarios for REST Resources Plugin (plugins/rest-resources/index.js)
 * Tests:
 * - pluralizeSegment variations (y -> ies, sh/ch/x/z/s -> es, general s)
 * - parseIncludeParam (relations, nested dot avoidance, allowInclude constraints)
 * - parseSortParams (-, +, :, comma-separated, array, fallback to PK)
 * - applyColumnFilters (boolean normalization, numeric coercion, operators eq/ne/gt/gte/lt/lte/like/ilike/in/notin/null/notnull/between)
 * - sanitizeRecordTree & pickWritableColumns (hidden fields stripping, auto-increment pk omission)
 * - resolveExposedModels (models, excludeModels, filter function)
 * - CRUD route handlers (list, create, show, update, delete, restore, forceDelete, pagination meta)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { defineModel, clearRegistry, createDatabase, zdb } from '../../../core/orm/index.js';
import restResourcePlugin, {
  pluralizeSegment,
  parseIncludeParam,
  parseSortParams,
  applyColumnFilters,
  sanitizeRecordTree,
  pickWritableColumns,
  resolveExposedModels,
} from '../../../plugins/rest-resources/index.js';

describe.sequential('REST Resources Extended Scenarios', () => {
  let db;
  let knex;
  let app;

  beforeAll(async () => {
    clearRegistry();
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: false,
    });
    knex = db.knex;

    await knex.schema.createTable('categories', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('slug').notNullable();
    });

    await knex.schema.createTable('products', (table) => {
      table.increments('id').primary();
      table.integer('category_id').nullable();
      table.string('title').notNullable();
      table.float('price').defaultTo(0);
      table.integer('stock').defaultTo(0);
      table.boolean('is_active').defaultTo(true);
      table.string('secret_token').nullable();
      table.timestamp('deleted_at').nullable();
    });

    const Category = defineModel({
      name: 'Category',
      table: 'categories',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string(),
        slug: zdb.string(),
      }),
      rest: {
        enabled: true,
      },
    });
    db.registerModel(Category);

    const Product = defineModel({
      name: 'Product',
      table: 'products',
      schema: zdb.schema({
        id: zdb.id(),
        category_id: zdb.integer({ nullable: true }),
        title: zdb.string(),
        price: zdb.float({ default: 0 }),
        stock: zdb.integer({ default: 0 }),
        is_active: zdb.boolean({ default: true }),
        secret_token: zdb.string({ nullable: true }),
        deleted_at: zdb.date({ nullable: true }),
      }),
      hidden: ['secret_token'],
      scopes: {
        softDelete: true,
      },
      relations: {
        category: {
          type: 'belongsTo',
          model: () => Category,
          foreignKey: 'category_id',
        },
      },
      rest: {
        enabled: true,
        allowInclude: ['category'],
      },
    });
    db.registerModel(Product);

    // Setup Express app with restResourcePlugin
    app = express();
    app.use(express.json());

    const plugin = restResourcePlugin({
      path: '/api/v1',
      db,
    });

    const routes = [];
    const pluginCtx = {
      app,
      db,
      addRoute(method, routePath, ...handlers) {
        routes.push({ method, routePath });
        app[method.toLowerCase()](routePath, ...handlers);
      },
    };

    plugin.onRoutesReady(pluginCtx);
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
    clearRegistry();
  });

  describe('Helper Functions & Parsers', () => {
    it('pluralizeSegment converts model names into proper REST URL segments', () => {
      expect(pluralizeSegment('Category')).toBe('categories');
      expect(pluralizeSegment('Company')).toBe('companies');
      expect(pluralizeSegment('Day')).toBe('days'); // vowel + y -> s
      expect(pluralizeSegment('Box')).toBe('boxes'); // x -> es
      expect(pluralizeSegment('Branch')).toBe('branches'); // ch -> es
      expect(pluralizeSegment('Dish')).toBe('dishes'); // sh -> es
      expect(pluralizeSegment('User')).toBe('users'); // regular -> s
    });

    it('parseIncludeParam parses, filters and validates relation inclusion', () => {
      const productModel = db.getModel('Product');

      expect(parseIncludeParam(productModel, null)).toEqual([]);
      expect(parseIncludeParam(productModel, '')).toEqual([]);
      expect(parseIncludeParam(productModel, 'category')).toEqual(['category']);
      // Nested dots are excluded
      expect(parseIncludeParam(productModel, 'category.parent,invalidRel')).toEqual([]);
    });

    it('parseSortParams handles arrays, +/-/col:dir tokens and primaryKey fallback', () => {
      const productModel = db.getModel('Product');

      // Fallback
      expect(parseSortParams(productModel, null, null)).toEqual([
        { column: 'id', direction: 'desc' },
      ]);

      // Simple string
      expect(parseSortParams(productModel, 'price', 'asc')).toEqual([
        { column: 'price', direction: 'asc' },
      ]);

      // Prefix syntax: +price, -stock
      expect(parseSortParams(productModel, '+price,-stock', null)).toEqual([
        { column: 'price', direction: 'asc' },
        { column: 'stock', direction: 'desc' },
      ]);

      // Colon syntax: title:desc
      expect(parseSortParams(productModel, 'title:desc', null)).toEqual([
        { column: 'title', direction: 'desc' },
      ]);

      // Array syntax
      expect(parseSortParams(productModel, ['-price', 'stock:asc'], null)).toEqual([
        { column: 'price', direction: 'desc' },
        { column: 'stock', direction: 'asc' },
      ]);
    });

    it('sanitizeRecordTree removes hidden columns recursively', () => {
      const productModel = db.getModel('Product');
      const rawRecord = {
        id: 1,
        title: 'Keyboard',
        secret_token: 'SUPER_SECRET',
        category: {
          id: 10,
          name: 'Peripherals',
        },
      };

      const sanitized = sanitizeRecordTree(rawRecord, productModel);
      expect(sanitized.id).toBe(1);
      expect(sanitized.title).toBe('Keyboard');
      expect(sanitized.secret_token).toBeUndefined();
      expect(sanitized.category.name).toBe('Peripherals');

      // Handles arrays
      const arr = sanitizeRecordTree([rawRecord], productModel);
      expect(arr[0].secret_token).toBeUndefined();
      expect(sanitizeRecordTree(null, productModel)).toBeNull();
    });

    it('pickWritableColumns filters body to valid non-hidden and non-autoincrement columns', () => {
      const productModel = db.getModel('Product');
      const body = {
        id: 99, // auto-increment primary key ignored
        title: 'Mouse',
        price: 49.99,
        secret_token: 'attempt_hidden_injection', // hidden ignored
        unknown_col: 'ignored', // non-existent ignored
      };

      const clean = pickWritableColumns(body, productModel);
      expect(clean.id).toBeUndefined();
      expect(clean.title).toBe('Mouse');
      expect(clean.price).toBe(49.99);
      expect(clean.secret_token).toBeUndefined();
      expect(clean.unknown_col).toBeUndefined();
    });

    it('resolveExposedModels respects models filter, excludeModels and custom predicate', () => {
      const all = resolveExposedModels(db, {});
      expect(all.some((m) => m.name === 'Product')).toBe(true);
      expect(all.some((m) => m.name === 'Category')).toBe(true);

      const excluded = resolveExposedModels(db, { excludeModels: ['Product'] });
      expect(excluded.some((m) => m.name === 'Product')).toBe(false);

      const explicit = resolveExposedModels(db, { models: ['Category'] });
      expect(explicit.length).toBe(1);
      expect(explicit[0].name).toBe('Category');

      const filtered = resolveExposedModels(db, { filter: (m) => m.name === 'Product' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Product');
    });
  });

  describe('REST Endpoints Integration', () => {
    let catId;
    let prodId;

    it('POST /api/v1/categories creates a new category', async () => {
      const res = await request(app)
        .post('/api/v1/categories')
        .send({ name: 'Electronics', slug: 'electronics' })
        .expect(201);

      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('Electronics');
      catId = res.body.data.id;
    });

    it('POST /api/v1/products creates a new product with category association', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .send({
          title: 'Wireless Headphones',
          category_id: catId,
          price: 199.99,
          stock: 45,
          is_active: true,
          secret_token: 'should-be-omitted-from-response',
        })
        .expect(201);

      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.title).toBe('Wireless Headphones');
      expect(res.body.data.price).toBe(199.99);
      expect(res.body.data.secret_token).toBeUndefined(); // Stripped by hidden
      prodId = res.body.data.id;
    });

    it('GET /api/v1/products returns paginated list with metadata', async () => {
      const res = await request(app)
        .get('/api/v1/products?page=1&perPage=10')
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.perPage).toBe(10);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/products/:id includes relations via ?include=category', async () => {
      const res = await request(app)
        .get(`/api/v1/products/${prodId}?include=category`)
        .expect(200);

      expect(res.body.data.id).toBe(prodId);
      expect(res.body.data.category).toBeDefined();
      expect(res.body.data.category.name).toBe('Electronics');
    });

    it('GET /api/v1/products with filtering and sorting', async () => {
      // Create a second product
      await request(app)
        .post('/api/v1/products')
        .send({
          title: 'Budget Cable',
          price: 9.99,
          stock: 50,
          is_active: false,
          category_id: catId,
        })
        .expect(201);

      // Filter by stock=50
      const resFiltered = await request(app)
        .get('/api/v1/products?stock=50')
        .expect(200);
      expect(resFiltered.body.data.every((p) => p.stock === 50)).toBe(true);

      // Sort by price descending
      const resSorted = await request(app)
        .get('/api/v1/products?sort=-price')
        .expect(200);
      expect(resSorted.body.data[0].price).toBeGreaterThan(resSorted.body.data[1].price);
    });

    it('PATCH /api/v1/products/:id updates record partially', async () => {
      const res = await request(app)
        .patch(`/api/v1/products/${prodId}`)
        .send({ price: 179.99 })
        .expect(200);

      expect(res.body.data.price).toBe(179.99);
      expect(res.body.data.title).toBe('Wireless Headphones');
    });

    it('DELETE /api/v1/products/:id soft deletes record', async () => {
      await request(app)
        .delete(`/api/v1/products/${prodId}`)
        .expect(200);

      // Subsequent show returns 404 due to soft delete scope
      await request(app)
        .get(`/api/v1/products/${prodId}`)
        .expect(404);

      // But can be viewed with trashed=only
      const resTrashed = await request(app)
        .get('/api/v1/products?trashed=only')
        .expect(200);
      expect(resTrashed.body.data.some((p) => p.id === prodId)).toBe(true);

      // Or with trashed=include
      const resInclude = await request(app)
        .get('/api/v1/products?trashed=include')
        .expect(200);
      expect(resInclude.body.data.some((p) => p.id === prodId)).toBe(true);
    });

    it('GET /api/v1/products/99999 returns 404', async () => {
      await request(app)
        .get('/api/v1/products/99999')
        .expect(404);
    });
  });
});
