/**
 * Unit & Integration tests for Relational Fields & Performance DX (BelongsTo Dropdown)
 * Tests:
 * 1. defineModel admin.relations configuration preservation
 * 2. GET /_admin/api/models/:model/schema includes relationsConfig
 * 3. GET /_admin/api/models/:model/relations/:relation with:
 *    - Structured response { data, displayField, primaryKey, pagination }
 *    - Column projection (only PK, displayField, searchFields selected)
 *    - Search query filtering (?search= and ?q=)
 *    - Pagination (?page=, ?limit=, ?all=true)
 *    - Selected ID inclusion (?selected=) when item is not on the current page
 * 4. Client-side auto-detection of foreign key columns (*_id or references) to belongsTo
 */

const { createDatabase, defineModel, zdb, hasModel, getModel } = require('../../../core/orm');
const { createApp } = require('../../../index');
const supertest = require('supertest');
const adminPanelPlugin = require('../../../plugins/admin-panel');
const fs = require('fs');
const path = require('path');

describe('Admin Panel Relational Fields & Performance DX', { timeout: 120000 }, () => {
  let db;
  let app;
  let adminCookie;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    // 1. Author Model (Related model)
    if (!hasModel('AuthorRelDx')) {
      defineModel({
        name: 'AuthorRelDx',
        table: 'authors_rel_dx',
        schema: zdb.schema({
          id: zdb.id(),
          full_name: zdb.string(),
          email: zdb.string(),
          secret_notes: zdb.text().optional(),
        }),
        admin: {
          enabled: true,
          displayField: 'full_name',
          searchFields: ['full_name', 'email'],
        },
      });
    }

    // 2. Tag Model (HasMany relation target)
    if (!hasModel('TagRelDx')) {
      defineModel({
        name: 'TagRelDx',
        table: 'tags_rel_dx',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string(),
        }),
        admin: {
          enabled: true,
          displayField: 'title',
        },
      });
    }

    // 3. Post Model (with belongsTo and explicit admin.relations configuration)
    if (!hasModel('PostRelDx')) {
      defineModel({
        name: 'PostRelDx',
        table: 'posts_rel_dx',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string(),
          author_id: zdb.integer(),
        }),
        relations: {
          author: {
            type: 'belongsTo',
            model: () => getModel('AuthorRelDx'),
            foreignKey: 'author_id',
          },
          tags: {
            type: 'hasMany',
            model: () => getModel('TagRelDx'),
            foreignKey: 'post_id',
          },
        },
        admin: {
          enabled: true,
          displayField: 'title',
          relations: {
            author: {
              displayField: 'full_name',
              searchFields: ['full_name', 'email'],
              limit: 5,
            },
          },
        },
      });
    }

    // Create database schema
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

    await db.knex.schema.createTable('authors_rel_dx', (table) => {
      table.increments('id').primary();
      table.string('full_name');
      table.string('email');
      table.text('secret_notes');
    });

    await db.knex.schema.createTable('tags_rel_dx', (table) => {
      table.increments('id').primary();
      table.string('title');
      table.integer('post_id').nullable();
    });

    await db.knex.schema.createTable('posts_rel_dx', (table) => {
      table.increments('id').primary();
      table.string('title');
      table.integer('author_id');
    });

    // Seed 15 authors to test search, pagination & projection in batch
    const authors = [];
    for (let i = 1; i <= 15; i++) {
      authors.push({
        full_name: i === 1 ? 'Alice Wonderland' : (i === 15 ? 'Zack Snyder' : `Author Number ${i}`),
        email: `author${i}@example.com`,
        secret_notes: `Very heavy private text payload for author ${i}`,
      });
    }
    await db.knex('authors_rel_dx').insert(authors);

    // Seed tags in batch
    await db.knex('tags_rel_dx').insert([
      { title: 'JavaScript' },
      { title: 'TypeScript' },
      { title: 'Node.js' },
    ]);

    // Create App
    const result = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      viewsDir: './tests/fixtures/views',
      publicDir: './public',
      silent: true,
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
        }),
      ],
    });

    app = result.app;

    // Admin Auth Setup
    const setupRes = await supertest(app)
      .post('/_admin/api/auth/setup')
      .send({
        email: 'rel_admin@example.com',
        password: 'password123',
        name: 'Rel Admin',
      });

    if (setupRes.headers['set-cookie']) {
      adminCookie = setupRes.headers['set-cookie'];
    } else {
      const loginRes = await supertest(app)
        .post('/_admin/api/auth/login')
        .send({
          email: 'rel_admin@example.com',
          password: 'password123',
        });
      adminCookie = loginRes.headers['set-cookie'];
    }
  });

  afterAll(async () => {
    if (db && db.knex) {
      await db.knex.destroy();
    }
  });

  it('preserves admin.relations configuration in defineModel and exposes via schema API', async () => {
    const postModel = db.getModel('PostRelDx');
    expect(postModel.admin.relations).toBeDefined();
    expect(postModel.admin.relations.author).toEqual({
      displayField: 'full_name',
      searchFields: ['full_name', 'email'],
      limit: 5,
    });

    // Verify modelHandler returns relationsConfig
    const res = await supertest(app)
      .get('/_admin/api/models/PostRelDx')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.relationsConfig).toBeDefined();
    expect(res.body.relationsConfig.author).toEqual({
      displayField: 'full_name',
      searchFields: ['full_name', 'email'],
      limit: 5,
    });
  }, 120000);

  it('returns structured pagination metadata and column projection in relations API', async () => {
    const res = await supertest(app)
      .get('/_admin/api/models/PostRelDx/relations/author?page=1&limit=5')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.displayField).toBe('full_name');
    expect(res.body.primaryKey).toBe('id');
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(5);
    expect(res.body.pagination.total).toBe(15);
    expect(res.body.pagination.totalPages).toBe(3);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.data.length).toBe(5);

    // Verify column projection: secret_notes should NOT be selected/returned
    const first = res.body.data[0];
    expect(first.id).toBeDefined();
    expect(first.full_name).toBeDefined();
    expect(first.secret_notes).toBeUndefined();
  });

  it('supports search query filter (?search= and ?q=)', async () => {
    // Search by name
    const res1 = await supertest(app)
      .get('/_admin/api/models/PostRelDx/relations/author?search=Alice')
      .set('Cookie', adminCookie);

    expect(res1.status).toBe(200);
    expect(res1.body.data.length).toBe(1);
    expect(res1.body.data[0].full_name).toBe('Alice Wonderland');
    expect(res1.body.pagination.total).toBe(1);

    // Search by email (one of searchFields)
    const res2 = await supertest(app)
      .get('/_admin/api/models/PostRelDx/relations/author?q=author15@example.com')
      .set('Cookie', adminCookie);

    expect(res2.status).toBe(200);
    expect(res2.body.data.length).toBe(1);
    expect(res2.body.data[0].full_name).toBe('Zack Snyder');
  });

  it('supports ?all=true to fetch all relation items without pagination', async () => {
    const res = await supertest(app)
      .get('/_admin/api/models/PostRelDx/relations/author?all=true')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(15);
    expect(res.body.pagination.hasMore).toBe(false);
    expect(res.body.pagination.totalPages).toBe(1);
  });

  it('includes selected ID even if not on the current page or filtered out', async () => {
    // Page 1 with limit 3 (sorted by full_name: Alice Wonderland, Author Number 10, Author Number 11)
    // Zack Snyder (id: 15) is on page 5!
    const res = await supertest(app)
      .get('/_admin/api/models/PostRelDx/relations/author?page=1&limit=3&selected=15')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    // Zack Snyder (id: 15) must be present in data
    const hasZack = res.body.data.some((item) => item.id === 15 || String(item.id) === '15');
    expect(hasZack).toBe(true);

    const zackItem = res.body.data.find((item) => item.id === 15 || String(item.id) === '15');
    expect(zackItem.full_name).toBe('Zack Snyder');
    // Still projected (no secret_notes)
    expect(zackItem.secret_notes).toBeUndefined();
  });

  it('client-side getFieldRenderer auto-detects foreign keys (*_id and references)', () => {
    const helpersContent = fs.readFileSync(
      path.resolve(__dirname, '../../../plugins/admin-panel/client/parts/05-rich-text-file-helpers.js'),
      'utf-8'
    );

    // Verify auto-detection code exists in getFieldRenderer
    expect(helpersContent).toContain("col.name.endsWith('_id')");
    expect(helpersContent).toContain('FieldRenderers.belongsTo');
  });

  it('client-side BelongsToField contains combobox, debounced search, backdrop and pagination', () => {
    const fieldRenderersContent = fs.readFileSync(
      path.resolve(__dirname, '../../../plugins/admin-panel/client/parts/04-field-renderers.js'),
      'utf-8'
    );

    // Verify upgraded BelongsToField features
    expect(fieldRenderersContent).toContain('vnode.state.isOpen');
    expect(fieldRenderersContent).toContain('vnode.state._searchTimer');
    expect(fieldRenderersContent).toContain('fetchOptions');
    expect(fieldRenderersContent).toContain('loadingMore');
    expect(fieldRenderersContent).toContain('vnode.state.hasMore');
    expect(fieldRenderersContent).toContain('Clear');
  });

  it('client-side HasManyField contains filter input and select/deselect all buttons', () => {
    const fieldRenderersContent = fs.readFileSync(
      path.resolve(__dirname, '../../../plugins/admin-panel/client/parts/04-field-renderers.js'),
      'utf-8'
    );

    // Verify upgraded HasManyField features
    expect(fieldRenderersContent).toContain('vnode.state.filter');
    expect(fieldRenderersContent).toContain('selectAll');
    expect(fieldRenderersContent).toContain('deselectAll');
    expect(fieldRenderersContent).toContain('Filter ');
  });
});
