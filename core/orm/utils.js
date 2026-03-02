/**
 * Webspresso ORM - Utilities
 * Internal helper functions
 * @module core/orm/utils
 */

/**
 * Pick specific keys from an object
 * @param {Object} obj - Source object
 * @param {string[]} keys - Keys to pick
 * @returns {Object}
 */
function pick(obj, keys) {
  const result = {};
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object
 * @param {Object} obj - Source object
 * @param {string[]} keys - Keys to omit
 * @returns {Object}
 */
function omit(obj, keys) {
  const result = {};
  const omitSet = new Set(keys);
  for (const key in obj) {
    if (!omitSet.has(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

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
 * Convert snake_case to camelCase
 * @param {string} str - Snake case string
 * @returns {string}
 */
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase to snake_case
 * @param {string} str - Camel case string
 * @returns {string}
 */
function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Ensure a value is an array
 * @param {*} value - Value to wrap
 * @returns {Array}
 */
function ensureArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Deep clone an object (simple version, no circular refs)
 * @param {Object} obj - Object to clone
 * @returns {Object}
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return new Date(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(deepClone);
  }
  const cloned = {};
  for (const key in obj) {
    cloned[key] = deepClone(obj[key]);
  }
  return cloned;
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

