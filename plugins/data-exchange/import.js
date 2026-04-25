/**
 * CSV / XLSX import (admin multipart upload)
 * @module plugins/data-exchange/import
 */

const multer = require('multer');
const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { buildHeaderMapping, dataRowsToObjects } = require('./parse-table');

function allowedImportColumns(model) {
  const hidden = new Set(model.hidden || []);
  return Array.from(model.columns.keys()).filter((c) => !hidden.has(c));
}

/**
 * @param {*} raw
 * @param {import('../../core/orm/types').ColumnMeta|undefined} meta
 * @param {string} column
 */
function coerceCell(raw, meta, column) {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number' && Number.isNaN(raw)) return undefined;

  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t === '') return undefined;
    raw = t;
  }

  if (!meta || !meta.type) return raw;

  switch (meta.type) {
    case 'bigint':
    case 'integer': {
      if (typeof raw === 'number') return Math.trunc(raw);
      const n = parseInt(String(raw), 10);
      if (Number.isNaN(n)) throw new Error(`Invalid integer for ${column}`);
      return n;
    }
    case 'decimal':
    case 'float': {
      if (typeof raw === 'number') return raw;
      const n = parseFloat(String(raw));
      if (Number.isNaN(n)) throw new Error(`Invalid number for ${column}`);
      return n;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes') return true;
      if (s === 'false' || s === '0' || s === 'no') return false;
      throw new Error(`Invalid boolean for ${column}`);
    }
    case 'json': {
      if (typeof raw === 'object') return raw;
      try {
        return JSON.parse(String(raw));
      } catch {
        throw new Error(`Invalid JSON for ${column}`);
      }
    }
    default:
      return raw;
  }
}

function buildPayloadForRow(model, data, mode) {
  const allowed = new Set(allowedImportColumns(model));
  const payload = {};
  for (const [col, raw] of Object.entries(data)) {
    if (!allowed.has(col)) continue;
    const meta = model.columns.get(col);
    let v;
    try {
      v = coerceCell(raw, meta, col);
    } catch (e) {
      throw e;
    }
    if (v === undefined) continue;
    payload[col] = v;
  }

  const pk = model.primaryKey;
  const pkMeta = model.columns.get(pk);
  if (
    mode === 'insert' &&
    pkMeta?.autoIncrement &&
    (payload[pk] === undefined || payload[pk] === null || payload[pk] === '')
  ) {
    delete payload[pk];
  }

  return payload;
}

function parseCsvToRows(buffer) {
  const text = buffer.toString('utf8');
  const records = parseCsv(text, {
    relaxColumnCount: true,
    skipEmptyLines: true,
  });
  if (records.length === 0) return [];
  return records.map((row) => row.map((c) => (c === '' ? '' : c)));
}

async function parseXlsxToRows(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    let maxCol = 0;
    row.eachCell({ includeEmpty: true }, (_cell, colNumber) => {
      maxCol = Math.max(maxCol, colNumber);
    });
    const arr = [];
    for (let c = 1; c <= maxCol; c++) {
      arr.push(cellValueToPlain(row.getCell(c)));
    }
    rows.push(arr);
  });
  return rows;
}

function cellValueToPlain(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v !== null) {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text || '').join('');
    }
    if ('result' in v && v.result !== undefined) return v.result;
  }
  return v;
}

function createMulter(maxFileBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileBytes, files: 1 },
  });
}

/**
 * @param {object} opts
 * @param {import('../../core/orm/database').Database} opts.db
 * @param {number} opts.maxRows
 * @param {number} opts.maxFileBytes
 */
