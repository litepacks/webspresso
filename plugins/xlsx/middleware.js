'use strict';

/**
 * XLSX Express Middleware
 * Decorates res.xlsx() and req.parseXlsx() helpers
 * @module plugins/xlsx/middleware
 */

const { generate, parse, fromModel } = require('./engine');

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Creates the XLSX middleware
 * @param {Object} [globalOptions]
 * @returns {Function}
 */
function createXlsxMiddleware(globalOptions = {}) {
  return (req, res, next) => {
    // 1. Response Helper: res.xlsx(data, filename, options)
    res.xlsx = async function (data, filename = 'export.xlsx', options = {}) {
      try {
        let buffer;

        if (Buffer.isBuffer(data)) {
          buffer = data;
        } else if (data && typeof data.find === 'function' && data.model) {
          // Repository instance
          buffer = await fromModel(data, options.filter || options.query || {}, {
            ...globalOptions,
            ...options,
          });
        } else if (Array.isArray(data)) {
          buffer = await generate({
            ...globalOptions,
            ...options,
            sheets: [
              {
                name: options.sheetName || 'Data',
                columns: options.columns,
                rows: data,
                headerStyle: options.headerStyle,
              },
            ],
          });
        } else if (data && typeof data === 'object') {
          buffer = await generate({
            ...globalOptions,
            ...options,
            ...data,
          });
        } else {
          throw new Error('res.xlsx() expects an Array of rows, a sheets object, a Model Repository, or a Buffer');
        }

        const safeFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;

        res.setHeader('Content-Type', XLSX_MIME_TYPE);
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

    // 2. Request Helper: req.parseXlsx(fileOrBuffer, options)
    req.parseXlsx = async function (fileOrBuffer, options = {}) {
      const target = fileOrBuffer || req.file?.buffer || req.rawBody || req.body;
      if (!target) {
        throw new Error('req.parseXlsx requires a file Buffer or multipart req.file.buffer');
      }
      return parse(target, options);
    };

    next();
  };
}

module.exports = {
  createXlsxMiddleware,
  XLSX_MIME_TYPE,
};
