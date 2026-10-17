/**
 * HTTP Compression Middleware
 * Provides threshold-based streaming response compression for Webspresso applications.
 * Backed by the official Express compression package with native Brotli (br), Gzip, and Deflate support.
 * @module core/compression/middleware
 */

const compression = require('compression');

/**
 * Safely append a field to the HTTP Vary header
 * @param {import('http').ServerResponse} res
 * @param {string} field
 */
function appendVary(res, field) {
  const current = res.getHeader('Vary');
  if (!current) {
    res.setHeader('Vary', field);
    return;
  }

  const currentStr = Array.isArray(current) ? current.join(', ') : String(current);
  const parts = currentStr.split(',').map(s => s.trim().toLowerCase());

  if (parts.includes('*') || parts.includes(field.toLowerCase())) {
    return;
  }

  res.setHeader('Vary', `${currentStr}, ${field}`);
}

/**
 * Response helper to opt-out of compression for a specific route
 * @param {boolean} [enable=true]
 */
function resCompress(enable = true) {
  this._noCompression = !enable;
  return this;
}

/**
 * Create Webspresso HTTP Response Compression Middleware
 * @param {Object} [options]
 * @param {number} [options.threshold=1024] - Minimum response size in bytes to apply compression
 * @param {number} [options.level=6] - Default compression level
 * @param {string[]} [options.encodings] - Supported encodings in preference order
 * @param {function(import('http').IncomingMessage, import('http').ServerResponse): boolean} [options.filter] - Custom filter function
 * @param {Object} [options.brotli] - Custom Brotli options
 * @param {Object} [options.gzip] - Custom Gzip options
 * @param {Object} [options.deflate] - Custom Deflate options
 * @returns {import('express').RequestHandler}
 */
function createCompressionMiddleware(options = {}) {
  const threshold = typeof options.threshold === 'number' && options.threshold >= 0 ? options.threshold : 1024;
  const customFilter = typeof options.filter === 'function' ? options.filter : null;

  const comp = compression({
    ...options,
    threshold,
    brotli: options.brotli,
    level: options.level,
    filter: (req, res) => {
      // Respect Webspresso opt-out flags
      if (res._noCompression || res.locals?.compress === false || res.shouldCompress === false) {
        return false;
      }
      // Never compress server-sent event streams
      const contentType = res.getHeader('Content-Type');
      if (contentType && String(contentType).toLowerCase().includes('text/event-stream')) {
        return false;
      }
      if (customFilter) {
        return customFilter(req, res);
      }
      return compression.filter(req, res);
    },
  });

  return function compressionMiddleware(req, res, next) {
    // Expose opt-out API on response object
    res._noCompression = false;
    res.compress = resCompress;

    // Prevent Content-Length header mismatch if setHeader is invoked after compression starts
    const origSetHeader = res.setHeader;
    res.setHeader = function(field, val) {
      if (res.getHeader('Content-Encoding') && typeof field === 'string' && field.toLowerCase() === 'content-length') {
        return res;
      }
      return origSetHeader.call(res, field, val);
    };

    return comp(req, res, next);
  };
}

module.exports = {
  createCompressionMiddleware,
  appendVary,
};
