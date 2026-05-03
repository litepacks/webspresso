/**
 * Admin panel rich-text HTML sanitization on create/update API
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, zdb } from '../../index.js';
import { adminPanelPlugin } from '../../plugins/index.js';
import { clearRegistry } from '../../core/orm/model.js';

describe.sequential('Admin rich-text sanitization API', () => {
  let app;
  let db;
  let modelName;
  let tableName;

  let suiteId = 0;

  async function loginCookie(application) {
    const a = application || app;
    await request(a)
      .post('/_admin/api/auth/setup')
      .send({
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin User',
      });
    const loginRes = await request(a)
      .post('/_admin/api/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'password123',
      });
    return loginRes.headers['set-cookie'];
  }

  async function bootstrapApp({ sanitizeRichText }) {
    clearRegistry();
    if (db) {
      await db.destroy();
    }

    suiteId += 1;
    modelName = `RichSanitizeDoc${suiteId}`;
    tableName = `rich_sanitize_docs_${suiteId}`;

    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
    });

    const DocModel = defineModel({
      name: modelName,
      table: tableName,
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(),
        body: zdb.text({ nullable: true }),
        bio: zdb.text(),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
      }),
      scopes: { timestamps: true },
      admin: {
        enabled: true,
        label: 'Rich sanitize',
        customFields: {
          body: { type: 'rich-text' },
          bio: { type: 'rich-text' },
        },
      },
    });
    db.registerModel(DocModel);

    await db.knex.schema.createTable(tableName, (table) => {
      table.bigIncrements('id');
      table.string('title');
      table.text('body').nullable();
      table.text('bio').notNullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
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

    const result = createApp({
      pagesDir: './tests/fixtures/pages',
      viewsDir: './tests/fixtures/views',
      publicDir: './public',
      plugins: [
        adminPanelPlugin({
          path: '/_admin',
          db,
          richTextSanitize: sanitizeRichText,
        }),
      ],
    });

    app = result.app;
  }

  beforeEach(async () => {
    await bootstrapApp({ sanitizeRichText: true });
  });

  afterEach(async () => {
    if (db) {
      await db.destroy();
      db = null;
    }
    clearRegistry();
  });

  it('strips XSS from rich-text fields on create', async () => {
    const cookie = await loginCookie();
    const payload = {
      title: 'doc1',
      body: '<p>Hello</p><script>document.cookie=1</script>',
      bio: '<p><strong>Bio</strong></p><iframe src="https://evil"></iframe>',
    };
    const res = await request(app)
      .post(`/_admin/api/models/${modelName}/records`)
      .set('Cookie', cookie)
      .send(payload)
      .expect(201);

    const html = `${res.body.data.body}\n${res.body.data.bio}`;
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/iframe/i);
    expect(html).toContain('Hello');
    expect(html).toContain('<strong>');
  });

  it('returns 400 when required rich-text is empty after sanitization', async () => {
    const cookie = await loginCookie();
    const res = await request(app)
      .post(`/_admin/api/models/${modelName}/records`)
      .set('Cookie', cookie)
      .send({
        title: 'doc2',
        bio: '<script></script>',
      })
      .expect(400);

    expect(res.body.error).toMatch(/bio/i);
  });

  it('normalizes nullable rich-text to null when empty after sanitization', async () => {
    const cookie = await loginCookie();
    const res = await request(app)
      .post(`/_admin/api/models/${modelName}/records`)
      .set('Cookie', cookie)
      .send({
        title: 'doc3',
        body: '<p></p>',
        bio: '<p>required</p>',
      })
      .expect(201);

    expect(res.body.data.body === null || res.body.data.body === '').toBeTruthy();
  });

  it('sanitizes rich-text on update', async () => {
    const cookie = await loginCookie();
    const created = await request(app)
      .post(`/_admin/api/models/${modelName}/records`)
      .set('Cookie', cookie)
      .send({
        title: 'doc4',
        bio: '<p>initial</p>',
      })
      .expect(201);

    const id = created.body.data.id;
    const updated = await request(app)
      .put(`/_admin/api/models/${modelName}/records/${id}`)
      .set('Cookie', cookie)
      .send({
        bio: '<p>u</p><script>x</script>',
      })
      .expect(200);

    expect(updated.body.data.bio).not.toMatch(/script/i);
    expect(updated.body.data.bio).toContain('<p>');
  });

  it('does not sanitize when richTextSanitize is false', async () => {
    await bootstrapApp({ sanitizeRichText: false });
    const appOff = app;

    const cookie = await loginCookie(appOff);
    const evil = '<p>ok</p><script>bad</script>';
    const res = await request(appOff)
      .post(`/_admin/api/models/${modelName}/records`)
      .set('Cookie', cookie)
      .send({
        title: 'off',
        bio: evil,
      })
      .expect(201);

    expect(res.body.data.bio).toContain('<script>');
  });
});
