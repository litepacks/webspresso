/**
 * File Manager Core Engine — Safe filesystem operations, traversal protection & metadata resolution.
 * @module plugins/file-manager/core
 */

const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { randomBytes } = require('crypto');
const { ValidationError, SecurityError, NotFoundError } = require('../../core/errors');
const { normalizePublicBase, canonicalExtFromMime } = require('../upload/local-file-provider');
const {
  validateSafeExtension,
  validateMagicBytes,
  sanitizeSvgContent,
} = require('./security');

/**
 * File category map by extension
 */
const EXTENSION_CATEGORIES = {
  // Images
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  tiff: 'image',

  // Documents
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  odt: 'document',
  ods: 'document',
  odp: 'document',
  rtf: 'document',

  // Text & Code
  txt: 'text',
  csv: 'text',
  md: 'text',
  json: 'code',
  xml: 'code',
  html: 'code',
  css: 'code',
  js: 'code',
  ts: 'code',
  jsx: 'code',
  tsx: 'code',
  sql: 'code',
  yaml: 'code',
  yml: 'code',

  // Audio
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  flac: 'audio',
  aac: 'audio',
  weba: 'audio',

  // Video
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  wmv: 'video',

  // Archives
  zip: 'archive',
  rar: 'archive',
  tar: 'archive',
  gz: 'archive',
  '7z': 'archive',
  bz2: 'archive',
};

const MIME_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  gz: 'application/gzip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
};

/**
 * Validate and safely resolve relative path within baseDir to prevent path traversal.
 * @param {string} baseDir - Base root directory
 * @param {string} [relPath=''] - Relative path inside baseDir
 * @returns {string} Absolute normalized filesystem path
 */
function resolveSafePath(baseDir, relPath = '') {
  if (typeof baseDir !== 'string' || !baseDir.trim()) {
    throw new ValidationError('Invalid base directory');
  }

  const normalizedBase = path.resolve(baseDir);

  if (relPath == null || relPath === '') {
    return normalizedBase;
  }

  if (typeof relPath !== 'string') {
    throw new ValidationError('Path must be a string');
  }

  // Detect null byte injection
  if (relPath.includes('\0')) {
    throw new SecurityError('Null byte detected in path', 400);
  }

  // Prevent URL decoded traversal attempts
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(relPath);
  } catch (err) {
    throw new ValidationError('Malformed URI path sequence', 400);
  }
  if (decodedPath.includes('\0')) {
    throw new SecurityError('Null byte detected in path', 400);
  }

  // Normalize slashes
  const cleanRel = decodedPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = cleanRel.split('/');
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new SecurityError('Directory traversal attempt detected', 403);
    }
  }

  const targetPath = path.resolve(normalizedBase, cleanRel);

  // Guarantee target is within baseDir
  if (!targetPath.startsWith(normalizedBase + path.sep) && targetPath !== normalizedBase) {
    throw new SecurityError('Path traversal attempt detected', 403);
  }

  return targetPath;
}

/**
 * Sanitize a single filename or folder name.
 * @param {string} name
 * @returns {string} Clean name
 */
function sanitizeName(name) {
  if (!name || typeof name !== 'string') {
    throw new ValidationError('Name is required');
  }

  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new ValidationError('Invalid file or directory name');
  }

  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    throw new ValidationError('Name cannot contain path separators or null bytes');
  }

  // Disallow hidden or risky filenames
  if (trimmed.startsWith('.')) {
    throw new ValidationError('Dotfiles are not allowed');
  }

  return trimmed;
}

/**
 * Get category type of a file
 * @param {string} ext
 * @returns {string} 'image' | 'document' | 'video' | 'audio' | 'archive' | 'code' | 'text' | 'other'
 */
function getFileType(ext) {
  const cleanExt = (ext || '').replace(/^\./, '').toLowerCase();
  return EXTENSION_CATEGORIES[cleanExt] || 'other';
}

/**
 * Guess MIME type from extension
 * @param {string} ext
 * @returns {string}
 */
function getMimeType(ext) {
  const cleanExt = (ext || '').replace(/^\./, '').toLowerCase();
  return MIME_MAP[cleanExt] || 'application/octet-stream';
}

/**
 * Compute breadcrumbs array for navigation
 * @param {string} relPath
 * @returns {Array<{ name: string, path: string }>}
 */
