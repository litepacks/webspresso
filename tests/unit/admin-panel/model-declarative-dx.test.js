/**
 * Unit & Integration tests for Declarative DX (ORM ↔ Admin Panel Mapping)
 * Tests listColumns, searchFields, displayField, readOnly, permissions, defaultSort, group, and badge formatters.
 */

const { createDatabase, defineModel, zdb, hasModel } = require('../../../core/orm');
const { createApp } = require('../../../index');
const supertest = require('supertest');
const adminPanelPlugin = require('../../../plugins/admin-panel');
const { registerModelMenuItems } = require('../../../plugins/admin-panel/modules/menu');

describe('Admin Panel Declarative Model DX (ORM ↔ Admin)', () => {
  let db;
  let app;
  let adminCookie;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    // 1. AuthorModel (Target for relations)
    if (!hasModel('AuthorDxTest')) {
      defineModel({
        name: 'AuthorDxTest',
        table: 'authors_dx_test',
        schema: zdb.schema({
          id: zdb.id(),
          full_name: zdb.string(),
          bio: zdb.text().optional(),
        }),
        admin: {
          enabled: true,
          displayField: 'full_name',
          group: 'Editorial',
        },
      });
    }

    // 2. ArticleModel (Full declarative setup: listColumns, searchFields, defaultSort, badge, group)
    if (!hasModel('ArticleDxTest')) {
      defineModel({
        name: 'ArticleDxTest',
        table: 'articles_dx_test',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string(),
          slug: zdb.string(),
          body: zdb.text(),
          status: zdb.string(),
          author_id: zdb.integer(),
          created_at: zdb.timestamp({ auto: 'create' }),
        }),
        relations: {
          author: {
            type: 'belongsTo',
            model: () => db.getModel('AuthorDxTest'),
            foreignKey: 'author_id',
          },
        },
        admin: {
          enabled: true,
          label: 'Articles',
          group: 'Editorial',
          displayField: 'title',
          listColumns: ['title', 'status', 'created_at'],
          searchFields: ['title', 'slug'], // Exclude body from search!
          defaultSort: { column: 'created_at', direction: 'desc' },
          columns: {
            status: {
              badge: {
                published: 'green',
                draft: 'amber',
                archived: 'gray',
              },
            },
          },
        },
      });
    }

    // 3. ReadOnlyModel (readOnly: true)
    if (!hasModel('AuditLogDxTest')) {
      defineModel({
        name: 'AuditLogDxTest',
        table: 'audit_logs_dx_test',
        schema: zdb.schema({
          id: zdb.id(),
          event: zdb.string(),
          details: zdb.string().optional(),
        }),
        admin: {
          enabled: true,
          readOnly: true,
          group: 'System',
        },
      });
    }

    // 4. GranularPermissionsModel (permissions: { create: false, edit: true, delete: false })
    if (!hasModel('ConfigDxTest')) {
      defineModel({
        name: 'ConfigDxTest',
        table: 'configs_dx_test',
        schema: zdb.schema({
          id: zdb.id(),
          key: zdb.string(),
          value: zdb.string(),
        }),
        admin: {
          enabled: true,
          permissions: {
            create: false,
            edit: true,
            delete: false,
          },
        },
      });
    }

    // 5. EditDisabledModel (permissions: { edit: false })
    if (!hasModel('ImmutableEventDxTest')) {
      defineModel({
        name: 'ImmutableEventDxTest',
        table: 'immutable_events_dx_test',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string(),
        }),
        admin: {
          enabled: true,
          permissions: {
            create: true,
            edit: false,
            delete: true,
          },
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

    await db.knex.schema.createTable('authors_dx_test', (table) => {
      table.increments('id').primary();
      table.string('full_name');
      table.text('bio');
    });

    await db.knex.schema.createTable('articles_dx_test', (table) => {
      table.increments('id').primary();
      table.string('title');
      table.string('slug');
      table.text('body');
      table.string('status');
      table.integer('author_id');
      table.timestamp('created_at');
    });

    await db.knex.schema.createTable('audit_logs_dx_test', (table) => {
      table.increments('id').primary();
      table.string('event');
      table.string('details');
    });

    await db.knex.schema.createTable('configs_dx_test', (table) => {
      table.increments('id').primary();
      table.string('key');
      table.string('value');
    });

    await db.knex.schema.createTable('immutable_events_dx_test', (table) => {
      table.increments('id').primary();
      table.string('name');
    });

    // Seed data
    const author = await db.getRepository('AuthorDxTest').create({
      full_name: 'Jane Doe',
      bio: 'Author bio here',
    });

    await db.getRepository('ArticleDxTest').create({
      title: 'First Post',
      slug: 'first-post',
      body: 'Contains specialkeyword hidden in body',
      status: 'published',
      author_id: author.id,
      created_at: '2026-01-01 10:00:00',
    });

    await db.getRepository('ArticleDxTest').create({
      title: 'Second Article with specialkeyword',
      slug: 'second-article',
      body: 'Regular body content',
      status: 'draft',
      author_id: author.id,
      created_at: '2026-02-01 10:00:00',
    });

    await db.getRepository('AuditLogDxTest').create({
      event: 'LOGIN',
      details: 'User logged in',
    });

    await db.getRepository('ConfigDxTest').create({
      key: 'SITE_TITLE',
      value: 'My Great Site',
    });

    await db.getRepository('ImmutableEventDxTest').create({
      name: 'INITIAL_BOOT',
    });

    const result = createApp({
      pagesDir: './tests/fixtures/empty-pages',
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

    // Admin Auth Setup
    const setupRes = await supertest(app)
      .post('/_admin/api/auth/setup')
      .send({
        email: 'dx_admin@example.com',
        password: 'password123',
        name: 'DX Admin',
      });

    if (setupRes.headers['set-cookie']) {
      adminCookie = setupRes.headers['set-cookie'];
    } else {
      const loginRes = await supertest(app)
        .post('/_admin/api/auth/login')
        .send({
          email: 'dx_admin@example.com',
          password: 'password123',
        });
      adminCookie = loginRes.headers['set-cookie'];
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  describe('Model Definition & Metadata Normalization', () => {
    it('normalizes declarative admin options on model definition', () => {
      const articleModel = db.getModel('ArticleDxTest');
      expect(articleModel.admin.listColumns).toEqual(['title', 'status', 'created_at']);
      expect(articleModel.admin.searchFields).toEqual(['title', 'slug']);
      expect(articleModel.admin.displayField).toBe('title');
      expect(articleModel.admin.defaultSort).toEqual({ column: 'created_at', direction: 'desc' });
      expect(articleModel.admin.group).toBe('Editorial');
      expect(articleModel.admin.permissions).toEqual({ create: true, edit: true, delete: true });
      expect(articleModel.admin.readOnly).toBe(false);

      const auditModel = db.getModel('AuditLogDxTest');
      expect(auditModel.admin.readOnly).toBe(true);
      expect(auditModel.admin.group).toBe('System');

      const configModel = db.getModel('ConfigDxTest');
      expect(configModel.admin.permissions).toEqual({ create: false, edit: true, delete: false });
    });
  });

  describe('API /models endpoint', () => {
    it('returns group, readOnly, permissions, displayField and defaultSort in model listing', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models')
        .set('Cookie', adminCookie)
        .expect(200);

      const models = res.body.models || res.body;
      const article = models.find((m) => m.name === 'ArticleDxTest');
      expect(article).toBeDefined();
      expect(article.group).toBe('Editorial');
      expect(article.displayField).toBe('title');
      expect(article.readOnly).toBe(false);
      expect(article.permissions).toEqual({ create: true, edit: true, delete: true });
      expect(article.defaultSort).toEqual({ column: 'created_at', direction: 'desc' });

      const audit = models.find((m) => m.name === 'AuditLogDxTest');
      expect(audit).toBeDefined();
      expect(audit.group).toBe('System');
      expect(audit.readOnly).toBe(true);
    });
  });

  describe('API /models/:model endpoint', () => {
    it('returns declarative metadata and column badge config', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models/ArticleDxTest')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.listColumns).toEqual(['title', 'status', 'created_at']);
      expect(res.body.searchFields).toEqual(['title', 'slug']);
      expect(res.body.displayField).toBe('title');
      expect(res.body.defaultSort).toEqual({ column: 'created_at', direction: 'desc' });
      expect(res.body.group).toBe('Editorial');

      // Check status column has badge configuration
      const statusCol = res.body.columns.find((c) => c.name === 'status');
      expect(statusCol).toBeDefined();
      expect(statusCol.badge).toEqual({
        published: 'green',
        draft: 'amber',
        archived: 'gray',
      });
    });
  });

  describe('Targeted Search via searchFields', () => {
    it('searches ONLY in specified searchFields and ignores non-search fields', async () => {
      // 'specialkeyword' is present in Article 1's 'body' and Article 2's 'title'.
      // Since searchFields is ['title', 'slug'], Article 1 (where it is only in 'body') must NOT be matched!
      const res = await supertest(app)
        .get('/_admin/api/models/ArticleDxTest/records?search=specialkeyword')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].title).toBe('Second Article with specialkeyword');
    });
  });

  describe('Default Sort via defaultSort', () => {
    it('sorts records using defaultSort when no sort query parameter is provided', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models/ArticleDxTest/records')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data.length).toBe(2);
      // Article 2 was created on 2026-02-01, Article 1 on 2026-01-01.
      // Descending order puts Article 2 first.
      expect(res.body.data[0].title).toBe('Second Article with specialkeyword');
      expect(res.body.data[1].title).toBe('First Post');
    });

    it('allows query parameters to override defaultSort', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models/ArticleDxTest/records?sort=created_at&direction=asc')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].title).toBe('First Post');
      expect(res.body.data[1].title).toBe('Second Article with specialkeyword');
    });
  });

  describe('Read-Only Model Protection', () => {
    it('blocks record creation on read-only models with 403 Forbidden', async () => {
      const res = await supertest(app)
        .post('/_admin/api/models/AuditLogDxTest/records')
        .set('Cookie', adminCookie)
        .send({ event: 'ATTEMPT_CREATE', details: 'Forbidden' })
        .expect(403);

      expect(res.body.error).toContain('is read-only');
    });

    it('blocks record update on read-only models with 403 Forbidden', async () => {
      const res = await supertest(app)
        .put('/_admin/api/models/AuditLogDxTest/records/1')
        .set('Cookie', adminCookie)
        .send({ event: 'ATTEMPT_UPDATE' })
        .expect(403);

      expect(res.body.error).toContain('is read-only');
    });

    it('blocks record deletion on read-only models with 403 Forbidden', async () => {
      const res = await supertest(app)
        .delete('/_admin/api/models/AuditLogDxTest/records/1')
        .set('Cookie', adminCookie)
        .expect(403);

      expect(res.body.error).toContain('is read-only');
    });
  });

  describe('Granular Permissions Protection', () => {
    it('blocks creation when permissions.create is false', async () => {
      const res = await supertest(app)
        .post('/_admin/api/models/ConfigDxTest/records')
        .set('Cookie', adminCookie)
        .send({ key: 'NEW_KEY', value: 'Val' })
        .expect(403);

      expect(res.body.error).toContain('Creation is disabled');
    });

    it('allows update when permissions.edit is true', async () => {
      const res = await supertest(app)
        .put('/_admin/api/models/ConfigDxTest/records/1')
        .set('Cookie', adminCookie)
        .send({ value: 'Updated Site Title' })
        .expect(200);

      expect(res.body.data.value).toBe('Updated Site Title');
    });

    it('blocks deletion when permissions.delete is false', async () => {
      const res = await supertest(app)
        .delete('/_admin/api/models/ConfigDxTest/records/1')
        .set('Cookie', adminCookie)
        .expect(403);

      expect(res.body.error).toContain('Deletion is disabled');
    });

    it('blocks editing when permissions.edit is false', async () => {
      const res = await supertest(app)
        .put('/_admin/api/models/ImmutableEventDxTest/records/1')
        .set('Cookie', adminCookie)
        .send({ name: 'TAMPERED_NAME' })
        .expect(403);

      expect(res.body.error).toContain('Editing is disabled');
    });
  });

  describe('Relation displayField and primaryKey', () => {
    it('returns target displayField and primaryKey from relation endpoint', async () => {
      const res = await supertest(app)
        .get('/_admin/api/models/ArticleDxTest/relations/author')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.displayField).toBe('full_name');
      expect(res.body.primaryKey).toBe('id');
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].full_name).toBe('Jane Doe');
    });
  });

  describe('Menu Auto-Grouping', () => {
    it('registers group menu item when model defines admin.group', () => {
      const registeredGroups = [];
      const registeredItems = [];
      const mockAdminApi = {
        registerMenuGroup: (id, config) => {
          registeredGroups.push({ id, ...config });
        },
        registerMenuItem: (item) => {
          registeredItems.push(item);
        },
        menuGroups: new Map(),
      };

      const models = [
        { name: 'ArticleDxTest', label: 'Articles', admin: { enabled: true, group: 'Editorial' } },
        { name: 'AuthorDxTest', label: 'Authors', admin: { enabled: true, group: 'Editorial' } },
        { name: 'AuditLogDxTest', label: 'Audit Logs', admin: { enabled: true, group: 'System' } },
        { name: 'OrphanModel', label: 'Orphans', admin: { enabled: false } },
      ];

      registerModelMenuItems({ registry: mockAdminApi, models });

      // Check group items exist
      const editorialGroup = registeredGroups.find((g) => g.id === 'editorial');
      expect(editorialGroup).toBeDefined();
      expect(editorialGroup.label).toBe('Editorial');

      const systemGroup = registeredGroups.find((g) => g.id === 'system');
      expect(systemGroup).toBeDefined();
      expect(systemGroup.label).toBe('System');

      // Check model items have their assigned group
      const articleItem = registeredItems.find((i) => i.id === 'model-ArticleDxTest' || i.id === 'model-articledxtest');
      expect(articleItem).toBeDefined();
      expect(articleItem.id).toBe('model-ArticleDxTest');
      expect(articleItem.group).toBe('editorial');

      const authorItem = registeredItems.find((i) => i.id === 'model-AuthorDxTest' || i.id === 'model-authordxtest');
      expect(authorItem).toBeDefined();
      expect(authorItem.id).toBe('model-AuthorDxTest');
      expect(authorItem.group).toBe('editorial');

      const auditItem = registeredItems.find((i) => i.id === 'model-AuditLogDxTest' || i.id === 'model-auditlogdxtest');
      expect(auditItem).toBeDefined();
      expect(auditItem.id).toBe('model-AuditLogDxTest');
      expect(auditItem.group).toBe('system');

      const orphanItem = registeredItems.find((i) => i.id === 'model-OrphanModel' || i.id === 'model-orphanmodel');
      expect(orphanItem).toBeUndefined();
    });
  });

  describe('Client-Side SPA Helpers', () => {
    const vm = require('vm');
    const fs = require('fs');
    const path = require('path');

    let clientHelpers;

    beforeAll(() => {
      const part07 = fs.readFileSync(
        path.join(__dirname, '../../../plugins/admin-panel/client/parts/07-model-list.js'),
        'utf8'
      );
      const sandbox = {
        m: (tag, attrs, children) => ({ tag, attrs, children }),
        window: {},
        console,
        state: {},
      };
      vm.createContext(sandbox);
      vm.runInContext(
        part07 +
          '; this.getDisplayColumns = getDisplayColumns; this.formatCellValue = formatCellValue;',
        sandbox
      );
      clientHelpers = sandbox;
    });

    it('getDisplayColumns prioritizes modelMeta.listColumns in exact order', () => {
      const columns = [
        { name: 'id', type: 'integer' },
        { name: 'title', type: 'string' },
        { name: 'body', type: 'text' },
        { name: 'status', type: 'string' },
        { name: 'created_at', type: 'datetime' },
      ];

      const modelMeta = {
        listColumns: ['status', 'title'],
      };

      const displayCols = clientHelpers.getDisplayColumns(columns, modelMeta);
      expect(displayCols.map((c) => c.name)).toEqual(['status', 'title']);
    });

    it('formatCellValue renders badge HTML for mapped enum/status values', () => {
      const col = {
        name: 'status',
        type: 'string',
        badge: {
          published: 'green',
          draft: 'amber',
          archived: 'gray',
        },
      };

      const vnodePublished = clientHelpers.formatCellValue('published', col);
      expect(vnodePublished.tag).toContain('span');
      expect(vnodePublished.tag).toContain('bg-green-100');
      expect(vnodePublished.attrs).toBe('published');

      const vnodeDraft = clientHelpers.formatCellValue('draft', col);
      expect(vnodeDraft.tag).toContain('span');
      expect(vnodeDraft.tag).toContain('bg-amber-100');
      expect(vnodeDraft.attrs).toBe('draft');
    });
  });
});
