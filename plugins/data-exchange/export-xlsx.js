/**
 * Excel (.xlsx) export using exceljs
 * Forwarding to enhanced export engine for backward compatibility
 * @module plugins/data-exchange/export-xlsx
 */

'use strict';

const {
  buildXlsxBuffer,
  createExportHandler,
  getModelExportColumns,
} = require('./export');

module.exports = {
  buildXlsxBuffer,
  createExportXlsxHandler: createExportHandler,
  getModelExportColumns,
};
