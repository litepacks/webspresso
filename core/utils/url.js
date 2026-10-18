'use strict';

/**
 * Webspresso - Zero-Dependency URL & Path Normalization Utilities
 * High-performance, linear-time URL and path formatting helpers.
 * @module core/utils/url
 */

const { trimUrlPathSlashes } = require('../url-path-normalize');

/**
 * Safely removes trailing slash(es) from a URL or path.
 *
 * @param {string|unknown} input - URL, pathname, or path fragment
 * @param {Object} [options]
 * @param {boolean} [options.preserveRoot=false] - If true and input resolves to '/', keeps single '/'
 * @returns {string} Truncated string without trailing slash(es)
 */
function stripTrailingSlash(input, options = {}) {
  if (input == null) return '';
  let s = String(input);
  if (s.length === 0) return '';

  const preserveRoot = options.preserveRoot === true;

  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* / */) {
    end--;
  }

  if (end === 0) {
    return preserveRoot ? '/' : '';
  }

  return s.slice(0, end);
}

/**
 * Ensures a path starts with a leading slash ('/').
 *
 * @param {string|unknown} input - Path fragment
 * @returns {string} Path with leading slash
 */
function ensureLeadingSlash(input) {
  if (input == null) return '/';
  const s = String(input).trim();
  if (s.length === 0) return '/';
  return s.charCodeAt(0) === 47 /* / */ ? s : `/${s}`;
}

/**
 * Ensures a URL or path ends with a trailing slash ('/').
 *
 * @param {string|unknown} input - Path or URL
 * @returns {string} String with trailing slash
 */
function ensureTrailingSlash(input) {
  if (input == null) return '/';
  const s = String(input);
  if (s.length === 0) return '/';
  return s.charCodeAt(s.length - 1) === 47 /* / */ ? s : `${s}/`;
}

/**
 * Safely removes leading slash(es) from a path fragment.
 *
 * @param {string|unknown} input - Path fragment
 * @returns {string} Path without leading slash(es)
 */
function stripLeadingSlash(input) {
  if (input == null) return '';
  let s = String(input);
  let start = 0;
  while (start < s.length && s.charCodeAt(start) === 47 /* / */) {
    start++;
  }
  return s.slice(start);
}

/**
 * Joins a base URL with one or more path fragments without double slashes.
 *
 * @param {string} base - Base URL or path prefix
 * @param {...string} paths - Path fragments to append
 * @returns {string} Combined normalized URL or path
 */
function joinUrl(base, ...paths) {
  let result = stripTrailingSlash(base || '');
  for (const part of paths) {
    if (part == null) continue;
    const clean = stripLeadingSlash(stripTrailingSlash(part));
    if (clean.length > 0) {
      result = result ? `${result}/${clean}` : clean;
    }
  }
  return result || '/';
}

module.exports = {
  stripTrailingSlash,
  ensureLeadingSlash,
  ensureTrailingSlash,
  stripLeadingSlash,
  joinUrl,
  trimUrlPathSlashes,
};
