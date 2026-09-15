'use strict';

/**
 * Webspresso CSV Core Engine
 * High-performance, RFC 4180 compliant CSV generator, parser, and ORM exporter
 * @module plugins/csv/engine
 */

const { parse: parseSync } = require('csv-parse/sync');
const { parse: parseStream } = require('csv-parse');
const { Readable } = require('stream');

/**
 * UTF-8 Byte Order Mark (BOM)
 * Ensures Microsoft Excel and other spreadsheet editors correctly open UTF-8 files (Turkish/Unicode characters)
 */
const UTF8_BOM = '\uFEFF';

/**
 * Standard CSV MIME type with charset
 */
const CSV_MIME_TYPE = 'text/csv; charset=utf-8';

/**
 * Common formula injection trigger characters
 * @type {RegExp}
 */
const FORMULA_INJECTION_REGEX = /^([=+\-@\t\r])/;

/**
 * Neutralizes Excel/Calc formula injection by escaping dangerous prefixes
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
 * Escapes a single cell value for CSV (RFC 4180 compliant)
 * @param {*} value
 * @param {Object} [options]
 * @param {string} [options.delimiter=',']
 * @param {string} [options.quote='"']
 * @param {boolean} [options.alwaysQuote=false]
 * @param {boolean} [options.sanitizeFormulas=true]
 * @returns {string}
 */
function escapeCsvField(value, options = {}) {
  const {
    delimiter = ',',
    quote = '"',
    alwaysQuote = false,
    sanitizeFormulas: shouldSanitize = true,
  } = options;

  if (value === null || value === undefined) {
    return '';
  }

  let str = value;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === 'object') {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  } else {
    str = String(value);
  }

  if (shouldSanitize) {
    str = sanitizeFormula(str);
  }

  const needsQuotes =
    alwaysQuote ||
    str.includes(delimiter) ||
    str.includes(quote) ||
    str.includes('\n') ||
    str.includes('\r') ||
    str.startsWith(' ') ||
    str.endsWith(' ');

  if (needsQuotes) {
    const escaped = str.split(quote).join(quote + quote);
    return `${quote}${escaped}${quote}`;
  }

  return str;
}

/**
 * Generates an RFC 4180 compliant CSV string or Buffer from structured data
 * @param {Object} options
 * @param {Array<Object>} [options.rows] - Array of row objects
 * @param {Array<Object>} [options.data] - Alias for rows
 * @param {Array<Object|string>} [options.columns] - Explicit column definitions
 * @param {string} [options.delimiter=','] - Column delimiter (',', ';', '\t', '|')
 * @param {string} [options.eol='\r\n'] - End of line sequence
 * @param {boolean} [options.header=true] - Include header row
 * @param {boolean} [options.bom=true] - Include UTF-8 BOM for Excel UTF-8 compatibility
 * @param {boolean} [options.sanitizeFormulas=true] - Escape dangerous formula prefixes
 * @param {boolean} [options.asBuffer=true] - Return Buffer (true) or String (false)
 * @returns {Buffer|string}
 */
function generate(options = {}) {
  const {
    delimiter = ',',
    eol = '\r\n',
    header = true,
    bom = true,
    sanitizeFormulas: shouldSanitize = true,
    asBuffer = true,
  } = options;

  const rows = Array.isArray(options.rows)
    ? options.rows
    : Array.isArray(options.data)
      ? options.data
      : [];

  // Derive or normalize columns
  let columns = options.columns;
  if (!columns && rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
    columns = Object.keys(rows[0]).map((key) => ({
      header: key,
      key,
    }));
  } else if (Array.isArray(columns)) {
    columns = columns.map((col) => {
      if (typeof col === 'string') {
        return { header: col, key: col };
      }
      return {
        header: col.header || col.name || col.key,
        key: col.key || col.name || col.header,
      };
    });
  } else {
    columns = [];
  }

  const lines = [];

  // Header line
  if (header && columns.length > 0) {
    const headerLine = columns
      .map((col) =>
        escapeCsvField(col.header, {
          delimiter,
          sanitizeFormulas: false,
        })
      )
      .join(delimiter);
    lines.push(headerLine);
  }

  // Row lines
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rowFields = columns.map((col) => {
      const val = row[col.key];
      return escapeCsvField(val, {
        delimiter,
        sanitizeFormulas: shouldSanitize,
      });
    });
    lines.push(rowFields.join(delimiter));
  }

  let csvContent = lines.join(eol);
  if (lines.length > 0) {
    csvContent += eol;
  }

  const fullContent = bom ? UTF8_BOM + csvContent : csvContent;

  if (asBuffer) {
    return Buffer.from(fullContent, 'utf8');
  }

  return fullContent;
}

/**
 * Parses a CSV buffer, string, or stream into an array of JSON objects
 * @param {Buffer|string|Readable} input
 * @param {Object} [options]
 * @param {string} [options.delimiter] - Explicit delimiter, or auto-detected if omitted
 * @param {boolean|Array<string>} [options.columns=true] - Header row inference
 * @param {boolean} [options.skip_empty_lines=true]
 * @param {boolean} [options.trim=true]
 * @param {boolean} [options.relax_column_count=true]
 * @param {Function} [options.transformRow] - Optional custom transformer: (row, idx) => row
 * @returns {Promise<Array<Object>>}
 */
