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
  const trimmed = str.replace(/^[-_\s]+|[-_\s]+$/g, '');
  if (!trimmed) return '';
  const res = trimmed.replace(/[-_\s]+([a-zA-Z0-9])/g, (_, letter) => letter.toUpperCase());
  return res.charAt(0).toLowerCase() + res.slice(1);
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
  return str
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-_\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
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
  return str
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[-_\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
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
