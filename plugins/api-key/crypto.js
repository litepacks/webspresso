/**
 * API Key Plugin — Cryptographic Utilities
 * Zero external dependencies (uses native Node.js crypto)
 * @module plugins/api-key/crypto
 */

'use strict';

const crypto = require('crypto');

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Uses dummy buffer comparison if lengths differ to avoid leaking length via response timing.
 * 
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Perform dummy timing-safe comparison with itself to preserve constant execution time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Hash a raw API key using SHA-256
 * 
 * @param {string} rawKey
 * @returns {string} Hex-encoded SHA-256 hash (64 characters)
 */
function hashKey(rawKey) {
  if (typeof rawKey !== 'string' || rawKey.length === 0) {
    return '';
  }
  return crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/**
 * Mask an API key for safe UI display and logs.
 * Shows prefix + '...' + last 4 characters.
 * 
 * @param {string} rawKey
 * @param {string} [prefix='wsp_live_']
 * @returns {string}
 */
function maskKey(rawKey, prefix = 'wsp_live_') {
  if (!rawKey || typeof rawKey !== 'string') {
    return '****';
  }

  if (rawKey.length <= 8) {
    return '****';
  }

  const last4 = rawKey.slice(-4);
  const effectivePrefix = rawKey.startsWith(prefix) ? prefix : rawKey.slice(0, Math.min(prefix.length, 9));
  return `${effectivePrefix}...${last4}`;
}

/**
 * Generate a cryptographically secure API key
 * 
 * @param {Object} [options]
 * @param {string} [options.prefix='wsp_live_'] - Prefix for the key
 * @param {number} [options.byteLength=24] - Number of random bytes (produces 32 base64url chars)
 * @returns {{ key: string, hash: string, hint: string, prefix: string }}
 */
function generateKey(options = {}) {
  const prefix = typeof options.prefix === 'string' ? options.prefix : 'wsp_live_';
  const byteLength = typeof options.byteLength === 'number' && options.byteLength > 0 ? options.byteLength : 24;

  const randomPart = crypto.randomBytes(byteLength).toString('base64url');
  const key = `${prefix}${randomPart}`;
  const hash = hashKey(key);
  const hint = maskKey(key, prefix);

  return {
    key,
    hash,
    hint,
    prefix,
  };
}

module.exports = {
  safeCompare,
  hashKey,
  maskKey,
  generateKey,
};
