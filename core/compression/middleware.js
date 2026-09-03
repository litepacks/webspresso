/**
 * HTTP Compression Middleware
 * Provides threshold-based streaming response compression for Webspresso applications.
 * @module core/compression/middleware
 */

const { selectEncoding, getDefaultSupportedEncodings } = require('./negotiate');
const { isCompressible } = require('./compressible');
const { createCompressionStream } = require('./compression-stream');

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
  const supportedEncodings = Array.isArray(options.encodings) && options.encodings.length > 0
    ? options.encodings
    : getDefaultSupportedEncodings();

  const customFilter = typeof options.filter === 'function' ? options.filter : null;

  return function compressionMiddleware(req, res, next) {
    // Expose opt-out API on response object
    res._noCompression = false;
    res.compress = function(enable = true) {
      res._noCompression = !enable;
      return res;
    };

    // Skip compression for HEAD requests
    if (req.method === 'HEAD') {
      return next();
    }

    const acceptEncoding = req.headers['accept-encoding'];
    let selectedEncoding = null;
    let checkedEncoding = false;

    function getSelectedEncoding() {
      if (!checkedEncoding) {
        checkedEncoding = true;
        selectedEncoding = selectEncoding(acceptEncoding, supportedEncodings);
      }
      return selectedEncoding;
    }

    // Original methods to wrap
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    const origWriteHead = res.writeHead.bind(res);

    let compressStream = null;
    let isCompressing = false;
    let headersSent = false;
    let bufferedChunks = [];
    let bufferedLength = 0;
    let decided = false;

    /**
     * Check if response should be compressed
     * @param {number} [expectedLength]
     * @returns {boolean}
     */
    function shouldCompress(expectedLength) {
      if (res._noCompression || res.locals?.compress === false || res.shouldCompress === false) {
        return false;
      }

      // Check status codes that must not have a body
      const statusCode = res.statusCode || 200;
      if (statusCode === 204 || statusCode === 304 || statusCode === 205 || statusCode < 200) {
        return false;
      }

      // If response already has a Content-Encoding, do not double-compress
      if (res.getHeader('Content-Encoding')) {
        return false;
      }

      // Check Content-Type compressibility
      const contentType = res.getHeader('Content-Type');
      if (!contentType || !isCompressible(contentType)) {
        return false;
      }

      // Check threshold if length is known
      if (typeof expectedLength === 'number' && expectedLength < threshold) {
        return false;
      }

      // Custom filter hook
      if (customFilter && !customFilter(req, res)) {
        return false;
      }

      // Check if client supports any available encoding
      const encoding = getSelectedEncoding();
      if (!encoding || encoding === 'identity') {
        return false;
      }

      return true;
    }

    /**
     * Initialize compression stream and headers
     */
    function startCompression() {
      const encoding = getSelectedEncoding();
      compressStream = createCompressionStream(encoding, options);
      if (!compressStream) {
        isCompressing = false;
        return;
      }

      isCompressing = true;
      appendVary(res, 'Accept-Encoding');
      res.setHeader('Content-Encoding', encoding);
      res.removeHeader('Content-Length');

      // Pipe compression stream chunks directly into underlying socket/response
      compressStream.on('data', (chunk) => {
        origWrite(chunk);
      });

      compressStream.on('end', () => {
        origEnd();
      });

      compressStream.on('error', (err) => {
        origEnd();
      });
    }

    // Wrap writeHead
    res.writeHead = function(statusCode, ...args) {
      if (res.headersSent) return res;

      if (typeof args[0] === 'object' && args[0] !== null) {
        for (const [k, v] of Object.entries(args[0])) {
          res.setHeader(k, v);
        }
      } else if (typeof args[1] === 'object' && args[1] !== null) {
        for (const [k, v] of Object.entries(args[1])) {
          res.setHeader(k, v);
        }
      }

      if (isCompressing) {
        const encoding = getSelectedEncoding();
        if (encoding) {
          res.setHeader('Content-Encoding', encoding);
        }
        res.removeHeader('Content-Length');
        appendVary(res, 'Accept-Encoding');
      }

      return origWriteHead.call(res, statusCode, ...args);
    };

    // Wrap write
    res.write = function(chunk, encoding, callback) {
      if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }

      if (!chunk) {
        return true;
      }

      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);

      if (!decided) {
        bufferedChunks.push(buf);
        bufferedLength += buf.length;

        // If buffered size exceeds threshold, decide to start compression immediately
        if (bufferedLength >= threshold) {
          decided = true;
          if (shouldCompress()) {
            startCompression();
            // Flush buffered chunks through compressor
            for (const b of bufferedChunks) {
              compressStream.write(b);
            }
            bufferedChunks = [];
          } else {
            // Send buffered chunks uncompressed
            for (const b of bufferedChunks) {
              origWrite(b);
            }
            bufferedChunks = [];
          }
        }
        if (typeof callback === 'function') callback();
        return true;
      }

      if (isCompressing && compressStream) {
        return compressStream.write(buf, callback);
      }

      return origWrite(buf, callback);
    };

    // Wrap end
    res.end = function(chunk, encoding, callback) {
      if (typeof chunk === 'function') {
        callback = chunk;
        chunk = null;
      } else if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }

      if (chunk) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        if (!decided) {
          bufferedChunks.push(buf);
          bufferedLength += buf.length;
        } else if (isCompressing && compressStream) {
          compressStream.write(buf);
        } else {
          origWrite(buf);
        }
      }

      if (!decided) {
        decided = true;
        // Check if total length satisfies threshold and compressibility
        if (shouldCompress(bufferedLength)) {
          startCompression();
          if (bufferedChunks.length === 1) {
            if (typeof callback === 'function') {
              compressStream.once('end', callback);
            }
            const singleBuf = bufferedChunks[0];
            bufferedChunks = [];
            compressStream.end(singleBuf);
            return res;
          }
          for (const b of bufferedChunks) {
            compressStream.write(b);
          }
          bufferedChunks = [];
        } else {
          // Output uncompressed
          if (shouldCompress(Infinity) && bufferedLength < threshold) {
            // Ensure Vary is set if content was compressible but just below threshold
            appendVary(res, 'Accept-Encoding');
          }
          for (const b of bufferedChunks) {
            origWrite(b);
          }
          bufferedChunks = [];
          return origEnd(callback);
        }
      }

      if (isCompressing && compressStream) {
        if (typeof callback === 'function') {
          compressStream.once('end', callback);
        }
        compressStream.end();
        return res;
      }

      return origEnd(callback);
    };

    next();
  };
}

module.exports = {
  createCompressionMiddleware,
  appendVary,
};
