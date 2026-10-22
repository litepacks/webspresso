/**
 * Admin Panel Django-inspired Features Unit Tests
 * - Inline Models (admin.inlines)
 * - List Editable (admin.listEditable & quick-edit / batch-edit)
 * - Date Hierarchy & Filter Facets (admin.dateHierarchy & admin.listFilter)
 * - Model Actions (admin.actions)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineModel, clearRegistry } from '../../core/orm/model.js';
import { createDatabase, zdb } from '../../core/orm/index.js';
import { createApiHandlers } from '../../plugins/admin-panel/api.js';
import { createMockRes } from '../utils/http.js';

describe('Admin Panel Django-inspired Features', () => {
  let db;
  let knex;
  let handlers;

  beforeAll(async () => {
    clearRegistry();

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = db.knex;

    // Create tables
    await knex.schema.createTable('orders', (table) => {
      table.increments('id').primary();
      table.string('customer_name').notNullable();
      table.string('status').defaultTo('pending');
      table.float('total').defaultTo(0);
      table.string('created_at').notNullable();
      table.string('updated_at').nullable();
    });

    await knex.schema.createTable('order_items', (table) => {
      table.increments('id').primary();
      table.integer('order_id').notNullable();
      table.string('product_name').notNullable();
      table.float('price').notNullable();
      table.integer('quantity').defaultTo(1);
    });

    // Define OrderItem model
    const OrderItem = defineModel({
      name: 'OrderItem',
      table: 'order_items',
      schema: zdb.schema({
        id: zdb.id(),
        order_id: zdb.integer({ nullable: true }),
        product_name: zdb.string(),
        price: zdb.float(),
        quantity: zdb.integer({ default: 1 }),
      }),
      admin: {
        enabled: true,
        label: 'Order Items',
      },
    });
    db.registerModel(OrderItem);

    // Define Order model with Django-inspired admin features
    const Order = defineModel({
      name: 'Order',
      table: 'orders',
      schema: zdb.schema({
        id: zdb.id(),
        customer_name: zdb.string(),
        status: zdb.string({ default: 'pending' }),
        total: zdb.float({ default: 0 }),
        created_at: zdb.string(),
        updated_at: zdb.string({ nullable: true }),
      }),
      admin: {
        enabled: true,
        label: 'Orders',
        inlines: [
          {
            model: 'OrderItem',
            foreignKey: 'order_id',
            fields: ['product_name', 'price', 'quantity'],
            title: 'Line Items',
          },
        ],
        listEditable: ['status', 'total'],
        dateHierarchy: 'created_at',
        listFilter: ['status'],
        actions: [
          {
            id: 'mark-completed',
            label: 'Mark as Completed',
            handler: async ({ ids, repo }) => {
              for (const id of ids) {
                await repo.update(id, { status: 'completed' });
              }
              return { updated: ids.length, status: 'completed' };
            },
          },
        ],
      },
    });
    db.registerModel(Order);

    handlers = createApiHandlers({
      path: '/_admin',
      db,
      richTextSanitize: false,
    });
  });

  afterAll(async () => {
    clearRegistry();
    if (knex) await knex.destroy();
  });

  describe('Model Metadata & Schema Preservation', () => {
    it('preserves inlines, listEditable, dateHierarchy, listFilter, and actions in defineModel and modelHandler', async () => {
      const res = createMockRes();
      await handlers.modelHandler({ params: { model: 'Order' } }, res);

      expect(res.statusCode).toBe(200);
      expect(res.data).toBeDefined();
      expect(res.data.name).toBe('Order');
      expect(res.data.inlines).toEqual([
        expect.objectContaining({
          model: 'OrderItem',
          foreignKey: 'order_id',
          title: 'Line Items',
        }),
      ]);
      expect(res.data.listEditable).toEqual(['status', 'total']);
      expect(res.data.dateHierarchy).toBe('created_at');
      expect(res.data.listFilter).toEqual(['status']);
      expect(res.data.actions).toEqual([
        expect.objectContaining({
          id: 'mark-completed',
          label: 'Mark as Completed',
        }),
      ]);
    });
  });

  describe('Inline Models (admin.inlines)', () => {
    let createdOrderId;

    it('creates parent record and child inlines in one transaction/operation', async () => {
      const res = createMockRes();
      const req = {
        params: { model: 'Order' },
        body: {
          customer_name: 'John Doe',
          status: 'pending',
          total: 100,
          created_at: '2026-03-15 10:00:00',
          _inlines: {
            OrderItem: [
              { product_name: 'Keyboard', price: 60, quantity: 1 },
              { product_name: 'Mouse', price: 40, quantity: 1 },
            ],
          },
        },
      };

      await handlers.createRecordHandler(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.data.data.id).toBeDefined();
      createdOrderId = res.data.data.id;

      // Verify child records in DB
      const items = await knex('order_items').where({ order_id: createdOrderId });
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.product_name)).toEqual(['Keyboard', 'Mouse']);
    });

    it('returns parent record with populated _inlines in recordHandler', async () => {
      const res = createMockRes();
      const req = {
        params: { model: 'Order', id: createdOrderId },
      };

      await handlers.recordHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.data.data.id).toBe(createdOrderId);
      expect(res.data.data._inlines).toBeDefined();
      expect(res.data.data._inlines.OrderItem).toHaveLength(2);
      expect(res.data.data._inlines.OrderItem[0].product_name).toBe('Keyboard');
    });

    it('syncs inlines on parent update (updates, additions, and deletions)', async () => {
      const itemsBefore = await knex('order_items').where({ order_id: createdOrderId });
      const [item1, item2] = itemsBefore;

      const res = createMockRes();
      const req = {
        params: { model: 'Order', id: createdOrderId },
        body: {
          total: 150,
          _inlines: {
            OrderItem: [
              // Update item1
              { id: item1.id, product_name: 'Mechanical Keyboard', price: 90, quantity: 1 },
              // Delete item2 with _delete: true
              { id: item2.id, _delete: true },
              // Add item3 (no id)
              { product_name: 'Mousepad', price: 20, quantity: 1 },
            ],
          },
        },
      };

      await handlers.updateRecordHandler(req, res);
      expect(res.statusCode).toBe(200);

      // Verify updated items in DB
      const itemsAfter = await knex('order_items').where({ order_id: createdOrderId });
      expect(itemsAfter).toHaveLength(2);

      const updatedItem1 = itemsAfter.find((i) => i.id === item1.id);
      expect(updatedItem1.product_name).toBe('Mechanical Keyboard');
      expect(updatedItem1.price).toBe(90);

      const deletedItem2 = itemsAfter.find((i) => i.id === item2.id);
      expect(deletedItem2).toBeUndefined();

      const newItem = itemsAfter.find((i) => i.product_name === 'Mousepad');
      expect(newItem).toBeDefined();
      expect(newItem.price).toBe(20);
    });

    it('supports dedicated inline CRUD endpoints', async () => {
      // 1. inlineListHandler
      const resList = createMockRes();
      await handlers.inlineListHandler(
        { params: { model: 'Order', id: createdOrderId, inlineModel: 'OrderItem' } },
        resList
      );
      expect(resList.statusCode).toBe(200);
      expect(resList.data.data).toHaveLength(2);

      // 2. inlineCreateHandler
      const resCreate = createMockRes();
      await handlers.inlineCreateHandler(
        {
          params: { model: 'Order', id: createdOrderId, inlineModel: 'OrderItem' },
          body: { product_name: 'USB Cable', price: 15, quantity: 2 },
        },
        resCreate
      );
      expect(resCreate.statusCode).toBe(201);
      expect(resCreate.data.data.product_name).toBe('USB Cable');
      const createdInlineId = resCreate.data.data.id;

      // 3. inlineUpdateHandler
      const resUpdate = createMockRes();
      await handlers.inlineUpdateHandler(
        {
          params: { model: 'Order', id: createdOrderId, inlineModel: 'OrderItem', inlineId: createdInlineId },
          body: { price: 12 },
        },
        resUpdate
      );
      expect(resUpdate.statusCode).toBe(200);
      expect(resUpdate.data.data.price).toBe(12);

      // 4. inlineDeleteHandler
      const resDelete = createMockRes();
      await handlers.inlineDeleteHandler(
        {
          params: { model: 'Order', id: createdOrderId, inlineModel: 'OrderItem', inlineId: createdInlineId },
        },
        resDelete
      );
      expect(resDelete.statusCode).toBe(200);
      expect(resDelete.data.success).toBe(true);

      const checkItem = await knex('order_items').where({ id: createdInlineId }).first();
      expect(checkItem).toBeUndefined();
    });
  });

  describe('List Editable (admin.listEditable)', () => {
    let orderId;

    beforeAll(async () => {
      const [id] = await knex('orders').insert({
        customer_name: 'Alice',
        status: 'pending',
        total: 50,
        created_at: '2026-03-10 12:00:00',
      });
      orderId = id;
    });

    it('quick-edits an allowed listEditable field successfully', async () => {
      const res = createMockRes();
      const req = {
        params: { model: 'Order', id: orderId },
        body: { status: 'shipped' },
      };

      await handlers.quickEditHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data.status).toBe('shipped');

      const row = await knex('orders').where({ id: orderId }).first();
      expect(row.status).toBe('shipped');
    });

    it('rejects editing a column not configured in listEditable', async () => {
      const res = createMockRes();
      const req = {
        params: { model: 'Order', id: orderId },
        body: { customer_name: 'Hacked Name' },
      };

      await handlers.quickEditHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('is not list-editable');

      const row = await knex('orders').where({ id: orderId }).first();
      expect(row.customer_name).toBe('Alice');
    });

    it('batch-edits multiple records with allowed editable fields', async () => {
      const [id2] = await knex('orders').insert({
        customer_name: 'Bob',
        status: 'pending',
        total: 75,
        created_at: '2026-03-12 14:00:00',
      });

      const res = createMockRes();
      const req = {
        params: { model: 'Order' },
        body: {
          updates: [
            { id: orderId, changes: { status: 'delivered', total: 60 } },
            { id: id2, changes: { status: 'processing', total: 80 } },
          ],
        },
      };

      await handlers.batchEditHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.count).toBe(2);

      const r1 = await knex('orders').where({ id: orderId }).first();
      expect(r1.status).toBe('delivered');
      expect(r1.total).toBe(60);

      const r2 = await knex('orders').where({ id: id2 }).first();
      expect(r2.status).toBe('processing');
      expect(r2.total).toBe(80);
    });
  });

  describe('Date Hierarchy & Filtering (admin.dateHierarchy)', () => {
    beforeAll(async () => {
      await knex('orders').truncate();
      await knex('orders').insert([
        { customer_name: 'Order 1', status: 'completed', total: 10, created_at: '2025-11-04 10:00:00' },
        { customer_name: 'Order 2', status: 'completed', total: 20, created_at: '2026-01-15 11:00:00' },
        { customer_name: 'Order 3', status: 'pending', total: 30, created_at: '2026-01-20 12:00:00' },
        { customer_name: 'Order 4', status: 'pending', total: 40, created_at: '2026-02-10 13:00:00' },
      ]);
    });

    it('aggregates years with counts at the top level', async () => {
      const res = createMockRes();
      await handlers.dateHierarchyHandler({ params: { model: 'Order' }, query: {} }, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.level).toBe('years');
      expect(res.data.items).toEqual([
        { year: 2026, count: 3 },
        { year: 2025, count: 1 },
      ]);
    });

    it('drilldown to months when year is provided', async () => {
      const res = createMockRes();
      await handlers.dateHierarchyHandler({ params: { model: 'Order' }, query: { year: '2026' } }, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.level).toBe('months');
      expect(res.data.year).toBe(2026);
      expect(res.data.items).toEqual([
        { month: 1, count: 2 },
        { month: 2, count: 1 },
      ]);
    });

    it('drilldown to days when year and month are provided', async () => {
      const res = createMockRes();
      await handlers.dateHierarchyHandler({ params: { model: 'Order' }, query: { year: '2026', month: '1' } }, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.level).toBe('days');
      expect(res.data.items).toEqual([
        { day: 15, count: 1 },
        { day: 20, count: 1 },
      ]);
    });

    it('recordsListHandler filters records using date hierarchy parameters', async () => {
      const res = createMockRes();
      await handlers.recordsListHandler({ params: { model: 'Order' }, query: { year: '2026', month: '1' } }, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.data.map((r) => r.customer_name).sort()).toEqual(['Order 2', 'Order 3']);
    });
  });

  describe('Filter Facets (admin.listFilter)', () => {
    it('returns value distribution and counts for configured listFilter columns', async () => {
      const res = createMockRes();
      await handlers.filterFacetsHandler({ params: { model: 'Order' }, query: {} }, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.facets).toBeDefined();
      expect(res.data.facets.status).toBeDefined();
      expect(res.data.facets.status).toEqual([
        { value: 'completed', count: 2 },
        { value: 'pending', count: 2 },
      ]);
    });
  });

  describe('Model Actions (admin.actions)', () => {
    it('executes a custom model action on specified records', async () => {
      const orders = await knex('orders').select('id', 'status');
      const pendingIds = orders.filter((o) => o.status === 'pending').map((o) => o.id);
      expect(pendingIds.length).toBeGreaterThan(0);

      const res = createMockRes();
      const req = {
        params: { model: 'Order', actionId: 'mark-completed' },
        body: { ids: pendingIds },
      };

      await handlers.modelActionHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.updated).toBe(pendingIds.length);
      expect(res.data.status).toBe('completed');

      // Verify records are now completed
      const updatedOrders = await knex('orders').whereIn('id', pendingIds);
      expect(updatedOrders.every((o) => o.status === 'completed')).toBe(true);
    });

    it('returns 404 for unknown action', async () => {
      const res = createMockRes();
      const req = {
        params: { model: 'Order', actionId: 'non-existent-action' },
        body: { ids: [1] },
      };

      await handlers.modelActionHandler(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.data.error).toContain('not found');
    });

    it('returns 400 when ids array is missing or empty', async () => {
      const res = createMockRes();
      const req = {
        params: { model: 'Order', actionId: 'mark-completed' },
        body: { ids: [] },
      };

      await handlers.modelActionHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('Array of record ids is required');
    });
  });
});