function buildBreadcrumbs(relPath) {
  const breadcrumbs = [{ name: 'Root', path: '' }];
  if (!relPath) return breadcrumbs;

  const segments = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  let current = '';

  for (const seg of segments) {
    current = current ? `${current}/${seg}` : seg;
    breadcrumbs.push({ name: seg, path: current });
  }

  return breadcrumbs;
}

/**
 * List files and directories in relativePath.
 * @param {string} baseDir
 * @param {string} [relPath='']
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function listFiles(baseDir, relPath = '', options = {}) {
  const targetDir = resolveSafePath(baseDir, relPath);
  const normalizedRel = path.relative(path.resolve(baseDir), targetDir).replace(/\\/g, '/');
  const publicBase = normalizePublicBase(options.publicBasePath);

  let dirents;
  try {
    dirents = await fs.readdir(targetDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new NotFoundError(`Directory not found: ${relPath}`);
    }
    throw err;
  }

  const items = [];
  let dirsCount = 0;
  let filesCount = 0;

  for (const dirent of dirents) {
    // Ignore hidden files / dotfiles (.git, .DS_Store, etc.)
    if (dirent.name.startsWith('.')) continue;

    const itemRelPath = normalizedRel ? `${normalizedRel}/${dirent.name}` : dirent.name;
    const fullPath = path.join(targetDir, dirent.name);

    if (dirent.isDirectory()) {
      dirsCount++;
      let mtime = null;
      try {
        const stats = await fs.stat(fullPath);
        mtime = stats.mtime;
      } catch (e) {}

      items.push({
        name: dirent.name,
        isDir: true,
        path: itemRelPath,
        size: 0,
        mtime,
        ext: '',
        type: 'folder',
        mimeType: '',
        publicUrl: null,
      });
    } else if (dirent.isFile()) {
      filesCount++;
      try {
        const stats = await fs.stat(fullPath);
        const ext = path.extname(dirent.name).replace(/^\./, '').toLowerCase();
        const type = getFileType(ext);
        const mimeType = getMimeType(ext);
        const publicUrl = `${publicBase}/${itemRelPath}`.replace(/\/{2,}/g, '/');

        items.push({
          name: dirent.name,
          isDir: false,
          path: itemRelPath,
          size: stats.size,
          mtime: stats.mtime,
          ext,
          type,
          mimeType,
          publicUrl,
        });
      } catch (e) {
        // Skip unreadable files
      }
    }
  }

  // Filter: Search
  let filtered = items;
  if (options.search && typeof options.search === 'string') {
    const q = options.search.toLowerCase().trim();
    filtered = filtered.filter((i) => i.name.toLowerCase().includes(q));
  }

  // Filter: Type
  if (options.type && options.type !== 'all') {
    const targetType = String(options.type).toLowerCase();
    filtered = filtered.filter((i) => i.isDir || i.type === targetType);
  }

  // Sorting
  const sortBy = options.sort || 'name';
  const order = (options.order || 'asc').toLowerCase() === 'desc' ? -1 : 1;

  filtered.sort((a, b) => {
    // Folders always come first
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;

    if (sortBy === 'size') {
      return (a.size - b.size) * order;
    }
    if (sortBy === 'mtime') {
      const timeA = a.mtime ? new Date(a.mtime).getTime() : 0;
      const timeB = b.mtime ? new Date(b.mtime).getTime() : 0;
      return (timeA - timeB) * order;
    }
    if (sortBy === 'ext') {
      return (a.ext || '').localeCompare(b.ext || '') * order;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * order;
  });

  const total = filtered.length;
  let pagedItems = filtered;

  if (options.page && options.perPage) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const perPage = Math.max(1, parseInt(options.perPage, 10) || 20);
    const start = (page - 1) * perPage;
    pagedItems = filtered.slice(start, start + perPage);
  }

  return {
    path: normalizedRel,
    breadcrumbs: buildBreadcrumbs(normalizedRel),
    items: pagedItems,
    total,
    dirsCount,
    filesCount,
    page: options.page ? parseInt(options.page, 10) : 1,
    perPage: options.perPage ? parseInt(options.perPage, 10) : total,
  };
}

/**
 * Create a new folder
 * @param {string} baseDir
 * @param {string} parentRelPath
 * @param {string} name
 * @returns {Promise<{ success: boolean, path: string, name: string }>}
 */
