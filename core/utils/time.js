'use strict';

/**
 * Webspresso - Zero-Dependency Time & Duration Utilities
 * Fast, robust duration parsing and formatting helpers for cache TTL, JWT expiration, timeouts, and delays.
 * @module core/utils/time
 */

/**
 * Parses duration / TTL input into seconds.
 * Compatible with core/auth/jwt parseDuration contract.
 *
 * @param {string|number|unknown} duration - Duration string (e.g. '10s', '15m', '2h', '7d', '500') or seconds number
 * @param {number} [defaultSec=3600] - Default seconds if input is invalid or missing
 * @returns {number} Seconds
 */
function parseDurationSec(duration, defaultSec = 3600) {
  if (typeof duration === 'number') {
    return duration;
  }
  if (typeof duration !== 'string') {
    return defaultSec;
  }

  const match = duration.trim().match(/^(\d+)\s*([smhdw])?$/i);
  if (!match) {
    const parsed = parseInt(duration, 10);
    return isNaN(parsed) ? defaultSec : parsed;
  }

  const value = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    case 'w': return value * 604800;
    default: return value;
  }
}

/**
 * Parses TTL / duration input into milliseconds.
 * Compatible with src/services/memoize parseTtlMs contract.
 *
 * @param {string|number|boolean|unknown} ttl - Duration string ('5s', '1m', '2h', '1d', '100'), ms number, or boolean
 * @param {number} [defaultMs=60000] - Default milliseconds if input is invalid or missing
 * @returns {number} Milliseconds
 */
function parseDurationMs(ttl, defaultMs = 60000) {
  if (typeof ttl === 'number') {
    return ttl > 0 ? ttl : defaultMs;
  }
  if (ttl === true || !ttl) {
    return defaultMs;
  }
  if (typeof ttl === 'string') {
    const match = ttl.trim().match(/^(\d+)\s*([smhdw]|ms)?$/i);
    if (match) {
      const val = parseInt(match[1], 10);
      const unit = (match[2] || 's').toLowerCase();
      switch (unit) {
        case 'ms': return val;
        case 's': return val * 1_000;
        case 'm': return val * 60_000;
        case 'h': return val * 3_600_000;
        case 'd': return val * 86_400_000;
        case 'w': return val * 604_800_000;
        default: return val * 1_000;
      }
    }
    const num = parseInt(ttl, 10);
    return !Number.isNaN(num) && num > 0 ? num : defaultMs;
  }
  return defaultMs;
}

/**
 * Returns a Promise that resolves after the specified milliseconds.
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

module.exports = {
  parseDurationSec,
  parseDurationMs,
  parseDuration: parseDurationSec,
  parseTtlMs: parseDurationMs,
  sleep,
};
