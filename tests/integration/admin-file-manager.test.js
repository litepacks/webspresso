/**
 * Integration tests for File Manager Plugin & Admin Panel Module
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createApp } from '../../src/server.js';
import { createDatabase } from '../../index.js';
import { adminPanelPlugin, fileManagerPlugin } from '../../plugins/index.js';
import { clearRegistry } from '../../core/orm/model.js';

describe.sequential('Admin File Manager Plugin Integration', () => {
  let app;
  let db;
  let tmpDir;
  let uploadDir;

  let sharedCookie;

  beforeAll(async () => {
    clearRegistry();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-admin-fm-'));
    uploadDir = path.join(tmpDir, 'public', 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });

    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
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

    const emptyPagesDir = path.join(__dirname, '../fixtures/empty-pages');
    const result = createApp({
      pagesDir: emptyPagesDir,
      viewsDir: './tests/fixtures/views',
      publicDir: path.join(tmpDir, 'public'),
      plugins: [
        fileManagerPlugin({
          baseDir: uploadDir,
          publicBasePath: '/uploads',
          pageTitle: 'Dosya Yöneticisi',
          menuLabel: 'Dosyalar',
        }),
        adminPanelPlugin({ db }),
      ],
    });
    app = result.app;

    const setupRes = await request(app)
      .post('/_admin/api/auth/setup')
      .send({
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin User',
      });
    sharedCookie = setupRes.headers['set-cookie'];
  });

  afterAll(async () => {
    if (db) await db.destroy();
    clearRegistry();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registers file manager module and custom page in admin panel', async () => {
    const res = await request(app).get('/_admin').expect(200);
    expect(res.text).toContain('window.__customPages[\'files\']');
  });

  it('lists directory, creates folder, uploads file, renames and deletes via API', async () => {
    const cookie = sharedCookie;

    // 1. Initial list empty
    const list1 = await request(app)
      .get('/_admin/api/files')
      .set('Cookie', cookie)
      .expect(200);

    expect(list1.body.success).toBe(true);
    expect(list1.body.items).toEqual([]);

    // 2. Create subfolder
    const mkdirRes = await request(app)
      .post('/_admin/api/files/mkdir')
      .set('Cookie', cookie)
      .send({ name: 'documents' })
      .expect(201);

    expect(mkdirRes.body.success).toBe(true);
    expect(mkdirRes.body.data.name).toBe('documents');

    // 3. Upload file into documents folder
    const uploadRes = await request(app)
      .post('/_admin/api/files/upload?path=documents')
      .set('Cookie', cookie)
      .attach('files', Buffer.from('%PDF-1.4 test document'), 'report.pdf')
      .expect(201);

    expect(uploadRes.body.success).toBe(true);
    expect(uploadRes.body.count).toBe(1);
    expect(uploadRes.body.files[0].type).toBe('document');
    expect(uploadRes.body.files[0].publicUrl).toMatch(/^\/uploads\/documents\//);

    // 4. List subfolder
    const listDocs = await request(app)
      .get('/_admin/api/files?path=documents')
      .set('Cookie', cookie)
      .expect(200);

    expect(listDocs.body.items.length).toBe(1);
    const uploadedFile = listDocs.body.items[0];
    expect(uploadedFile.name).toBe(uploadRes.body.files[0].name);

    // 5. Rename uploaded file
    const renameRes = await request(app)
      .post('/_admin/api/files/rename')
      .set('Cookie', cookie)
      .send({ path: uploadedFile.path, newName: 'final-report.pdf' })
      .expect(200);

    expect(renameRes.body.success).toBe(true);
    expect(renameRes.body.data.newName).toBe('final-report.pdf');

    // 6. Delete file
    const delRes = await request(app)
      .post('/_admin/api/files/delete')
      .set('Cookie', cookie)
      .send({ path: renameRes.body.data.newPath })
      .expect(200);

    expect(delRes.body.success).toBe(true);

    // 7. Verify folder is empty again
    const listDocsAfter = await request(app)
      .get('/_admin/api/files?path=documents')
      .set('Cookie', cookie)
      .expect(200);

    expect(listDocsAfter.body.items.length).toBe(0);
  });
});
