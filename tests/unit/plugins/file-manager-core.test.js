/**
 * Unit tests for File Manager Core Engine
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  resolveSafePath,
  sanitizeName,
  getFileType,
  listFiles,
  createDirectory,
  renameItem,
  moveItem,
  deleteItem,
  calculateStorageUsage,
  saveUploadedFile,
} from '../../../plugins/file-manager/core';
import { ValidationError, SecurityError, NotFoundError } from '../../../core/errors';

describe('File Manager Core Engine', () => {
  let tempBaseDir;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-core-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup error
    }
  });

  describe('resolveSafePath', () => {
    it('validates baseDir and returns normalized base when relPath is empty', () => {
      expect(() => resolveSafePath('')).toThrow(ValidationError);
      expect(() => resolveSafePath(null)).toThrow(ValidationError);
      expect(() => resolveSafePath(tempBaseDir, 123)).toThrow(ValidationError);

      const resolved = resolveSafePath(tempBaseDir, '');
      expect(resolved).toBe(path.resolve(tempBaseDir));
    });

    it('blocks null byte injections', () => {
      expect(() => resolveSafePath(tempBaseDir, 'test\0file.txt')).toThrow(SecurityError);
      expect(() => resolveSafePath(tempBaseDir, 'test%00file.txt')).toThrow(SecurityError);
    });

    it('blocks directory traversal attempts', () => {
      expect(() => resolveSafePath(tempBaseDir, '../outside.txt')).toThrow(SecurityError);
      expect(() => resolveSafePath(tempBaseDir, 'sub/../../outside.txt')).toThrow(SecurityError);
      expect(() => resolveSafePath(tempBaseDir, 'sub/./file.txt')).toThrow(SecurityError);
    });

    it('resolves safe relative path within baseDir', () => {
      const resolved = resolveSafePath(tempBaseDir, 'documents/notes.txt');
      expect(resolved).toBe(path.resolve(tempBaseDir, 'documents/notes.txt'));
    });
  });

  describe('sanitizeName', () => {
    it('rejects invalid names or path separators', () => {
      expect(() => sanitizeName('')).toThrow(ValidationError);
      expect(() => sanitizeName('.')).toThrow(ValidationError);
      expect(() => sanitizeName('..')).toThrow(ValidationError);
      expect(() => sanitizeName('folder/name')).toThrow(ValidationError);
      expect(() => sanitizeName('folder\\name')).toThrow(ValidationError);
      expect(() => sanitizeName('.hidden')).toThrow(ValidationError);
    });

    it('returns trimmed valid name', () => {
      expect(sanitizeName('  my_folder  ')).toBe('my_folder');
      expect(sanitizeName('report-2026.pdf')).toBe('report-2026.pdf');
    });
  });

  describe('getFileType', () => {
    it('categorizes extensions correctly', () => {
      expect(getFileType('png')).toBe('image');
      expect(getFileType('.jpg')).toBe('image');
      expect(getFileType('pdf')).toBe('document');
      expect(getFileType('txt')).toBe('text');
      expect(getFileType('js')).toBe('code');
      expect(getFileType('mp3')).toBe('audio');
      expect(getFileType('mp4')).toBe('video');
      expect(getFileType('zip')).toBe('archive');
      expect(getFileType('unknown_xyz')).toBe('other');
    });
  });

  describe('Filesystem CRUD Operations', () => {
    it('creates directories safely and prevents duplicates', async () => {
      const dir = await createDirectory(tempBaseDir, '', 'photos');
      expect(dir.name).toBe('photos');
      expect(dir.success).toBe(true);
      expect(dir.path).toBe('photos');

      // Duplicate should fail
      await expect(createDirectory(tempBaseDir, '', 'photos')).rejects.toThrow(/already exists/i);
    });

    it('lists files with sorting and filtering', async () => {
      await fs.writeFile(path.join(tempBaseDir, 'b_file.txt'), 'content B');
      await fs.writeFile(path.join(tempBaseDir, 'a_file.png'), 'content A');
      await fs.mkdir(path.join(tempBaseDir, 'subfolder'));

      const listAsc = await listFiles(tempBaseDir, '', { sort: 'name', order: 'asc' });
      expect(listAsc.items.length).toBe(3);
      // Folders come first by default, then files sorted
      expect(listAsc.items[0].type).toBe('folder');
      expect(listAsc.items[0].isDir).toBe(true);
      expect(listAsc.items[0].name).toBe('subfolder');
      expect(listAsc.items[1].name).toBe('a_file.png');
      expect(listAsc.items[2].name).toBe('b_file.txt');

      // Search filter
      const searchRes = await listFiles(tempBaseDir, '', { search: 'b_file' });
      expect(searchRes.items.length).toBe(1);
      expect(searchRes.items[0].name).toBe('b_file.txt');

      // Type filter preserves folders but filters files
      const imageRes = await listFiles(tempBaseDir, '', { type: 'image' });
      const imageFiles = imageRes.items.filter((i) => !i.isDir);
      expect(imageFiles.length).toBe(1);
      expect(imageFiles[0].name).toBe('a_file.png');
    });

    it('renames files and directories', async () => {
      const originalPath = path.join(tempBaseDir, 'old.txt');
      await fs.writeFile(originalPath, 'hello');

      const result = await renameItem(tempBaseDir, 'old.txt', 'new.txt');
      expect(result.oldPath).toBe('old.txt');
      expect(result.newName).toBe('new.txt');

      const existsNew = await fs.stat(path.join(tempBaseDir, 'new.txt')).then(() => true).catch(() => false);
      expect(existsNew).toBe(true);

      // Renaming non-existent item should fail
      await expect(renameItem(tempBaseDir, 'ghost.txt', 'fail.txt')).rejects.toThrow(NotFoundError);
    });

    it('moves files into destination directory', async () => {
      await fs.mkdir(path.join(tempBaseDir, 'target_dir'));
      await fs.writeFile(path.join(tempBaseDir, 'doc.txt'), 'move me');

      const moved = await moveItem(tempBaseDir, 'doc.txt', 'target_dir');
      expect(moved.oldPath).toBe('doc.txt');
      expect(moved.newPath).toBe('target_dir/doc.txt');

      const existsTarget = await fs.stat(path.join(tempBaseDir, 'target_dir', 'doc.txt')).then(() => true).catch(() => false);
      expect(existsTarget).toBe(true);
    });

    it('deletes files and directories recursively', async () => {
      const filePath = path.join(tempBaseDir, 'delete_me.txt');
      await fs.writeFile(filePath, 'del');

      const result = await deleteItem(tempBaseDir, 'delete_me.txt');
      expect(result.success).toBe(true);

      const exists = await fs.stat(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(false);

      // Deleting root directory is blocked
      await expect(deleteItem(tempBaseDir, '')).rejects.toThrow(/Cannot delete root/);
    });

    it('calculates storage usage recursively', async () => {
      await fs.writeFile(path.join(tempBaseDir, 'f1.txt'), Buffer.alloc(100));
      await fs.mkdir(path.join(tempBaseDir, 'nested'));
      await fs.writeFile(path.join(tempBaseDir, 'nested', 'f2.txt'), Buffer.alloc(250));

      const total = await calculateStorageUsage(tempBaseDir);
      expect(total).toBe(350);
    });

    it('saves uploaded file with security verification and public path resolution', async () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const saved = await saveUploadedFile(
        tempBaseDir,
        'uploads',
        pngBuffer,
        'test-image.png',
        'image/png',
        '/static/uploads'
      );

      expect(saved.name).toContain('test-image');
      expect(saved.ext).toBe('png');
      expect(saved.type).toBe('image');
      expect(saved.publicUrl).toContain('/static/uploads/uploads/');
      expect(saved.size).toBe(pngBuffer.length);
    });
  });
});
