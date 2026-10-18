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

/**
 * Compute SHA-256 hash of a string, Buffer, or value.
 *
 * Zero-dependency wrapper around native `crypto.createHash('sha256')`.
 * Safely coerces non-Buffer/non-string values to strings (or empty string for null/undefined).
 *
 * @param {string|Buffer|any} data - Data to hash
 * @param {import('crypto').BinaryToTextEncoding|'buffer'} [encoding='hex'] - Output encoding ('hex', 'base64', 'base64url', or 'buffer')
 * @returns {string|Buffer} Digest in specified encoding, or Buffer if encoding is 'buffer'
 */
function sha256(data, encoding = 'hex') {
  if (data === null || data === undefined) {
    data = '';
  }
  const input = Buffer.isBuffer(data) || typeof data === 'string' ? data : String(data);
  const hash = crypto.createHash('sha256').update(input);
  return encoding === 'buffer' ? hash.digest() : hash.digest(encoding || 'hex');
}

/**
 * Compute HMAC-SHA256 signature of data using a secret key.
 *
 * Zero-dependency wrapper around native `crypto.createHmac('sha256', secret)`.
 *
 * @param {string|Buffer|any} data - Data to sign
 * @param {string|Buffer} secret - Secret key
 * @param {import('crypto').BinaryToTextEncoding|'buffer'} [encoding='hex'] - Output encoding ('hex', 'base64', 'base64url', or 'buffer')
 * @returns {string|Buffer} Signature in specified encoding, or Buffer if encoding is 'buffer'
 */
function hmacSha256(data, secret, encoding = 'hex') {
  if (secret === null || secret === undefined) {
    throw new TypeError('A secret key is required for HMAC computation');
  }
  if (data === null || data === undefined) {
    data = '';
  }
  const input = Buffer.isBuffer(data) || typeof data === 'string' ? data : String(data);
  const hmac = crypto.createHmac('sha256', secret).update(input);
  return encoding === 'buffer' ? hmac.digest() : hmac.digest(encoding || 'hex');
}

/**
 * Generate a cryptographically secure random token string or buffer.
 *
 * @param {number} [byteLength=32] - Number of random bytes
 * @param {import('crypto').BinaryToTextEncoding|'buffer'} [encoding='hex'] - Output encoding ('hex', 'base64', 'base64url', or 'buffer')
 * @returns {string|Buffer}
 */
function randomToken(byteLength = 32, encoding = 'hex') {
  const bytes = crypto.randomBytes(byteLength);
  return encoding === 'buffer' ? bytes : bytes.toString(encoding || 'hex');
}

/**
 * Generate a cryptographically secure random string with an optional prefix.
 * E.g. randomId('whsec', 24) -> 'whsec_a1b2c3...'
 *
 * @param {string} [prefix=''] - Identifier prefix
 * @param {number} [byteLength=16] - Random byte length
 * @param {import('crypto').BinaryToTextEncoding} [encoding='hex'] - Output encoding
 * @returns {string}
 */
function randomId(prefix = '', byteLength = 16, encoding = 'hex') {
  const token = randomToken(byteLength, encoding);
  if (!prefix) return token;
  const p = prefix.endsWith('_') ? prefix : `${prefix}_`;
  return `${p}${token}`;
}

/**
 * Generate a timestamped unique ID with optional prefix.
 * E.g. randomTimestampedId('dlv', 8) -> 'dlv_1729221234567_abcdef1234567890'
 *
 * @param {string} [prefix=''] - Identifier prefix
 * @param {number} [byteLength=8] - Random byte length
 * @param {import('crypto').BinaryToTextEncoding} [encoding='hex'] - Output encoding
 * @returns {string}
 */
function randomTimestampedId(prefix = '', byteLength = 8, encoding = 'hex') {
  const token = randomToken(byteLength, encoding);
  const p = prefix ? (prefix.endsWith('_') ? prefix : `${prefix}_`) : '';
  return `${p}${Date.now()}_${token}`;
}

/**
 * Encode string or Buffer to Base64URL string (RFC 4648 §5).
 *
 * @param {string|Buffer|any} input
 * @returns {string}
 */
function base64UrlEncode(input) {
  if (input === null || input === undefined) return '';
  return Buffer.isBuffer(input)
    ? input.toString('base64url')
    : Buffer.from(String(input), 'utf8').toString('base64url');
}

/**
 * Decode Base64URL string to UTF-8 string.
 *
 * @param {string} input
 * @returns {string}
 */
function base64UrlDecode(input) {
  if (!input) return '';
  return Buffer.from(String(input), 'base64url').toString('utf8');
}

module.exports = {
  safeCompare,
  timingSafeEqual: safeCompare,
  sha256,
  hashSha256: sha256,
  hmacSha256,
  createHmacSha256: hmacSha256,
  randomToken,
  randomId,
  randomTimestampedId,
  base64UrlEncode,
  base64UrlDecode,
};