async function parse(input, options = {}) {
  const {
    delimiter,
    columns = true,
    skip_empty_lines = true,
    trim = true,
    relax_column_count = true,
    transformRow,
    ...restOptions
  } = options;

  let text;
  if (Buffer.isBuffer(input)) {
    text = input.toString('utf8');
  } else if (typeof input === 'string') {
    text = input;
  } else if (input && typeof input.pipe === 'function') {
    // Stream input
    return new Promise((resolve, reject) => {
      const results = [];
      let index = 0;

      const parser = parseStream({
        delimiter,
        columns,
        skip_empty_lines,
        trim,
        relax_column_count,
        bom: true,
        ...restOptions,
      });

      parser.on('readable', () => {
        let record;
        while ((record = parser.read()) !== null) {
          const transformed = typeof transformRow === 'function' ? transformRow(record, index++) : record;
          if (transformed !== null && transformed !== undefined) {
            results.push(transformed);
          }
        }
      });

      parser.on('error', reject);
      parser.on('end', () => resolve(results));

      input.pipe(parser);
    });
  } else {
    throw new Error('parseCsv requires a valid Buffer, String, or Readable Stream');
  }

  // Strip BOM if present in string
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Auto-detect delimiter if not specified
  let detectedDelimiter = delimiter;
  if (!detectedDelimiter) {
    const firstLine = text.split(/\r\n|\r|\n/)[0] || '';
    const semicolons = (firstLine.match(/;/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;
    const tabs = (firstLine.match(/\t/g) || []).length;
    const pipes = (firstLine.match(/\|/g) || []).length;

    if (semicolons > commas && semicolons > tabs && semicolons > pipes) {
      detectedDelimiter = ';';
    } else if (tabs > commas && tabs > semicolons && tabs > pipes) {
      detectedDelimiter = '\t';
    } else if (pipes > commas && pipes > semicolons && pipes > tabs) {
      detectedDelimiter = '|';
    } else {
      detectedDelimiter = ',';
    }
  }

  const records = parseSync(text, {
    delimiter: detectedDelimiter,
    columns,
    skip_empty_lines,
    trim,
    relax_column_count,
    bom: true,
    ...restOptions,
  });

  if (typeof transformRow === 'function') {
    return records.map((record, idx) => transformRow(record, idx)).filter((r) => r !== null && r !== undefined);
  }

  return records;
}

/**
 * Automatically exports records from an ORM Repository into a CSV buffer
 * @param {Object} repository - Model repository from db.getRepository('Model')
 * @param {Object|Function} [filterOrQuery={}] - Query filters or query callback
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

  let columns = options.columns;
  if (!columns && repository.model?.schema?.shape) {
    const hidden = new Set(repository.model.hidden || []);
    columns = Object.keys(repository.model.schema.shape)
      .filter((col) => !hidden.has(col))
      .map((col) => ({
        header: col,
        key: col,
      }));
  }

  return generate({
    ...options,
    columns,
    rows: records,
  });
}

/**
 * Creates a high-performance streaming CSV writer for massive datasets
 * @param {import('stream').Writable} outputStream
 * @param {Object} [options]
 * @param {string} [options.delimiter=',']
 * @param {string} [options.eol='\r\n']
 * @param {boolean} [options.bom=true]
 * @param {boolean} [options.sanitizeFormulas=true]
 * @returns {{ writeHeader: Function, writeRow: Function, writeRows: Function, end: Function }}
 */
function createStreamWriter(outputStream, options = {}) {
  const {
    delimiter = ',',
    eol = '\r\n',
    bom = true,
    sanitizeFormulas: shouldSanitize = true,
  } = options;

  let columns = options.columns || null;
  let headerWritten = false;

  if (bom) {
    outputStream.write(UTF8_BOM, 'utf8');
  }

  function normalizeColumns(cols) {
    if (!cols) return [];
    return cols.map((c) => {
      if (typeof c === 'string') return { header: c, key: c };
      return {
        header: c.header || c.name || c.key,
        key: c.key || c.name || c.header,
      };
    });
  }

  if (columns) {
    columns = normalizeColumns(columns);
  }

  function writeHeader(customColumns) {
    if (customColumns) {
      columns = normalizeColumns(customColumns);
    }
    if (!columns || columns.length === 0) return;
    const headerLine =
      columns
        .map((col) =>
          escapeCsvField(col.header, {
            delimiter,
            sanitizeFormulas: false,
          })
        )
        .join(delimiter) + eol;
    outputStream.write(headerLine, 'utf8');
    headerWritten = true;
  }

  function writeRow(row) {
    if (!row || typeof row !== 'object') return;

    if (!headerWritten && !columns) {
      columns = Object.keys(row).map((k) => ({ header: k, key: k }));
      writeHeader();
    } else if (!headerWritten && columns) {
      writeHeader();
    }

    const rowLine =
      columns
        .map((col) => {
          const val = row[col.key];
          return escapeCsvField(val, {
            delimiter,
            sanitizeFormulas: shouldSanitize,
          });
        })
        .join(delimiter) + eol;

    outputStream.write(rowLine, 'utf8');
  }

  function writeRows(rows) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      writeRow(row);
    }
  }

  function end() {
    outputStream.end();
  }

  return {
    writeHeader,
    writeRow,
    writeRows,
    end,
    stream: outputStream,
  };
}

module.exports = {
  generate,
  parse,
  fromModel,
  createStreamWriter,
  sanitizeFormula,
  escapeCsvField,
  UTF8_BOM,
  CSV_MIME_TYPE,
};
