/**
 * Data Exchange Export Engine (Excel .xlsx and CSV)
 * @module plugins/data-exchange/export
 */

'use strict';

const { sanitizeForOutput } = require('../../core/orm/utils');
const { resolveExportRecords } = require('./record-selection');
const { generate: generateCsv } = require('../csv/engine');

let ExcelJS = null;
function getExcelJS() {
  if (!ExcelJS) {
    try {
      ExcelJS = require('exceljs');
    } catch {
      throw new Error(
        "The 'exceljs' package is required for Excel export in dataExchangePlugin. Install it with: npm install exceljs"
      );
    }
  }
  return ExcelJS;
}

/**
 * Resolve allowed export columns for a model
 * @param {Object} model
 * @param {Array<Object>} [cleanRecords=[]]
 * @param {Array<string>} [requestedColumns]
 * @returns {Array<string>}
 */
function getModelExportColumns(model, cleanRecords = [], requestedColumns = null) {
  const hiddenSet = new Set(model.hidden || []);
  const colSet = new Set();

  if (model.columns && typeof model.columns.keys === 'function') {
    for (const c of model.columns.keys()) {
      if (!hiddenSet.has(c)) colSet.add(c);
    }
  }
  if (model.schema?.shape) {
    for (const c of Object.keys(model.schema.shape)) {
      if (!hiddenSet.has(c)) colSet.add(c);
    }
  }
  if (colSet.size === 0 && cleanRecords.length > 0) {
    for (const c of Object.keys(cleanRecords[0])) {
      if (!hiddenSet.has(c)) colSet.add(c);
    }
  }

  const allAvailable = Array.from(colSet);

  if (requestedColumns && Array.isArray(requestedColumns) && requestedColumns.length > 0) {
    const requestedSet = new Set(requestedColumns);
    return allAvailable.filter(c => requestedSet.has(c));
  }

  return allAvailable;
}

/**
 * Build Excel (.xlsx) Buffer
 * @param {Object} model
 * @param {Array<Object>} records
 * @param {Object} [options]
 * @returns {Promise<Buffer>}
 */
async function buildXlsxBuffer(model, records, options = {}) {
  const clean = sanitizeForOutput(records, model);
  const requestedColumns = options.columns || null;
  const columns = getModelExportColumns(model, clean, requestedColumns);

  const ExcelLib = getExcelJS();
  const wb = new ExcelLib.Workbook();
  const ws = wb.addWorksheet('Export', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.addRow(columns);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };

  for (const rec of clean) {
    const rowValues = columns.map((c) => {
      let v = rec[c];
      if (v === null || v === undefined) return '';
      if (typeof v === 'bigint') return v.toString();
      if (v instanceof Date) return v.toISOString();
      if (Buffer.isBuffer(v)) return v.toString('base64');
      if (typeof v === 'object') v = JSON.stringify(v);
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) return ` ${v}`;
      return v;
    });
    ws.addRow(rowValues);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/**
 * Build CSV Buffer
 * @param {Object} model
 * @param {Array<Object>} records
 * @param {Object} [options]
 * @returns {Buffer}
 */
function buildCsvBuffer(model, records, options = {}) {
  const clean = sanitizeForOutput(records, model);
  const requestedColumns = options.columns || null;
  const columns = getModelExportColumns(model, clean, requestedColumns);

  const rows = clean.map(rec => {
    const rowObj = {};
    for (const c of columns) {
      let v = rec[c];
      if (v === null || v === undefined) {
        rowObj[c] = '';
      } else if (typeof v === 'bigint') {
        rowObj[c] = v.toString();
      } else if (v instanceof Date) {
        rowObj[c] = v.toISOString();
      } else if (Buffer.isBuffer(v)) {
        rowObj[c] = v.toString('base64');
      } else if (typeof v === 'object') {
        rowObj[c] = JSON.stringify(v);
      } else {
        rowObj[c] = v;
      }
    }
    return rowObj;
  });

  return generateCsv({
    rows,
    columns,
    header: true,
    bom: true,
    asBuffer: true,
  });
}

/**
 * Express handler for exporting records in XLSX or CSV format
 * @param {Object} opts
 * @param {Object} opts.db
 * @param {number} [opts.maxRows=10000]
 * @returns {Function}
 */
function createExportHandler(opts) {
  const { db, maxRows = 10000 } = opts;

  return async function exportHandler(req, res) {
    try {
      const modelName = req.params.model || req.query.model;
      const result = await resolveExportRecords(db, modelName, req);
      if (result.error) {
        return res.status(result.error).json({ error: result.message });
      }
      const { model, records } = result;
      if (records.length > maxRows) {
        return res.status(400).json({
          error: `Too many rows to export (${records.length}). Limit is ${maxRows}.`,
        });
      }

      // Format: xlsx (default) or csv
      const format = String(req.query.format || req.body?.format || 'xlsx').toLowerCase();

      // Custom columns filter
      let requestedCols = null;
      if (req.query.columns) {
        requestedCols = Array.isArray(req.query.columns)
          ? req.query.columns
          : String(req.query.columns).split(',').map(s => s.trim()).filter(Boolean);
      } else if (req.body?.columns) {
        requestedCols = Array.isArray(req.body.columns)
          ? req.body.columns
          : String(req.body.columns).split(',').map(s => s.trim()).filter(Boolean);
      }

      const safeName = String(model.name).replace(/[^\w.-]+/g, '_');

      if (format === 'csv') {
        const buffer = buildCsvBuffer(model, records, { columns: requestedCols });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}_export.csv"`);
        return res.send(buffer);
      }

      // Default: XLSX
      const buffer = await buildXlsxBuffer(model, records, { columns: requestedCols });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}_export.xlsx"`);
      return res.send(buffer);
    } catch (err) {
      console.error('[data-exchange] export error:', err);
      return res.status(500).json({ error: err.message || 'Export failed' });
    }
  };
}

module.exports = {
  buildXlsxBuffer,
  buildCsvBuffer,
  getModelExportColumns,
  createExportHandler,
  createExportXlsxHandler: createExportHandler, // backward-compat alias
};
