/**
 * File upload plugin — multipart parsing, validation, pluggable storage.
 * @module plugins/upload
 */

const multer = require('multer');
const path = require('path');
const { createLocalFileProvider } = require('./local-file-provider');

/**
 * @typedef {import('express').Request} ExpressRequest
 */

/**
 * @typedef {Object} UploadPutArgs
 * @property {Buffer} [buffer]
 * @property {import('stream').Readable} [stream]
 * @property {string} originalName
 * @property {string} mimeType
 * @property {number} size
 * @property {ExpressRequest} req
 */

/**
 * @typedef {Object} UploadPutResult
 * @property {string} publicUrl
 * @property {string} [key]
 */

/**
 * @typedef {Object} UploadStorageProvider
 * @property {(args: UploadPutArgs) => Promise<UploadPutResult>} put
 */

/**
 * @param {string} [p]
 * @returns {string}
 */
function normalizeRoutePath(p) {
  const s = (p || '/api/upload').trim();
  return s.startsWith('/') ? s : `/${s}`;
}

/**
 * @param {string} [name]
 * @returns {string} lowercase extension without dot
 */
function extensionFromName(name) {
  return path.extname(path.basename(name || '')).replace(/^\./, '').toLowerCase();
}

/**
 * @param {number} maxBytes
 * @param {string} fieldName
 * @returns {import('express').RequestHandler}
 */
function createMulterSingleMiddleware(maxBytes, fieldName) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
  });
  return upload.single(fieldName);
}

/**
 * @param {unknown} err
 * @returns {{ status: number, message: string }}
 */
function multerErrorResponse(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return { status: 413, message: 'File too large' };
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return { status: 400, message: 'Invalid upload (too many files or unexpected field)' };
    }
    return { status: 400, message: err.message || 'Upload error' };
  }
  return { status: 400, message: err instanceof Error ? err.message : String(err) };
}

/**
 * @param {Object} [options]
 * @param {string} [options.path='/api/upload'] — POST route
 * @param {UploadStorageProvider} [options.provider] — Storage backend; default: local disk
 * @param {Object} [options.local] — Shorthand for createLocalFileProvider when provider omitted
 * @param {string} [options.local.destDir]
 * @param {string} [options.local.publicBasePath]
 * @param {number} [options.maxBytes=10485760] — 10 MiB default
 * @param {string[]|null} [options.mimeAllowlist] — If set, reject other MIME types (415)
 * @param {string[]|null} [options.extensionAllowlist] — Optional extra guard on original extension
 * @param {import('express').RequestHandler|import('express').RequestHandler[]} [options.middleware]
 * @param {string} [options.fieldName='file'] — Multipart field name
 * @returns {Object} Webspresso plugin
 */
function uploadPlugin(options = {}) {
  const {
    path: routePath = '/api/upload',
    provider: userProvider,
    local,
    maxBytes = 10 * 1024 * 1024,
    mimeAllowlist = null,
    extensionAllowlist = null,
    middleware = [],
    fieldName = 'file',
  } = options;

  const normalizedPath = normalizeRoutePath(routePath);

  const provider =
    userProvider ||
    createLocalFileProvider({
      destDir: local?.destDir,
      publicBasePath: local?.publicBasePath,
    });

  const mw = (Array.isArray(middleware) ? middleware : [middleware]).filter(Boolean);
  const parseMultipart = createMulterSingleMiddleware(maxBytes, fieldName);

  return {
    name: 'upload',
    version: '1.0.0',
    description: 'Multipart file uploads with pluggable storage',

    onRoutesReady(ctx) {
      const { app } = ctx;
      app.set('webspresso.uploadPath', normalizedPath);

      const handler = (req, res) => {
        parseMultipart(req, res, async (err) => {
          if (err) {
            const { status, message } = multerErrorResponse(err);
            return res.status(status).json({ error: message, message });
          }

          const file = req.file;
          if (!file || !file.buffer) {
            return res.status(400).json({ error: 'No file uploaded', message: 'No file uploaded' });
          }

          const mime = file.mimetype || 'application/octet-stream';
          const originalName = file.originalname || 'upload';
          const ext = extensionFromName(originalName);

          if (mimeAllowlist && mimeAllowlist.length && !mimeAllowlist.includes(mime)) {
            return res.status(415).json({ error: 'MIME type not allowed', message: 'MIME type not allowed' });
          }
          if (
            extensionAllowlist &&
            extensionAllowlist.length &&
            (!ext || !extensionAllowlist.includes(ext))
          ) {
            return res.status(400).json({ error: 'File extension not allowed', message: 'File extension not allowed' });
          }

          try {
            const result = await provider.put({
              buffer: file.buffer,
              originalName,
              mimeType: mime,
              size: file.size,
              req,
            });
            res.json({
              url: result.publicUrl,
              publicUrl: result.publicUrl,
              key: result.key,
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: message, message });
          }
        });
      };

      ctx.addRoute('post', normalizedPath, ...mw, handler);

      if (process.env.NODE_ENV !== 'production') {
        console.log(`  Upload plugin: POST ${normalizedPath}`);
      }
    },
  };
}

module.exports = {
  uploadPlugin,
  createLocalFileProvider,
};