async function createDirectory(baseDir, parentRelPath, name) {
  const safeName = sanitizeName(name);
  const parentDir = resolveSafePath(baseDir, parentRelPath);
  const targetDir = path.join(parentDir, safeName);

  // Security check on target
  resolveSafePath(baseDir, path.relative(baseDir, targetDir));

  try {
    await fs.mkdir(targetDir, { recursive: false });
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new ValidationError(`Directory already exists: ${safeName}`);
    }
    throw err;
  }

  const relNewPath = path.relative(path.resolve(baseDir), targetDir).replace(/\\/g, '/');
  return { success: true, path: relNewPath, name: safeName };
}

/**
 * Rename a file or folder
 * @param {string} baseDir
 * @param {string} itemRelPath
 * @param {string} newName
 * @returns {Promise<{ success: boolean, oldPath: string, newPath: string, newName: string }>}
 */
async function renameItem(baseDir, itemRelPath, newName) {
  const safeNewName = sanitizeName(newName);
  const oldFullPath = resolveSafePath(baseDir, itemRelPath);
  const parentDir = path.dirname(oldFullPath);
  const newFullPath = path.join(parentDir, safeNewName);

  // Security check
  resolveSafePath(baseDir, path.relative(baseDir, newFullPath));

  try {
    await fs.access(oldFullPath);
  } catch (e) {
    throw new NotFoundError(`File or folder not found: ${itemRelPath}`);
  }

  try {
    await fs.rename(oldFullPath, newFullPath);
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new ValidationError(`An item named "${safeNewName}" already exists`);
    }
    throw err;
  }

  const relNewPath = path.relative(path.resolve(baseDir), newFullPath).replace(/\\/g, '/');
  return { success: true, oldPath: itemRelPath, newPath: relNewPath, newName: safeNewName };
}

/**
 * Delete a file or folder safely
 * @param {string} baseDir
 * @param {string} itemRelPath
 * @returns {Promise<{ success: boolean, path: string }>}
 */
async function deleteItem(baseDir, itemRelPath) {
  if (!itemRelPath || itemRelPath.trim() === '' || itemRelPath === '/') {
    throw new SecurityError('Cannot delete root directory', 403);
  }

  const targetFullPath = resolveSafePath(baseDir, itemRelPath);

  let stats;
  try {
    stats = await fs.stat(targetFullPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new NotFoundError(`Item not found: ${itemRelPath}`);
    }
    throw err;
  }

  if (stats.isDirectory()) {
    await fs.rm(targetFullPath, { recursive: true, force: true });
  } else {
    await fs.unlink(targetFullPath);
  }

  invalidateStorageCache(baseDir);
  return { success: true, path: itemRelPath };
}

/**
 * Move a file or folder into a destination directory
 * @param {string} baseDir
 * @param {string} sourceRelPath
 * @param {string} destDirRelPath
 * @returns {Promise<{ success: boolean, oldPath: string, newPath: string }>}
 */
async function moveItem(baseDir, sourceRelPath, destDirRelPath) {
  if (!sourceRelPath) throw new ValidationError('Source path is required');
  const sourceFullPath = resolveSafePath(baseDir, sourceRelPath);
  const destDirFullPath = resolveSafePath(baseDir, destDirRelPath || '');

  const itemName = path.basename(sourceFullPath);
  const targetFullPath = path.join(destDirFullPath, itemName);

  // Ensure target doesn't move a folder into itself
  if (targetFullPath.startsWith(sourceFullPath + path.sep)) {
    throw new ValidationError('Cannot move a folder into its own subdirectory');
  }

  resolveSafePath(baseDir, path.relative(baseDir, targetFullPath));

  await fs.rename(sourceFullPath, targetFullPath);

  const newRelPath = path.relative(path.resolve(baseDir), targetFullPath).replace(/\\/g, '/');
  return { success: true, oldPath: sourceRelPath, newPath: newRelPath };
}

const storageCache = new Map();
const STORAGE_CACHE_TTL = 15000; // 15 seconds

function invalidateStorageCache(baseDir) {
  if (baseDir) {
    storageCache.delete(path.resolve(baseDir));
  } else {
    storageCache.clear();
  }
}

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Detailed storage statistics including category breakdown and quota
 * @param {string} baseDir
 * @param {Object} [options]
 * @param {boolean} [options.forceRefresh=false]
 * @param {number|null} [options.maxTotalStorageBytes]
 * @returns {Promise<Object>}
 */
