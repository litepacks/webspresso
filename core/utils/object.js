'use strict';

/**
 * Webspresso - Zero-Dependency Object & Array Utilities
 * Safe property picking, omission, array wrapping, and deep cloning.
 * @module core/utils/object
 */

/**
 * Ensure a value is wrapped in an array.
 * Returns empty array for null or undefined.
 * Returns array as-is if already an array.
 * Wraps any other value in a single-element array.
 *
 * @template T
 * @param {T|T[]|null|undefined} value - Value to ensure as array
 * @returns {T[]}
 * @example
 * ensureArray(null) // -> []
 * ensureArray(undefined) // -> []
 * ensureArray('foo') // -> ['foo']
 * ensureArray(['bar']) // -> ['bar']
 */
function ensureArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Pick specific keys from an object.
 *
 * @param {Record<string, any>|null|undefined} obj - Source object
 * @param {string[]|string} keys - Keys to pick
 * @returns {Record<string, any>} Object with picked keys
 */
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') {
    return {};
  }
  const result = {};
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object.
 *
 * @param {Record<string, any>|null|undefined} obj - Source object
 * @param {string[]|string} keys - Keys to omit
 * @returns {Record<string, any>} Object without omitted keys
 */
function omit(obj, keys) {
  if (!obj || typeof obj !== 'object') {
    return {};
  }
  const result = {};
  const omitSet = new Set(Array.isArray(keys) ? keys : [keys]);
  for (const key in obj) {
    if (!omitSet.has(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Deep clone an object, array, or Date instance safely.
 * Strips prototype pollution attempts (__proto__, constructor, prototype).
 *
 * @template T
 * @param {T} obj - Target object to clone
 * @returns {T} Cloned copy
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  if (Array.isArray(obj)) {
    return obj.map(deepClone);
  }
  const cloned = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    cloned[key] = deepClone(obj[key]);
  }
  return { ...cloned };
}

module.exports = {
  ensureArray,
  pick,
  omit,
  deepClone,
};
