/**
 * Server-side HTML sanitization for admin panel Quill/rich-text fields.
 * Intended for XSS mitigation before persistence — not a substitute for safe templating on public pages.
 */

'use strict';

const sanitizeHtml = require('sanitize-html');

const RICH_TEXT_SANITIZE_OPTIONS = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'strike',
    'del',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'ul',
    'ol',
    'li',
    'a',
    'span',
    'pre',
    'code',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['class'],
    p: ['class'],
    ol: ['class'],
    ul: ['class'],
    li: ['class'],
    blockquote: ['class'],
    pre: ['class'],
    code: ['class'],
    h1: ['class'],
    h2: ['class'],
    h3: ['class'],
    h4: ['class'],
    h5: ['class'],
    h6: ['class'],
  },
  allowedClasses: {
    span: [/^ql-/],
    p: [/^ql-/],
    ol: [/^ql-/],
    ul: [/^ql-/],
    li: [/^ql-/],
    blockquote: [/^ql-/],
    pre: [/^ql-/],
    code: [/^language-/, /^lang-/, /^ql-/],
    h1: [/^ql-/],
    h2: [/^ql-/],
    h3: [/^ql-/],
    h4: [/^ql-/],
    h5: [/^ql-/],
    h6: [/^ql-/],
  },
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto', 'tel'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: true,
  transformTags: {
    a(tagName, attribs) {
      const href = (attribs.href || '').trim();
      if (/^javascript:/i.test(href) || /^vbscript:/i.test(href) || /^data:/i.test(href)) {
        delete attribs.href;
      }
      if (attribs.target === '_blank') {
        attribs.rel = 'noopener noreferrer';
      }
      return { tagName, attribs };
    },
  },
};

/**
 * @param {unknown} input
 * @returns {unknown}
 */
function sanitizeRichHtml(input) {
  if (input === null || input === undefined) {
    return input;
  }
  if (typeof input !== 'string') {
    return input;
  }
  return sanitizeHtml(input, RICH_TEXT_SANITIZE_OPTIONS);
}

module.exports = {
  sanitizeRichHtml,
  RICH_TEXT_SANITIZE_OPTIONS,
};
