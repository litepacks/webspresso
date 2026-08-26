/**
 * Built-in Media & File Upload Services
 * @module src/services/builtins/media
 */

const fs = require('fs/promises');
const path = require('path');
const { z } = require('zod');
const { ValidationError, NotFoundError } = require('../../../core/errors');
const { createLocalFileProvider, canonicalExtFromMime } = require('../../../plugins/upload/local-file-provider');

/**
 * Convert base64 data (including data URLs) to Buffer
 * @param {string} base64Str
 * @returns {{ buffer: Buffer, mimeType?: string }}
 */
function parseBase64(base64Str) {
  const match = base64Str.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    return { buffer, mimeType };
  }
  return { buffer: Buffer.from(base64Str, 'base64') };
}

/**
 * Validate storage key to prevent directory traversal
 * @param {string} key
 * @param {string} baseDir
 * @returns {string} Absolute resolved file path
 */
function resolveSafeKeyPath(key, baseDir) {
  if (!key || typeof key !== 'string' || key.includes('..') || path.isAbsolute(key)) {
    throw new ValidationError('Invalid file key or path traversal attempt', [
      { field: 'key', message: 'Path traversal attempt detected' },
    ]);
  }

  const resolvedBase = path.resolve(baseDir);
  const targetPath = path.resolve(resolvedBase, key);

  if (!targetPath.startsWith(resolvedBase + path.sep) && targetPath !== resolvedBase) {
    throw new ValidationError('Invalid file key or path traversal attempt', [
      { field: 'key', message: 'Path traversal attempt detected' },
    ]);
  }

  return targetPath;
}

/**
 * Create built-in media services map
 * @param {Object} [options]
 * @param {import('../../../plugins/upload').UploadStorageProvider} [options.provider]
 * @param {string} [options.destDir]
 * @param {string} [options.publicBasePath]
 * @returns {Record<string, Object>}
 */
function createMediaServices(options = {}) {
  const destDir = path.resolve(
    options.destDir || path.join(process.cwd(), 'public', 'uploads')
  );
  const provider = options.provider || createLocalFileProvider({
    destDir,
    publicBasePath: options.publicBasePath,
  });

  return {
    'media.upload': {
      schema: z.object({
        buffer: z.any().optional(),
        base64: z.string().optional(),
        filePath: z.string().optional(),
        originalName: z.string().min(1).default('upload.bin'),
        mimeType: z.string().optional(),
        destDir: z.string().optional(),
        publicBasePath: z.string().optional(),
      }),
      async handler(input, ctx) {
        let { buffer, base64, filePath, originalName, mimeType, destDir: customDest, publicBasePath: customBase } = input;
        let finalMime = mimeType || 'application/octet-stream';

        if (buffer && !(buffer instanceof Buffer) && !(buffer instanceof Uint8Array)) {
          if (typeof buffer === 'string') {
            buffer = Buffer.from(buffer);
          } else {
            throw new ValidationError('Invalid buffer provided', [
              { field: 'buffer', message: 'Expected Buffer or Uint8Array' },
            ]);
          }
        }

        if (!buffer && base64) {
          const parsed = parseBase64(base64);
          buffer = parsed.buffer;
          if (parsed.mimeType && (!mimeType || mimeType === 'application/octet-stream')) {
            finalMime = parsed.mimeType;
          }
        } else if (!buffer && filePath) {
          try {
            buffer = await fs.readFile(path.resolve(filePath));
            if (!originalName || originalName === 'upload.bin') {
              originalName = path.basename(filePath);
            }
          } catch (err) {
            throw new NotFoundError(`Source file not found: ${filePath}`, { cause: err });
          }
        }

        if (!buffer || buffer.length === 0) {
          throw new ValidationError('No file content provided (buffer, base64, or filePath is required)', [
            { field: 'buffer', message: 'No file content provided' },
          ]);
        }

        const activeProvider = (customDest || customBase)
          ? createLocalFileProvider({ destDir: customDest || destDir, publicBasePath: customBase })
          : provider;

        const uploadResult = await activeProvider.put({
          buffer,
          originalName,
          mimeType: finalMime,
          size: buffer.length,
          req: ctx.req || null,
        });

        return {
          publicUrl: uploadResult.publicUrl,
          key: uploadResult.key || path.basename(uploadResult.publicUrl),
          size: buffer.length,
          mimeType: finalMime,
          originalName,
        };
      },
    },

    'media.delete': {
      schema: z.object({
        key: z.string().min(1, 'Key is required'),
        destDir: z.string().optional(),
      }),
      async handler(input, ctx) {
        const { key, destDir: customDest } = input;
        const targetDir = customDest ? path.resolve(customDest) : destDir;
        const targetPath = resolveSafeKeyPath(key, targetDir);

        try {
          await fs.unlink(targetPath);
          return { success: true, key };
        } catch (err) {
          if (err.code === 'ENOENT') {
            return { success: false, key, message: 'File not found' };
          }
          throw err;
        }
      },
    },

    'media.info': {
      schema: z.object({
        key: z.string().min(1, 'Key is required'),
        destDir: z.string().optional(),
      }),
      async handler(input, ctx) {
        const { key, destDir: customDest } = input;
        const targetDir = customDest ? path.resolve(customDest) : destDir;
        const targetPath = resolveSafeKeyPath(key, targetDir);

        try {
          const stats = await fs.stat(targetPath);
          const ext = path.extname(targetPath).toLowerCase();
          return {
            exists: true,
            key,
            size: stats.size,
            mtime: stats.mtime,
            ext,
          };
        } catch (err) {
          if (err.code === 'ENOENT') {
            return { exists: false, key };
          }
          throw err;
        }
      },
    },
  };
}

module.exports = {
  createMediaServices,
  resolveSafeKeyPath,
  parseBase64,
};
