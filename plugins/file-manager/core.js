/**
 * File Manager Core Engine — Safe filesystem operations, traversal protection & metadata resolution.
 * @module plugins/file-manager/core
 */

const fs = require('fs/promises');
const path = require('path');
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
  const decodedPath = decodeURIComponent(relPath);
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

  const segments = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
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
  const normalizedRel = path.relative(path.resolve(baseDir), targetDir).replace(/\\/g, '');
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

/**
 * Calculate total disk usage in bytes under baseDir
 * @param {string} baseDir
 * @returns {Promise<number>}
 */
async function calculateStorageUsage(baseDir) {
  let totalBytes = 0;
  async function scan(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(full);
        } else if (entry.isFile()) {
          const st = await fs.stat(full);
          totalBytes += st.size;
        }
      }
    } catch (e) {}
  }
  await scan(path.resolve(baseDir));
  return totalBytes;
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

module.exports = {
  resolveSafePath,
  sanitizeName,
  getFileType,
  getMimeType,
  buildBreadcrumbs,
  listFiles,
  createDirectory,
  renameItem,
  deleteItem,
  moveItem,
  saveUploadedFile,
  calculateStorageUsage,
};
