'use strict';

/**
 * Webspresso - Zero-Dependency RegExp Utilities
 * Fast, secure regular expression escaping and glob-to-regex conversion helpers.
 * @module core/utils/regex
 */

/**
 * Escapes all regular expression special characters in a string.
 * Safe against ReDoS and regex injection when inserting dynamic substrings into RegExp.
 *
 * @param {string|unknown} str - String to escape
 * @returns {string} Escaped string safe for new RegExp()
 */
function escapeRegExp(str) {
  if (str == null) return '';
  return String(str).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Converts a glob pattern string (e.g. 'users/*', 'api/**', 'order.*') into a RegExp.
 *
 * @param {string} pattern - Glob pattern string
 * @param {Object} [options]
 * @param {'/'|'.'|null} [options.separator='/'] - Segment separator ('/' for URLs/paths, '.' for events/dots, null for flat)
 * @param {boolean} [options.exact=true] - Whether to match entire string (^...$)
 * @param {string} [options.flags=''] - RegExp flags (e.g. 'i')
 * @returns {RegExp}
 */
function globToRegExp(pattern, options = {}) {
  const {
    separator = '/',
    exact = true,
    flags = '',
  } = options;

  if (typeof pattern !== 'string') {
    return exact ? /^$/ : /(?:)/;
  }

  if (pattern === '*' || pattern === '**') {
    return new RegExp(exact ? '^.*$' : '.*', flags);
  }

  // 1. Fully escape all regex characters first
  let escaped = escapeRegExp(pattern);

  // 2. Replace escaped wildcard sequences
  if (separator === '/') {
    // URL or path globbing
    escaped = escaped
      .replace(/\\\*\\\*/g, '.*')
      .replace(/\\\*/g, '[^/]*')
      .replace(/\\\?/g, '.');
  } else if (separator === '.') {
    // Dot-notation event globbing (e.g. order.* or order.**)
    escaped = escaped
      .replace(/\\\*\\\*/g, '.*')
      .replace(/\\\*/g, '[^.]+')
      .replace(/\\\?/g, '.');
  } else {
    // Flat wildcard matching
    escaped = escaped
      .replace(/\\\*+/g, '.*')
      .replace(/\\\?/g, '.');
  }

  const regexStr = exact ? `^${escaped}$` : escaped;
  return new RegExp(regexStr, flags);
}

module.exports = {
  escapeRegExp,
  escapeRegex: escapeRegExp,
  globToRegExp,
};
