/**
 * Built-in File Manager Services
 * @module src/services/builtins/file-manager
 */

const path = require('path');
const fs = require('fs/promises');
const { z } = require('zod');
const { ValidationError, NotFoundError } = require('../../../core/errors');
const {
  listFiles,
  createDirectory,
  renameItem,
  deleteItem,
  moveItem,
  saveUploadedFile,
} = require('../../../plugins/file-manager/core');
const { parseBase64 } = require('./media');

/**
 * Create built-in file manager services map
 * @param {Object} [options]
 * @param {string} [options.baseDir]
 * @param {string} [options.publicBasePath]
 * @returns {Record<string, Object>}
 */
function createFileManagerServices(options = {}) {
  const defaultBaseDir = path.resolve(
    options.baseDir || path.join(process.cwd(), 'public', 'uploads')
  );
  const defaultPublicBase = options.publicBasePath || '/uploads';

  return {
    'fileManager.list': {
      schema: z.object({
        path: z.string().optional().default(''),
        search: z.string().optional(),
        type: z.string().optional(),
        sort: z.enum(['name', 'size', 'mtime', 'ext']).optional().default('name'),
        order: z.enum(['asc', 'desc']).optional().default('asc'),
        page: z.number().int().positive().optional(),
        perPage: z.number().int().positive().optional(),
        baseDir: z.string().optional(),
        publicBasePath: z.string().optional(),
      }),
      async handler(input) {
        const baseDir = input.baseDir ? path.resolve(input.baseDir) : defaultBaseDir;
        const publicBasePath = input.publicBasePath || defaultPublicBase;

        return listFiles(baseDir, input.path, {
          search: input.search,
          type: input.type,
          sort: input.sort,
          order: input.order,
          page: input.page,
          perPage: input.perPage,
          publicBasePath,
        });
      },
    },

    'fileManager.mkdir': {
      schema: z.object({
        path: z.string().optional().default(''),
        name: z.string().min(1, 'Directory name is required'),
        baseDir: z.string().optional(),
      }),
      async handler(input) {
        const baseDir = input.baseDir ? path.resolve(input.baseDir) : defaultBaseDir;
        return createDirectory(baseDir, input.path, input.name);
      },
    },

    'fileManager.rename': {
      schema: z.object({
        path: z.string().min(1, 'Target path is required'),
        newName: z.string().min(1, 'New name is required'),
        baseDir: z.string().optional(),
      }),
      async handler(input) {
        const baseDir = input.baseDir ? path.resolve(input.baseDir) : defaultBaseDir;
        return renameItem(baseDir, input.path, input.newName);
      },
    },

    'fileManager.delete': {
      schema: z.object({
        path: z.string().min(1, 'Path is required'),
        baseDir: z.string().optional(),
      }),
      async handler(input) {
        const baseDir = input.baseDir ? path.resolve(input.baseDir) : defaultBaseDir;
        return deleteItem(baseDir, input.path);
      },
    },

    'fileManager.move': {
      schema: z.object({
        source: z.string().min(1, 'Source path is required'),
        destination: z.string().optional().default(''),
        baseDir: z.string().optional(),
      }),
      async handler(input) {
        const baseDir = input.baseDir ? path.resolve(input.baseDir) : defaultBaseDir;
        return moveItem(baseDir, input.source, input.destination);
      },
    },

    'fileManager.upload': {
      schema: z.object({
        path: z.string().optional().default(''),
        buffer: z.any().optional(),
        base64: z.string().optional(),
        filePath: z.string().optional(),
        originalName: z.string().min(1).default('upload.bin'),
        mimeType: z.string().optional(),
        baseDir: z.string().optional(),
        publicBasePath: z.string().optional(),
      }),
      async handler(input) {
        let {
          path: targetRelPath,
          buffer,
          base64,
          filePath,
          originalName,
          mimeType,
          baseDir: customBaseDir,
          publicBasePath: customPublicBase,
        } = input;
        const baseDir = customBaseDir ? path.resolve(customBaseDir) : defaultBaseDir;
        const publicBasePath = customPublicBase || defaultPublicBase;

        if (buffer && !(buffer instanceof Buffer) && !(buffer instanceof Uint8Array)) {
          if (typeof buffer === 'string') {
            buffer = Buffer.from(buffer);
          } else {
            throw new ValidationError('Invalid buffer provided');
          }
        }

        if (!buffer && base64) {
          const parsed = parseBase64(base64);
          buffer = parsed.buffer;
          if (parsed.mimeType && (!mimeType || mimeType === 'application/octet-stream')) {
            mimeType = parsed.mimeType;
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
          throw new ValidationError('No file content provided');
        }

        return saveUploadedFile(
          baseDir,
          targetRelPath,
          buffer,
          originalName,
          mimeType,
          publicBasePath
        );
      },
    },
  };
}

module.exports = {
  createFileManagerServices,
};
