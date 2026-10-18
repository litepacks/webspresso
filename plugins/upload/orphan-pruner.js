'use strict';

/**
 * Orphaned Uploads Scanner & Pruner
 * Identifies and deletes unreferenced uploaded files from disk.
 * Zero external dependencies.
 * @module plugins/upload/orphan-pruner
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { normalizePublicBase } = require('./local-file-provider');
const { safeJsonParse } = require('../../core/utils/json');

/**
 * Format bytes into human readable string
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Recursively find all files in a directory
 * @param {string} dir
 * @param {string} [baseDir]
 * @returns {Promise<Array<{ relativePath: string, absolutePath: string, size: number, mtime: Date }>>}
 */
async function scanDirectoryFiles(dir, baseDir = dir) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // ignore hidden files
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await scanDirectoryFiles(fullPath, baseDir);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        try {
          const st = await fs.stat(fullPath);
          const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
          results.push({
            relativePath,
            absolutePath: fullPath,
            size: st.size,
            mtime: st.mtime,
          });
        } catch (e) {
          // File might have been removed concurrently, ignore
        }
      }
    }
  } catch (e) {
    // Directory not accessible, ignore
  }
  return results;
}

/**
 * Extract all referenced file names and URL fragments from database
 * @param {Object} db - Database instance (with knex and optional models)
 * @returns {Promise<Set<string>>}
 */
async function extractDbFileReferences(db) {
  const references = new Set();
  if (!db || !db.knex) return references;

  const { getAllModels } = require('../../core/orm/model');
  const allModels = db.getAllModels ? db.getAllModels() : Array.from(getAllModels().values());
  const modelList = Array.isArray(allModels) ? allModels : Array.from(allModels.values());

  const tablesToScan = new Set();
  for (const model of modelList) {
    if (model.table) tablesToScan.add(model.table);
  }

  // Common additional tables
  const extraTables = ['admin_users', 'files', 'media', 'attachments', 'content_items'];
  for (const t of extraTables) {
    try {
      if (await db.knex.schema.hasTable(t)) {
        tablesToScan.add(t);
      }
    } catch (e) {}
  }

  function addStringReference(val) {
    if (typeof val !== 'string' || !val) return;
    const str = val.trim();
    if (!str) return;

    // Direct path or filename
    references.add(str);
    references.add(path.basename(str));

    // Normalized url without leading /
    references.add(str.replace(/^\/+/, ''));

    // Extract potential url/filename tokens inside rich-text or JSON
    const matches = str.match(/[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{2,8}/g);
    if (matches) {
      for (const m of matches) {
        references.add(m);
        references.add(path.basename(m));
        references.add(m.replace(/^\/+/, ''));
      }
    }
  }

  function scanValue(val) {
    if (val == null) return;
    if (typeof val === 'string') {
      addStringReference(val);
    } else if (Array.isArray(val)) {
      for (const item of val) scanValue(item);
    } else if (typeof val === 'object') {
      for (const k of Object.keys(val)) {
        scanValue(val[k]);
      }
    }
  }

  for (const table of tablesToScan) {
    try {
      const exists = await db.knex.schema.hasTable(table);
      if (!exists) continue;

      const rows = await db.knex(table).select();
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        for (const [key, value] of Object.entries(row)) {
          // If value is a JSON string, try to parse
          if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
            const parsed = safeJsonParse(value, null);
            if (parsed) {
              scanValue(parsed);
            } else {
              addStringReference(value);
            }
          } else {
            scanValue(value);
          }
        }
      }
    } catch (e) {
      // Table scan failed, ignore
    }
  }

  return references;
}

/**
 * Scan for orphaned upload files
 * @param {Object} options
 * @param {Object} [options.db] - Database instance
 * @param {string} [options.destDir] - Uploads directory on disk
 * @param {string} [options.publicBasePath='/uploads'] - Public URL base path
 * @returns {Promise<Object>}
 */
async function scanOrphanedUploads(options = {}) {
  const { db, publicBasePath = '/uploads' } = options;
  const destDir = path.resolve(
    options.destDir || path.join(process.cwd(), 'public', 'uploads')
  );

  let diskFiles = [];
  if (fsSync.existsSync(destDir)) {
    diskFiles = await scanDirectoryFiles(destDir);
  }

  let totalBytes = 0;
  for (const f of diskFiles) {
    totalBytes += f.size;
  }

  const dbReferences = await extractDbFileReferences(db);
  const normalizedBase = normalizePublicBase(publicBasePath);

  const orphanedFiles = [];
  const referencedFiles = [];

  for (const file of diskFiles) {
    const baseName = path.basename(file.relativePath);
    const fullPublicUrl = `${normalizedBase}/${file.relativePath}`.replace(/\/{2,}/g, '/');

    // Check if filename, relative path, or public url is referenced in DB
    const isReferenced =
      dbReferences.has(file.relativePath) ||
      dbReferences.has(baseName) ||
      dbReferences.has(fullPublicUrl) ||
      dbReferences.has(fullPublicUrl.replace(/^\/+/, ''));

    if (isReferenced) {
      referencedFiles.push(file);
    } else {
      orphanedFiles.push({
        ...file,
        publicUrl: fullPublicUrl,
      });
    }
  }

  let orphanedBytes = 0;
  for (const f of orphanedFiles) {
    orphanedBytes += f.size;
  }

  return {
    destDir,
    totalFiles: diskFiles.length,
    totalBytes,
    totalBytesFormatted: formatBytes(totalBytes),
    referencedCount: referencedFiles.length,
    orphanedCount: orphanedFiles.length,
    orphanedBytes,
    orphanedBytesFormatted: formatBytes(orphanedBytes),
    orphanedFiles,
  };
}

/**
 * Prune orphaned uploads from disk
 * @param {Object} options
 * @param {Object} [options.db] - Database instance
 * @param {string} [options.destDir] - Uploads directory on disk
 * @param {string} [options.publicBasePath='/uploads'] - Public URL base path
 * @param {boolean} [options.dryRun=false] - Only scan without deleting
 * @returns {Promise<Object>}
 */
async function pruneOrphanedUploads(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const scan = await scanOrphanedUploads(options);

  if (dryRun || scan.orphanedCount === 0) {
    return {
      ...scan,
      dryRun,
      deletedCount: 0,
      deletedBytes: 0,
      deletedBytesFormatted: formatBytes(0),
      deletedFiles: [],
    };
  }

  const deletedFiles = [];
  let deletedBytes = 0;

  for (const file of scan.orphanedFiles) {
    try {
      await fs.unlink(file.absolutePath);
      deletedFiles.push(file.relativePath);
      deletedBytes += file.size;

      // Try to clean up empty parent directories
      const parentDir = path.dirname(file.absolutePath);
      if (parentDir !== scan.destDir) {
        try {
          const contents = await fs.readdir(parentDir);
          if (contents.length === 0) {
            await fs.rmdir(parentDir);
          }
        } catch (e) {}
      }
    } catch (e) {
      // Deletion error, ignore
    }
  }

  return {
    ...scan,
    dryRun: false,
    deletedCount: deletedFiles.length,
    deletedBytes,
    deletedBytesFormatted: formatBytes(deletedBytes),
    deletedFiles,
  };
}

module.exports = {
  formatBytes,
  scanDirectoryFiles,
  extractDbFileReferences,
  scanOrphanedUploads,
  pruneOrphanedUploads,
};
