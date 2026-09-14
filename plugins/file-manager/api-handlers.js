/**
 * File Manager Admin API Handlers with RBAC & Storage Quota
 * @module plugins/file-manager/api-handlers
 */

const multer = require('multer');
const {
  listFiles,
  createDirectory,
  renameItem,
  deleteItem,
  moveItem,
  saveUploadedFile,
  calculateStorageUsage,
} = require('./core');

/**
 * Create Multer middleware for in-memory upload parsing
 * @param {number} maxBytes
 * @param {number} maxFiles
 */
function createUploadMiddleware(maxBytes, maxFiles = 20) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: maxFiles },
  });
  return upload.array('files', maxFiles);
}

/**
 * Helper to check RBAC permissions
 * @param {import('express').Request} req
 * @param {string} action
 * @param {Record<string, string[]>|null} permissions
 * @returns {boolean}
 */
function isActionAllowed(req, action, permissions) {
  if (!permissions || !permissions[action]) {
    return true; // No restriction specified
  }

  const allowedRoles = permissions[action];
  if (!Array.isArray(allowedRoles) || allowedRoles.includes('*')) {
    return true;
  }

  const adminUser = req.session && req.session.adminUser;
  const userRole = adminUser ? (adminUser.role || 'admin') : 'admin';

  return allowedRoles.includes(userRole);
}

/**
 * @param {Object} options
 * @param {string} options.baseDir
 * @param {string} options.publicBasePath
 * @param {number} [options.maxUploadBytes=10485760]
 * @param {number|null} [options.maxTotalStorageBytes]
 * @param {string[]|null} [options.allowedExtensions]
 * @param {string[]|null} [options.allowedMimeTypes]
 * @param {Record<string, string[]>|null} [options.permissions]
 * @param {Object} [options.security]
 */
