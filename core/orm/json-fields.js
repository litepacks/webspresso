/**
 * Webspresso ORM - JSON column helpers (shared by repository and query builder)
 * @module core/orm/json-fields
 */

/**
 * Get JSON column names from model
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Set<string>} Set of JSON column names
 */
function getJsonColumns(model) {
  const jsonCols = new Set();
  if (model.columns) {
    for (const [name, meta] of model.columns) {
      if (meta.type === 'json') {
        jsonCols.add(name);
      }
    }
  }
  return jsonCols;
}

/**
 * Serialize JSON fields for database storage
 * @param {Object} data - Data to serialize
 * @param {Set<string>} jsonColumns - JSON column names
 * @returns {Object} Serialized data
 */
function serializeJsonFields(data, jsonColumns) {
  if (jsonColumns.size === 0) return data;

  const serialized = { ...data };
  for (const col of jsonColumns) {
    if (col in serialized && serialized[col] !== null && serialized[col] !== undefined) {
      if (typeof serialized[col] !== 'string') {
        serialized[col] = JSON.stringify(serialized[col]);
      }
    }
  }
  return serialized;
}

/**
 * Deserialize JSON fields from database
 * @param {Object} record - Record from database
 * @param {Set<string>} jsonColumns - JSON column names
 * @returns {Object} Deserialized record
 */
function deserializeJsonFields(record, jsonColumns) {
  if (!record || jsonColumns.size === 0) return record;

  for (const col of jsonColumns) {
    if (col in record && record[col] !== null && record[col] !== undefined) {
      if (typeof record[col] === 'string') {
        try {
          record[col] = JSON.parse(record[col]);
        } catch {
          // If parsing fails, keep the original string value
        }
      }
    }
  }
  return record;
}

module.exports = {
  getJsonColumns,
  serializeJsonFields,
  deserializeJsonFields,
};
