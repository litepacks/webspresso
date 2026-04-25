/**
 * Header row → column index mapping for spreadsheet import.
 * @module plugins/data-exchange/parse-table
 */

function normalizeHeaderCell(h) {
  if (h == null || h === '') return '';
  return String(h).replace(/^\uFEFF/, '').trim();
}

/**
 * Map header labels to model column names (case-insensitive; spaces → underscores).
 * @param {string[]} headerRow
 * @param {Iterable<string>} allowedKeys
 * @returns {(string|null)[]} index → model column or null if unknown
 */
function buildHeaderMapping(headerRow, allowedKeys) {
  const lowerToKey = new Map();
  for (const k of allowedKeys) {
    lowerToKey.set(String(k).toLowerCase().replace(/\s+/g, '_'), k);
  }
  const mapping = [];
  for (let i = 0; i < headerRow.length; i++) {
    const norm = normalizeHeaderCell(headerRow[i]).toLowerCase().replace(/\s+/g, '_');
    if (!norm) {
      mapping.push(null);
      continue;
    }
    mapping.push(lowerToKey.get(norm) ?? null);
  }
  return mapping;
}

/**
 * @param {Array<Array<*>>} rows including header as rows[0]
 * @param {(string|null)[]} headerMapping
 * @returns {{ rowNumber: number, data: Record<string, *> }[]} rowNumber = 1-based sheet row
 */
function dataRowsToObjects(rows, headerMapping) {
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const data = {};
    for (let i = 0; i < headerMapping.length; i++) {
      const key = headerMapping[i];
      if (!key) continue;
      if (!(i in row)) continue;
      const cell = row[i];
      if (cell === undefined || cell === null) continue;
      if (typeof cell === 'string' && cell.trim() === '') continue;
      data[key] = cell;
    }
    if (Object.keys(data).length > 0) {
      out.push({ rowNumber: r + 1, data });
    }
  }
  return out;
}

module.exports = {
  normalizeHeaderCell,
  buildHeaderMapping,
  dataRowsToObjects,
};
