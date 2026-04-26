/**
 * Excel (.xlsx) export using exceljs
 * @module plugins/data-exchange/export-xlsx
 */

const ExcelJS = require('exceljs');
const { sanitizeForOutput } = require('../../core/orm/utils');
const { resolveExportRecords } = require('./record-selection');

/**
 * @param {import('../../core/orm/types').ModelDefinition} model
 * @param {object[]} records
 * @returns {Promise<Buffer>}
 */
async function buildXlsxBuffer(model, records) {
  const clean = sanitizeForOutput(records, model);
  const hiddenSet = new Set(model.hidden || []);
  const columns = Array.from(model.columns.keys()).filter((c) => !hiddenSet.has(c));

  const wb = new ExcelJS.Workbook();
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
 * @param {object} opts
 * @param {import('../../core/orm/database').Database} opts.db
 * @param {number} opts.maxRows
 */
function createExportXlsxHandler(opts) {
  const { db, maxRows } = opts;

  return async function exportXlsxHandler(req, res) {
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
      const buffer = await buildXlsxBuffer(model, records);
      const safeName = String(model.name).replace(/[^\w.-]+/g, '_');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}_export.xlsx"`);
      res.send(buffer);
    } catch (err) {
      console.error('[data-exchange] export xlsx:', err);
      res.status(500).json({ error: err.message || 'Export failed' });
    }
  };
}

module.exports = {
  buildXlsxBuffer,
  createExportXlsxHandler,
};
