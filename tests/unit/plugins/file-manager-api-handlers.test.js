/**
 * Unit tests for File Manager API Route Handlers
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createFileManagerApiHandlers,
  isActionAllowed,
} from '../../../plugins/file-manager/api-handlers';

const coreMod = require('../../../plugins/file-manager/core');

describe('File Manager API Handlers & RBAC', () => {
  describe('isActionAllowed', () => {
    it('allows action when no permissions map is provided or action is unrestricted', () => {
      expect(isActionAllowed({}, 'list', null)).toBe(true);
      expect(isActionAllowed({}, 'list', {})).toBe(true);
      expect(isActionAllowed({}, 'list', { delete: ['admin'] })).toBe(true);
    });

    it('allows action when wildcard role is present', () => {
      expect(isActionAllowed({}, 'upload', { upload: ['*'] })).toBe(true);
    });

    it('checks session adminUser role against allowed roles', () => {
      const perms = { delete: ['superadmin'], upload: ['editor', 'admin'] };

      const adminReq = { session: { adminUser: { role: 'admin' } } };
      const superReq = { session: { adminUser: { role: 'superadmin' } } };
      const viewerReq = { session: { adminUser: { role: 'viewer' } } };

      expect(isActionAllowed(adminReq, 'upload', perms)).toBe(true);
      expect(isActionAllowed(adminReq, 'delete', perms)).toBe(false);

      expect(isActionAllowed(superReq, 'delete', perms)).toBe(true);
      expect(isActionAllowed(viewerReq, 'upload', perms)).toBe(false);
    });
  });

  describe('CRUD API Handlers', () => {
    let handlers;
    let listFilesSpy;
    let createDirSpy;
    let renameSpy;
    let moveSpy;
    let deleteSpy;

    beforeEach(() => {
      listFilesSpy = vi.spyOn(coreMod, 'listFiles');
      createDirSpy = vi.spyOn(coreMod, 'createDirectory');
      renameSpy = vi.spyOn(coreMod, 'renameItem');
      moveSpy = vi.spyOn(coreMod, 'moveItem');
      deleteSpy = vi.spyOn(coreMod, 'deleteItem');

      handlers = createFileManagerApiHandlers({
        baseDir: '/test/uploads',
        publicBasePath: '/uploads',
        permissions: {
          delete: ['admin'],
        },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function createMockRes() {
      return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
    }

    it('list handler executes listFiles and returns results', async () => {
      listFilesSpy.mockResolvedValue({ items: [{ name: 'file.txt' }], total: 1 });
      const res = createMockRes();

      await handlers.list(
        { query: { path: 'sub', sort: 'mtime', order: 'desc', page: '1', perPage: '10' } },
        res
      );

      expect(listFilesSpy).toHaveBeenCalledWith('/test/uploads', 'sub', expect.objectContaining({
        sort: 'mtime',
        order: 'desc',
        page: 1,
        perPage: 10,
      }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, total: 1 }));
    });

    it('list handler handles errors with error status code', async () => {
      const err = new Error('Directory traversal attempt detected');
      err.statusCode = 400;
      listFilesSpy.mockRejectedValue(err);
      const res = createMockRes();

      await handlers.list({ query: { path: '../etc' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: expect.stringMatching(/traversal/i) });
    });

    it('mkdir handler validates directory name and returns 201 on success', async () => {
      createDirSpy.mockResolvedValue({ name: 'docs', path: 'docs' });
      const res1 = createMockRes();

      // Missing name
      await handlers.mkdir({ body: { path: '' } }, res1);
      expect(res1.status).toHaveBeenCalledWith(400);
      expect(res1.json).toHaveBeenCalledWith({ success: false, error: 'Directory name is required' });

      // Valid name
      const res2 = createMockRes();
      await handlers.mkdir({ body: { path: '', name: 'docs' } }, res2);
      expect(res2.status).toHaveBeenCalledWith(201);
      expect(res2.json).toHaveBeenCalledWith({ success: true, data: { name: 'docs', path: 'docs' } });
    });

    it('rename handler validates itemPath and newName', async () => {
      renameSpy.mockResolvedValue({ oldName: 'a.txt', newName: 'b.txt' });
      const res1 = createMockRes();

      // Missing parameters
      await handlers.rename({ body: { path: 'a.txt' } }, res1);
      expect(res1.status).toHaveBeenCalledWith(400);

      // Valid rename
      const res2 = createMockRes();
      await handlers.rename({ body: { path: 'a.txt', newName: 'b.txt' } }, res2);
      expect(renameSpy).toHaveBeenCalledWith('/test/uploads', 'a.txt', 'b.txt');
      expect(res2.json).toHaveBeenCalledWith({ success: true, data: { oldName: 'a.txt', newName: 'b.txt' } });
    });

    it('move handler validates source and executes moveItem', async () => {
      moveSpy.mockResolvedValue({ source: 'a.txt', destination: 'folder/a.txt' });
      const res1 = createMockRes();

      // Missing source
      await handlers.move({ body: {} }, res1);
      expect(res1.status).toHaveBeenCalledWith(400);

      // Valid move
      const res2 = createMockRes();
      await handlers.move({ body: { source: 'a.txt', destination: 'folder' } }, res2);
      expect(moveSpy).toHaveBeenCalledWith('/test/uploads', 'a.txt', 'folder');
      expect(res2.json).toHaveBeenCalledWith({ success: true, data: { source: 'a.txt', destination: 'folder/a.txt' } });
    });

    it('delete handler enforces RBAC permission check', async () => {
      const res = createMockRes();
      const nonAdminReq = {
        session: { adminUser: { role: 'viewer' } },
        body: { path: 'file.txt' },
      };

      await handlers.delete(nonAdminReq, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringContaining('Permission denied'),
      }));
    });

    it('delete handler validates path and deletes item', async () => {
      deleteSpy.mockResolvedValue(true);
      const res = createMockRes();
      const adminReq = {
        session: { adminUser: { role: 'admin' } },
        body: { path: 'file.txt' },
      };

      await handlers.delete(adminReq, res);
      expect(deleteSpy).toHaveBeenCalledWith('/test/uploads', 'file.txt');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: true });
    });
  });

  describe('Upload API Handler', () => {
    const multer = require('multer');

    function createMockRes() {
      let resolveFn;
      const done = new Promise((resolve) => {
        resolveFn = resolve;
      });
      const res = {
        done,
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockImplementation((data) => {
          resolveFn(data);
          return res;
        }),
      };
      return res;
    }

    it('rejects upload when user lacks upload permissions', async () => {
      const handlers = createFileManagerApiHandlers({
        permissions: { upload: ['admin'] },
      });
      const res = createMockRes();
      const req = { session: { adminUser: { role: 'viewer' } } };

      handlers.upload(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringContaining('Permission denied'),
      }));
    });

    it('handles Multer LIMIT_FILE_SIZE error with 413', async () => {
      const multerErr = new multer.MulterError('LIMIT_FILE_SIZE');
      multerErr.code = 'LIMIT_FILE_SIZE';

      const mockMiddleware = (_req, _res, cb) => cb(multerErr);
      const handlers = createFileManagerApiHandlers({
        uploadMiddleware: mockMiddleware,
      });

      const res = createMockRes();
      handlers.upload({}, res);

      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'File too large' });
    });

    it('handles generic Multer or upload error with 400', async () => {
      const mockMiddleware = (_req, _res, cb) => cb(new Error('Corrupt stream'));
      const handlers = createFileManagerApiHandlers({
        uploadMiddleware: mockMiddleware,
      });

      const res = createMockRes();
      handlers.upload({}, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Corrupt stream' });
    });

    it('returns 400 when no files are uploaded', async () => {
      const mockMiddleware = (req, _res, cb) => {
        req.files = [];
        cb(null);
      };
      const handlers = createFileManagerApiHandlers({
        uploadMiddleware: mockMiddleware,
      });

      const res = createMockRes();
      handlers.upload({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'No files uploaded' });
    });

    it('enforces maxTotalStorageBytes quota check with 507', async () => {
      const calcStorageSpy = vi.spyOn(coreMod, 'calculateStorageUsage').mockResolvedValue(900);
      const mockMiddleware = (req, _res, cb) => {
        req.files = [{ originalname: 'big.png', size: 200, buffer: Buffer.alloc(200) }];
        cb(null);
      };

      const handlers = createFileManagerApiHandlers({
        maxTotalStorageBytes: 1000,
        uploadMiddleware: mockMiddleware,
      });

      const res = createMockRes();
      handlers.upload({ query: {} }, res);
      await res.done;

      expect(calcStorageSpy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(507);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringMatching(/quota exceeded/i),
      }));

      calcStorageSpy.mockRestore();
    });

    it('validates allowedExtensions with 400 error', async () => {
      const mockMiddleware = (req, _res, cb) => {
        req.files = [{ originalname: 'script.exe', mimetype: 'application/x-msdownload', size: 10 }];
        cb(null);
      };

      const handlers = createFileManagerApiHandlers({
        allowedExtensions: ['png', 'jpg'],
        uploadMiddleware: mockMiddleware,
      });

      const res = createMockRes();
      handlers.upload({ query: {} }, res);
      await res.done;

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringMatching(/File extension .exe is not allowed/i),
      }));
    });

    it('validates allowedMimeTypes with 415 error', async () => {
      const mockMiddleware = (req, _res, cb) => {
        req.files = [{ originalname: 'image.png', mimetype: 'text/plain', size: 10 }];
        cb(null);
      };

      const handlers = createFileManagerApiHandlers({
        allowedMimeTypes: ['image/png'],
        uploadMiddleware: mockMiddleware,
      });

      const res = createMockRes();
      handlers.upload({ query: {} }, res);
      await res.done;

      expect(res.status).toHaveBeenCalledWith(415);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringMatching(/MIME type text\/plain is not allowed/i),
      }));
    });

    it('successfully uploads and saves files with 201 response', async () => {
      const saveSpy = vi.spyOn(coreMod, 'saveUploadedFile').mockResolvedValue({
        name: 'test.png',
        url: '/uploads/test.png',
        size: 50,
      });

      const mockMiddleware = (req, _res, cb) => {
        req.file = {
          originalname: 'test.png',
          mimetype: 'image/png',
          buffer: Buffer.from('image-data'),
          size: 50,
        };
        cb(null);
      };

      const handlers = createFileManagerApiHandlers({
        baseDir: '/custom/uploads',
        publicBasePath: '/my-uploads',
        uploadMiddleware: mockMiddleware,
      });

      const res = createMockRes();
      handlers.upload({ query: { path: 'sub' } }, res);
      await res.done;

      expect(saveSpy).toHaveBeenCalledWith(
        '/custom/uploads',
        'sub',
        expect.any(Buffer),
        'test.png',
        'image/png',
        '/my-uploads',
        expect.any(Object)
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        files: [{ name: 'test.png', url: '/uploads/test.png', size: 50 }],
        count: 1,
      });

      saveSpy.mockRestore();
    });

    it('handles saveUploadedFile errors gracefully', async () => {
      const saveSpy = vi.spyOn(coreMod, 'saveUploadedFile').mockRejectedValue(new Error('Disk full'));

      const mockMiddleware = (req, _res, cb) => {
        req.files = [{
          originalname: 'test.png',
          mimetype: 'image/png',
          buffer: Buffer.from('data'),
        }];
        cb(null);
      };

      const handlers = createFileManagerApiHandlers({
        uploadMiddleware: mockMiddleware,
      });

      const res = createMockRes();
      handlers.upload({ query: {} }, res);
      await res.done;

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Disk full' });

      saveSpy.mockRestore();
    });
  });
});