async function getDetailedStorageStats(baseDir, options = {}) {
  const resolvedBase = path.resolve(baseDir);
  const now = Date.now();
  const cached = storageCache.get(resolvedBase);

  if (!options.forceRefresh && cached && cached.stats && (now - cached.timestamp) < STORAGE_CACHE_TTL) {
    return applyQuota(cached.stats, options.maxTotalStorageBytes);
  }

  let totalBytes = 0;
  let fileCount = 0;
  let folderCount = 0;

  const categories = {
    images: { count: 0, bytes: 0, percent: 0, label: 'Images', color: '#10b981', formattedBytes: '0 B' },
    documents: { count: 0, bytes: 0, percent: 0, label: 'Documents', color: '#6366f1', formattedBytes: '0 B' },
    code: { count: 0, bytes: 0, percent: 0, label: 'Code & Text', color: '#f59e0b', formattedBytes: '0 B' },
    media: { count: 0, bytes: 0, percent: 0, label: 'Video & Audio', color: '#ec4899', formattedBytes: '0 B' },
    archives: { count: 0, bytes: 0, percent: 0, label: 'Archives', color: '#8b5cf6', formattedBytes: '0 B' },
    other: { count: 0, bytes: 0, percent: 0, label: 'Other', color: '#94a3b8', formattedBytes: '0 B' },
  };

  async function scan(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          folderCount++;
          await scan(full);
        } else if (entry.isFile()) {
          fileCount++;
          const st = await fs.stat(full);
          const size = st.size;
          totalBytes += size;

          const ext = (path.extname(entry.name) || '').toLowerCase().replace(/^\./, '');
          const catType = EXTENSION_CATEGORIES[ext] || 'other';

          if (catType === 'image') {
            categories.images.count++;
            categories.images.bytes += size;
          } else if (catType === 'document') {
            categories.documents.count++;
            categories.documents.bytes += size;
          } else if (catType === 'text' || catType === 'code') {
            categories.code.count++;
            categories.code.bytes += size;
          } else if (catType === 'video' || catType === 'audio') {
            categories.media.count++;
            categories.media.bytes += size;
          } else if (catType === 'archive') {
            categories.archives.count++;
            categories.archives.bytes += size;
          } else {
            categories.other.count++;
            categories.other.bytes += size;
          }
        }
      }
    } catch (e) {}
  }

  await scan(resolvedBase);

  // Compute category percentages and format strings
  if (totalBytes > 0) {
    for (const key of Object.keys(categories)) {
      categories[key].percent = Math.round((categories[key].bytes / totalBytes) * 1000) / 10;
      categories[key].formattedBytes = formatBytes(categories[key].bytes);
    }
  }

  const rawStats = {
    totalBytes,
    fileCount,
    folderCount,
    categories,
    formattedTotal: formatBytes(totalBytes),
  };

  storageCache.set(resolvedBase, { bytes: totalBytes, stats: rawStats, timestamp: now });
  return applyQuota(rawStats, options.maxTotalStorageBytes);
}

function applyQuota(stats, quotaBytes) {
  const quota = typeof quotaBytes === 'number' && quotaBytes > 0 ? quotaBytes : (1024 * 1024 * 1024); // 1 GB default quota
  const hasCustomQuota = typeof quotaBytes === 'number' && quotaBytes > 0;
  const usagePercent = quota > 0 ? Math.min(100, Math.round((stats.totalBytes / quota) * 1000) / 10) : 0;
  const freeBytes = Math.max(0, quota - stats.totalBytes);

  return {
    ...stats,
    quotaBytes: quota,
    hasCustomQuota,
    freeBytes,
    formattedFree: formatBytes(freeBytes),
    formattedQuota: formatBytes(quota),
    usagePercent,
    isNearLimit: usagePercent >= 80,
    isOverLimit: stats.totalBytes >= quota,
  };
}

/**
 * Calculate total disk usage in bytes under baseDir
 * @param {string} baseDir
 * @param {Object} [options]
 * @param {boolean} [options.forceRefresh=false]
 * @returns {Promise<number>}
 */
async function calculateStorageUsage(baseDir, options = {}) {
  const stats = await getDetailedStorageStats(baseDir, options);
  return stats.totalBytes;
}

/**
 * Save an uploaded buffer to a specific target relative folder
 * @param {string} baseDir
 * @param {string} targetDirRelPath
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {string} [mimeType]
 * @param {string} [publicBasePath]
 * @param {Object} [securityOpts]
 * @returns {Promise<Object>}
 */
