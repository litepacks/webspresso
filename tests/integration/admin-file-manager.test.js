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

describe.sequential('Admin File Manager Plugin Integration', () => {
  let app;
  let db;
  let tmpDir;
  let uploadDir;

  let sharedCookie;

  beforeAll(async () => {
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
      silent: true,
      server: { port: 0, shutdown: { enabled: false } },
      helmet: false,
      compression: false,
      cache: false,
      healthCheck: false,
      metrics: false,
      lazyRoutes: true,
      plugins: [
        fileManagerPlugin({
          baseDir: uploadDir,
          publicBasePath: '/uploads',
          pageTitle: 'File Manager',
          menuLabel: 'Files',
        }),
        adminPanelPlugin({ db }),
      ],
    });
    app = result.app;

    await db.knex('admin_users').insert({
      email: 'admin@example.com',
      password: '$2b$04$Wuy3PNKivlnz5etS8gSaoeMqE7OUaMbnKcBRjSD0AxL.Qrd5hTAAK',
      name: 'Admin User',
      role: 'admin',
      active: true,
    });

    const loginRes = await request(app)
      .post('/_admin/api/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'password123',
      });
    sharedCookie = loginRes.headers['set-cookie'];
  });

  afterAll(async () => {
    if (db) await db.destroy();
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

    // 8. Save edited image (new copy and overwrite)
    const dummyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const saveImgRes = await request(app)
      .post('/_admin/api/files/save-image')
      .set('Cookie', cookie)
      .send({
        path: 'test-image.png',
        dataUrl: dummyPngDataUrl,
        overwrite: false,
      })
      .expect(200);

    expect(saveImgRes.body.success).toBe(true);
    expect(saveImgRes.body.file.name).toContain('test-image');

    // Overwrite test
    const overwriteImgRes = await request(app)
      .post('/_admin/api/files/save-image')
      .set('Cookie', cookie)
      .send({
        path: saveImgRes.body.file.path,
        dataUrl: dummyPngDataUrl,
        overwrite: true,
      })
      .expect(200);

    expect(overwriteImgRes.body.success).toBe(true);

    // 9. Save text / code content (new file and overwrite)
    const initialJsonContent = JSON.stringify({ siteName: 'Webspresso App', theme: 'dark' }, null, 2);
    const saveTxtRes = await request(app)
      .post('/_admin/api/files/save-content')
      .set('Cookie', cookie)
      .send({
        path: 'site-config.json',
        content: initialJsonContent,
        overwrite: true,
      })
      .expect(200);

    expect(saveTxtRes.body.success).toBe(true);
    expect(saveTxtRes.body.file.name).toBe('site-config.json');
    expect(saveTxtRes.body.file.ext).toBe('json');

    // 10. Read text file content via API
    const readTxtRes = await request(app)
      .get('/_admin/api/files/content?path=site-config.json')
      .set('Cookie', cookie)
      .expect(200);

    expect(readTxtRes.body.success).toBe(true);
    expect(readTxtRes.body.content).toBe(initialJsonContent);
    expect(readTxtRes.body.ext).toBe('json');
    expect(readTxtRes.body.mimeType).toBe('application/json');

    // 11. Save as copy (overwrite: false)
    const copyTxtRes = await request(app)
      .post('/_admin/api/files/save-content')
      .set('Cookie', cookie)
      .send({
        path: 'site-config.json',
        content: JSON.stringify({ siteName: 'Copy App' }),
        overwrite: false,
      })
      .expect(200);

    expect(copyTxtRes.body.success).toBe(true);
    expect(copyTxtRes.body.file.name).toContain('site-config-copy');

    // 12. Path traversal security protection
    await request(app)
      .get('/_admin/api/files/content?path=../../package.json')
      .set('Cookie', cookie)
      .expect(400);

    // 13. Non-existent file 404
    await request(app)
      .get('/_admin/api/files/content?path=non-existent-file.txt')
      .set('Cookie', cookie)
      .expect(404);

    // 14. Download multiple files as ZIP archive
    const zipRes = await request(app)
      .get('/_admin/api/files/download-zip?paths=site-config.json')
      .set('Cookie', cookie)
      .expect(200);

    expect(zipRes.headers['content-type']).toBe('application/zip');
    expect(zipRes.headers['content-disposition']).toContain('attachment; filename=');
    expect(Number(zipRes.headers['content-length'])).toBeGreaterThan(50);

    // 15. Batch move files
    await request(app)
      .post('/_admin/api/files/mkdir')
      .set('Cookie', cookie)
      .send({ name: 'target-dir' })
      .expect(201);

    const batchMoveRes = await request(app)
      .post('/_admin/api/files/batch-move')
      .set('Cookie', cookie)
      .send({
        paths: ['site-config.json'],
        destination: 'target-dir',
      })
      .expect(200);

    expect(batchMoveRes.body.success).toBe(true);
    expect(batchMoveRes.body.count).toBe(1);

    // Verify moved file is now in target-dir
    const targetDirList = await request(app)
      .get('/_admin/api/files?path=target-dir')
      .set('Cookie', cookie)
      .expect(200);

    expect(targetDirList.body.items.some(i => i.name === 'site-config.json')).toBe(true);

    // 16. Batch delete files
    const batchDelRes = await request(app)
      .post('/_admin/api/files/batch-delete')
      .set('Cookie', cookie)
      .send({
        paths: ['target-dir/site-config.json', copyTxtRes.body.file.path],
      })
      .expect(200);

    expect(batchDelRes.body.success).toBe(true);
    expect(batchDelRes.body.count).toBe(2);

    // 17. Storage Usage & Quota Stats
    const storageRes = await request(app)
      .get('/_admin/api/files/storage-stats?refresh=true')
      .set('Cookie', cookie)
      .expect(200);

    expect(storageRes.body.success).toBe(true);
    expect(storageRes.body.stats).toBeDefined();
    expect(typeof storageRes.body.stats.totalBytes).toBe('number');
    expect(typeof storageRes.body.stats.quotaBytes).toBe('number');
    expect(typeof storageRes.body.stats.usagePercent).toBe('number');
    expect(storageRes.body.stats.categories).toBeDefined();
    expect(storageRes.body.stats.categories.images).toBeDefined();
    expect(storageRes.body.stats.categories.code).toBeDefined();

    // Verify storage stats are also present in list endpoint
    const listWithStorageRes = await request(app)
      .get('/_admin/api/files')
      .set('Cookie', cookie)
      .expect(200);

    expect(listWithStorageRes.body.storage).toBeDefined();
    expect(listWithStorageRes.body.storage.quotaBytes).toBeGreaterThan(0);
  });
});
