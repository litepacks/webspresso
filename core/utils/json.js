'use strict';

/**
 * Webspresso - Zero-Dependency JSON Utilities
 * Safe, fault-tolerant JSON parse and stringify helpers that never throw unhandled exceptions.
 * @module core/utils/json
 */

/**
 * Safely parses a JSON string without throwing exceptions.
 * Returns the provided fallback value if parsing fails or input is missing.
 * If input is already an object or array (and not a string), returns input directly.
 *
 * @template T
 * @param {string|unknown} input - Value or JSON string to parse
 * @param {T} [fallback=null] - Value to return if parsing fails
 * @param {Function} [reviver] - Optional JSON.parse reviver function
 * @returns {any|T}
 */
function safeJsonParse(input, fallback = null, reviver) {
  if (input === null || input === undefined || input === '') {
    return fallback;
  }
  if (typeof input !== 'string') {
    return input;
  }

  try {
    return JSON.parse(input, reviver);
  } catch (_) {
    return fallback;
  }
}

/**
 * Safely serializes a value to a JSON string without throwing exceptions.
 * Handles circular references and BigInt values gracefully.
 *
 * @param {unknown} value - Value to serialize
 * @param {string|number|null} [space=null] - Indentation spaces
 * @param {string} [fallback=''] - Fallback value if serialization fails
 * @returns {string}
 */
function safeJsonStringify(value, space = null, fallback = '') {
  if (value === undefined) {
    return fallback;
  }
  try {
    return JSON.stringify(value, null, space ?? undefined);
  } catch (_) {
    // Attempt circular-safe serialization
    try {
      const seen = new WeakSet();
      return JSON.stringify(
        value,
        (key, val) => {
          if (typeof val === 'bigint') {
            return val.toString();
          }
          if (typeof val === 'object' && val !== null) {
            if (seen.has(val)) {
              return '[Circular]';
            }
            seen.add(val);
          }
          return val;
        },
        space ?? undefined
      );
    } catch {
      return fallback;
    }
  }
}

/**
 * Checks whether a given string is valid JSON without throwing.
 *
 * @param {string|unknown} str - String to test
 * @returns {boolean}
 */
function isValidJson(str) {
  if (typeof str !== 'string' || !str.trim()) {
    return false;
  }
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  safeJsonParse,
  safeJsonStringify,
  isValidJson,
};