function createFileManagerApiHandlers(options = {}) {
  const baseDir = options.baseDir || './public/uploads';
  const publicBasePath = options.publicBasePath || '/uploads';
  const maxUploadBytes = options.maxUploadBytes || 10 * 1024 * 1024;
  const maxTotalStorageBytes = options.maxTotalStorageBytes || null;
  const allowedExtensions = options.allowedExtensions || null;
  const allowedMimeTypes = options.allowedMimeTypes || null;
  const permissions = options.permissions || null;
  const securityOpts = options.security || {};

  const parseUpload = createUploadMiddleware(maxUploadBytes);

  return {
    async list(req, res) {
      if (!isActionAllowed(req, 'list', permissions)) {
        return res.status(403).json({ success: false, error: 'Permission denied for action: list' });
      }

      try {
        const relPath = req.query.path || '';
        const search = req.query.search || undefined;
        const type = req.query.type || undefined;
        const sort = req.query.sort || 'name';
        const order = req.query.order || 'asc';
        const page = req.query.page ? parseInt(req.query.page, 10) : undefined;
        const perPage = req.query.perPage ? parseInt(req.query.perPage, 10) : undefined;

        const result = await listFiles(baseDir, relPath, {
          search,
          type,
          sort,
          order,
          page,
          perPage,
          publicBasePath,
        });

        return res.json({ success: true, ...result });
      } catch (err) {
        const status = err.statusCode || err.status || 400;
        return res.status(status).json({ success: false, error: err.message });
      }
    },

    async mkdir(req, res) {
      if (!isActionAllowed(req, 'mkdir', permissions)) {
        return res.status(403).json({ success: false, error: 'Permission denied for action: mkdir' });
      }

      try {
        const { path: relPath = '', name } = req.body || {};
        if (!name) {
          return res.status(400).json({ success: false, error: 'Directory name is required' });
        }
        const result = await createDirectory(baseDir, relPath, name);
        return res.status(201).json({ success: true, data: result });
      } catch (err) {
        const status = err.statusCode || err.status || 400;
        return res.status(status).json({ success: false, error: err.message });
      }
    },

    async rename(req, res) {
      if (!isActionAllowed(req, 'rename', permissions)) {
        return res.status(403).json({ success: false, error: 'Permission denied for action: rename' });
      }

      try {
        const { path: itemPath, newName } = req.body || {};
        if (!itemPath || !newName) {
          return res.status(400).json({ success: false, error: 'Path and newName are required' });
        }
        const result = await renameItem(baseDir, itemPath, newName);
        return res.json({ success: true, data: result });
      } catch (err) {
        const status = err.statusCode || err.status || 400;
        return res.status(status).json({ success: false, error: err.message });
      }
    },

    async move(req, res) {
      if (!isActionAllowed(req, 'move', permissions)) {
        return res.status(403).json({ success: false, error: 'Permission denied for action: move' });
      }

      try {
        const { source, destination = '' } = req.body || {};
        if (!source) {
          return res.status(400).json({ success: false, error: 'Source path is required' });
        }
        const result = await moveItem(baseDir, source, destination);
        return res.json({ success: true, data: result });
      } catch (err) {
        const status = err.statusCode || err.status || 400;
        return res.status(status).json({ success: false, error: err.message });
      }
    },

    async delete(req, res) {
      if (!isActionAllowed(req, 'delete', permissions)) {
        return res.status(403).json({ success: false, error: 'Permission denied for action: delete' });
      }

      try {
        const { path: itemPath } = req.body || {};
        if (!itemPath) {
          return res.status(400).json({ success: false, error: 'Path is required' });
        }
        const result = await deleteItem(baseDir, itemPath);
        return res.json({ success: true, data: result });
      } catch (err) {
        const status = err.statusCode || err.status || 400;
        return res.status(status).json({ success: false, error: err.message });
      }
    },

    upload(req, res) {
      if (!isActionAllowed(req, 'upload', permissions)) {
        return res.status(403).json({ success: false, error: 'Permission denied for action: upload' });
      }

      parseUpload(req, res, async (err) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, error: 'File too large' });
          }
          return res.status(400).json({ success: false, error: err.message || 'Upload error' });
        }

        const files = req.files || (req.file ? [req.file] : []);
        if (!files || files.length === 0) {
          return res.status(400).json({ success: false, error: 'No files uploaded' });
        }

        const targetRelPath = req.query.path || (req.body && req.body.path) || '';

        // Storage Quota Check
        if (maxTotalStorageBytes && typeof maxTotalStorageBytes === 'number') {
          const currentUsage = await calculateStorageUsage(baseDir);
          const incomingBytes = files.reduce((acc, f) => acc + (f.size || f.buffer?.length || 0), 0);
          if (currentUsage + incomingBytes > maxTotalStorageBytes) {
            return res.status(507).json({
              success: false,
              error: 'Storage quota exceeded for this instance',
            });
          }
        }

        // Validate allowed extensions and MIME types
        for (const f of files) {
          const ext = (f.originalname || '').split('.').pop().toLowerCase();
          if (allowedExtensions && allowedExtensions.length && !allowedExtensions.includes(ext)) {
            return res.status(400).json({
              success: false,
              error: `File extension .${ext} is not allowed`,
            });
          }
          if (allowedMimeTypes && allowedMimeTypes.length && !allowedMimeTypes.includes(f.mimetype)) {
            return res.status(415).json({
              success: false,
              error: `MIME type ${f.mimetype} is not allowed`,
            });
          }
        }

        try {
          const uploaded = [];
          for (const file of files) {
            const saved = await saveUploadedFile(
              baseDir,
              targetRelPath,
              file.buffer,
              file.originalname,
              file.mimetype,
              publicBasePath,
              securityOpts
            );
            uploaded.push(saved);
          }

          return res.status(201).json({
            success: true,
            files: uploaded,
            count: uploaded.length,
          });
        } catch (saveErr) {
          const status = saveErr.statusCode || saveErr.status || 500;
          return res.status(status).json({ success: false, error: saveErr.message });
        }
      });
    },
  };
}

module.exports = {
  createFileManagerApiHandlers,
  isActionAllowed,
};
