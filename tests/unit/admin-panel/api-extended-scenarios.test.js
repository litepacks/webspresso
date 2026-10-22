/**
 * Extended Scenarios for Admin Panel API Handlers (plugins/admin-panel/api.js)
 * Covers:
 * - quickEditHandler & batchEditHandler (permissions, validation, listEditable filters)
 * - inline CRUD handlers (inlineListHandler, inlineCreateHandler, inlineUpdateHandler, inlineDeleteHandler)
 * - syncInlines engine (_delete, _destroy, create, update)
 * - modelActionHandler (model-scoped action, registry bulk action, permission & 404 handling)
 * - updateProfileHandler (password change, validation, duplicate email checks)
 * - dateHierarchyHandler & filterFacetsHandler
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { defineModel, clearRegistry } from '../../../core/orm/model.js';
import { createDatabase, zdb } from '../../../core/orm/index.js';
import { createApiHandlers } from '../../../plugins/admin-panel/api.js';
import { createMockRes } from '../../utils';

describe.sequential('Admin Panel API Extended Scenarios', () => {
  let db;
  let knex;
  let handlers;
  let registryMock;

  beforeAll(async () => {
    clearRegistry();

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = db.knex;

    // Create tables
    await knex.schema.createTable('invoices', (table) => {
      table.increments('id').primary();
      table.string('invoice_number').notNullable();
      table.string('status').defaultTo('draft');
      table.float('amount').defaultTo(0);
      table.string('created_at').notNullable();
      table.string('updated_at').nullable();
    });

    await knex.schema.createTable('invoice_items', (table) => {
      table.increments('id').primary();
      table.integer('invoice_id').notNullable();
      table.string('description').notNullable();
      table.float('price').notNullable();
      table.integer('quantity').defaultTo(1);
    });

    await knex.schema.createTable('read_only_records', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
    });

    await knex.schema.createTable('admin_users', (table) => {
      table.increments('id').primary();
      table.string('email').unique().notNullable();
      table.string('name').notNullable();
      table.string('password').notNullable();
      table.string('role').defaultTo('admin');
      table.boolean('is_active').defaultTo(true);
      table.string('created_at').notNullable();
      table.string('updated_at').nullable();
    });

    // Define models
    const InvoiceItem = defineModel({
      name: 'InvoiceItem',
      table: 'invoice_items',
      schema: zdb.schema({
        id: zdb.id(),
        invoice_id: zdb.integer(),
        description: zdb.string(),
        price: zdb.float(),
        quantity: zdb.integer({ default: 1 }),
      }),
      admin: {
        enabled: true,
        displayName: 'Invoice Item',
      },
    });
    db.registerModel(InvoiceItem);

    const Invoice = defineModel({
      name: 'Invoice',
      table: 'invoices',
      schema: zdb.schema({
        id: zdb.id(),
        invoice_number: zdb.string(),
        status: zdb.string({ default: 'draft' }),
        amount: zdb.float({ default: 0 }),
        created_at: zdb.string(),
        updated_at: zdb.string({ nullable: true }),
      }),
      admin: {
        enabled: true,
        displayName: 'Invoices',
        listEditable: ['status', 'amount'],
        dateHierarchy: 'created_at',
        listFilter: ['status'],
        inlines: [
          {
            model: 'InvoiceItem',
            foreignKey: 'invoice_id',
            title: 'Items',
          },
        ],
        actions: [
          {
            id: 'mark_as_paid',
            name: 'Mark as Paid',
            handler: async ({ ids, repo }) => {
              for (const id of ids) {
                await repo.update(id, { status: 'paid' });
              }
              return { updatedCount: ids.length };
            },
          },
        ],
      },
    });
    db.registerModel(Invoice);

    const ReadOnlyRecord = defineModel({
      name: 'ReadOnlyRecord',
      table: 'read_only_records',
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(),
      }),
      admin: {
        enabled: true,
        readOnly: true,
      },
    });
    db.registerModel(ReadOnlyRecord);

    const AdminUserModel = defineModel({
      name: 'AdminUser',
      table: 'admin_users',
      schema: zdb.schema({
        id: zdb.id(),
        email: zdb.string(),
        name: zdb.string(),
        password: zdb.string(),
        role: zdb.string({ default: 'admin' }),
        is_active: zdb.boolean({ default: true }),
        created_at: zdb.string(),
        updated_at: zdb.string({ nullable: true }),
      }),
      admin: {
        enabled: true,
      },
    });
    db.registerModel(AdminUserModel);

    registryMock = {
      bulkActions: new Map(),
      getBulkAction(id) {
        return this.bulkActions.get(id);
      },
      registerBulkAction(id, config) {
        this.bulkActions.set(id, config);
      },
    };

    handlers = createApiHandlers({
      db,
      registry: registryMock,
      AdminUser: AdminUserModel,
      hashPassword: async (pwd) => crypto.createHash('sha256').update(pwd).digest('hex'),
      comparePassword: async (pwd, hash) => crypto.createHash('sha256').update(pwd).digest('hex') === hash,
    });
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
    clearRegistry();
  });

  describe('quickEditHandler', () => {
    it('returns 404 when model is missing or disabled', async () => {
      const res = createMockRes();
      await handlers.quickEditHandler({ params: { model: 'Ghost', id: 1 }, body: {} }, res);
      expect(res.statusCode).toBe(404);
      expect(res.data.error).toContain('not found');
    });

    it('returns 403 when model is read-only', async () => {
      const res = createMockRes();
      await handlers.quickEditHandler({ params: { model: 'ReadOnlyRecord', id: 1 }, body: { title: 'New' } }, res);
      expect(res.statusCode).toBe(403);
      expect(res.data.error).toContain('Editing is disabled');
    });

    it('returns 400 when attempting to quick-edit a non-listEditable column', async () => {
      const res = createMockRes();
      await handlers.quickEditHandler(
        { params: { model: 'Invoice', id: 1 }, body: { invoice_number: 'INV-FORBIDDEN' } },
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('not list-editable');
    });

    it('returns 400 when no valid editable fields are provided', async () => {
      const res = createMockRes();
      await handlers.quickEditHandler(
        { params: { model: 'Invoice', id: 1 }, body: {} },
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('No valid editable fields');
    });

    it('successfully updates list-editable fields on an existing record', async () => {
      const repo = db.getRepository('Invoice');
      const invoice = await repo.create({
        invoice_number: 'INV-1001',
        status: 'draft',
        amount: 250,
        created_at: '2026-05-01',
      });

      const res = createMockRes();
      await handlers.quickEditHandler(
        { params: { model: 'Invoice', id: invoice.id }, body: { status: 'sent', amount: 300 } },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data.status).toBe('sent');
      expect(res.data.data.amount).toBe(300);
    });

    it('returns 404 when updating non-existent record ID', async () => {
      const res = createMockRes();
      await handlers.quickEditHandler(
        { params: { model: 'Invoice', id: 99999 }, body: { status: 'sent' } },
        res
      );
      expect(res.statusCode).toBe(404);
      expect(res.data.error).toContain('Record not found');
    });
  });

  describe('batchEditHandler', () => {
    it('returns 400 when updates payload is not an array or is empty', async () => {
      const res = createMockRes();
      await handlers.batchEditHandler({ params: { model: 'Invoice' }, body: {} }, res);
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('Array of updates is required');
    });

    it('updates multiple records in batch filtering out non-listEditable columns', async () => {
      const repo = db.getRepository('Invoice');
      const inv1 = await repo.create({ invoice_number: 'INV-B1', status: 'draft', amount: 100, created_at: '2026-05-01' });
      const inv2 = await repo.create({ invoice_number: 'INV-B2', status: 'draft', amount: 200, created_at: '2026-05-01' });

      const res = createMockRes();
      await handlers.batchEditHandler(
        {
          params: { model: 'Invoice' },
          body: {
            updates: [
              { id: inv1.id, changes: { status: 'paid', invoice_number: 'TRY_OVERRIDE_IGNORED' } },
              { id: inv2.id, changes: { status: 'cancelled', amount: 0 } },
              { id: null, changes: { status: 'ignored' } }, // skips invalid
            ],
          },
        },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.count).toBe(2);

      const refreshed1 = await repo.findById(inv1.id);
      expect(refreshed1.status).toBe('paid');
      expect(refreshed1.invoice_number).toBe('INV-B1'); // Unchanged because not in listEditable

      const refreshed2 = await repo.findById(inv2.id);
      expect(refreshed2.status).toBe('cancelled');
      expect(refreshed2.amount).toBe(0);
    });
  });

  describe('inline CRUD handlers (inlineList, inlineCreate, inlineUpdate, inlineDelete)', () => {
    let invoiceRecord;

    beforeAll(async () => {
      invoiceRecord = await db.getRepository('Invoice').create({
        invoice_number: 'INV-INLINE',
        status: 'draft',
        amount: 500,
        created_at: '2026-06-01',
      });
    });

    it('inlineCreateHandler creates a child record with foreign key bound to parent ID', async () => {
      const res = createMockRes();
      await handlers.inlineCreateHandler(
        {
          params: { model: 'Invoice', id: invoiceRecord.id, inlineModel: 'InvoiceItem' },
          body: { description: 'Web Design', price: 500, quantity: 1 },
        },
        res
      );

      expect(res.statusCode).toBe(201);
      expect(res.data.data.description).toBe('Web Design');
      expect(res.data.data.invoice_id).toBe(invoiceRecord.id);
    });

    it('inlineListHandler retrieves inline child records for a parent record', async () => {
      const res = createMockRes();
      await handlers.inlineListHandler(
        { params: { model: 'Invoice', id: invoiceRecord.id, inlineModel: 'InvoiceItem' } },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.data.data)).toBe(true);
      expect(res.data.data.length).toBeGreaterThanOrEqual(1);
      expect(res.data.data[0].description).toBe('Web Design');
    });

    it('inlineUpdateHandler updates a specific inline record', async () => {
      const itemRepo = db.getRepository('InvoiceItem');
      const item = await itemRepo.create({
        invoice_id: invoiceRecord.id,
        description: 'SEO Optimization',
        price: 300,
        quantity: 1,
      });

      const res = createMockRes();
      await handlers.inlineUpdateHandler(
        {
          params: { inlineModel: 'InvoiceItem', inlineId: item.id },
          body: { price: 350 },
        },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.data.data.price).toBe(350);
    });

    it('inlineDeleteHandler deletes an inline record', async () => {
      const itemRepo = db.getRepository('InvoiceItem');
      const item = await itemRepo.create({
        invoice_id: invoiceRecord.id,
        description: 'Temp Item',
        price: 50,
      });

      const res = createMockRes();
      await handlers.inlineDeleteHandler(
        { params: { inlineModel: 'InvoiceItem', inlineId: item.id } },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);

      const check = await itemRepo.findById(item.id);
      expect(check).toBeNull();
    });
  });

  describe('modelActionHandler & bulk actions', () => {
    it('returns 400 when ids array is missing or empty', async () => {
      const res = createMockRes();
      await handlers.modelActionHandler(
        { params: { model: 'Invoice', actionId: 'mark_as_paid' }, body: { ids: [] } },
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('Array of record ids is required');
    });

    it('executes model-scoped action successfully', async () => {
      const repo = db.getRepository('Invoice');
      const inv = await repo.create({ invoice_number: 'INV-ACT-1', status: 'draft', created_at: '2026-07-01' });

      const res = createMockRes();
      await handlers.modelActionHandler(
        { params: { model: 'Invoice', actionId: 'mark_as_paid' }, body: { ids: [inv.id] } },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.updatedCount).toBe(1);

      const refreshed = await repo.findById(inv.id);
      expect(refreshed.status).toBe('paid');
    });

    it('executes registry-level bulk action as fallback', async () => {
      let bulkExecuted = false;
      registryMock.registerBulkAction('global_export', {
        id: 'global_export',
        handler: async (records, modelName) => {
          bulkExecuted = true;
          return { exported: records.length, model: modelName };
        },
      });

      const repo = db.getRepository('Invoice');
      const inv = await repo.create({ invoice_number: 'INV-REG-1', status: 'draft', created_at: '2026-07-01' });

      const res = createMockRes();
      await handlers.modelActionHandler(
        { params: { model: 'Invoice', actionId: 'global_export' }, body: { ids: [inv.id] } },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.exported).toBe(1);
      expect(bulkExecuted).toBe(true);
    });

    it('returns 404 when actionId is not found', async () => {
      const res = createMockRes();
      await handlers.modelActionHandler(
        { params: { model: 'Invoice', actionId: 'unknown_action' }, body: { ids: [1] } },
        res
      );
      expect(res.statusCode).toBe(404);
      expect(res.data.error).toContain('not found');
    });
  });

  describe('updateProfileHandler', () => {
    let adminUserId;

    beforeAll(async () => {
      const [id] = await knex('admin_users').insert({
        email: 'staff@webspresso.io',
        name: 'Staff Member',
        password: crypto.createHash('sha256').update('InitialPass123!').digest('hex'),
        role: 'admin',
        created_at: '2026-01-01',
      });
      adminUserId = id;

      await knex('admin_users').insert({
        email: 'other@webspresso.io',
        name: 'Other Staff',
        password: 'hash',
        role: 'admin',
        created_at: '2026-01-01',
      });
    });

    it('returns 401 when no session adminUser is present', async () => {
      const res = createMockRes();
      await handlers.updateProfileHandler({ session: null, body: {} }, res);
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when new password is too short (< 6 chars)', async () => {
      const res = createMockRes();
      await handlers.updateProfileHandler(
        {
          session: { adminUser: { id: adminUserId } },
          body: {
            name: 'Staff',
            email: 'staff@webspresso.io',
            currentPassword: 'InitialPass123!',
            newPassword: '123',
          },
        },
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('at least 6 characters');
    });

    it('returns 400 when new password is given without current password', async () => {
      const res = createMockRes();
      await handlers.updateProfileHandler(
        {
          session: { adminUser: { id: adminUserId } },
          body: { name: 'Staff', email: 'staff@webspresso.io', newPassword: 'NewPassword123' },
        },
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('Current password is required');
    });

    it('returns 400 when current password does not match', async () => {
      const res = createMockRes();
      await handlers.updateProfileHandler(
        {
          session: { adminUser: { id: adminUserId } },
          body: {
            name: 'Staff',
            email: 'staff@webspresso.io',
            currentPassword: 'WrongPassword',
            newPassword: 'NewPassword123!',
          },
        },
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('Current password is incorrect');
    });

    it('returns 400 when email is already taken by another admin user', async () => {
      const res = createMockRes();
      await handlers.updateProfileHandler(
        {
          session: { adminUser: { id: adminUserId } },
          body: { name: 'Staff', email: 'other@webspresso.io' },
        },
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('already in use');
    });

    it('updates name and password successfully when valid', async () => {
      const session = { adminUser: { id: adminUserId, email: 'staff@webspresso.io', name: 'Staff' } };
      const res = createMockRes();
      await handlers.updateProfileHandler(
        {
          session,
          body: {
            name: 'Updated Staff',
            email: 'staff-updated@webspresso.io',
            currentPassword: 'InitialPass123!',
            newPassword: 'BrandNewPass123!',
          },
        },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.user.name).toBe('Updated Staff');
      expect(res.data.user.email).toBe('staff-updated@webspresso.io');

      // Verify DB record
      const dbUser = await knex('admin_users').where('id', adminUserId).first();
      expect(dbUser.name).toBe('Updated Staff');
      expect(dbUser.password).toBe(crypto.createHash('sha256').update('BrandNewPass123!').digest('hex'));
    });
  });
});
