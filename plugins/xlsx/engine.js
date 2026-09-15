'use strict';

/**
 * Webspresso XLSX Core Engine
 * High-performance Excel spreadsheet generator, parser, and ORM exporter
 * @module plugins/xlsx/engine
 */

const ExcelJS = require('exceljs');
const { PassThrough } = require('stream');

/**
 * Common formula injection trigger characters
 * @type {RegExp}
 */
const FORMULA_INJECTION_REGEX = /^([=+\-@\t\r])/;

/**
 * Neutralizes Excel formula injection by escaping dangerous prefixes
 * @param {*} value
 * @returns {*}
 */
function sanitizeFormula(value) {
  if (typeof value === 'string' && FORMULA_INJECTION_REGEX.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Converts a 6-character hex color (e.g. '4F46E5' or '#4F46E5') to ARGB
 * @param {string} hex
 * @returns {string}
 */
function hexToArgb(hex) {
  if (!hex || typeof hex !== 'string') return 'FF4F46E5';
  let clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length === 6) {
    return `FF${clean.toUpperCase()}`;
  }
  if (clean.length === 8) {
    return clean.toUpperCase();
  }
  return 'FF4F46E5';
}

/**
 * Automatically calculates optimal column widths based on headers and sample rows
 * @param {ExcelJS.Worksheet} worksheet
 * @param {Array<Object>} columns
 * @param {Array<Object>} rows
 */
function applyAutoWidths(worksheet, columns, rows) {
  if (!columns || !Array.isArray(columns)) return;

  columns.forEach((col, index) => {
    const colIndex = index + 1;
    let maxLength = col.header ? String(col.header).length : 10;

    // Sample up to first 100 rows for performance
    const sampleLimit = Math.min(rows.length, 100);
    for (let i = 0; i < sampleLimit; i++) {
      const val = rows[i] ? rows[i][col.key] : '';
      if (val !== null && val !== undefined) {
        const strVal = val instanceof Date ? 'YYYY-MM-DD HH:mm:ss' : String(val);
        if (strVal.length > maxLength) {
          maxLength = strVal.length;
        }
      }
    }

    const column = worksheet.getColumn(colIndex);
    column.width = Math.min(Math.max(maxLength + 4, 12), 60);
  });
}

/**
 * Applies styled headers to a worksheet
 * @param {ExcelJS.Worksheet} worksheet
 * @param {Object} [style]
 */
function applyHeaderStyle(worksheet, style = {}) {
  const headerRow = worksheet.getRow(1);
  const bgColor = hexToArgb(style.bg || style.fill || '4F46E5');
  const textColor = hexToArgb(style.color || style.textColor || 'FFFFFF');

  headerRow.height = style.height || 26;
  headerRow.eachCell((cell) => {
    cell.font = {
      name: style.fontName || 'Segoe UI',
      size: style.fontSize || 11,
      bold: style.bold !== false,
      color: { argb: textColor },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgColor },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: style.align || 'left',
      wrapText: false,
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'medium', color: { argb: 'FF3730A3' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
  });
}

/**
 * Generates an Excel XLSX workbook buffer from declarative options
 * @param {Object} options
 * @param {string} [options.creator='Webspresso']
 * @param {string} [options.title]
 * @param {Date} [options.created]
 * @param {boolean} [options.sanitizeFormulas=true]
 * @param {Array<Object>|Object} options.sheets - Sheet configuration(s)
 * @returns {Promise<Buffer>}
 */
async function generate(options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.creator || 'Webspresso';
  workbook.created = options.created || new Date();
  if (options.title) workbook.title = options.title;

  const sanitize = options.sanitizeFormulas !== false;

  // Normalize sheets: can be single object or array
  const rawSheets = options.sheets
    ? Array.isArray(options.sheets) ? options.sheets : [options.sheets]
    : [{ name: options.name || 'Sheet1', columns: options.columns, rows: options.rows || options.data || [] }];

  for (let idx = 0; idx < rawSheets.length; idx++) {
    const sheetConfig = rawSheets[idx];
    const sheetName = sheetConfig.name || `Sheet${idx + 1}`;
    const worksheet = workbook.addWorksheet(sheetName, {
      views: sheetConfig.views || [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });

    const rows = Array.isArray(sheetConfig.rows)
      ? sheetConfig.rows
      : Array.isArray(sheetConfig.data)
        ? sheetConfig.data
        : [];

    // Derive columns if not explicitly provided
    let columns = sheetConfig.columns;
    if (!columns && rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
      columns = Object.keys(rows[0]).map((key) => ({
        header: key,
        key,
      }));
    }

    if (columns && Array.isArray(columns)) {
      worksheet.columns = columns.map((col) => ({
        header: col.header || col.name || col.key,
        key: col.key,
        width: col.width || 15,
        style: col.style || {},
      }));

      // Apply auto-widths if requested (default: true)
      if (sheetConfig.autoWidth !== false) {
        applyAutoWidths(worksheet, columns, rows);
      }

      // Add rows
      for (const row of rows) {
        const rowData = {};
        for (const col of columns) {
          let val = row ? row[col.key] : '';
          if (sanitize) {
            val = sanitizeFormula(val);
          }
          rowData[col.key] = val !== undefined ? val : null;
        }
        worksheet.addRow(rowData);
      }

      // Format headers
      applyHeaderStyle(worksheet, sheetConfig.headerStyle || options.headerStyle);

      // Apply zebra striping or row borders if enabled
      if (sheetConfig.striped !== false) {
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          row.alignment = { vertical: 'middle' };
          if (rowNumber % 2 === 0) {
            row.eachCell((cell) => {
              if (!cell.fill || cell.fill.type !== 'pattern') {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFF9FAFB' },
                };
              }
            });
          }
        });
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Parses an XLSX buffer or stream into JSON objects
 * @param {Buffer|import('stream').Readable} input
 * @param {Object} [options]
 * @param {string|number} [options.sheet] - Sheet name or 1-based index
 * @param {number} [options.headerRow=1] - Row index of headers
 * @param {number} [options.dataStartRow=2] - Row index where data begins
 * @param {boolean} [options.raw=false] - Return raw cell values without formatting
 * @param {Function} [options.transformRow] - Custom row transformer
 * @returns {Promise<Array<Object>|Object.<string, Array<Object>>>}
 */
async function parse(input, options = {}) {
  const workbook = new ExcelJS.Workbook();

  if (Buffer.isBuffer(input)) {
    await workbook.xlsx.load(input);
  } else if (input && typeof input.pipe === 'function') {
    await workbook.xlsx.read(input);
  } else {
    throw new Error('parseXlsx requires a valid Buffer or Readable Stream');
  }

  const headerRowIdx = options.headerRow || 1;
  const dataStartRowIdx = options.dataStartRow || headerRowIdx + 1;
  const transformRow = typeof options.transformRow === 'function' ? options.transformRow : null;

  function parseWorksheet(ws) {
    const headers = [];
    const headerRow = ws.getRow(headerRowIdx);

    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      let val = cell.value;
      if (typeof val === 'object' && val !== null) {
        val = val.text || val.result || String(val);
      }
      const headerName = String(val || `col_${colNumber}`).trim();
      headers[colNumber] = headerName;
    });

    const rows = [];
    const rowCount = ws.rowCount;

    for (let r = dataStartRowIdx; r <= rowCount; r++) {
      const row = ws.getRow(r);
      if (!row || !row.hasValues) continue;

      const rowObj = {};
      let hasData = false;

      headers.forEach((header, colNum) => {
        if (!header) return;
        const cell = row.getCell(colNum);
        let cellVal = cell.value;

        if (cellVal && typeof cellVal === 'object') {
          if (cellVal instanceof Date) {
            // Keep Date instance or format
          } else if (cellVal.text !== undefined) {
            cellVal = cellVal.text;
          } else if (cellVal.result !== undefined) {
            cellVal = cellVal.result;
          }
        }

        if (cellVal !== null && cellVal !== undefined && cellVal !== '') {
          hasData = true;
        }

        rowObj[header] = cellVal !== undefined ? cellVal : null;
      });

      if (hasData) {
        rows.push(transformRow ? transformRow(rowObj, rows.length) : rowObj);
      }
    }

    return rows;
  }

  // If specific sheet requested
  if (options.sheet !== undefined) {
    let ws;
    if (typeof options.sheet === 'number') {
      ws = workbook.getWorksheet(options.sheet);
    } else {
      ws = workbook.getWorksheet(String(options.sheet));
    }

    if (!ws) {
      throw new Error(`Worksheet "${options.sheet}" not found in XLSX workbook`);
    }

    return parseWorksheet(ws);
  }

  // If only 1 sheet exists, return array directly for convenience
  if (workbook.worksheets.length === 1) {
    return parseWorksheet(workbook.worksheets[0]);
  }

  // Multiple sheets: return dictionary keyed by sheet name
  const result = {};
  for (const ws of workbook.worksheets) {
    result[ws.name] = parseWorksheet(ws);
  }
  return result;
}

/**
 * Automatically exports records from an ORM Repository into an Excel workbook buffer
 * @param {Object} repository - Model repository from db.getRepository('Model')
 * @param {Object} [filterOrQuery={}] - Query filters
 * @param {Object} [options={}] - Export options
 * @returns {Promise<Buffer>}
 */
async function fromModel(repository, filterOrQuery = {}, options = {}) {
  if (!repository || (typeof repository.find !== 'function' && typeof repository.query !== 'function')) {
    throw new Error('fromModel requires a valid Webspresso Model Repository');
  }

  let records;
  if (typeof filterOrQuery === 'function') {
    if (typeof repository.query !== 'function') {
      throw new Error('fromModel query callback requires a repository with query() method');
    }
    records = await filterOrQuery(repository.query());
  } else {
    records = typeof repository.find === 'function' ? await repository.find(filterOrQuery) : [];
  }

  const modelName = repository.model?.name || 'Records';
  const sheetName = options.sheetName || options.name || modelName;

  let columns = options.columns;
  if (!columns && repository.model?.schema?.shape) {
    const hidden = new Set(repository.model.hidden || []);
    columns = Object.keys(repository.model.schema.shape)
      .filter((col) => !hidden.has(col))
      .map((col) => ({
        header: col.charAt(0).toUpperCase() + col.slice(1).replace(/_/g, ' '),
        key: col,
      }));
  }

  return generate({
    creator: options.creator || 'Webspresso ORM',
    title: options.title || `${modelName} Export`,
    sheets: [
      {
        name: sheetName,
        columns,
        rows: records,
        headerStyle: options.headerStyle,
      },
    ],
  });
}

/**
 * Creates a high-performance streaming workbook writer for massive datasets
 * @param {import('stream').Writable} outputStream
 * @param {Object} [options]
 * @returns {ExcelJS.stream.xlsx.WorkbookWriter}
 */
function createStreamWriter(outputStream, options = {}) {
  return new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: outputStream,
    useStyles: options.useStyles !== false,
    useSharedStrings: options.useSharedStrings || false,
  });
}

module.exports = {
  generate,
  parse,
  fromModel,
  createStreamWriter,
  sanitizeFormula,
  applyHeaderStyle,
  applyAutoWidths,
  hexToArgb,
};
