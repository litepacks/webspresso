'use strict';

/**
 * Webspresso - Zero-Dependency Approximate Byte Sizer
 * Fast, non-blocking memory footprint calculator for LRU cache entries.
 * Handles strings, numbers, buffers, dates, arrays, and objects with recursion depth limits.
 * @module core/cache/byte-size
 */

const MAX_RECURSION_DEPTH = 6;

/**
 * Approximates memory byte size of any JavaScript value.
 *
 * @param {*} value - Value to calculate size for
 * @param {number} [depth=0] - Current recursion depth
 * @param {Set} [seen=null] - Circular reference protection set
 * @returns {number} Approximate size in bytes
 */
function approximateByteSize(value, depth = 0, seen = null) {
  if (value === null || value === undefined) {
    return 8;
  }

  const type = typeof value;

  if (type === 'boolean') {
    return 4;
  }

  if (type === 'number') {
    return 8;
  }

  if (type === 'string') {
    // UTF-8 byte length (fast Buffer approximation)
    return Buffer.byteLength(value, 'utf8') + 8;
  }

  if (type === 'bigint') {
    return 16;
  }

  if (type === 'symbol') {
    return 16;
  }

  if (type === 'function') {
    return 32;
  }

  // Buffers and TypedArrays
  if (Buffer.isBuffer(value)) {
    return value.length + 32;
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength + 32;
  }

  if (value instanceof ArrayBuffer) {
    return value.byteLength + 32;
  }

  // Guard against deep nesting
  if (depth > MAX_RECURSION_DEPTH) {
    return 64;
  }

  if (type === 'object') {
    if (!seen) {
      seen = new Set();
    }
    if (seen.has(value)) {
      return 0; // Prevent infinite recursion on circular references
    }
    seen.add(value);

    let bytes = 32; // V8 object header baseline

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        bytes += approximateByteSize(value[i], depth + 1, seen);
      }
      return bytes;
    }

    if (value instanceof Date) {
      return 16;
    }

    if (value instanceof RegExp) {
      return value.source.length * 2 + 32;
    }

    if (value instanceof Map) {
      for (const [k, v] of value.entries()) {
        bytes += approximateByteSize(k, depth + 1, seen) + approximateByteSize(v, depth + 1, seen);
      }
      return bytes;
    }

    if (value instanceof Set) {
      for (const item of value.values()) {
        bytes += approximateByteSize(item, depth + 1, seen);
      }
      return bytes;
    }

    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      bytes += Buffer.byteLength(k, 'utf8') + 8 + approximateByteSize(value[k], depth + 1, seen);
    }
    return bytes;
  }

  return 16;
}

module.exports = {
  approximateByteSize,
};
