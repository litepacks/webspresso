/**
 * Unit tests for File Manager Core Engine & Services
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  resolveSafePath,
  sanitizeName,
  getFileType,
  listFiles,
  createDirectory,
  renameItem,
  deleteItem,
  moveItem,
  saveUploadedFile,
} from '../../../plugins/file-manager/core';
import { createFileManagerServices } from '../../../src/services/builtins/file-manager';

describe('File Manager Core & Security', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-fm-unit-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('resolveSafePath Security Checks', () => {
    it('resolves valid relative paths inside base directory', () => {
      const resolved = resolveSafePath(tmpDir, 'documents/notes.txt');
      expect(resolved).toBe(path.join(path.resolve(tmpDir), 'documents/notes.txt'));
    });

    it('rejects path traversal attempts with ..', () => {
      expect(() => resolveSafePath(tmpDir, '../outside.txt')).toThrow(/Directory traversal|Path traversal/i);
      expect(() => resolveSafePath(tmpDir, 'sub/../../etc/passwd')).toThrow(/Directory traversal|Path traversal/i);
    });

    it('rejects URL encoded path traversal attempts', () => {
      expect(() => resolveSafePath(tmpDir, '%2e%2e/secret.txt')).toThrow(/Directory traversal|Path traversal/i);
    });

    it('rejects null byte injection', () => {
      expect(() => resolveSafePath(tmpDir, 'safe.txt\0.exe')).toThrow(/Null byte/i);
    });
  });

  describe('sanitizeName', () => {
    it('allows valid filenames', () => {
      expect(sanitizeName('document-2026.pdf')).toBe('document-2026.pdf');
    });

    it('rejects path separators', () => {
      expect(() => sanitizeName('sub/folder')).toThrow(/path separators/i);
      expect(() => sanitizeName('sub\\folder')).toThrow(/path separators/i);
    });

    it('rejects dotfiles and empty strings', () => {
      expect(() => sanitizeName('.env')).toThrow(/Dotfiles/i);
      expect(() => sanitizeName('   ')).toThrow(/Name is required|Invalid/i);
      expect(() => sanitizeName('..')).toThrow(/Invalid/i);
    });
  });

  describe('getFileType categories', () => {
    it('correctly maps extensions to categories', () => {
      expect(getFileType('png')).toBe('image');
      expect(getFileType('.jpg')).toBe('image');
      expect(getFileType('pdf')).toBe('document');
      expect(getFileType('mp4')).toBe('video');
      expect(getFileType('mp3')).toBe('audio');
      expect(getFileType('zip')).toBe('archive');
      expect(getFileType('js')).toBe('code');
      expect(getFileType('xyz')).toBe('other');
    });
  });

  describe('CRUD Operations', () => {
    it('creates folders, renames, moves and deletes items', async () => {
      // 1. Create directory
      const mkdirRes = await createDirectory(tmpDir, '', 'photos');
      expect(mkdirRes.success).toBe(true);
      expect(mkdirRes.path).toBe('photos');

      // 2. Save uploaded file into folder
      const fileBuffer = Buffer.from('hello webspresso file manager');
      const uploaded = await saveUploadedFile(tmpDir, 'photos', fileBuffer, 'sample.txt', 'text/plain', '/uploads');
      expect(uploaded.path).toMatch(/^photos\//);
      expect(uploaded.publicUrl).toMatch(/^\/uploads\/photos\//);

      // 3. List directory
      const list = await listFiles(tmpDir, 'photos', { publicBasePath: '/uploads' });
      expect(list.items.length).toBe(1);
      expect(list.items[0].type).toBe('text');

      // 4. Rename file
      const oldPath = list.items[0].path;
      const renameRes = await renameItem(tmpDir, oldPath, 'renamed.txt');
      expect(renameRes.success).toBe(true);
      expect(renameRes.newName).toBe('renamed.txt');

      // 5. Create target subfolder and move file
      await createDirectory(tmpDir, 'photos', 'archive');
      const moveRes = await moveItem(tmpDir, renameRes.newPath, 'photos/archive');
      expect(moveRes.success).toBe(true);
      expect(moveRes.newPath).toBe('photos/archive/renamed.txt');

      // 6. Delete file
      const delRes = await deleteItem(tmpDir, moveRes.newPath);
      expect(delRes.success).toBe(true);

      // 7. Delete folder
      const delDirRes = await deleteItem(tmpDir, 'photos');
      expect(delDirRes.success).toBe(true);
    });
  });

  describe('Built-in Services Execution', () => {
    it('executes fileManager.* services properly', async () => {
      const services = createFileManagerServices({
        baseDir: tmpDir,
        publicBasePath: '/uploads',
      });

      // list empty
      const listResult = await services['fileManager.list'].handler({ path: '' });
      expect(listResult.items).toEqual([]);

      // mkdir
      await services['fileManager.mkdir'].handler({ name: 'media' });

      // upload via service (valid PNG magic bytes)
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const uploadRes = await services['fileManager.upload'].handler({
        path: 'media',
        buffer: validPng,
        originalName: 'hero.png',
        mimeType: 'image/png',
      });
      expect(uploadRes.publicUrl).toMatch(/^\/uploads\/media\//);

      // list with search
      const searched = await services['fileManager.list'].handler({
        path: 'media',
        search: 'hero',
      });
      expect(searched.items.length).toBe(1);
      expect(searched.items[0].type).toBe('image');
    });
  });
});
