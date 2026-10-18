/**
 * Webspresso ORM - Utilities
 * Internal helper functions
 * @module core/orm/utils
 */

const { toCamelCase, toSnakeCase } = require('../utils/string');
const { pick, omit, ensureArray, deepClone } = require('../utils/object');

const snakeToCamel = toCamelCase;
const camelToSnake = toSnakeCase;

/**
 * Format date for database
 * @param {Date} date - Date to format
 * @returns {string}
 */
function formatDateForDb(date) {
  return date.toISOString();
}

/**
 * Generate timestamp for migration filename
 * @returns {string} Format: YYYYMMDD_HHmmss
 */
function generateMigrationTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * Remove hidden columns from a record for safe API/template output
 * @param {Object} record - Record from database
 * @param {import('./types').ModelDefinition} model - Model definition with hidden columns
 * @returns {Object} Record without hidden columns
 */
function omitHiddenColumns(record, model) {
  if (!record) return record;
  if (!model?.hidden?.length) return record;
  return omit(record, model.hidden);
}

/**
 * Remove hidden columns from records (array or single) for safe output
 * @param {Object|Object[]} records - Record(s) from database
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Object|Object[]} Sanitized record(s)
 */
function sanitizeForOutput(records, model) {
  if (!model?.hidden?.length) return records;
  if (Array.isArray(records)) {
    return records.map((r) => omit(r, model.hidden));
  }
  return omit(records, model.hidden);
}

module.exports = {
  pick,
  omit,
  omitHiddenColumns,
  sanitizeForOutput,
  formatDateForDb,
  generateMigrationTimestamp,
  snakeToCamel,
  camelToSnake,
  ensureArray,
  deepClone,
};