async function saveUploadedFile(baseDir, targetDirRelPath, buffer, originalName, mimeType, publicBasePath, securityOpts = {}) {
  const destDir = resolveSafePath(baseDir, targetDirRelPath || '');
  await fs.mkdir(destDir, { recursive: true });

  const safeOriginal = path.basename(originalName || 'upload');

  // Security 1: Validate dangerous & double extensions
  const cleanExt = validateSafeExtension(safeOriginal);
  let ext = `.${cleanExt}`;

  const fromMime = canonicalExtFromMime(mimeType);
  if (fromMime && ext !== fromMime) {
    ext = fromMime;
  }

  let finalBuffer = buffer;

  // Security 2: SVG Stored XSS Sanitization
  if (cleanExt === 'svg' || mimeType === 'image/svg+xml') {
    if (securityOpts.sanitizeSvg !== false) {
      finalBuffer = sanitizeSvgContent(finalBuffer);
    }
  }

  // Security 3: Magic Bytes Verification
  if (securityOpts.validateMagicBytes !== false) {
    validateMagicBytes(finalBuffer, cleanExt);
  }

  let baseNameOnly = path.basename(safeOriginal, path.extname(safeOriginal)).replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'file';
  let storedName = `${baseNameOnly}${ext}`;
  let targetPath = path.join(destDir, storedName);

  try {
    await fs.access(targetPath);
    storedName = `${baseNameOnly}-${Date.now()}${ext}`;
    targetPath = path.join(destDir, storedName);
  } catch (e) {
    // Safe to use original clean name
  }

  resolveSafePath(baseDir, path.relative(baseDir, targetPath));

  await fs.writeFile(targetPath, finalBuffer);
  invalidateStorageCache(baseDir);

  const relFilePath = path.relative(path.resolve(baseDir), targetPath).replace(/\\/g, '/');
  const publicBase = normalizePublicBase(publicBasePath);
  const publicUrl = `${publicBase}/${relFilePath}`.replace(/\/{2,}/g, '/');

  return {
    name: storedName,
    originalName: safeOriginal,
    path: relFilePath,
    publicUrl,
    size: finalBuffer.length,
    mimeType: mimeType || getMimeType(ext),
    ext: ext.replace(/^\./, ''),
    type: getFileType(ext),
  };
}

/**
 * Save an edited image (from data URL or buffer)
 * @param {string} baseDir - Base root directory
 * @param {string} itemPath - Relative file path of the image
 * @param {string|Buffer} data - Base64 Data URL or raw Buffer
 * @param {Object} [options] - Options: overwrite, newName, publicBasePath
 * @returns {Promise<Object>}
 */
async function saveEditedImage(baseDir, itemPath, data, options = {}) {
  const { overwrite = false, newName, publicBasePath = '' } = options;
  const currentPath = resolveSafePath(baseDir, itemPath);

  let buffer;
  let mimeType = '';
  if (typeof data === 'string') {
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      buffer = Buffer.from(match[2], 'base64');
    } else {
      buffer = Buffer.from(data, 'base64');
    }
  } else if (Buffer.isBuffer(data)) {
    buffer = data;
  } else {
    throw new ValidationError('Invalid image data provided');
  }

  const dir = path.dirname(currentPath);
  const origExt = path.extname(currentPath);
  const baseName = path.basename(currentPath, origExt);

  let finalTarget;
  let finalFileName;

  if (overwrite) {
    finalTarget = currentPath;
    finalFileName = path.basename(currentPath);
  } else {
    const ext = mimeType === 'image/webp' ? '.webp' : (mimeType === 'image/jpeg' ? '.jpg' : (mimeType === 'image/png' ? '.png' : origExt));
    const targetName = newName ? sanitizeName(newName) : `${baseName}-edited${ext}`;
    finalFileName = targetName;
    finalTarget = path.join(dir, targetName);

    try {
      await fs.access(finalTarget);
      finalFileName = `${baseName}-edited-${Date.now()}${ext}`;
      finalTarget = path.join(dir, finalFileName);
    } catch {}
  }

  resolveSafePath(baseDir, path.relative(baseDir, finalTarget));

  await fs.writeFile(finalTarget, buffer);
  invalidateStorageCache(baseDir);

  const relFilePath = path.relative(path.resolve(baseDir), finalTarget).replace(/\\/g, '/');
  const publicBase = normalizePublicBase(publicBasePath);
  const publicUrl = `${publicBase}/${relFilePath}`.replace(/\/{2,}/g, '/');
  const ext = path.extname(finalFileName).replace(/^\./, '').toLowerCase();

  return {
    name: finalFileName,
    path: relFilePath,
    publicUrl,
    size: buffer.length,
    mimeType: mimeType || getMimeType(ext),
    ext,
    type: 'image',
  };
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'csv', 'md', 'markdown', 'json', 'xml', 'html', 'htm',
  'css', 'scss', 'sass', 'less', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'sql', 'yaml', 'yml', 'env', 'sh', 'bash', 'log', 'ini', 'toml',
  'svg', 'gitignore', 'conf', 'config',
]);

