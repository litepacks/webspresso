/**
 * Webspresso Auth - Zero-dependency JWT implementation
 * Uses Node.js native crypto module for HS256 HMAC-SHA256 signatures
 * @module core/auth/jwt
 */

const crypto = require('crypto');
const { safeCompare, hmacSha256, base64UrlEncode, base64UrlDecode } = require('../utils/crypto');
const { parseDurationSec } = require('../utils/time');

const HS256_HEADER_BASE64URL = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

/**
 * Parse duration string (e.g. '1h', '7d', '15m', '3600') into seconds
 * @param {string|number} duration
 * @returns {number} Seconds
 */
const parseDuration = parseDurationSec;

/**
 * Sign payload to create HS256 JWT string
 * @param {Object} payload - Payload object
 * @param {string} secret - Secret key for signing
 * @param {Object} [options] - Signing options
 * @param {string|number} [options.expiresIn='24h'] - Expiration time (seconds or '1h', '7d', etc.)
 * @param {string} [options.algorithm='HS256'] - Signature algorithm (HS256 supported)
 * @param {string} [options.issuer] - Token issuer (iss)
 * @param {string} [options.subject] - Token subject (sub)
 * @param {string} [options.audience] - Token audience (aud)
 * @returns {string} JWT string
 */
function signJwt(payload, secret, options = {}) {
  if (!secret) {
    throw new Error('Secret is required to sign JWT');
  }

  const algorithm = options.algorithm || 'HS256';
  if (algorithm !== 'HS256') {
    throw new Error(`Unsupported algorithm '${algorithm}'. Only HS256 is supported.`);
  }

  const header = {
    alg: algorithm,
    typ: 'JWT',
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const claims = {
    iat: nowSec,
  };

  if (options.expiresIn !== false) {
    const ttlSec = parseDuration(options.expiresIn ?? '24h');
    claims.exp = nowSec + ttlSec;
  }

  if (options.issuer) claims.iss = options.issuer;
  if (options.subject) claims.sub = options.subject;
  if (options.audience) claims.aud = options.audience;

  const fullPayload = {
    ...claims,
    ...payload,
  };

  const encodedHeader = algorithm === 'HS256' ? HS256_HEADER_BASE64URL : base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const encodedSignature = hmacSha256(signingInput, secret, 'base64url');

  return `${signingInput}.${encodedSignature}`;
}

const VERIFIED_JWT_CACHE_LIMIT = 1024;
const MAX_PAYLOAD_SIZE = 1048576; // 1 MB
const verifiedJwtCache = new Map();

/**
 * Clear verified JWT cache
 */
function clearJwtCache() {
  verifiedJwtCache.clear();
}

/**
 * Verify and decode HS256 JWT string
 * @param {string} token - JWT string
 * @param {string} secret - Secret key
 * @param {Object} [options] - Verification options
 * @param {boolean} [options.ignoreExpiration=false] - Ignore token expiration
 * @param {string} [options.issuer] - Expected issuer
 * @param {string} [options.audience] - Expected audience
 * @param {boolean} [options.cache=true] - Cache verified payload in bounded LRU cache
 * @param {number} [options.maxPayloadSize=1048576] - Maximum allowed payload length in bytes
 * @returns {Object} Decoded payload
 * @throws {Error} If token is invalid or expired
 */
function verifyJwt(token, secret, options = {}) {
  if (!secret) {
    throw new Error('Secret is required to verify JWT');
  }

  if (!token || typeof token !== 'string') {
    throw new Error('JWT token must be a non-empty string');
  }

  // Fast-path: Check bounded verification LRU cache
  const cacheKey = options.cache !== false && typeof secret === 'string'
    ? `${token}##${secret}`
    : null;

  if (cacheKey) {
    const cached = verifiedJwtCache.get(cacheKey);
    if (cached) {
      // Refresh LRU order
      verifiedJwtCache.delete(cacheKey);
      verifiedJwtCache.set(cacheKey, cached);

      const nowSec = Math.floor(Date.now() / 1000);
      if (!options.ignoreExpiration && typeof cached.exp === 'number') {
        if (nowSec >= cached.exp) {
          verifiedJwtCache.delete(cacheKey);
          throw new Error('JWT token has expired');
        }
      }

      if (options.issuer && cached.iss !== options.issuer) {
        throw new Error(`Invalid JWT issuer (expected ${options.issuer}, got ${cached.iss})`);
      }

      if (options.audience && cached.aud !== options.audience) {
        throw new Error(`Invalid JWT audience (expected ${options.audience}, got ${cached.aud})`);
      }

      return { ...cached };
    }
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  // 1. Fast-path header check: bypass decoding and JSON parsing for standard HS256 header
  let header;
  if (encodedHeader === HS256_HEADER_BASE64URL) {
    header = { alg: 'HS256', typ: 'JWT' };
  } else {
    try {
      header = JSON.parse(base64UrlDecode(encodedHeader));
    } catch (e) {
      throw new Error('Invalid JWT header JSON');
    }
  }

  if (!header || typeof header !== 'object' || header.alg !== 'HS256') {
    throw new Error(`Unsupported algorithm '${header?.alg}' in JWT header`);
  }

  // 2. DoS Protection: verify payload size limit before JSON parsing
  const maxPayloadSize = typeof options.maxPayloadSize === 'number'
    ? options.maxPayloadSize
    : MAX_PAYLOAD_SIZE;

  if (encodedPayload.length > maxPayloadSize) {
    throw new Error('JWT payload exceeds maximum allowed size');
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (e) {
    throw new Error('Invalid JWT payload JSON');
  }

  // 3. Re-compute and constant-time compare signature
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignatureBuf = hmacSha256(signingInput, secret, 'buffer');

  const actualSignatureBuf = Buffer.from(encodedSignature, 'base64url');

  if (!safeCompare(expectedSignatureBuf, actualSignatureBuf)) {
    throw new Error('Invalid JWT signature');
  }

  // 4. Check claims
  const nowSec = Math.floor(Date.now() / 1000);

  if (!options.ignoreExpiration && typeof payload.exp === 'number') {
    if (nowSec >= payload.exp) {
      throw new Error('JWT token has expired');
    }
  }

  if (options.issuer && payload.iss !== options.issuer) {
    throw new Error(`Invalid JWT issuer (expected ${options.issuer}, got ${payload.iss})`);
  }

  if (options.audience && payload.aud !== options.audience) {
    throw new Error(`Invalid JWT audience (expected ${options.audience}, got ${payload.aud})`);
  }

  // 5. Store in bounded verification LRU cache
  if (cacheKey) {
    if (verifiedJwtCache.size >= VERIFIED_JWT_CACHE_LIMIT) {
      const oldestKey = verifiedJwtCache.keys().next().value;
      verifiedJwtCache.delete(oldestKey);
    }
    verifiedJwtCache.set(cacheKey, payload);
  }

  return { ...payload };
}

/**
 * Decode JWT without verifying signature
 * @param {string} token
 * @returns {{ header: Object, payload: Object }|null}
 */
function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = parts[0] === HS256_HEADER_BASE64URL
      ? { alg: 'HS256', typ: 'JWT' }
      : JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return { header, payload };
  } catch (e) {
    return null;
  }
}

module.exports = {
  signJwt,
  verifyJwt,
  decodeJwt,
  base64UrlEncode,
  base64UrlDecode,
  parseDuration,
  clearJwtCache,
  HS256_HEADER_BASE64URL,
  MAX_PAYLOAD_SIZE,
};
