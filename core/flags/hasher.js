/**
 * Webspresso Feature Flags: Fast Deterministic Hasher
 * Used for percentage rollouts, canary traffic splitting, and variant bucketing.
 * @module core/flags/hasher
 */

'use strict';

/**
 * 32-bit FNV-1a hash algorithm (non-cryptographic, high-distribution, sub-microsecond)
 * @param {string} str
 * @returns {number} 32-bit unsigned integer
 */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

/**
 * Compute deterministic bucket (0-99) for a flag and distinct user identifier
 * @param {string} flagKey
 * @param {string|number} distinctId
 * @returns {number} integer in range [0, 99]
 */
function getBucket(flagKey, distinctId) {
  const seed = `${flagKey || ''}:${distinctId !== undefined && distinctId !== null ? distinctId : 'anonymous'}`;
  return fnv1a(seed) % 100;
}

module.exports = {
  fnv1a,
  getBucket,
};
