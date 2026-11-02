/**
 * Spreadsheet Preview & Smart Column Mapping Analyzer
 * Parses first rows of CSV/XLSX and matches file headers to ORM model columns
 * @module plugins/data-exchange/preview
 */

'use strict';

const {
  createMulter,
  parseCsvToRows,
  parseXlsxToRows,
  allowedImportColumns,
} = require('./import');

/**
 * Normalize a column string for fuzzy/alias matching
 * e.g. "Email Address" -> "emailaddress", "is_active" -> "isactive"
 * @param {string} str
 * @returns {string}
 */
function normalizeHeaderName(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Semantic concepts for smart mapping. A header and a model column match when both
 * refer to the same concept (by whole normalized name or by one of their words), so
 * "Email" / "Mail" map to `email_address` and "Customer Name" maps to `full_name`.
 */
const CONCEPT_ALIASES = {
  name: ['name', 'fullname', 'customername', 'displayname', 'personname', 'username'],
  email: ['email', 'mail', 'emailaddress', 'useremail', 'contactemail'],
  phone: ['phone', 'phonenumber', 'telephone', 'mobile', 'tel', 'cell'],
  active: ['active', 'isactive', 'status', 'enabled', 'isenabled', 'activestatus'],
  created: ['created', 'createdat', 'creationdate', 'datecreated', 'registeredat'],
  updated: ['updated', 'updatedat', 'lastupdated', 'datemodified', 'modifiedat'],
  description: ['description', 'desc', 'details', 'notes', 'summary', 'about'],
  amount: ['amount', 'balance', 'price', 'cost', 'unitprice', 'rate', 'total'],
  quantity: ['quantity', 'qty', 'count', 'units'],
};

const IGNORED_TOKENS = new Set(['the', 'of', 'a', 'an', 'is', 'id', 'no', 'nr']);

function tokenize(str) {
  return String(str || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !IGNORED_TOKENS.has(t));
}

/**
 * Concepts a name refers to, by its whole normalized form or any of its words.
 * @param {string} name
 * @returns {Set<string>}
 */
function conceptsOf(name) {
  const norm = normalizeHeaderName(name);
  const tokens = tokenize(name);
  const found = new Set();
  for (const [concept, aliases] of Object.entries(CONCEPT_ALIASES)) {
    if (aliases.includes(norm) || tokens.some((t) => aliases.includes(t))) {
      found.add(concept);
    }
  }
  return found;
}

/**
 * Suggest model column for a given file header
 * @param {string} header
 * @param {string[]} modelCols
 * @returns {string|null}
 */
function suggestColumnMatch(header, modelCols) {
  if (!header) return null;
  const raw = String(header).trim();
  const lower = raw.toLowerCase();
  const norm = normalizeHeaderName(raw);

  // 1. Exact match
  if (modelCols.includes(raw)) return raw;

  // 2. Case-insensitive match
  for (const col of modelCols) {
    if (col.toLowerCase() === lower) return col;
  }

  // 3. Normalized alphanumeric match
  for (const col of modelCols) {
    if (normalizeHeaderName(col) === norm) return col;
  }

  // 4. Score columns by shared concepts (strong) and shared words (weak); require a unique best
  const headerConcepts = conceptsOf(raw);
  const headerTokens = new Set(tokenize(raw));
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const col of modelCols) {
    let score = 0;
    for (const c of conceptsOf(col)) {
      if (headerConcepts.has(c)) score += 2;
    }
    for (const t of tokenize(col)) {
      if (headerTokens.has(t)) score += 1;
    }
    if (score > bestScore) {
      best = col;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) {
      tie = true;
    }
  }

  return bestScore > 0 && !tie ? best : null;
}

/**
 * Analyze spreadsheet rows and generate preview payload
 * @param {Object} model
 * @param {Array<Array<any>>} rows
 * @param {number} [maxPreviewRows=10]
 * @returns {Object}
 */
