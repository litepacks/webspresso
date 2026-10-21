'use strict';

/**
 * Webspresso - Zero-Dependency String Utilities
 * Fast, standard case conversion and string manipulation helpers.
 * @module core/utils/string
 */

/**
 * Convert a string (kebab-case, snake_case, spaces) to camelCase.
 *
 * @param {string|unknown} str - Input string
 * @returns {string} camelCase formatted string
 * @example
 * toCamelCase('order-items') // -> 'orderItems'
 * toCamelCase('get_by_id') // -> 'getById'
 * toCamelCase('user_profile_data') // -> 'userProfileData'
 */
function toCamelCase(str) {
  if (!str || typeof str !== 'string') return '';
  const s = str.trim();
  if (!s) return '';

  let start = 0;
  let end = s.length;
  while (start < end && (s[start] === '-' || s[start] === '_')) {
    start++;
  }
  while (end > start && (s[end - 1] === '-' || s[end - 1] === '_')) {
    end--;
  }
  if (start >= end) return '';

  let result = '';
  let capitalizeNext = false;
  for (let i = start; i < end; i++) {
    const ch = s[i];
    if (ch === '-' || ch === '_' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      capitalizeNext = true;
    } else {
      if (capitalizeNext) {
        result += result.length === 0 ? ch.toLowerCase() : ch.toUpperCase();
        capitalizeNext = false;
      } else {
        result += result.length === 0 ? ch.toLowerCase() : ch;
      }
    }
  }
  return result;
}

/**
 * Convert a string (camelCase, kebab-case, spaces) to snake_case.
 *
 * @param {string|unknown} str - Input string
 * @returns {string} snake_case formatted string
 * @example
 * toSnakeCase('fooBarBaz') // -> 'foo_bar_baz'
 * toSnakeCase('order-items') // -> 'order_items'
 */
function toSnakeCase(str) {
  if (!str || typeof str !== 'string') return '';
  const s = str.trim();
  if (!s) return '';

  const expanded = s.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  let result = '';
  let prevWasUnderscore = false;

  for (let i = 0; i < expanded.length; i++) {
    const ch = expanded[i];
    if (ch === '-' || ch === '_' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (!prevWasUnderscore && result.length > 0) {
        result += '_';
        prevWasUnderscore = true;
      }
    } else {
      result += ch.toLowerCase();
      prevWasUnderscore = false;
    }
  }

  while (result.endsWith('_')) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Convert a string (camelCase, snake_case, spaces) to kebab-case.
 *
 * @param {string|unknown} str - Input string
 * @returns {string} kebab-case formatted string
 * @example
 * toKebabCase('orderItems') // -> 'order-items'
 * toKebabCase('foo_bar_baz') // -> 'foo-bar-baz'
 */
function toKebabCase(str) {
  if (!str || typeof str !== 'string') return '';
  const s = str.trim();
  if (!s) return '';

  const expanded = s.replace(/([a-z0-9])([A-Z])/g, '$1-$2');
  let result = '';
  let prevWasDash = false;

  for (let i = 0; i < expanded.length; i++) {
    const ch = expanded[i];
    if (ch === '-' || ch === '_' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (!prevWasDash && result.length > 0) {
        result += '-';
        prevWasDash = true;
      }
    } else {
      result += ch.toLowerCase();
      prevWasDash = false;
    }
  }

  while (result.endsWith('-')) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Convert a string to PascalCase.
 *
 * @param {string|unknown} str - Input string
 * @returns {string} PascalCase formatted string
 * @example
 * toPascalCase('order-items') // -> 'OrderItems'
 * toPascalCase('user_id') // -> 'UserId'
 */
function toPascalCase(str) {
  const camel = toCamelCase(str);
  if (!camel) return '';
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

module.exports = {
  toCamelCase,
  snakeToCamel: toCamelCase,
  toSnakeCase,
  camelToSnake: toSnakeCase,
  toKebabCase,
  toPascalCase,
};
