/**
 * Webspresso Auth - Zero-dependency JWT implementation
 * Uses Node.js native crypto module for HS256 HMAC-SHA256 signatures
 * @module core/auth/jwt
 */

const crypto = require('crypto');

/**
 * Base64URL encode string or Buffer
 * @param {string|Buffer} input
 * @returns {string}
 */
function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Base64URL decode string
 * @param {string} input
 * @returns {string}
 */
function base64UrlDecode(input) {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Parse duration string (e.g. '1h', '7d', '15m', '3600') into seconds
 * @param {string|number} duration
 * @returns {number} Seconds
 */
function parseDuration(duration) {
  if (typeof duration === 'number') {
    return duration;
  }
  if (typeof duration !== 'string') {
    return 3600; // Default 1 hour
  }

  const match = duration.trim().match(/^(\d+)\s*([smhd])?$/i);
  if (!match) {
    const parsed = parseInt(duration, 10);
    return isNaN(parsed) ? 3600 : parsed;
  }

  const value = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return value;
  }
}

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

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();

  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verify and decode HS256 JWT string
 * @param {string} token - JWT string
 * @param {string} secret - Secret key
 * @param {Object} [options] - Verification options
 * @param {boolean} [options.ignoreExpiration=false] - Ignore token expiration
 * @param {string} [options.issuer] - Expected issuer
 * @param {string} [options.audience] - Expected audience
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

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header;
  let payload;

  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
  } catch (e) {
    throw new Error('Invalid JWT header JSON');
  }

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (e) {
    throw new Error('Invalid JWT payload JSON');
  }

  if (header.alg !== 'HS256') {
    throw new Error(`Unsupported algorithm '${header.alg}' in JWT header`);
  }

  // Re-compute signature
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignatureBuf = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();

  const actualSignatureBuf = Buffer.from(encodedSignature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  if (
    expectedSignatureBuf.length !== actualSignatureBuf.length ||
    !crypto.timingSafeEqual(expectedSignatureBuf, actualSignatureBuf)
  ) {
    throw new Error('Invalid JWT signature');
  }

  // Check claims
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

  return payload;
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
    const header = JSON.parse(base64UrlDecode(parts[0]));
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
};
