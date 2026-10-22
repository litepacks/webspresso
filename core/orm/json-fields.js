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
  if (model && model._jsonColumns) {
    if (!model._jsonColumns._array) {
      Object.defineProperty(model._jsonColumns, '_array', {
        value: Array.from(model._jsonColumns),
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
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
  Object.defineProperty(jsonCols, '_array', {
    value: Array.from(jsonCols),
    writable: true,
    configurable: true,
    enumerable: false,
  });
  if (model) {
    model._jsonColumns = jsonCols;
  }
  return jsonCols;
}

/**
 * Serialize JSON fields for database storage
 * @param {Object} data - Data to serialize
 * @param {Set<string>|Array<string>} jsonColumns - JSON column names
 * @returns {Object} Serialized data
 */
function serializeJsonFields(data, jsonColumns) {
  if (!data || !jsonColumns) return data;
  const size = jsonColumns.size !== undefined ? jsonColumns.size : jsonColumns.length;
  if (size === 0) return data;

  const cols = jsonColumns._array || (Array.isArray(jsonColumns) ? jsonColumns : Array.from(jsonColumns));
  const serialized = { ...data };
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    if (col in serialized) {
      const val = serialized[col];
      if (val !== null && val !== undefined && typeof val !== 'string') {
        serialized[col] = JSON.stringify(val);
      }
    }
  }
  return serialized;
}

/**
 * Deserialize JSON fields from database
 * @param {Object} record - Record from database
 * @param {Set<string>|Array<string>} jsonColumns - JSON column names
 * @returns {Object} Deserialized record
 */
function deserializeJsonFields(record, jsonColumns) {
  if (!record || !jsonColumns) return record;
  const size = jsonColumns.size !== undefined ? jsonColumns.size : jsonColumns.length;
  if (size === 0) return record;

  const cols = jsonColumns._array || (Array.isArray(jsonColumns) ? jsonColumns : Array.from(jsonColumns));
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    if (col in record) {
      const val = record[col];
      // If already parsed (object, array, number, boolean) or null/undefined, skip parsing
      if (typeof val === 'string') {
        if (val.length === 0) continue;
        try {
          record[col] = JSON.parse(val);
        } catch (_) {
          // Keep raw string if parsing fails
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

