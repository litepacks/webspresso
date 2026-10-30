/**
 * Spreadsheet Template Generator for Models (CSV and Excel .xlsx)
 * Generates ready-to-fill import templates with model column headers and sample data
 * @module plugins/data-exchange/template
 */

'use strict';

const { allowedImportColumns } = require('./import');
const { generate: generateCsv } = require('../csv/engine');

let ExcelJS = null;
function getExcelJS() {
  if (!ExcelJS) {
    try {
      ExcelJS = require('exceljs');
    } catch {
      throw new Error(
        "The 'exceljs' package is required for Excel template generation in dataExchangePlugin. Install it with: npm install exceljs"
      );
    }
  }
  return ExcelJS;
}

/**
 * Generate a type-appropriate sample value for a column
 * @param {string} colName
 * @param {Object} [meta]
 * @returns {*}
 */
function getSampleValueForColumn(colName, meta = {}) {
  const type = (meta.type || '').toLowerCase();
  const name = colName.toLowerCase();

  if (name.includes('email')) return 'user@example.com';
  if (name.includes('phone') || name.includes('mobile')) return '+1-555-0199';
  if (name.includes('url') || name.includes('website')) return 'https://example.com';
  if (name.includes('title')) return 'Sample Title';
  if (name.includes('name')) return 'Sample ' + colName.charAt(0).toUpperCase() + colName.slice(1);
  if (name.includes('description') || name.includes('bio')) return 'Sample descriptive text for ' + colName;
  if (name.includes('status')) return 'active';
  if (name.includes('role')) return 'user';
  if (name.includes('price') || name.includes('amount') || name.includes('cost')) return 29.99;
  if (name.includes('quantity') || name.includes('count') || name.includes('age')) return 10;

  switch (type) {
    case 'integer':
    case 'bigint':
      return 100;
    case 'decimal':
    case 'float':
      return 19.95;
    case 'boolean':
      return true;
    case 'date':
      return '2026-10-30';
    case 'datetime':
    case 'timestamp':
      return new Date().toISOString();
    case 'json':
      return '{"sample":"value"}';
    default:
      return 'Sample ' + colName;
  }
}

/**
 * Resolve target columns for a model template
 * @param {Object} model
 * @param {Object} [options]
 * @param {string} [options.mode='insert'] - 'insert' or 'upsert'
 * @returns {Array<{ name: string, type: string, required: boolean, sample: any }>}
 */
function resolveTemplateColumns(model, options = {}) {
  const mode = options.mode || 'insert';
  const pk = model.primaryKey || 'id';
  const allCols = allowedImportColumns(model);

  const columns = [];
  for (const colName of allCols) {
    const meta = model.columns?.get ? model.columns.get(colName) : {};
    const isPk = colName === pk;

    // In insert mode, omit auto-generated primary key
    if (mode === 'insert' && isPk && (meta.autoIncrement || meta.auto === 'create' || !meta.type)) {
      continue;
    }

    columns.push({
      name: colName,
      type: meta.type || 'string',
      required: !meta.nullable && meta.default === undefined && !meta.auto,
      sample: getSampleValueForColumn(colName, meta),
    });
  }

  return columns;
}

/**
 * Generate CSV template buffer
 * @param {Object} model
 * @param {Object} [options]
 * @returns {Buffer}
 */
function generateCsvTemplate(model, options = {}) {
  const columns = resolveTemplateColumns(model, options);
  const includeSample = options.includeSampleRow !== false;

  const headerRow = columns.map(c => c.name);
  const rows = [];

  if (includeSample) {
    const sampleObj = {};
    for (const c of columns) {
      sampleObj[c.name] = c.sample;
    }
    rows.push(sampleObj);
  }

  return generateCsv({
    rows,
    columns: headerRow,
    header: true,
    bom: true,
    asBuffer: true,
  });
}

/**
 * Generate Excel (.xlsx) template buffer with styles
 * @param {Object} model
 * @param {Object} [options]
 * @returns {Promise<Buffer>}
 */
async function generateXlsxTemplate(model, options = {}) {
  const columns = resolveTemplateColumns(model, options);
  const includeSample = options.includeSampleRow !== false;

  const ExcelLib = getExcelJS();
  const wb = new ExcelLib.Workbook();
  wb.creator = 'Webspresso Data Exchange';
  wb.created = new Date();

  const ws = wb.addWorksheet(`${model.name} Template`, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Define columns with auto-width
  ws.columns = columns.map(c => ({
    header: c.name,
    key: c.name,
    width: Math.max(c.name.length + 4, 16),
  }));

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' }, // Indigo-600
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  if (includeSample) {
    const sampleObj = {};
    for (const c of columns) {
      sampleObj[c.name] = c.sample;
    }
    const sampleRow = ws.addRow(sampleObj);
    sampleRow.font = { italic: true, color: { argb: 'FF4B5563' } }; // Gray-600
    sampleRow.height = 20;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/**
 * Express handler for downloading model template
 * @param {Object} opts
 * @param {Object} opts.db
 * @returns {Function}
 */
function createTemplateHandler(opts) {
  const { db } = opts;

  return async function templateHandler(req, res) {
    try {
      const modelName = req.params.model;
      const { getModel } = require('../../core/orm/model');
      const model = db.getModel ? db.getModel(modelName) : getModel(modelName);

      if (!model || !model.admin?.enabled) {
        return res.status(404).json({ error: `Model "${modelName}" not found or disabled.` });
      }

      const format = (req.query.format || 'csv').toLowerCase();
      const mode = (req.query.mode || 'insert').toLowerCase();
      const includeSample = req.query.sample !== 'false' && req.query.sample !== '0';

      const safeName = String(model.name).replace(/[^\w.-]+/g, '_');

      if (format === 'xlsx' || format === 'excel') {
        const buffer = await generateXlsxTemplate(model, { mode, includeSampleRow: includeSample });
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}_template.xlsx"`);
        return res.send(buffer);
      }

      // Default: CSV
      const buffer = generateCsvTemplate(model, { mode, includeSampleRow: includeSample });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}_template.csv"`);
      return res.send(buffer);
    } catch (err) {
      console.error('[data-exchange] template error:', err);
      return res.status(500).json({ error: err.message || 'Template generation failed' });
    }
  };
}

module.exports = {
  getSampleValueForColumn,
  resolveTemplateColumns,
  generateCsvTemplate,
  generateXlsxTemplate,
  createTemplateHandler,
};