function createImportHandler(opts) {
  const { db, maxRows, maxFileBytes } = opts;
  const upload = createMulter(maxFileBytes).single('file');

  return async function importHandler(req, res) {
    upload(req, res, async (multerErr) => {
      try {
        if (multerErr) {
          const code = multerErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
          return res.status(code).json({
            error: multerErr.code === 'LIMIT_FILE_SIZE' ? 'File too large' : multerErr.message,
          });
        }

        const modelName = req.params.model;
        const { getModel } = require('../../core/orm/model');
        const model = db.getModel ? db.getModel(modelName) : getModel(modelName);
        if (!model || !model.admin?.enabled) {
          return res.status(404).json({ error: 'Model not found or not enabled' });
        }

        const modeRaw = (req.query.mode || req.body?.mode || 'insert').toLowerCase();
        const mode = modeRaw === 'upsert' ? 'upsert' : 'insert';
        let upsertKey = req.query.upsertKey || req.body?.upsertKey || model.primaryKey;
        upsertKey = String(upsertKey);

        if (!model.columns.has(upsertKey)) {
          return res.status(400).json({ error: `upsertKey "${upsertKey}" is not a column` });
        }
        if (model.hidden?.includes(upsertKey)) {
          return res.status(400).json({ error: `upsertKey "${upsertKey}" is not allowed` });
        }

        if (!req.file || !req.file.buffer) {
          return res.status(400).json({ error: 'Missing file field' });
        }

        const name = (req.file.originalname || '').toLowerCase();
        const isCsv = name.endsWith('.csv') || (req.file.mimetype || '').includes('csv');
        let rows;
        if (isCsv) {
          rows = parseCsvToRows(req.file.buffer);
        } else {
          try {
            rows = await parseXlsxToRows(req.file.buffer);
          } catch (e) {
            return res.status(400).json({ error: `Invalid spreadsheet: ${e.message}` });
          }
        }

        if (rows.length < 2) {
          return res.status(400).json({ error: 'File must include a header row and at least one data row' });
        }

        const allowedKeys = allowedImportColumns(model);
        const headerMapping = buildHeaderMapping(rows[0], allowedKeys);
        const objects = dataRowsToObjects(rows, headerMapping);
        if (objects.length > maxRows) {
          return res.status(400).json({ error: `Too many data rows (${objects.length}). Limit is ${maxRows}.` });
        }

        const repo = db.getRepository(model.name);
        const summary = {
          success: true,
          created: 0,
          updated: 0,
          failed: 0,
          errors: [],
        };

        for (const { rowNumber, data } of objects) {
          try {
            const payload = buildPayloadForRow(model, data, mode);
            if (Object.keys(payload).length === 0) {
              summary.failed++;
              summary.errors.push({ row: rowNumber, message: 'No mappable columns' });
              continue;
            }

            if (mode === 'insert') {
              await repo.create(payload);
              summary.created++;
              continue;
            }

            const keyMeta = model.columns.get(upsertKey);
            let keyVal;
            try {
              keyVal = coerceCell(data[upsertKey], keyMeta, upsertKey);
            } catch (e) {
              summary.failed++;
              summary.errors.push({ row: rowNumber, message: e.message || 'Bad upsert key' });
              continue;
            }

            if (keyVal === undefined || keyVal === null) {
              const insertPayload = { ...payload };
              delete insertPayload[upsertKey];
              await repo.create(insertPayload);
              summary.created++;
              continue;
            }

            const existing = await repo.findOne({ [upsertKey]: keyVal });
            if (existing) {
              const id = existing[model.primaryKey];
              await repo.update(id, payload);
              summary.updated++;
            } else {
              await repo.create({ ...payload, [upsertKey]: keyVal });
              summary.created++;
            }
          } catch (e) {
            summary.failed++;
            summary.errors.push({ row: rowNumber, message: e.message || String(e) });
          }
        }

        summary.success = summary.failed === 0;
        res.json(summary);
      } catch (err) {
        console.error('[data-exchange] import:', err);
        res.status(500).json({ error: err.message || 'Import failed' });
      }
    });
  };
}

module.exports = {
  createImportHandler,
  createMulter,
  allowedImportColumns,
  parseCsvToRows,
  parseXlsxToRows,
  buildPayloadForRow,
};