/**
 * Check if a file extension is eligible for text/code editing
 * @param {string} ext
 * @returns {boolean}
 */
function isTextEditable(ext) {
  if (!ext) return false;
  const cleanExt = ext.replace(/^\./, '').toLowerCase();
  return TEXT_EXTENSIONS.has(cleanExt);
}

/**
 * Safely read a text/configuration file's content
 * @param {string} baseDir
 * @param {string} itemPath
 * @param {Object} [options]
 * @param {number} [options.maxTextBytes=5242880] (5MB default)
 * @returns {Promise<Object>}
 */
async function getFileContent(baseDir, itemPath, options = {}) {
  const target = resolveSafePath(baseDir, itemPath);
  const maxBytes = options.maxTextBytes || 5 * 1024 * 1024;

  let stat;
  try {
    stat = await fs.stat(target);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new NotFoundError(`File not found: ${itemPath}`);
    }
    throw err;
  }

  if (!stat.isFile()) {
    throw new ValidationError('Target is not a regular file');
  }

  if (stat.size > maxBytes) {
    throw new ValidationError(`File is too large to open in editor (${(stat.size / 1024 / 1024).toFixed(2)} MB, max ${maxBytes / 1024 / 1024} MB)`);
  }

  const ext = path.extname(target).replace(/^\./, '').toLowerCase();
  
  // Read buffer and check for null bytes if not an explicitly known text extension
  const buffer = await fs.readFile(target);
  if (!isTextEditable(ext)) {
    const checkLength = Math.min(buffer.length, 512);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) {
        throw new ValidationError('File appears to be binary and cannot be edited as text');
      }
    }
  }

  const content = buffer.toString('utf8');
  const fileName = path.basename(target);
  const relFilePath = path.relative(path.resolve(baseDir), target).replace(/\\/g, '/');

  return {
    name: fileName,
    path: relFilePath,
    content,
    size: stat.size,
    ext,
    mimeType: getMimeType(ext),
    modifiedAt: stat.mtime.toISOString(),
  };
}

/**
 * Safely save updated text content to file
 * @param {string} baseDir
 * @param {string} itemPath
 * @param {string} content
 * @param {Object} [options]
 * @param {boolean} [options.overwrite=true]
 * @param {string} [options.newName]
 * @param {string} [options.publicBasePath='/uploads']
 * @returns {Promise<Object>}
 */
async function saveFileContent(baseDir, itemPath, content, options = {}) {
  if (typeof content !== 'string') {
    throw new ValidationError('Content must be a string');
  }

  const target = resolveSafePath(baseDir, itemPath);
  const { overwrite = true, newName, publicBasePath = '/uploads' } = options;

  let stat;
  try {
    stat = await fs.stat(target);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(path.dirname(target), { recursive: true });
    } else {
      throw err;
    }
  }

  if (stat && !stat.isFile()) {
    throw new ValidationError('Target path exists but is not a regular file');
  }

  const originalExt = path.extname(target).replace(/^\./, '').toLowerCase();
  let contentToSave = content;
  if (originalExt === 'svg') {
    contentToSave = sanitizeSvgContent(contentToSave);
  }

  let finalTarget = target;
  let finalFileName = path.basename(target);

  if (newName) {
    const cleanNewName = sanitizeName(newName);
    finalFileName = cleanNewName;
    finalTarget = path.join(path.dirname(target), cleanNewName);
  } else if (!overwrite) {
    const dir = path.dirname(target);
    const extWithDot = path.extname(target);
    const baseNameWithoutExt = path.basename(target, extWithDot);
    
    let candidateName = `${baseNameWithoutExt}-copy${extWithDot}`;
    let candidatePath = path.join(dir, candidateName);
    let counter = 1;

    while (true) {
      try {
        await fs.access(candidatePath);
        candidateName = `${baseNameWithoutExt}-copy-${counter}${extWithDot}`;
        candidatePath = path.join(dir, candidateName);
        counter++;
      } catch {
        break;
      }
    }

    finalTarget = candidatePath;
    finalFileName = candidateName;
  }

  const buffer = Buffer.from(contentToSave, 'utf8');
  await fs.writeFile(finalTarget, buffer);
  invalidateStorageCache(baseDir);

  const relFilePath = path.relative(path.resolve(baseDir), finalTarget).replace(/\\/g, '/');
  const publicBase = normalizePublicBase(publicBasePath);
  const publicUrl = `${publicBase}/${relFilePath}`.replace(/\/{2,}/g, '/');
  const ext = path.extname(finalFileName).replace(/^\./, '').toLowerCase();

  return {
    name: finalFileName,
    path: relFilePath,
    publicUrl,
    size: buffer.length,
    mimeType: getMimeType(ext),
    ext,
    type: getFileType(finalFileName, false),
  };
}

