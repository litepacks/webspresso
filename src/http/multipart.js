/**
 * Multipart file extraction from parsed body (Hono parseBody)
 * @module src/http/multipart
 */

/**
 * @param {object} req
 * @param {string} fieldName
 * @param {number} maxBytes
 */
async function extractUploadFile(req, fieldName, maxBytes) {
  const raw = req.body?.[fieldName];
  if (!raw) return null;

  if (raw && typeof raw.arrayBuffer === 'function') {
    const buf = Buffer.from(await raw.arrayBuffer());
    if (buf.length > maxBytes) {
      const err = new Error('File too large');
      err.code = 'LIMIT_FILE_SIZE';
      throw err;
    }
    return {
      buffer: buf,
      mimetype: raw.type || raw.mimetype || 'application/octet-stream',
      originalname: raw.name || raw.originalname || 'upload',
      size: buf.length,
    };
  }

  if (raw && Buffer.isBuffer(raw)) {
    if (raw.length > maxBytes) {
      const err = new Error('File too large');
      err.code = 'LIMIT_FILE_SIZE';
      throw err;
    }
    return {
      buffer: raw,
      mimetype: 'application/octet-stream',
      originalname: 'upload',
      size: raw.length,
    };
  }

  if (Buffer.isBuffer(raw)) {
    if (raw.length > maxBytes) {
      const err = new Error('File too large');
      err.code = 'LIMIT_FILE_SIZE';
      throw err;
    }
    return {
      buffer: raw,
      mimetype: 'application/octet-stream',
      originalname: 'upload',
      size: raw.length,
    };
  }

  return null;
}

module.exports = { extractUploadFile };