function analyzeSpreadsheetPreview(model, rows, maxPreviewRows = 10) {
  if (!rows || rows.length === 0) {
    return {
      model: model.name,
      totalRows: 0,
      headers: [],
      fileHeaders: [],
      sampleRows: [],
      modelColumns: [],
      suggestedMapping: {},
    };
  }

  const rawHeaders = rows[0].map(h => String(h || '').trim());
  const fileHeaders = rawHeaders.filter(Boolean);
  const dataRows = rows.slice(1);
  const totalRows = dataRows.length;

  const sampleRows = dataRows.slice(0, maxPreviewRows).map(row => {
    return row.slice(0, fileHeaders.length).map(v => (v === null || v === undefined ? '' : String(v)));
  });

  const allowedCols = allowedImportColumns(model);
  const pk = model.primaryKey || 'id';

  const modelColumns = allowedCols.map(colName => {
    const meta = model.columns?.get ? model.columns.get(colName) : {};
    return {
      name: colName,
      type: meta.type || 'string',
      required: !meta.nullable && meta.default === undefined && !meta.auto,
      primaryKey: colName === pk,
    };
  });

  const suggestedMapping = {};
  for (const h of fileHeaders) {
    suggestedMapping[h] = suggestColumnMatch(h, allowedCols);
  }

  return {
    model: model.name,
    totalRows,
    headers: fileHeaders,
    fileHeaders,
    sampleRows,
    modelColumns,
    suggestedMapping,
  };
}

/**
 * Express handler for spreadsheet upload preview
 * @param {Object} opts
 * @param {Object} opts.db
 * @param {number} [opts.maxFileBytes]
 * @returns {Function}
 */
function createPreviewHandler(opts) {
  const { db, maxFileBytes = 10 * 1024 * 1024 } = opts;
  const upload = createMulter(maxFileBytes).single('file');

  return async function previewHandler(req, res) {
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
          return res.status(404).json({ error: `Model "${modelName}" not found or disabled.` });
        }

        let buffer;
        let originalName = '';

        if (req.file && req.file.buffer) {
          buffer = req.file.buffer;
          originalName = (req.file.originalname || '').toLowerCase();
        } else if (req.body && req.body.csvText) {
          buffer = Buffer.from(req.body.csvText, 'utf8');
          originalName = 'upload.csv';
        } else if (req.body && req.body.base64) {
          const match = req.body.base64.match(/^data:([^;]+);base64,(.+)$/);
          buffer = Buffer.from(match ? match[2] : req.body.base64, 'base64');
          originalName = req.body.filename ? req.body.filename.toLowerCase() : 'upload.xlsx';
        }

        if (!buffer || buffer.length === 0) {
          return res.status(400).json({ error: 'No file uploaded or file is empty.' });
        }

        const isCsv = originalName.endsWith('.csv') || (req.file && (req.file.mimetype || '').includes('csv'));
        let rows = [];

        if (isCsv) {
          rows = parseCsvToRows(buffer);
        } else {
          try {
            rows = await parseXlsxToRows(buffer);
          } catch (xlsxErr) {
            // Attempt CSV parse fallback
            try {
              rows = parseCsvToRows(buffer);
            } catch {
              return res.status(400).json({ error: `Failed to parse spreadsheet: ${xlsxErr.message}` });
            }
          }
        }

        if (rows.length === 0) {
          return res.status(400).json({ error: 'Uploaded file is empty.' });
        }

        const previewData = analyzeSpreadsheetPreview(model, rows, 10);
        return res.json(previewData);
      } catch (err) {
        console.error('[data-exchange] preview error:', err);
        return res.status(500).json({ error: err.message || 'Failed to preview file.' });
      }
    });
  };
}

module.exports = {
  normalizeHeaderName,
  suggestColumnMatch,
  analyzeSpreadsheetPreview,
  createPreviewHandler,
};
