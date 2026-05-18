/**
 * Audit log plugin — HTTP integration
 */

const path = require('path');
const request = require('../helpers/http').request;
const { createApp } = require('../../src/server');
const { createDatabase, defineModel, clearRegistry, zdb } = require('../../core/orm');
const { adminPanelPlugin, auditLogPlugin } = require('../../plugins');
const { hash } = require('../../core/auth');

describe('Audit log plugin (integration)', () => {
  let app;
  let db;

  beforeAll(async () => {
    clearRegistry();
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    const Post = defineModel({
      name: 'TestPost',
      table: 'test_posts',
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(),
        content: zdb.string(),
        published: zdb.boolean({ default: false }),
        status: zdb.string({ default: 'draft' }),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
      }),
      admin: { enabled: true, label: 'Posts' },
    });
    db.registerModel(Post);

    await db.knex.schema.createTable('test_posts', (t) => {
      t.bigIncrements('id');
      t.string('title');
      t.text('content');
      t.boolean('published').defaultTo(false);
      t.string('status').defaultTo('draft');
      t.timestamp('created_at');
      t.timestamp('updated_at');
    });

    await db.knex.schema.createTable('admin_users', (t) => {
      t.bigIncrements('id');
      t.string('email').unique();
      t.string('password');
      t.string('name');
      t.string('role').defaultTo('admin');
      t.boolean('active').defaultTo(true);
      t.timestamp('created_at');
      t.timestamp('updated_at');
    });

    await db.knex.schema.createTable('audit_logs', (t) => {
      t.bigIncrements('id');
      t.timestamp('created_at').defaultTo(db.knex.fn.now());
      t.bigInteger('actor_id').nullable();
      t.string('actor_email', 255).nullable();
      t.string('action', 32);
      t.string('resource_model', 255);
      t.string('resource_id', 255).nullable();
      t.string('http_method', 16);
      t.string('path', 2000);
      t.string('ip', 64).nullable();
      t.text('user_agent').nullable();
      t.json('metadata').nullable();
    });

    const hp = await hash('password123');
    await db.knex('admin_users').insert({
      email: 'admin@test.com',
      password: hp,
      name: 'Admin',
      role: 'admin',
      active: 1,
      created_at: new Date(),
      updated_at: new Date(),
    });

    ({ app } = createApp({
      pagesDir: path.join(__dirname, '../fixtures/pages'),
      viewsDir: path.join(__dirname, '../fixtures/views'),
      logging: false,
      db,
      plugins: [
        adminPanelPlugin({ path: '/_admin', db }),
        auditLogPlugin({ db, adminPath: '/_admin' }),
      ],
    }));
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('records create on model CRUD API', async () => {
    const agent = request.agent(app);
    await agent
      .post('/_admin/api/auth/login')
      .send({ email: 'admin@test.com', password: 'password123' })
      .expect(200);

    const create = await agent.post('/_admin/api/models/TestPost/records').send({
      title: 'Audit test',
      content: 'Long enough content for validation rules',
      published: false,
      status: 'draft',
    });
    expect(create.status).toBe(201);
    const id = String(create.body.data.id);

    const rows = await db.knex('audit_logs').select('*');
    expect(rows.length).toBeGreaterThan(0);

    const list = await agent.get('/_admin/api/audit-logs?perPage=20&action=create&model=TestPost');
    expect(list.status).toBe(200);
    const row = (list.body.data || []).find(
      (r) => r.resource_id === id && r.action === 'create' && r.resource_model === 'TestPost'
    );
    expect(row).toBeTruthy();
    expect(row.actor_email).toBe('admin@test.com');
  });
});
