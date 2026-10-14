/**
 * Webspresso Forms & Flash Subsystem (AdonisJS & Django-inspired)
 * @module core/forms
 */

const { createFlashMiddleware, normalizeErrors } = require('./flash');
const { renderField, renderFormFor, humanize, escapeHtml } = require('./form-builder');

module.exports = {
  createFlashMiddleware,
  normalizeErrors,
  renderField,
  renderFormFor,
  humanize,
  escapeHtml,
};
