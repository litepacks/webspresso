/**
 * Default upload storage: write files to local disk and expose a public URL path.
 * @module plugins/upload/local-file-provider
 */

const fs = require('fs/promises');
const path = require('path');
const { randomBytes } = require('crypto');
const { trimUrlPathSlashes } = require('../../core/url-path-normalize');

/**
 * Common MIME → canonical extension (lowercase, with leading dot).
 * Used so stored filenames match the MIME the server accepted (see uploadPlugin mimeAllowlist).
 * Does not verify file content; spoofed MIME is a separate concern (allowlist + optional magic-byte later).
 */
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/html': '.html',
  'application/json': '.json',
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/webm': '.weba',
};

/**
 * Normalize public URL prefix (no trailing slash).
 * @param {string} [publicBasePath]
 * @returns {string}
 */
function normalizePublicBase(publicBasePath) {
  let p =
    publicBasePath == null || publicBasePath === ''
      ? '/uploads'
      : String(publicBasePath).trim();
  p = trimUrlPathSlashes(p);
  if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  return p || '/uploads';
}

/**
 * @param {string} [mimeType]
 * @returns {string|null} extension with leading dot, or null if unknown
 */
function canonicalExtFromMime(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') return null;
  const base = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[base] || null;
}

/**
 * Prefer a safe extension from the filename; align with MIME when we have a mapping.
 * @param {string} [mimeType]
 * @param {string} extFromName - already normalized (lowercase, with dot or '')
 * @returns {string} extension with leading dot or empty string
 */
function resolveStoredExtension(mimeType, extFromName) {
  const fromMime = canonicalExtFromMime(mimeType);
  if (fromMime) {
    if (!extFromName || extFromName !== fromMime) {
      return fromMime;
    }
    return extFromName;
  }
  return extFromName || '';
}

/**
 * @param {Object} [options]
 * @param {string} [options.destDir] — Absolute or cwd-relative directory for stored files
 * @param {string} [options.publicBasePath='/uploads'] — URL prefix (first segment of public URL)
 * @returns {import('./index').UploadStorageProvider}
 */
function createLocalFileProvider(options = {}) {
  const destDir = path.resolve(
    options.destDir || path.join(process.cwd(), 'public', 'uploads')
  );
  const publicBase = normalizePublicBase(options.publicBasePath);

  return {
    async put({ buffer, originalName, mimeType, size, req }) {
      void size;
      void req;
      await fs.mkdir(destDir, { recursive: true });

      const base = path.basename(originalName || 'upload');
      let ext = path.extname(base).toLowerCase();
      if (!/^\.[a-z0-9]{1,12}$/.test(ext)) {
        ext = '';
      }

      ext = resolveStoredExtension(mimeType, ext);

      const storedName = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
      const target = path.join(destDir, storedName);
      const resolvedDest = path.resolve(destDir);
      if (!target.startsWith(resolvedDest + path.sep) && target !== resolvedDest) {
        throw new Error('Invalid storage path');
      }

      await fs.writeFile(target, buffer);

      const publicUrl = `${publicBase}/${storedName}`.replace(/\/{2,}/g, '/');
      return { publicUrl, key: storedName };
    },
  };
}

module.exports = {
  createLocalFileProvider,
  normalizePublicBase,
  canonicalExtFromMime,
  resolveStoredExtension,
};
