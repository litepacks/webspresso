/**
 * Webspresso Zero-Dependency HTML Utilities
 *
 * High-performance, XSS-safe HTML entity escaping and unescaping.
 *
 * @module core/utils/html
 */

'use strict';

const HTML_ESCAPE_TEST_RE = /[&<>"']/;
const HTML_ESCAPE_RE = /[&<>"']/g;

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const HTML_UNESCAPE_RE = /&(?:amp|lt|gt|quot|#39|#039|#x27);/g;

const HTML_UNESCAPES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#039;': "'",
  '&#x27;': "'",
};

/**
 * Escapes characters with special meaning in HTML to prevent XSS injection attacks.
 * Fast-paths strings without special characters to avoid unnecessary allocations.
 *
 * @param {unknown} value - Value to escape (converted to string; null/undefined becomes '')
 * @returns {string} HTML-escaped string
 */
function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const str = typeof value === 'string' ? value : String(value);
  if (!HTML_ESCAPE_TEST_RE.test(str)) {
    return str;
  }

  return str.replace(HTML_ESCAPE_RE, (char) => HTML_ESCAPES[char]);
}

/**
 * Unescapes common HTML entities back to their literal character representations.
 *
 * @param {unknown} value - HTML string to unescape
 * @returns {string} Unescaped string
 */
function unescapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const str = typeof value === 'string' ? value : String(value);
  return str.replace(HTML_UNESCAPE_RE, (match) => HTML_UNESCAPES[match] || match);
}

module.exports = {
  escapeHtml,
  unescapeHtml,
};
