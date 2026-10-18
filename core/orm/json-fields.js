/**
 * Webspresso ORM - JSON column helpers (shared by repository and query builder)
 * @module core/orm/json-fields
 */

const { safeJsonParse } = require('../utils/json');

/**
 * Get JSON column names from model
 * @param {import('./types').ModelDefinition} model - Model definition
 * @returns {Set<string>} Set of JSON column names
 */
function getJsonColumns(model) {
  if (model && model._jsonColumns) {
    return model._jsonColumns;
  }
  const jsonCols = new Set();
  if (model && model.columns) {
    for (const [name, meta] of model.columns) {
      if (meta && (meta.type === 'json' || meta.type === 'array' || meta.type === 'files')) {
        jsonCols.add(name);
      }
    }
  }
  if (model && model.schema && model.schema.shape) {
    for (const [name, fieldSchema] of Object.entries(model.schema.shape)) {
      let current = fieldSchema;
      while (current && current._def) {
        if (current._def.innerType) {
          current = current._def.innerType;
        } else if (current._def.schema) {
          current = current._def.schema;
        } else {
          break;
        }
      }
      const typeName = current?._def?.typeName;
      if (typeName === 'ZodRecord' || typeName === 'ZodObject' || typeName === 'ZodArray') {
        jsonCols.add(name);
      }
    }
  }
  if (model) {
    model._jsonColumns = jsonCols;
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
      record[col] = safeJsonParse(record[col], record[col]);
    }
  }
  return record;
}

module.exports = {
  getJsonColumns,
  serializeJsonFields,
  deserializeJsonFields,
};