/**
 * Standard IEEE 802.3 CRC32 calculation for ZIP local file headers
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Native PKWARE ZIP archive builder using Buffer and zlib.deflateRawSync
 * @param {Array<{ path: string, data: Buffer|string }>} entries
 * @returns {Buffer}
 */
function createZip(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanRelPath = (entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanRelPath, 'utf8');
    const uncompressedData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '', 'utf8');
    const compressedData = zlib.deflateRawSync(uncompressedData);
    const checksum = crc32(uncompressedData);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4); // Min version (2.0)
    localHeader.writeUInt16LE(0, 6); // General flags
    localHeader.writeUInt16LE(8, 8); // Compression method: 8 (Deflate)
    localHeader.writeUInt16LE(0, 10); // Mod time
    localHeader.writeUInt16LE(0, 12); // Mod date
    localHeader.writeUInt32LE(checksum, 14); // CRC-32
    localHeader.writeUInt32LE(compressedData.length, 18); // Compressed size
    localHeader.writeUInt32LE(uncompressedData.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // Filename length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBuf.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Min version to extract
    centralHeader.writeUInt16LE(0, 8); // Flags
    centralHeader.writeUInt16LE(8, 10); // Compression method: Deflate
    centralHeader.writeUInt16LE(0, 12); // Mod time
    centralHeader.writeUInt16LE(0, 14); // Mod date
    centralHeader.writeUInt32LE(checksum, 16); // CRC-32
    centralHeader.writeUInt32LE(compressedData.length, 20); // Compressed size
    centralHeader.writeUInt32LE(uncompressedData.length, 24); // Uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // Filename length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(offset, 42); // Local header relative offset
    nameBuf.copy(centralHeader, 46);

    localHeaders.push(localHeader, compressedData);
    centralHeaders.push(centralHeader);
    offset += localHeader.length + compressedData.length;
  }

  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  endRecord.writeUInt16LE(0, 4); // Number of this disk
  endRecord.writeUInt16LE(0, 6); // Disk with start of central directory
  endRecord.writeUInt16LE(entries.length, 8); // Number of entries on disk
  endRecord.writeUInt16LE(entries.length, 10); // Total number of entries
  endRecord.writeUInt32LE(centralDirSize, 12); // Central directory size in bytes
  endRecord.writeUInt32LE(offset, 16); // Central directory offset
  endRecord.writeUInt16LE(0, 20); // ZIP comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, endRecord]);
}

/**
 * Recursively collect files into zip entries
 * @param {string} baseDir
 * @param {string} targetFullPath
 * @param {string} baseRel
 * @returns {Promise<Array<{ path: string, data: Buffer }>>}
 */
async function collectFilesForZip(baseDir, targetFullPath, baseRel = '') {
  const stat = await fs.stat(targetFullPath);
  const entries = [];
  if (stat.isDirectory()) {
    const items = await fs.readdir(targetFullPath, { withFileTypes: true });
    for (const item of items) {
      const childFullPath = path.join(targetFullPath, item.name);
      const childRelPath = baseRel ? `${baseRel}/${item.name}` : item.name;
      const childEntries = await collectFilesForZip(baseDir, childFullPath, childRelPath);
      entries.push(...childEntries);
    }
  } else {
    const data = await fs.readFile(targetFullPath);
    entries.push({ path: baseRel, data });
  }
  return entries;
}

/**
 * Bundle multiple files and folders into a ZIP archive buffer
 * @param {string} baseDir
 * @param {string[]} itemPaths
 * @returns {Promise<{ buffer: Buffer, filename: string, fileCount: number, size: number }>}
 */
