/**
 * Unit & Integration tests for Custom Actions & Bulk Actions UI integration
 * Verifies model-level declarative actions, auto-registration into registry,
 * API endpoint serialization, execution endpoints, and client-side helper functions.
 */

const { createDatabase, defineModel, zdb, hasModel } = require('../../../core/orm');
const { createApp } = require('../../../index');
const supertest = require('supertest');
const adminPanelPlugin = require('../../../plugins/admin-panel');
const { AdminRegistry } = require('../../../plugins/admin-panel/core/registry');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

describe('Admin Panel Custom Actions & Bulk Actions UI Integration', () => {
  let db;
  let app;
  let request;
  let adminCookie;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    if (!hasModel('ActionTestPost')) {
      defineModel({
        name: 'ActionTestPost',
        table: 'action_test_posts',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string(),
          status: zdb.string().default('draft'),
          views: zdb.integer().default(0),
        }),
        admin: {
          enabled: true,
          label: 'Action Posts',
          actions: [
            {
              id: 'publish',
              label: 'Publish Post',
              icon: 'check',
              color: 'green',
              confirm: true,
              confirmMessage: 'Are you sure you want to publish this post?',
              showWhen: { status: 'draft' },
              handler: async (record, { db: d }) => {
                const repo = d.getRepository('ActionTestPost');
                await repo.update(record.id, { status: 'published' });
                return { success: true, message: 'Post published successfully' };
              },
            },
            {
              id: 'archive',
              label: 'Archive Post',
              icon: 'archive',
              color: 'amber',
              showWhen: { status: 'published' },
              handler: async (record, { db: d }) => {
                const repo = d.getRepository('ActionTestPost');
                await repo.update(record.id, { status: 'archived' });
                return { success: true, message: 'Post archived' };
              },
            },
          ],
          bulkActions: [
            {
              id: 'bulk-publish',
              label: 'Publish Selected',
              icon: 'check',
              color: 'green',
              confirm: true,
              confirmMessage: 'Publish all selected posts?',
              handler: async (records, modelName, { db: d }) => {
                const repo = d.getRepository('ActionTestPost');
                for (const rec of records) {
                  await repo.update(rec.id, { status: 'published' });
                }
                return { success: true, message: `Published ${records.length} posts` };
              },
            },
          ],
        },
      });
    }

    // Database tables setup
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

    await db.knex.schema.createTable('action_test_posts', (table) => {
      table.increments('id').primary();
      table.string('title');
      table.string('status').defaultTo('draft');
      table.integer('views').defaultTo(0);
    });

    // Seed test data
    await db.knex('action_test_posts').insert([
      { id: 1, title: 'Draft Post 1', status: 'draft', views: 10 },
      { id: 2, title: 'Draft Post 2', status: 'draft', views: 20 },
      { id: 3, title: 'Published Post 3', status: 'published', views: 50 },
    ]);

    // Create app with admin panel
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
        adminPanelPlugin({
          path: '/_admin',
          db,
          auth: { enabled: true },
        }),
      ],
    });

    app = result.app;
    request = supertest(app);

    await db.knex('admin_users').insert({
      email: 'admin@action-test.com',
      password: '$2b$04$N/d4yPWhY79UBNMVL9BHluQkbufRToZLdzI3VWmz0Aa3Fr9mvMcK2',
      name: 'Action Admin',
      role: 'admin',
      active: true,
    });

    const loginRes = await request
      .post('/_admin/api/auth/login')
      .send({
        email: 'admin@action-test.com',
        password: 'Password123!',
      })
      .expect(200);

    adminCookie = loginRes.headers['set-cookie'];
  });

  describe('Model Actions Declarative Definition & Normalization', () => {
    it('normalizes admin.actions and admin.bulkActions on model', () => {
      const model = db.getModel('ActionTestPost');
      expect(Array.isArray(model.admin.actions)).toBe(true);
      expect(model.admin.actions.length).toBe(2);
      expect(model.admin.actions[0].id).toBe('publish');
      expect(model.admin.actions[0].color).toBe('green');
      expect(model.admin.actions[0].confirm).toBe(true);
      expect(model.admin.actions[0].showWhen).toEqual({ status: 'draft' });

      expect(Array.isArray(model.admin.bulkActions)).toBe(true);
      expect(model.admin.bulkActions.length).toBe(1);
      expect(model.admin.bulkActions[0].id).toBe('bulk-publish');
    });
  });

  describe('GET /_admin/api/models/:model Metadata with Actions', () => {
    it('returns actions and bulkActions in model metadata without exposing raw handler function', async () => {
      const res = await request
        .get('/_admin/api/models/ActionTestPost')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.actions).toBeDefined();
      expect(Array.isArray(res.body.actions)).toBe(true);
      expect(res.body.actions.some((a) => a.id === 'publish')).toBe(true);

      const pubAction = res.body.actions.find((a) => a.id === 'publish');
      expect(pubAction.label).toBe('Publish Post');
      expect(pubAction.icon).toBe('check');
      expect(pubAction.color).toBe('green');
      expect(pubAction.confirm).toBe(true);
      expect(pubAction.confirmMessage).toBe('Are you sure you want to publish this post?');
      expect(pubAction.showWhen).toEqual({ status: 'draft' });
      // Handler function should not be in JSON
      expect(pubAction.handler).toBeUndefined();

      expect(res.body.bulkActions).toBeDefined();
      expect(Array.isArray(res.body.bulkActions)).toBe(true);
      expect(res.body.bulkActions.some((b) => b.id === 'bulk-publish')).toBe(true);
      const bulkPubAction = res.body.bulkActions.find((b) => b.id === 'bulk-publish');
      expect(bulkPubAction.label).toBe('Publish Selected');
      expect(bulkPubAction.handler).toBeUndefined();
    });
  });

  describe('Record Action Execution (API & Alias)', () => {
    it('executes single record action via /extensions/actions/:actionId/:model/:id', async () => {
      const res = await request
        .post('/_admin/api/extensions/actions/publish/ActionTestPost/1')
        .set('Cookie', adminCookie)
        .send({})
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.result?.message).toBe('Post published successfully');

      // Verify DB was updated
      const updated = await db.getRepository('ActionTestPost').findById(1);
      expect(updated.status).toBe('published');
    });

    it('executes single record action via alias /actions/:actionId/:model/:id', async () => {
      const res = await request
        .post('/_admin/api/actions/archive/ActionTestPost/1')
        .set('Cookie', adminCookie)
        .send({})
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.result?.message).toBe('Post archived');

      // Verify DB was updated
      const updated = await db.getRepository('ActionTestPost').findById(1);
      expect(updated.status).toBe('archived');
    });

    it('returns 404 for nonexistent action', async () => {
      await request
        .post('/_admin/api/extensions/actions/nonexistent/ActionTestPost/1')
        .set('Cookie', adminCookie)
        .send({})
        .expect(404);
    });

    it('returns 404 for nonexistent record', async () => {
      await request
        .post('/_admin/api/extensions/actions/publish/ActionTestPost/9999')
        .set('Cookie', adminCookie)
        .send({})
        .expect(404);
    });
  });

  describe('Bulk Action Execution (API & Alias)', () => {
    it('executes bulk action via /extensions/bulk-actions/:actionId/:model', async () => {
      const res = await request
        .post('/_admin/api/extensions/bulk-actions/bulk-publish/ActionTestPost')
        .set('Cookie', adminCookie)
        .send({ ids: [2] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.result?.message).toBe('Published 1 posts');

      const updated = await db.getRepository('ActionTestPost').findById(2);
      expect(updated.status).toBe('published');
    });

    it('executes bulk action via alias /bulk-actions/:actionId/:model', async () => {
      const res = await request
        .post('/_admin/api/bulk-actions/bulk-publish/ActionTestPost')
        .set('Cookie', adminCookie)
        .send({ ids: [1, 2] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.result?.message).toBe('Published 2 posts');
    });

    it('returns 404 for nonexistent bulk action', async () => {
      await request
        .post('/_admin/api/bulk-actions/nonexistent/ActionTestPost')
        .set('Cookie', adminCookie)
        .send({ ids: [1] })
        .expect(404);
    });
  });

  describe('Client SPA Action Helpers Logic', () => {
    let clientContext;

    beforeAll(() => {
      // Create a mock DOM / browser environment sandbox for evaluating 08-record-list.js helpers
      const mockMithril = (...args) => ({ tag: args[0], attrs: args[1], children: args[2] });
      mockMithril.trust = (html) => ({ __trusted: html });
      mockMithril.route = { param: () => 'ActionTestPost', set: vi.fn() };

      clientContext = {
        m: mockMithril,
        window: {
          __ADMIN_CONFIG__: {
            actions: [
              { id: 'global-act', label: 'Global Action', models: '*' },
              { id: 'other-act', label: 'Other Model Action', models: ['OtherModel'] },
            ],
            bulkActions: [
              { id: 'bulk-delete', label: 'Delete' },
              { id: 'global-bulk', label: 'Global Bulk', color: 'indigo', models: '*' },
            ],
          },
        },
        state: { actionInProgress: null, pagination: { page: 1, total: 10 }, selectedRecords: new Set() },
      };

      const fileContent = fs.readFileSync(
        path.join(__dirname, '../../../plugins/admin-panel/client/parts/08-record-list.js'),
        'utf8',
      );

      // Extract the top helper functions from 08-record-list.js
      vm.createContext(clientContext);
      // Run the script in the context
      vm.runInContext(fileContent, clientContext);
    });

    it('getModelActions extracts actions from config and modelMeta', () => {
      const modelMeta = {
        actions: [
          { id: 'publish', label: 'Publish', color: 'green' },
          { id: 'global-act', label: 'Overridden Global', color: 'blue' },
        ],
      };
      const actions = clientContext.getModelActions('ActionTestPost', modelMeta);
      expect(actions.length).toBe(2);
      expect(actions.find((a) => a.id === 'publish')).toBeDefined();
      expect(actions.find((a) => a.id === 'global-act')?.label).toBe('Overridden Global');
    });

    it('getModelBulkActions filters out default delete/restore and includes custom bulk actions', () => {
      const modelMeta = {
        bulkActions: [{ id: 'bulk-publish', label: 'Publish All', color: 'green' }],
      };
      const bulkActions = clientContext.getModelBulkActions('ActionTestPost', modelMeta);
      expect(bulkActions.some((b) => b.id === 'bulk-delete')).toBe(false);
      expect(bulkActions.some((b) => b.id === 'global-bulk')).toBe(true);
      expect(bulkActions.some((b) => b.id === 'bulk-publish')).toBe(true);
    });

    it('shouldShowAction properly evaluates object conditions', () => {
      const action = { id: 'test', showWhen: { status: 'draft', views: 10 } };
      expect(clientContext.shouldShowAction(action, { status: 'draft', views: 10 })).toBe(true);
      expect(clientContext.shouldShowAction(action, { status: 'published', views: 10 })).toBe(false);
      expect(clientContext.shouldShowAction(action, { status: 'draft', views: 50 })).toBe(false);
    });

    it('shouldShowAction properly evaluates function conditions', () => {
      const action = { id: 'test', showWhen: (r) => r.views > 25 };
      expect(clientContext.shouldShowAction(action, { views: 30 })).toBe(true);
      expect(clientContext.shouldShowAction(action, { views: 10 })).toBe(false);
    });

    it('shouldShowAction returns true when showWhen is not set', () => {
      expect(clientContext.shouldShowAction({ id: 'no-condition' }, { status: 'any' })).toBe(true);
      expect(clientContext.shouldShowAction(null, { status: 'any' })).toBe(true);
    });

    it('getActionColorClass maps known colors correctly', () => {
      expect(clientContext.getActionColorClass('green')).toContain('text-green-600');
      expect(clientContext.getActionColorClass('red')).toContain('text-red-600');
      expect(clientContext.getActionColorClass('indigo')).toContain('text-indigo-600');
      expect(clientContext.getActionColorClass('blue')).toContain('text-indigo-600');
      expect(clientContext.getActionColorClass('amber')).toContain('text-amber-600');
      expect(clientContext.getActionColorClass('purple')).toContain('text-purple-600');
      expect(clientContext.getActionColorClass('unknown')).toContain('text-gray-600');
    });

    it('getBulkActionColorClass maps known colors correctly', () => {
      expect(clientContext.getBulkActionColorClass('green')).toContain('text-green-600');
      expect(clientContext.getBulkActionColorClass('red')).toContain('text-red-600');
      expect(clientContext.getBulkActionColorClass('indigo')).toContain('text-indigo-600');
      expect(clientContext.getBulkActionColorClass('amber')).toContain('text-amber-600');
      expect(clientContext.getBulkActionColorClass('unknown')).toContain('text-gray-700');
    });

    it('renderActionIcon handles SVG string and preset icon names', () => {
      const trusted = clientContext.renderActionIcon('<svg><path/></svg>');
      expect(trusted.__trusted).toBe('<svg><path/></svg>');

      const checkIcon = clientContext.renderActionIcon('check');
      expect(checkIcon).toBeDefined();

      const textFallback = clientContext.renderActionIcon('Custom');
      expect(textFallback).toBeDefined();
    });
  });
});
