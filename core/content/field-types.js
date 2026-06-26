/**
 * Content field type registry — validate and normalize values per field type.
 * @module core/content/field-types
 */

const { z } = require('zod');

/** @type {Set<string>} */
const FIELD_TYPES = new Set([
  'text',
  'textarea',
  'rich-text',
  'number',
  'boolean',
  'image',
  'url',
  'date',
  'select',
  'repeater',
]);

/**
 * @param {string} type
 * @returns {boolean}
 */
function isValidFieldType(type) {
  return FIELD_TYPES.has(type);
}

/**
 * @param {unknown} value
 * @param {import('./types').ContentFieldDefinition} field
 * @param {{ sanitizeRichHtml?: (v: string) => string }} [options]
 * @returns {unknown}
 */
function normalizeFieldValue(value, field, options = {}) {
  if (value === undefined || value === null) {
    if (field.required) {
      throw new Error(`Field "${field.name}" is required`);
    }
    return field.type === 'repeater' ? [] : null;
  }

  switch (field.type) {
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') {
        throw new Error(`Field "${field.name}" must be a string`);
      }
      return value;

    case 'rich-text': {
      if (typeof value !== 'string') {
        throw new Error(`Field "${field.name}" must be a string`);
      }
      return options.sanitizeRichHtml ? options.sanitizeRichHtml(value) : value;
    }

    case 'number': {
      const num = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(num)) {
        throw new Error(`Field "${field.name}" must be a number`);
      }
      return num;
    }

    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === '1' || value === 1) return true;
      if (value === 'false' || value === '0' || value === 0) return false;
      throw new Error(`Field "${field.name}" must be a boolean`);

    case 'image':
    case 'url': {
      if (typeof value !== 'string') {
        throw new Error(`Field "${field.name}" must be a URL string`);
      }
      const trimmed = value.trim();
      if (field.required && !trimmed) {
        throw new Error(`Field "${field.name}" is required`);
      }
      if (trimmed && field.type === 'url') {
        try {
          // eslint-disable-next-line no-new
          new URL(trimmed);
        } catch {
          throw new Error(`Field "${field.name}" must be a valid URL`);
        }
      }
      return trimmed || null;
    }

    case 'date': {
      if (typeof value !== 'string') {
        throw new Error(`Field "${field.name}" must be a date string`);
      }
      const parsed = z.string().date().safeParse(value);
      if (!parsed.success) {
        throw new Error(`Field "${field.name}" must be a valid date (YYYY-MM-DD)`);
      }
      return value;
    }

    case 'select': {
      if (typeof value !== 'string') {
        throw new Error(`Field "${field.name}" must be a string`);
      }
      const optionsList = field.options || [];
      if (optionsList.length > 0 && !optionsList.includes(value)) {
        throw new Error(`Field "${field.name}" must be one of: ${optionsList.join(', ')}`);
      }
      return value;
    }

    case 'repeater': {
      if (!Array.isArray(value)) {
        throw new Error(`Field "${field.name}" must be an array`);
      }
      const nestedFields = field.fields || [];
      return value.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error(`Field "${field.name}" item ${index} must be an object`);
        }
        return normalizeEntryData(item, nestedFields, options);
      });
    }

    default:
      throw new Error(`Unknown field type "${field.type}"`);
  }
}

/**
 * @param {Record<string, unknown>} data
 * @param {import('./types').ContentFieldDefinition[]} fields
 * @param {{ sanitizeRichHtml?: (v: string) => string }} [options]
 * @returns {Record<string, unknown>}
 */
function normalizeEntryData(data, fields, options = {}) {
  const input = data && typeof data === 'object' ? data : {};
  /** @type {Record<string, unknown>} */
  const result = {};

  for (const field of fields) {
    const raw = Object.prototype.hasOwnProperty.call(input, field.name)
      ? input[field.name]
      : undefined;
    result[field.name] = normalizeFieldValue(raw, field, options);
  }

  return result;
}

/**
 * Map content field types to admin panel customField types.
 * @param {import('./types').ContentFieldDefinition} field
 * @returns {Object|null}
 */
function toAdminCustomField(field) {
  switch (field.type) {
    case 'rich-text':
      return { type: 'rich-text' };
    case 'image':
      return { type: 'file-upload' };
    case 'textarea':
      return { type: 'text' };
    case 'select':
      return { type: 'enum', options: field.options || [] };
    default:
      return null;
  }
}

module.exports = {
  FIELD_TYPES,
  isValidFieldType,
  normalizeFieldValue,
  normalizeEntryData,
  toAdminCustomField,
};
