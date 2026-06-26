/**
 * Schema-driven content system — core module (framework-agnostic).
 * @module core/content
 */

const { createContentService } = require('./service');
const { createContentCache } = require('./cache');
const { parseContentTypeSchema, validateEntryData, isValidSlug } = require('./schema');
const { wrapEditable, wrapEntryBlock, escapeHtml } = require('./renderer');
const {
  FIELD_TYPES,
  isValidFieldType,
  normalizeEntryData,
  toAdminCustomField,
} = require('./field-types');

module.exports = {
  createContentService,
  createContentCache,
  parseContentTypeSchema,
  validateEntryData,
  isValidSlug,
  wrapEditable,
  wrapEntryBlock,
  escapeHtml,
  FIELD_TYPES,
  isValidFieldType,
  normalizeEntryData,
  toAdminCustomField,
};
