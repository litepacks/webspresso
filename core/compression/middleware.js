/**
 * HTTP Compression Middleware
 * Provides zero-dependency, threshold-based streaming response compression for Webspresso applications.
 * Uses native node:zlib with Brotli (br), Gzip, and Deflate support.
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
 * Response helper to opt-out of compression for a specific route
 * @param {boolean} [enable=true]
 */
function resCompress(enable = true) {
  this._noCompression = !enable;
  return this;
}

/**
 * Default compressibility filter
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {boolean}
 */
function defaultFilter(req, res) {
  const contentType = res.getHeader('Content-Type');
  if (!contentType) return false;
  return isCompressible(contentType);
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
  const supportedEncodings = options.encodings || getDefaultSupportedEncodings();

  return function compressionMiddleware(req, res, next) {
    // Expose opt-out API on response object
    res._noCompression = false;
    res.compress = resCompress;

    if (req.method === 'HEAD') {
      return next();
    }

    const _write = res.write;
    const _end = res.end;
    const _writeHead = res.writeHead;
    const _setHeader = res.setHeader;

    let chunks = [];
    let bufferedBytes = 0;
    let compressStream = null;
    let decided = false;
    let shouldCompress = false;
    let headersFlushed = false;
    let pendingWriteHead = null;

    // Prevent Content-Length header mismatch once compression starts
    res.setHeader = function(field, val) {
      if (typeof field === 'string' && field.toLowerCase() === 'content-length') {
        if (shouldCompress || res.getHeader('Content-Encoding')) {
          return res;
        }
      }
      return _setHeader.call(res, field, val);
    };

    function checkCanCompress() {
      if (res._noCompression || res.locals?.compress === false || res.shouldCompress === false) {
        return false;
      }
      const code = res.statusCode || 200;
      if (code === 204 || code === 304) {
        return false;
      }
      if (res.getHeader('Content-Encoding')) {
        return false;
      }
      const contentType = res.getHeader('Content-Type');
      if (contentType && String(contentType).toLowerCase().includes('text/event-stream')) {
        return false;
      }
      if (customFilter) {
        return Boolean(customFilter(req, res));
      }
      if (!contentType) {
        return false;
      }
      return isCompressible(contentType);
    }

    function flushHeaders(compressing, encoding) {
      if (headersFlushed) return;
      headersFlushed = true;

      if (compressing && encoding) {
        appendVary(res, 'Accept-Encoding');
        res.removeHeader('Content-Length');
        _setHeader.call(res, 'Content-Encoding', encoding);
      }

      if (pendingWriteHead) {
        const { statusCode, reason, headers } = pendingWriteHead;
        if (compressing && headers) {
          delete headers['content-length'];
          delete headers['Content-Length'];
          headers['content-encoding'] = encoding;
        }
        if (reason) {
          _writeHead.call(res, statusCode, reason, headers);
        } else if (headers) {
          _writeHead.call(res, statusCode, headers);
        } else {
          _writeHead.call(res, statusCode);
        }
        pendingWriteHead = null;
      }
    }

    function startCompression() {
      if (decided) return;
      decided = true;

      const acceptEncoding = req.headers['accept-encoding'];
      const encoding = selectEncoding(acceptEncoding, supportedEncodings);

      if (!encoding || encoding === 'identity' || !checkCanCompress()) {
        shouldCompress = false;
        flushHeaders(false);
        if (chunks.length > 0) {
          for (const c of chunks) {
            _write.call(res, c);
          }
          chunks = [];
        }
        return;
      }

      const stream = createCompressionStream(encoding, options);
      if (!stream) {
        shouldCompress = false;
        flushHeaders(false);
        if (chunks.length > 0) {
          for (const c of chunks) {
            _write.call(res, c);
          }
          chunks = [];
        }
        return;
      }

      shouldCompress = true;
      compressStream = stream;
      flushHeaders(true, encoding);

      compressStream.on('data', (chunk) => {
        if (_write.call(res, chunk) === false) {
          compressStream.pause();
          res.once('drain', () => compressStream.resume());
        }
      });

      compressStream.on('end', () => {
        _end.call(res);
      });

      compressStream.on('drain', () => {
        res.emit('drain');
      });

      compressStream.on('error', () => {
        _end.call(res);
      });

      res.on('close', () => {
        if (compressStream && !compressStream.destroyed) {
          compressStream.destroy();
        }
      });

      if (chunks.length > 0) {
        for (const c of chunks) {
          compressStream.write(c);
        }
        chunks = [];
      }
    }

    res.writeHead = function(statusCode, reason, obj) {
      let headers = obj;
      let reasonPhrase = reason;
      if (typeof reason !== 'string') {
        headers = reason;
        reasonPhrase = undefined;
      }

      pendingWriteHead = { statusCode, reason: reasonPhrase, headers };

      let cl = res.getHeader('Content-Length');
      if (!cl && headers) {
        cl = headers['content-length'] || headers['Content-Length'];
      }

      const clNum = cl ? parseInt(cl, 10) : null;
      if (clNum !== null && !isNaN(clNum) && clNum < threshold) {
        decided = true;
        shouldCompress = false;
        flushHeaders(false);
      } else if (clNum !== null && !isNaN(clNum) && clNum >= threshold) {
        startCompression();
      }

      return res;
    };

    res.write = function(chunk, encoding, callback) {
      if (!chunk) return true;

      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');

      if (!decided) {
        chunks.push(buf);
        bufferedBytes += buf.length;

        if (bufferedBytes >= threshold) {
          startCompression();
        }
        if (typeof callback === 'function') callback();
        return true;
      }

      if (shouldCompress && compressStream) {
        return compressStream.write(buf, callback);
      } else {
        return _write.call(res, chunk, encoding, callback);
      }
    };

    res.end = function(chunk, encoding, callback) {
      if (chunk) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
        if (!decided) {
          chunks.push(buf);
          bufferedBytes += buf.length;
        } else if (shouldCompress && compressStream) {
          compressStream.write(buf);
        } else {
          chunks.push(buf);
        }
      }

      if (!decided) {
        if (bufferedBytes >= threshold) {
          startCompression();
        } else {
          decided = true;
          shouldCompress = false;
          flushHeaders(false);
        }
      }

      if (shouldCompress && compressStream) {
        if (chunks.length > 0) {
          for (const c of chunks) {
            compressStream.write(c);
          }
          chunks = [];
        }
        compressStream.end(callback);
      } else {
        flushHeaders(false);
        if (chunks.length > 0) {
          for (const c of chunks) {
            _write.call(res, c);
          }
          chunks = [];
        }
        return _end.call(res, callback);
      }
    };

    next();
  };
}

createCompressionMiddleware.filter = defaultFilter;

module.exports = {
  createCompressionMiddleware,
  appendVary,
};

