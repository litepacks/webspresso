/**
 * Orphaned Uploads Pruner Unit Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import knex from 'knex';
const {
  formatBytes,
  scanDirectoryFiles,
  extractDbFileReferences,
  scanOrphanedUploads,
  pruneOrphanedUploads,
} = require('../../../plugins/upload/orphan-pruner');
const { uploadPlugin } = require('../../../plugins/upload/index');
const { registerCommand } = require('../../../bin/commands/upload-prune');

describe('Orphaned Uploads Pruner', () => {
  let tmpDir;
  let db;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webspresso-upload-test-'));

    const k = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await k.schema.createTable('users', (t) => {
      t.increments('id');
      t.string('email');
      t.string('avatar');
    });

    await k.schema.createTable('articles', (t) => {
      t.increments('id');
      t.string('title');
      t.text('content');
    });

    // Insert records referencing specific files
    await k('users').insert({
      email: 'john@example.com',
      avatar: '/uploads/user-avatar-1.jpg',
    });

    await k('articles').insert({
      title: 'Rich text article',
      content: '<p>Check out our chart <img src="/uploads/charts/report-2026.png" /></p>',
    });

    db = {
      knex: k,
      getAllModels: () => [
        { name: 'User', table: 'users' },
        { name: 'Article', table: 'articles' },
      ],
    };

    await populateSampleFiles();
  });

  const populateSampleFiles = async () => {
    await fs.mkdir(path.join(tmpDir, 'charts'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'old-folder'), { recursive: true });

    // Active referenced files
    await fs.writeFile(path.join(tmpDir, 'user-avatar-1.jpg'), 'AVATAR_IMAGE_DATA_12345');
    await fs.writeFile(path.join(tmpDir, 'charts', 'report-2026.png'), 'CHART_PNG_DATA_67890');

    // Orphaned files (never in DB)
    await fs.writeFile(path.join(tmpDir, 'abandoned-draft.pdf'), 'PDF_DATA_UNUSED');
    await fs.writeFile(path.join(tmpDir, 'old-folder', 'orphan-nested.docx'), 'NESTED_ORPHAN_DOC');
    await fs.writeFile(path.join(tmpDir, '.DS_Store'), 'IGNORED_HIDDEN_METADATA');
  };

  beforeEach(async () => {
    if (!fsSync.existsSync(path.join(tmpDir, 'abandoned-draft.pdf'))) {
      await populateSampleFiles();
    }
  });

  afterAll(async () => {
    if (db && db.knex) {
      await db.knex.destroy();
    }
    if (fsSync.existsSync(tmpDir)) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('formatBytes', () => {
    it('formats byte numbers into human readable strings', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
    });
  });

  describe('scanDirectoryFiles', () => {
    it('recursively discovers files and ignores hidden files', async () => {
      const files = await scanDirectoryFiles(tmpDir);
      const names = files.map((f) => f.relativePath).sort();

      expect(names).toContain('user-avatar-1.jpg');
      expect(names).toContain(path.join('charts', 'report-2026.png').replace(/\\/g, '/'));
      expect(names).toContain('abandoned-draft.pdf');
      expect(names).toContain(path.join('old-folder', 'orphan-nested.docx').replace(/\\/g, '/'));

      // Hidden files should be skipped
      expect(names).not.toContain('.DS_Store');
    });
  });

  describe('extractDbFileReferences', () => {
    it('extracts direct paths, basenames, and HTML embedded URLs from database', async () => {
      const refs = await extractDbFileReferences(db);

      expect(refs.has('user-avatar-1.jpg')).toBe(true);
      expect(refs.has('/uploads/user-avatar-1.jpg')).toBe(true);
      expect(refs.has('report-2026.png')).toBe(true);
      expect(refs.has('/uploads/charts/report-2026.png')).toBe(true);

      // Unused file should NOT be in references
      expect(refs.has('abandoned-draft.pdf')).toBe(false);
    });
  });

  describe('scanOrphanedUploads', () => {
    it('correctly partitions active referenced files and orphaned files', async () => {
      const scan = await scanOrphanedUploads({
        db,
        destDir: tmpDir,
        publicBasePath: '/uploads',
      });

      expect(scan.totalFiles).toBe(4);
      expect(scan.referencedCount).toBe(2);
      expect(scan.orphanedCount).toBe(2);
      expect(scan.orphanedBytes).toBeGreaterThan(0);

      const orphanedRelative = scan.orphanedFiles.map((f) => f.relativePath);
      expect(orphanedRelative).toContain('abandoned-draft.pdf');
      expect(orphanedRelative).toContain('old-folder/orphan-nested.docx');
    });

    it('returns empty summary when directory does not exist', async () => {
      const scan = await scanOrphanedUploads({
        db,
        destDir: path.join(tmpDir, 'non-existent-sub'),
      });
      expect(scan.totalFiles).toBe(0);
      expect(scan.orphanedCount).toBe(0);
      expect(scan.orphanedBytes).toBe(0);
    });
  });

  describe('pruneOrphanedUploads', () => {
    it('dryRun does not delete files from disk', async () => {
      const result = await pruneOrphanedUploads({
        db,
        destDir: tmpDir,
        publicBasePath: '/uploads',
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.orphanedCount).toBe(2);
      expect(result.deletedCount).toBe(0);

      // Confirm files still exist on disk
      expect(fsSync.existsSync(path.join(tmpDir, 'abandoned-draft.pdf'))).toBe(true);
      expect(fsSync.existsSync(path.join(tmpDir, 'old-folder', 'orphan-nested.docx'))).toBe(true);
    });

    it('deletes orphaned files and retains referenced active files', async () => {
      const result = await pruneOrphanedUploads({
        db,
        destDir: tmpDir,
        publicBasePath: '/uploads',
        dryRun: false,
      });

      expect(result.dryRun).toBe(false);
      expect(result.deletedCount).toBe(2);
      expect(result.deletedBytes).toBeGreaterThan(0);

      // Orphaned files should be deleted
      expect(fsSync.existsSync(path.join(tmpDir, 'abandoned-draft.pdf'))).toBe(false);
      expect(fsSync.existsSync(path.join(tmpDir, 'old-folder', 'orphan-nested.docx'))).toBe(false);

      // Referenced active files must remain
      expect(fsSync.existsSync(path.join(tmpDir, 'user-avatar-1.jpg'))).toBe(true);
      expect(fsSync.existsSync(path.join(tmpDir, 'charts', 'report-2026.png'))).toBe(true);
    });
  });

  describe('uploadPlugin API methods', () => {
    it('exposes scanOrphanedUploads and pruneOrphanedUploads on plugin.api', async () => {
      const plugin = uploadPlugin({
        local: { destDir: tmpDir },
      });

      expect(typeof plugin.api.scanOrphanedUploads).toBe('function');
      expect(typeof plugin.api.pruneOrphanedUploads).toBe('function');

      const scan = await plugin.api.scanOrphanedUploads({ db });
      expect(scan.totalFiles).toBe(4);
      expect(scan.orphanedCount).toBe(2);
    });
  });

  describe('CLI command registration', () => {
    it('registers upload:prune command on commander program', () => {
      const commandCalls = [];
      const program = {
        command: (name) => {
          commandCalls.push(name);
          return {
            description: () => ({
              option: function () { return this; },
              action: function () { return this; },
            }),
          };
        },
      };

      registerCommand(program);
      expect(commandCalls).toContain('upload:prune');
    });
  });
});
