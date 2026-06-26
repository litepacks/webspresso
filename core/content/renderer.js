/**
 * Content renderer — wraps values with inline-edit data attributes for admins.
 * @module core/content/renderer
 */

/**
 * Escape HTML for text nodes (not for rich-text which uses | safe separately).
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {unknown} value
 * @param {Object} meta
 * @param {number|string} meta.entryId
 * @param {string} meta.typeSlug
 * @param {string} [meta.field]
 * @param {string} [meta.label]
 * @param {boolean} [meta.isAdmin]
 * @param {boolean} [meta.safeHtml]
 * @returns {string}
 */
function wrapEditable(value, meta) {
  const display = meta.safeHtml ? String(value ?? '') : escapeHtml(value);

  if (!meta.isAdmin) {
    return display;
  }

  const attrs = [
    'class="ws-content-editable"',
    `data-ws-content-entry="${meta.entryId}"`,
    `data-ws-content-type="${meta.typeSlug}"`,
  ];

  if (meta.field) {
    attrs.push(`data-ws-content-field="${meta.field}"`);
  }
  if (meta.label) {
    attrs.push(`data-ws-content-label="${escapeHtml(meta.label)}"`);
  }
  if (meta.safeHtml) {
    attrs.push('data-ws-content-html="true"');
  }

  return `<span ${attrs.join(' ')}>${display}</span>`;
}

/**
 * Wrap an entire content entry block for entry-level edit button.
 * @param {string} innerHtml
 * @param {Object} meta
 * @param {number|string} meta.entryId
 * @param {string} meta.typeSlug
 * @param {string} [meta.label]
 * @param {boolean} meta.isAdmin
 * @returns {string}
 */
function wrapEntryBlock(innerHtml, meta) {
  if (!meta.isAdmin) {
    return innerHtml;
  }

  const label = meta.label ? escapeHtml(meta.label) : meta.typeSlug;
  return (
    `<div class="ws-content-block" data-ws-content-entry="${meta.entryId}" ` +
    `data-ws-content-type="${meta.typeSlug}" data-ws-content-label="${label}">` +
    `${innerHtml}</div>`
  );
}

module.exports = {
  escapeHtml,
  wrapEditable,
  wrapEntryBlock,
};
