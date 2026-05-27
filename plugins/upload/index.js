/**
 * File upload plugin — multipart parsing, validation, pluggable storage.
 * @module plugins/upload
 */

const path = require('path');
const { createLocalFileProvider } = require('./local-file-provider');

function normalizeRoutePath(p) {
  const s = (p || '/api/upload').trim();
  return s.startsWith('/') ? s : `/${s}`;
}

function extensionFromName(name) {
  return path.extname(path.basename(name || '')).replace(/^\./, '').toLowerCase();
}

const { extractUploadFile } = require('../../src/http/multipart');

function uploadErrorResponse(err) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, message: 'File too large' };
  }
  return { status: 400, message: err instanceof Error ? err.message : String(err) };
}

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

  return {
    name: 'upload',
    version: '1.0.0',
    description: 'Multipart file uploads with pluggable storage',

    onRoutesReady(ctx) {
      const { app } = ctx;
      app.set('webspresso.uploadPath', normalizedPath);

      const handler = async (req, res) => {
        try {
          const file = await extractUploadFile(req, fieldName, maxBytes);
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
            return res.status(400).json({
              error: 'File extension not allowed',
              message: 'File extension not allowed',
            });
          }

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
          const { status, message } = uploadErrorResponse(e);
          res.status(status).json({ error: message, message });
        }
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
