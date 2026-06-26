/**
 * Content type schema validation
 * @module core/content/schema
 */

const { z } = require('zod');
const { isValidFieldType } = require('./field-types');

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const fieldDefinitionSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/i, 'Field name must be alphanumeric'),
  type: z.string().refine(isValidFieldType, 'Invalid field type'),
  label: z.string().max(255).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  fields: z.lazy(() => z.array(fieldDefinitionSchema)).optional(),
});

const contentTypeSchemaSchema = z.object({
  fields: z.array(fieldDefinitionSchema).min(0),
});

/**
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_REGEX.test(slug);
}

/**
 * @param {unknown} schema
 * @returns {import('./types').ContentTypeSchema}
 */
function parseContentTypeSchema(schema) {
  const parsed = contentTypeSchemaSchema.parse(schema);
  const names = new Set();
  for (const field of parsed.fields) {
    if (names.has(field.name)) {
      throw new Error(`Duplicate field name "${field.name}"`);
    }
    names.add(field.name);
    if (field.type === 'select' && (!field.options || field.options.length === 0)) {
      throw new Error(`Select field "${field.name}" requires options`);
    }
    if (field.type === 'repeater') {
      if (!field.fields || field.fields.length === 0) {
        throw new Error(`Repeater field "${field.name}" requires nested fields`);
      }
      parseContentTypeSchema({ fields: field.fields });
    }
  }
  return parsed;
}

/**
 * @param {import('./types').ContentTypeSchema} schema
 * @param {Record<string, unknown>} data
 * @param {{ sanitizeRichHtml?: (v: string) => string }} [options]
 * @returns {Record<string, unknown>}
 */
function validateEntryData(schema, data, options = {}) {
  const { normalizeEntryData } = require('./field-types');
  return normalizeEntryData(data, schema.fields, options);
}

module.exports = {
  SLUG_REGEX,
  isValidSlug,
  parseContentTypeSchema,
  validateEntryData,
  fieldDefinitionSchema,
  contentTypeSchemaSchema,
};
