/**
 * Webspresso Zero-Dependency Crypto & Security Utilities
 *
 * Lightweight, timing-attack resistant cryptographic helpers.
 *
 * @module core/utils/crypto
 */

'use strict';

const crypto = require('crypto');

/**
 * Constant-time equality comparison to prevent timing attacks.
 *
 * Compares two strings or Buffers in constant time using `crypto.timingSafeEqual`.
 * Handles length mismatches by executing a dummy comparison against identical buffer
 * to protect against timing leakage while safely returning `false`.
 *
 * @param {string|Buffer} a - First value to compare
 * @param {string|Buffer} b - Second value to compare
 * @returns {boolean} True if values are identical, false otherwise
 */
function safeCompare(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) {
    return false;
  }

  const isABuf = Buffer.isBuffer(a);
  const isBBuf = Buffer.isBuffer(b);

  if (isABuf && isBBuf) {
    if (a.length !== b.length) {
      if (a.length > 0) {
        try {
          crypto.timingSafeEqual(a, a);
        } catch (_) {}
      }
      return false;
    }
    try {
      return crypto.timingSafeEqual(a, b);
    } catch (_) {
      return false;
    }
  }

  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    try {
      // Dummy comparison to prevent timing leaks on length mismatches
      crypto.timingSafeEqual(bufA, bufA);
    } catch (_) {}
    return false;
  }

  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (_) {
    return false;
  }
}

module.exports = {
  safeCompare,
  timingSafeEqual: safeCompare,
};
