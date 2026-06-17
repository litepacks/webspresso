/**
 * Admin panel file upload fields (zdb.file + uploadPlugin wiring)
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, zdb } from '../../index.js';
import { adminPanelPlugin, uploadPlugin } from '../../plugins/index.js';
import { clearRegistry } from '../../core/orm/model.js';
import { getFieldRenderer } from '../../plugins/admin-panel/field-renderers/index.js';

describe.sequential('Admin file upload fields', () => {
  let app;
  let db;
  let tmpDir;
  let modelName;
  let tableName;

  let suiteId = 0;

  async function loginCookie() {
    await request(app)
      .post('/_admin/api/auth/setup')
      .send({
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin User',
      });
    const loginRes = await request(app)
      .post('/_admin/api/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'password123',
      });
    return loginRes.headers['set-cookie'];
  }

  beforeEach(async () => {
    clearRegistry();
    suiteId += 1;
    modelName = `MediaAsset${suiteId}`;
    tableName = `media_assets_${suiteId}`;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-admin-file-'));
    const destDir = path.join(tmpDir, 'public', 'uploads');
    await fs.mkdir(destDir, { recursive: true });

    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
    });

    const MediaAsset = defineModel({
      name: modelName,
      table: tableName,
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(),
        cover_url: zdb.file({
          maxLength: 2048,
          nullable: true,
          ui: { label: 'Cover image', accept: 'image/*' },
        }),
        attachment: zdb.string({
          nullable: true,
          ui: { label: 'Legacy attachment' },
        }),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
      }),
      admin: {
        enabled: true,
        label: 'Media',
        customFields: {
          attachment: { type: 'file-upload' },
        },
      },
    });
    db.registerModel(MediaAsset);

    await db.knex.schema.createTable(tableName, (table) => {
      table.bigIncrements('id');
      table.string('title');
      table.string('cover_url', 2048).nullable();
      table.string('attachment').nullable();
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
      publicDir: path.join(tmpDir, 'public'),
      plugins: [
        uploadPlugin({
          path: '/api/upload',
          local: { destDir, publicBasePath: '/uploads' },
          maxBytes: 1024 * 1024,
        }),
        adminPanelPlugin({ db }),
      ],
    });
    app = result.app;
  });

  afterEach(async () => {
    if (db) await db.destroy();
    clearRegistry();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('exposes zdb.file columns as type file in model metadata', async () => {
    const cookie = await loginCookie();
    const res = await request(app)
      .get(`/_admin/api/models/${modelName}`)
      .set('Cookie', cookie)
      .expect(200);

    const cover = res.body.columns.find((c) => c.name === 'cover_url');
    const attachment = res.body.columns.find((c) => c.name === 'attachment');

    expect(cover.type).toBe('file');
    expect(cover.ui?.label).toBe('Cover image');
    expect(cover.ui?.accept).toBe('image/*');
    expect(attachment.customField).toEqual({ type: 'file-upload' });
  });

  it('injects uploadUrl into admin client config when uploadPlugin is registered first', async () => {
    const res = await request(app).get('/_admin').expect(200);
    expect(res.text).toContain('"uploadUrl":"/api/upload"');
  });

  it('persists uploaded file URL on create', async () => {
    const cookie = await loginCookie();
    const res = await request(app)
      .post(`/_admin/api/models/${modelName}/records`)
      .set('Cookie', cookie)
      .send({
        title: 'Hello',
        cover_url: '/uploads/cover.png',
        attachment: '/uploads/doc.pdf',
      })
      .expect(201);

    expect(res.body.data.cover_url).toBe('/uploads/cover.png');
    expect(res.body.data.attachment).toBe('/uploads/doc.pdf');
  });

  it('resolves file field renderers for schema and customFields', () => {
    clearRegistry();
    const schemaRenderer = getFieldRenderer({ name: 'cover_url', type: 'file' });
    const customRenderer = getFieldRenderer({
      name: 'attachment',
      type: 'string',
      customField: { type: 'file-upload' },
    });

    expect(schemaRenderer).toBeTruthy();
    expect(customRenderer).toBeTruthy();
    expect(schemaRenderer).toBe(customRenderer);
  });
});
