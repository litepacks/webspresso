/**
 * Integration & Unit tests for Admin Media Library / File Manager Picker in Model Forms
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, zdb } from '../../index.js';
import { adminPanelPlugin, fileManagerPlugin } from '../../plugins/index.js';
import { clearRegistry } from '../../core/orm/model.js';
import { getFieldRenderer, registry } from '../../plugins/admin-panel/field-renderers/index.js';

describe('Admin Media Library / File Manager Picker in Model Forms', () => {
  let app;
  let db;
  let tmpDir;
  let uploadDir;
  let sharedCookie;

  beforeAll(async () => {
    clearRegistry();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-file-picker-'));
    uploadDir = path.join(tmpDir, 'public', 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });

    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
    });

    const Article = defineModel({
      name: 'Article',
      table: 'articles',
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(),
        cover_image: zdb.file({
          nullable: true,
          ui: { label: 'Cover Image', accept: 'image/*' },
        }),
        gallery: zdb.files({
          nullable: true,
          ui: { label: 'Photo Gallery', accept: 'image/*' },
        }),
        document: zdb.string({
          nullable: true,
          ui: { label: 'Attachment Document' },
        }),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
      }),
      admin: {
        enabled: true,
        label: 'Articles',
        customFields: {
          document: { type: 'file-upload' },
        },
      },
    });
    db.registerModel(Article);

    await db.knex.schema.createTable('articles', (table) => {
      table.bigIncrements('id');
      table.string('title');
      table.string('cover_image').nullable();
      table.text('gallery').nullable();
      table.string('document').nullable();
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

    const emptyPagesDir = path.join(__dirname, '../fixtures/empty-pages');
    const result = createApp({
      pagesDir: emptyPagesDir,
      viewsDir: './tests/fixtures/views',
      publicDir: path.join(tmpDir, 'public'),
      plugins: [
        fileManagerPlugin({
          baseDir: uploadDir,
          publicBasePath: '/uploads',
          pageTitle: 'Media Library',
          menuLabel: 'Media',
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

  describe('Admin HTML & Config Injection', () => {
    it('injects window.__openFileManagerPicker into admin HTML client components', async () => {
      const res = await request(app).get('/_admin').expect(200);
      expect(res.text).toContain('window.__openFileManagerPicker = function(options)');
      expect(res.text).toContain('file-manager-picker-modal-root');
    });

    it('injects fileManager settings into window.__ADMIN_CONFIG__', async () => {
      const res = await request(app).get('/_admin').expect(200);
      expect(res.text).toContain('"fileManager"');
      expect(res.text).toContain('"apiPrefix":"/files"');
      expect(res.text).toContain('"publicBasePath":"/uploads"');
      expect(res.text).toContain('"pageTitle":"Media Library"');
    });

    it('includes model column metadata for file and files types', async () => {
      const res = await request(app)
        .get('/_admin/api/models/Article')
        .set('Cookie', sharedCookie)
        .expect(200);
      const cover = res.body.columns.find((c) => c.name === 'cover_image');
      const gallery = res.body.columns.find((c) => c.name === 'gallery');
      expect(cover.type).toBe('file');
      expect(cover.ui?.accept).toBe('image/*');
      expect(gallery.type).toBe('files');
    });
  });

  describe('Field Renderer Registry Resolution', () => {
    it('resolves FileUploadField for file and image column types', () => {
      const fileRenderer = getFieldRenderer({ name: 'avatar', type: 'file' });
      expect(fileRenderer).toBeDefined();

      const imageRenderer = getFieldRenderer({ name: 'banner', type: 'image' });
      expect(imageRenderer).toBe(fileRenderer);
    });

    it('resolves FilesUploadField for files and files-upload types', () => {
      const filesRenderer = getFieldRenderer({ name: 'photos', type: 'files' });
      expect(filesRenderer).toBeDefined();

      const filesUploadRenderer = getFieldRenderer({ name: 'docs', type: 'files-upload' });
      expect(filesUploadRenderer).toBe(filesRenderer);
    });

    it('resolves customFields with type: file-upload or files', () => {
      const customFile = getFieldRenderer({
        name: 'doc',
        type: 'string',
        customField: { type: 'file-upload' },
      });
      expect(customFile).toBeDefined();

      const customFiles = getFieldRenderer({
        name: 'attachments',
        type: 'json',
        customField: { type: 'files' },
      });
      expect(customFiles).toBeDefined();
    });
  });

  describe('Client SPA Field Renderers & Media Library Picker Integration', () => {
    const mockM = (tag, attrsOrChildren, ...children) => {
      let attrs = {};
      let childList = [];
      if (attrsOrChildren && typeof attrsOrChildren === 'object' && !Array.isArray(attrsOrChildren)) {
        attrs = attrsOrChildren;
        childList = children.flat();
      } else if (attrsOrChildren !== undefined) {
        childList = [attrsOrChildren, ...children].flat();
      }
      return { tag, attrs, children: childList };
    };

    let clientPart;
    beforeAll(() => {
      const partCode = fsSync.readFileSync(
        path.join(__dirname, '../../plugins/admin-panel/client/parts/05-rich-text-file-helpers.js'),
        'utf8'
      );
      const evalFn = new Function('m', 'formatColumnLabel', 'notifyError', 'notifyWarning', partCode + '\nreturn { getFieldRenderer, FileUploadField, FilesUploadField, RichTextField, renderUploadedFilePreview };');
      clientPart = evalFn(
        mockM,
        (s) => s,
        () => {},
        () => {}
      );
    });

    it('resolves FileUploadField for file, image, and files for files types in client SPA', () => {
      const fileRenderer = clientPart.getFieldRenderer({ name: 'photo', type: 'file' });
      expect(typeof fileRenderer).toBe('function');

      const imageRenderer = clientPart.getFieldRenderer({ name: 'avatar', type: 'image' });
      expect(typeof imageRenderer).toBe('function');

      const filesRenderer = clientPart.getFieldRenderer({ name: 'slides', type: 'files' });
      expect(typeof filesRenderer).toBe('function');
    });

    it('FileUploadField triggers window.__openFileManagerPicker when library button is clicked', () => {
      let pickerOpened = false;
      let pickerOpts = null;
      global.window = {
        __ADMIN_CONFIG__: { settings: {} },
        __openFileManagerPicker: (opts) => {
          pickerOpened = true;
          pickerOpts = opts;
          opts.onSelect('/uploads/picked-photo.jpg');
        },
      };

      let changedValue = '';
      const vnode = {
        attrs: {
          col: { name: 'photo', type: 'file', ui: { accept: 'image/*' } },
          value: '',
          onChange: (val) => { changedValue = val; },
        },
        state: {},
      };

      const rendered = clientPart.FileUploadField.view(vnode);
      expect(rendered).toBeDefined();

      // Find the button with text containing "Choose from Media Library"
      const findButton = (node) => {
        if (!node) return null;
        if (node.tag && node.tag.includes('button')) {
          const txt = JSON.stringify(node);
          if (txt.includes('Choose from Media Library')) return node;
        }
        if (Array.isArray(node.children)) {
          for (const c of node.children) {
            const found = findButton(c);
            if (found) return found;
          }
        }
        return null;
      };

      const btn = findButton(rendered);
      expect(btn).not.toBeNull();
      btn.attrs.onclick({ preventDefault: () => {}, stopPropagation: () => {} });

      expect(pickerOpened).toBe(true);
      expect(pickerOpts.accept).toBe('image/*');
      expect(changedValue).toBe('/uploads/picked-photo.jpg');
    });

    it('FilesUploadField appends picked file from window.__openFileManagerPicker', () => {
      let pickerOpened = false;
      global.window = {
        __ADMIN_CONFIG__: { settings: {} },
        __openFileManagerPicker: (opts) => {
          pickerOpened = true;
          opts.onSelect('/uploads/second-image.png');
        },
      };

      let changedValue = null;
      const vnode = {
        attrs: {
          col: { name: 'gallery', type: 'files', ui: { accept: 'image/*' } },
          value: ['/uploads/first-image.png'],
          onChange: (val) => { changedValue = val; },
        },
        state: {},
      };

      const rendered = clientPart.FilesUploadField.view(vnode);
      expect(rendered).toBeDefined();

      const findButton = (node) => {
        if (!node) return null;
        if (node.tag && node.tag.includes('button')) {
          const txt = JSON.stringify(node);
          if (txt.includes('Add from Media Library')) return node;
        }
        if (Array.isArray(node.children)) {
          for (const c of node.children) {
            const found = findButton(c);
            if (found) return found;
          }
        }
        return null;
      };

      const btn = findButton(rendered);
      expect(btn).not.toBeNull();
      btn.attrs.onclick({ preventDefault: () => {}, stopPropagation: () => {} });

      expect(pickerOpened).toBe(true);
      expect(changedValue).toEqual(['/uploads/first-image.png', '/uploads/second-image.png']);
    });
  });

  describe('Standalone Picker when includePage is false', () => {
    it('registers window.__openFileManagerPicker even when includePage is false', async () => {
      clearRegistry();
      const headlessDb = createDatabase({
        client: 'better-sqlite3',
        connection: ':memory:',
        useNullAsDefault: true,
        models: './tests/fixtures/models-empty',
      });

      const headlessApp = createApp({
        pagesDir: path.join(__dirname, '../fixtures/empty-pages'),
        viewsDir: './tests/fixtures/views',
        plugins: [
          fileManagerPlugin({
            baseDir: uploadDir,
            publicBasePath: '/uploads',
            includePage: false,
          }),
          adminPanelPlugin({ db: headlessDb }),
        ],
      }).app;

      const res = await request(headlessApp).get('/_admin').expect(200);
      // Window picker must still be registered
      expect(res.text).toContain('window.__openFileManagerPicker = function(options)');
      // But custom page route is not registered in pages
      expect(res.text).not.toContain('"path":"/files"');

      await headlessDb.destroy();
      clearRegistry();
    });
  });
});
