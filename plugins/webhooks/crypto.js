/**
 * Webhooks Cryptography & Signature Module
 * Zero-dependency HMAC-SHA256 signing, constant-time verification & secret generation
 * @module plugins/webhooks/crypto
 */

const { safeCompare, hmacSha256, randomId } = require('../../core/utils/crypto');

/**
 * Generate a cryptographically secure webhook signing secret
 * 
 * @param {string} [prefix='whsec_'] 
 * @param {number} [byteLength=24] 
 * @returns {string} E.g. 'whsec_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934c'
 */
function generateSecret(prefix = 'whsec_', byteLength = 24) {
  return randomId(prefix, byteLength, 'hex');
}

/**
 * Sign a webhook payload using HMAC-SHA256
 * 
 * @param {string|Object} payload - Raw payload string or serializable object
 * @param {string} secret - Secret key used for signing
 * @param {Object} [options]
 * @param {number} [options.timestamp] - Unix timestamp in seconds
 * @returns {{ signature: string, timestampedSignature: string, timestamp: number, hex: string }}
 */
function signPayload(payload, secret, options = {}) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('A valid string secret is required to sign webhook payloads.');
  }

  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const timestamp = typeof options.timestamp === 'number'
    ? options.timestamp
    : Math.floor(Date.now() / 1000);

  // 1. Direct payload HMAC-SHA256 (compatible with GitHub / standard webhooks)
  const hex = hmacSha256(payloadStr, secret, 'hex');
  const signature = `sha256=${hex}`;

  // 2. Timestamped HMAC-SHA256 (compatible with Stripe / Svix / Slack)
  const toSign = `${timestamp}.${payloadStr}`;
  const timestampedHex = hmacSha256(toSign, secret, 'hex');
  const timestampedSignature = `t=${timestamp},v1=${timestampedHex}`;

  return {
    signature,
    timestampedSignature,
    timestamp,
    hex,
  };
}

/**
 * Verify a webhook payload against an incoming signature header
 * 
 * @param {string|Object} payload 
 * @param {string} signatureHeader 
 * @param {string} secret 
 * @param {Object} [options]
 * @param {number} [options.tolerance=300] - Allowed timestamp drift in seconds (default 5 minutes)
 * @returns {boolean}
 */
function verifySignature(payload, signatureHeader, secret, options = {}) {
  if (!signatureHeader || typeof signatureHeader !== 'string' || !secret) {
    return false;
  }

  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const tolerance = options.tolerance !== undefined ? options.tolerance : 300;

  // Case A: Timestamped header format (t=1234567890,v1=abcdef...)
  if (signatureHeader.includes('t=') && signatureHeader.includes('v1=')) {
    const parts = signatureHeader.split(',');
    let timestamp = null;
    const signatures = [];

    for (const part of parts) {
      const [key, val] = part.trim().split('=');
      if (key === 't') {
        timestamp = parseInt(val, 10);
      } else if (key === 'v1' && val) {
        signatures.push(val);
      }
    }

    if (!timestamp || isNaN(timestamp) || signatures.length === 0) {
      return false;
    }

    // Check tolerance if enabled
    if (tolerance > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > tolerance) {
        return false;
      }
    }

    const toSign = `${timestamp}.${payloadStr}`;
    const expectedHex = hmacSha256(toSign, secret, 'hex');

    return signatures.some((sig) => safeCompare(sig, expectedHex));
  }

  // Case B: Simple format (sha256=abcdef... or raw hex)
  let receivedHex = signatureHeader.trim();
  if (receivedHex.startsWith('sha256=')) {
    receivedHex = receivedHex.slice(7);
  }

  const expectedHex = hmacSha256(payloadStr, secret, 'hex');
  return safeCompare(receivedHex, expectedHex);
}

module.exports = {
  generateSecret,
  safeCompare,
  signPayload,
  verifySignature,
};