async function createZipFromPaths(baseDir, itemPaths) {
  if (!Array.isArray(itemPaths) || itemPaths.length === 0) {
    throw new ValidationError('itemPaths array is required for ZIP download');
  }

  const allEntries = [];
  for (const itemPath of itemPaths) {
    const safePath = resolveSafePath(baseDir, itemPath);
    const itemName = path.basename(safePath);
    const entries = await collectFilesForZip(baseDir, safePath, itemName);
    allEntries.push(...entries);
  }

  if (allEntries.length === 0) {
    throw new ValidationError('Selected items do not contain any downloadable files');
  }

  const zipBuffer = createZip(allEntries);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `archive-${timestamp}.zip`;

  return {
    buffer: zipBuffer,
    filename,
    fileCount: allEntries.length,
    size: zipBuffer.length,
  };
}

/**
 * Batch delete multiple files or directories
 * @param {string} baseDir
 * @param {string[]} itemPaths
 * @returns {Promise<{ success: boolean, deleted: string[], failed: Array<{ path: string, error: string }>, count: number }>}
 */
async function batchDelete(baseDir, itemPaths) {
  if (!Array.isArray(itemPaths) || itemPaths.length === 0) {
    throw new ValidationError('itemPaths array is required for batch delete');
  }

  const deleted = [];
  const failed = [];

  for (const itemPath of itemPaths) {
    try {
      const safePath = resolveSafePath(baseDir, itemPath);
      const rootResolved = path.resolve(baseDir);
      if (safePath === rootResolved) {
        throw new SecurityError('Cannot delete the root directory');
      }
      const stat = await fs.stat(safePath);
      if (stat.isDirectory()) {
        await fs.rm(safePath, { recursive: true, force: true });
      } else {
        await fs.unlink(safePath);
      }
      deleted.push(itemPath);
    } catch (err) {
      failed.push({ path: itemPath, error: err.message });
    }
  }

  invalidateStorageCache(baseDir);

  return {
    success: failed.length === 0,
    deleted,
    failed,
    count: deleted.length,
  };
}

/**
 * Batch move multiple files or directories into a target destination directory
 * @param {string} baseDir
 * @param {string[]} itemPaths
 * @param {string} destinationRelPath
 * @returns {Promise<{ success: boolean, moved: Array<{ from: string, to: string }>, failed: Array<{ path: string, error: string }>, count: number }>}
 */
async function batchMove(baseDir, itemPaths, destinationRelPath = '') {
  if (!Array.isArray(itemPaths) || itemPaths.length === 0) {
    throw new ValidationError('itemPaths array is required for batch move');
  }

  const destSafeDir = resolveSafePath(baseDir, destinationRelPath);
  const destStat = await fs.stat(destSafeDir);
  if (!destStat.isDirectory()) {
    throw new ValidationError('Destination must be an existing directory');
  }

  const moved = [];
  const failed = [];

  for (const itemPath of itemPaths) {
    try {
      const safeSrc = resolveSafePath(baseDir, itemPath);
      const rootResolved = path.resolve(baseDir);
      if (safeSrc === rootResolved) {
        throw new SecurityError('Cannot move root directory');
      }
      const itemName = path.basename(safeSrc);
      const safeDest = path.join(destSafeDir, itemName);

      if (safeDest.startsWith(safeSrc + path.sep)) {
        throw new ValidationError('Cannot move a directory into its own subdirectory');
      }

      await fs.rename(safeSrc, safeDest);
      const newRelPath = path.relative(path.resolve(baseDir), safeDest).replace(/\\/g, '/');
      moved.push({ from: itemPath, to: newRelPath });
    } catch (err) {
      failed.push({ path: itemPath, error: err.message });
    }
  }

  invalidateStorageCache(baseDir);

  return {
    success: failed.length === 0,
    moved,
    failed,
    count: moved.length,
  };
}

module.exports = {
  resolveSafePath,
  sanitizeName,
  getFileType,
  getMimeType,
  isTextEditable,
  buildBreadcrumbs,
  listFiles,
  createDirectory,
  renameItem,
  deleteItem,
  moveItem,
  saveUploadedFile,
  saveEditedImage,
  getFileContent,
  saveFileContent,
  calculateStorageUsage,
  getDetailedStorageStats,
  formatBytes,
  invalidateStorageCache,
  crc32,
  createZip,
  createZipFromPaths,
  batchDelete,
  batchMove,
};

