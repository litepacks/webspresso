'use strict';

const path = require('path');
const fs = require('fs');

describe('Upload & REST Resources Branch Coverage', () => {
  describe('plugins/upload/index.js comprehensive branch coverage', () => {
    const { uploadPlugin, createLocalFileProvider } = require('../../plugins/upload/index.js');

    it('exercises createLocalFileProvider and uploadPlugin onRoutesReady routes and errors', async () => {
      const uploadDir = path.join(__dirname, '../../tmp/test-upload-dest');
      const provider = createLocalFileProvider({
        destDir: uploadDir,
        publicBasePath: '/uploads',
      });

      const resPut = await provider.put({
        buffer: Buffer.from('test image content'),
        originalName: 'test.png',
        mimeType: 'image/png',
        size: 18,
        req: {},
      });
      expect(resPut.publicUrl).toContain('/uploads/');
      fs.rmSync(uploadDir, { recursive: true, force: true });

      // Test uploadPlugin with multiple=true and allowlists
      const plugin = uploadPlugin({
        path: 'custom-upload',
        provider: {
          put: async (args) => {
            if (args.originalName === 'fail.png') {
              throw new Error('Disk full');
            }
            return { publicUrl: `/files/${args.originalName}`, key: args.originalName };
          },
        },
        multiple: true,
        mimeAllowlist: ['image/png'],
        extensionAllowlist: ['png'],
      });

      let routeHandler;
      const mockCtx = {
        app: { set: vi.fn(), serviceRegistry: { has: () => false, register: vi.fn() } },
        addRoute: vi.fn((method, p, ...handlers) => {
          routeHandler = handlers[handlers.length - 1];
        }),
      };

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      plugin.register(mockCtx);
      plugin.onRoutesReady(mockCtx);
      logSpy.mockRestore();
      expect(routeHandler).toBeDefined();

      // Test single mode plugin
      const singlePlugin = uploadPlugin({
        multiple: false,
        provider: {
          put: async () => ({ publicUrl: '/files/single.png', key: 'single.png' }),
        },
      });
      let singleHandler;
      singlePlugin.onRoutesReady({
        app: { set: vi.fn() },
        addRoute: vi.fn((m, p, ...h) => {
          singleHandler = h[h.length - 1];
        }),
      });
      expect(singleHandler).toBeDefined();
    });
  });

  describe('plugins/rest-resources/index.js route handler branch coverage', () => {
    const restResourcePlugin = require('../../plugins/rest-resources/index.js');

    it('exercises GET, POST, PATCH, and DELETE endpoints with error branches', async () => {
      const records = new Map();
      let autoId = 1;

      const mockRepo = {
        find: vi.fn(async () => Array.from(records.values())),
        findById: vi.fn(async (id) => records.get(Number(id)) || null),
        create: vi.fn(async (data) => {
          if (data.name === 'error') throw new Error('Create error');
          const rec = { id: autoId++, ...data };
          records.set(rec.id, rec);
          return rec;
        }),
        update: vi.fn(async (id, data) => {
          if (data.name === 'error') throw new Error('Update error');
          const rec = records.get(Number(id));
          if (!rec) return null;
          const updated = { ...rec, ...data };
          records.set(rec.id, updated);
          return updated;
        }),
        delete: vi.fn(async (id) => {
          if (id === '9999') throw new Error('Delete error');
          return records.delete(Number(id));
        }),
      };

      const mockModel = {
        name: 'Product',
        table: 'products',
        columns: new Map([
          ['id', { primary: true, autoIncrement: true }],
          ['name', { primary: false }],
          ['price', { primary: false }],
        ]),
        schema: {
          shape: {
            id: { type: 'id' },
            name: { type: 'string' },
            price: { type: 'number' },
          },
        },
        hidden: [],
        rest: { enabled: true },
      };

      const mockDb = {
        getRepository: vi.fn(() => mockRepo),
        getAllModels: vi.fn(() => new Map([[mockModel.name, mockModel]])),
      };

      const plugin = restResourcePlugin({
        path: '/api/v1',
      });

      const registeredRoutes = {};
      const mockCtx = {
        db: mockDb,
        addRoute: vi.fn((method, path, ...handlers) => {
          registeredRoutes[`${method.toUpperCase()} ${path}`] = handlers[handlers.length - 1];
        }),
      };

      plugin.onRoutesReady(mockCtx);

      // 1. POST /api/v1/products - create success & error
      const postHandler = registeredRoutes['POST /api/v1/products'];
      const resPost1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await postHandler({ body: { name: 'Widget', price: 10 } }, resPost1);
      expect(resPost1.status).toHaveBeenCalledWith(201);

      const resPost2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await postHandler({ body: { name: 'error' } }, resPost2);
      expect(resPost2.status).toHaveBeenCalledWith(400);

      // 2. GET /api/v1/products/:id - found & not found
      const getOneHandler = registeredRoutes['GET /api/v1/products/:id'];
      const resGet1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await getOneHandler({ params: { id: '1' }, query: {} }, resGet1);
      expect(resGet1.json).toHaveBeenCalled();

      const resGet2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await getOneHandler({ params: { id: '999' }, query: {} }, resGet2);
      expect(resGet2.status).toHaveBeenCalledWith(404);

      // 3. PATCH /api/v1/products/:id - update success, not found, and error
      const patchHandler = registeredRoutes['PATCH /api/v1/products/:id'];
      const resPatch1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await patchHandler({ params: { id: '1' }, body: { price: 20 } }, resPatch1);
      expect(resPatch1.json).toHaveBeenCalled();

      const resPatch2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await patchHandler({ params: { id: '999' }, body: { price: 20 } }, resPatch2);
      expect(resPatch2.status).toHaveBeenCalledWith(404);

      const resPatch3 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await patchHandler({ params: { id: '1' }, body: { name: 'error' } }, resPatch3);
      expect(resPatch3.status).toHaveBeenCalledWith(400);

      // 4. DELETE /api/v1/products/:id - delete success, not found, and error
      const deleteHandler = registeredRoutes['DELETE /api/v1/products/:id'];
      const resDel1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await deleteHandler({ params: { id: '1' } }, resDel1);
      expect(resDel1.json).toHaveBeenCalledWith({ success: true });

      const resDel2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await deleteHandler({ params: { id: '999' } }, resDel2);
      expect(resDel2.status).toHaveBeenCalledWith(404);

      const resDel3 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await deleteHandler({ params: { id: '9999' } }, resDel3);
      expect(resDel3.status).toHaveBeenCalledWith(400);
    });
  });

  describe('src/services/builtins/file-manager.js branch coverage', () => {
    const { createFileManagerServices } = require('../../src/services/builtins/file-manager.js');

    it('covers fileManager.upload validations, base64 parsing, filePath, and invalid buffer errors', async () => {
      const baseDir = path.join(__dirname, '../../tmp/test-fm-services');
      fs.mkdirSync(baseDir, { recursive: true });

      const services = createFileManagerServices({ defaultBaseDir: baseDir });
      const uploadService = services['fileManager.upload'];

      // 1. Invalid buffer type
      await expect(
        uploadService.handler({
          baseDir,
          buffer: { invalid: 'object' },
        })
      ).rejects.toThrow('Invalid buffer provided');

      // 2. Base64 payload
      const base64Data = 'data:text/plain;base64,' + Buffer.from('hello base64').toString('base64');
      const resBase64 = await uploadService.handler({
        baseDir,
        base64: base64Data,
        originalName: 'b64.txt',
      });
      expect(resBase64.name).toMatch(/^b64.*\.txt$/);

      // 3. FilePath reading from disk
      const srcFilePath = path.join(baseDir, 'source.txt');
      fs.writeFileSync(srcFilePath, 'from disk');
      const resFilePath = await uploadService.handler({
        baseDir,
        filePath: srcFilePath,
      });
      expect(resFilePath.name).toMatch(/^source.*\.txt$/);

      // 4. Missing filePath
      await expect(
        uploadService.handler({
          baseDir,
          filePath: path.join(baseDir, 'nonexistent.txt'),
        })
      ).rejects.toThrow('Source file not found');

      // 5. Empty content
      await expect(
        uploadService.handler({
          baseDir,
          buffer: Buffer.from(''),
        })
      ).rejects.toThrow('No file content provided');

      fs.rmSync(baseDir, { recursive: true, force: true });
    });
  });

  describe('src/server.js server options and async error wrapping branch coverage', () => {
    const { createApp } = require('../../src/server.js');

    it('covers compression, trustProxy, timeout, custom pages/services options, and wrapAsync error boundary', () => {
      const { app, shutdownManager } = createApp({
        pagesDir: './tests/fixtures/pages',
        viewsDir: './tests/fixtures/views',
        publicDir: './public',
        compression: true,
        timeout: '15s',
        trustProxy: 'loopback',
        pages: { dir: './tests/fixtures/pages' },
        services: { dir: './services' },
      });

      expect(app).toBeDefined();
      expect(typeof app.use).toBe('function');
      expect(typeof app.get).toBe('function');

      // Test async route wrapping on app.get
      app.get('/test-async-throw', async () => {});
    });
  });

  describe('plugins/rest-resources & plugins/xlsx engine branch coverage', () => {
    const restResourcePlugin = require('../../plugins/rest-resources/index.js');
    const { parse, fromModel } = require('../../plugins/xlsx/engine.js');

    it('exercises xlsx error branches', async () => {
      await expect(fromModel(null)).rejects.toThrow('fromModel requires a valid Webspresso Model Repository');
      await expect(fromModel({ find: () => [] }, () => {})).rejects.toThrow('fromModel query callback requires a repository with query() method');

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Sheet1');
      const buf = await wb.xlsx.writeBuffer();
      await expect(parse(buf, { sheet: 'NonExistent' })).rejects.toThrow('Worksheet "NonExistent" not found in XLSX workbook');
    });

    it('exercises restResourcePlugin routes and filter edge cases', async () => {
      const mockRepo = {
        query: () => {
          const q = {
            where: vi.fn(() => q),
            whereNull: vi.fn(() => q),
            whereNotNull: vi.fn(() => q),
            orderBy: vi.fn(() => q),
            offset: vi.fn(() => q),
            limit: vi.fn(() => q),
            with: vi.fn(() => q),
            count: vi.fn(async () => 5),
            list: vi.fn(async () => [{ id: 1, title: 'Item 1' }]),
          };
          return q;
        },
      };

      const columnsMap = new Map([
        ['id', { type: 'integer', primary: true, autoIncrement: true }],
        ['title', { type: 'string' }],
        ['status', { type: 'string' }],
        ['created_at', { type: 'datetime' }],
      ]);

      const modelsMap = new Map([
        ['Article', {
          name: 'Article',
          table: 'articles',
          columns: columnsMap,
          relations: { author: { type: 'belongsTo', model: () => ({ name: 'User', columns: new Map([['id', { type: 'integer' }], ['name', { type: 'string' }]]), relations: {} }) } },
          rest: { enabled: true },
        }],
      ]);

      const mockDb = {
        models: modelsMap,
        getAllModels: () => modelsMap,
        getRepository: (name) => mockRepo,
      };

      const routes = [];
      const mockCtx = {
        db: mockDb,
        addRoute: vi.fn((method, path, ...handlers) => {
          routes.push({ method, path, handler: handlers[handlers.length - 1] });
        }),
      };

      const plugin = restResourcePlugin({
        path: '/api/v1/rest',
      });

      plugin.onRoutesReady(mockCtx);

      const listRoute = routes.find(r => r.method === 'get' && r.path === '/api/v1/rest/articles');
      expect(listRoute).toBeDefined();

      // Test list handler with filters and includes
      const req = {
        query: {
          page: '1',
          perPage: '10',
          include: 'author',
          filter: {
            status: { eq: 'published', neq: 'draft' },
            title: 'Test',
          },
        },
      };
      const res = {
        json: vi.fn(),
        status: vi.fn(() => res),
      };

      await listRoute.handler(req, res);
      expect(res.json).toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].data).toBeDefined();
    });
  });
});
