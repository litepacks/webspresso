/**
 * ORM column → OpenAPI schema fragments (shared by schema-explorer and swagger plugin)
 */

const { getAllModels } = require('../orm/model');

/**
 * Generate OpenAPI 3 components.schemas from registered ORM models
 * @param {{ exclude?: string[] }} options
 * @returns {Record<string, object>}
 */
function generateOrmOpenApiSchemas(options = {}) {
  const { exclude = [] } = options;
  const models = getAllModels();
  const schemas = {};

  for (const [name, model] of models) {
    if (exclude.includes(name)) continue;

    const properties = {};
    const required = [];

    if (model.columns) {
      for (const [colName, meta] of model.columns) {
        properties[colName] = columnToOpenApiType(meta);

        if (!meta.nullable && !meta.autoIncrement && meta.default === undefined) {
          required.push(colName);
        }
      }
    }

    schemas[name] = {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };

    const inputProperties = {};
    const inputRequired = [];

    if (model.columns) {
      for (const [colName, meta] of model.columns) {
        if (meta.autoIncrement || meta.auto) continue;

        inputProperties[colName] = columnToOpenApiType(meta);

        if (!meta.nullable && meta.default === undefined) {
          inputRequired.push(colName);
        }
      }
    }

    schemas[`${name}Input`] = {
      type: 'object',
      properties: inputProperties,
      required: inputRequired.length > 0 ? inputRequired : undefined,
    };
  }

  return schemas;
}

/**
 * @param {Object} meta - Column metadata
 * @returns {Object}
 */
function columnToOpenApiType(meta) {
  const result = {};

  switch (meta.type) {
    case 'bigint':
    case 'integer':
      result.type = 'integer';
      if (meta.type === 'bigint') result.format = 'int64';
      break;

    case 'float':
    case 'decimal':
      result.type = 'number';
      if (meta.type === 'decimal') result.format = 'double';
      break;

    case 'boolean':
      result.type = 'boolean';
      break;

    case 'date':
      result.type = 'string';
      result.format = 'date';
      break;

    case 'datetime':
    case 'timestamp':
      result.type = 'string';
      result.format = 'date-time';
      break;

    case 'uuid':
      result.type = 'string';
      result.format = 'uuid';
      break;

    case 'nanoid':
      result.type = 'string';
      if (meta.maxLength) {
        result.maxLength = meta.maxLength;
      }
      break;

    case 'json':
      result.type = 'object';
      break;

    case 'enum':
      result.type = 'string';
      if (meta.enumValues) {
        result.enum = meta.enumValues;
      }
      break;

    case 'text':
    case 'string':
    default:
      result.type = 'string';
      if (meta.maxLength) {
        result.maxLength = meta.maxLength;
      }
      break;
  }

  if (meta.nullable) {
    result.nullable = true;
  }

  if (meta.default !== undefined) {
    result.default = meta.default;
  }

  return result;
}

module.exports = {
  generateOrmOpenApiSchemas,
  columnToOpenApiType,
};
