'use strict';

/**
 * CSV Express Middleware
 * Decorates res.csv() and req.parseCsv() helpers
 * @module plugins/csv/middleware
 */

const { generate, parse, fromModel, CSV_MIME_TYPE } = require('./engine');

/**
 * Creates the CSV middleware
 * @param {Object} [globalOptions]
 * @returns {Function}
 */
function createCsvMiddleware(globalOptions = {}) {
  return (req, res, next) => {
    // 1. Response Helper: res.csv(data, filename, options)
    res.csv = async function (data, filename = 'export.csv', options = {}) {
      try {
        let buffer;

        if (Buffer.isBuffer(data)) {
          buffer = data;
        } else if (typeof data === 'string') {
          buffer = Buffer.from(data, 'utf8');
        } else if (data && (typeof data.find === 'function' || typeof data.query === 'function') && data.model) {
          // Model repository instance
          buffer = await fromModel(data, options.filter || options.query || {}, {
            ...globalOptions,
            ...options,
          });
        } else if (Array.isArray(data)) {
          buffer = generate({
            ...globalOptions,
            ...options,
            rows: data,
          });
        } else if (data && typeof data === 'object') {
          buffer = generate({
            ...globalOptions,
            ...options,
            ...data,
          });
        } else {
          throw new Error('res.csv() expects an Array of rows, a config object, a Model Repository, a Buffer, or a String');
        }

        const safeFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;

        res.setHeader('Content-Type', CSV_MIME_TYPE);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(safeFilename)}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
        );
        res.setHeader('Content-Length', buffer.length);

        return res.end(buffer);
      } catch (err) {
        return next(err);
      }
    };

    // 2. Request Helper: req.parseCsv(fileOrBufferOrString, options)
    req.parseCsv = async function (fileOrBufferOrString, options = {}) {
      const target = fileOrBufferOrString || req.file?.buffer || req.rawBody || req.body;
      if (!target) {
        throw new Error('req.parseCsv requires a CSV string, Buffer, or multipart req.file.buffer');
      }
      return parse(target, options);
    };

    next();
  };
}

module.exports = {
  createCsvMiddleware,
  CSV_MIME_TYPE,
};
