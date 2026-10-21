/**
 * Webspresso Core Rate Limit Utilities
 * @module core/rate-limit/utils
 */

'use strict';

/**
 * Parse window duration string or number into milliseconds
 * Supports: 500, '500ms', '10s', '1m', '15m', '1h', '1d'
 * @param {string|number} window
 * @returns {number} duration in milliseconds
 */
function parseWindow(window) {
  if (typeof window === 'number' && !Number.isNaN(window) && window > 0) {
    return Math.floor(window);
  }

  if (typeof window === 'string') {
    const trimmed = window.trim().toLowerCase();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);
    if (match) {
      const val = parseFloat(match[1]);
      const unit = match[2] || 'ms';

      switch (unit) {
        case 'ms': return Math.floor(val);
        case 's': return Math.floor(val * 1000);
        case 'm': return Math.floor(val * 60 * 1000);
        case 'h': return Math.floor(val * 60 * 60 * 1000);
        case 'd': return Math.floor(val * 24 * 60 * 60 * 1000);
        default: return Math.floor(val);
      }
    }
  }

  // Fallback default: 60,000ms (1 minute)
  return 60000;
}

/**
 * Extract client IP address from incoming request with reverse proxy support
 * @param {Object} req
 * @returns {string} client IP
 */
function extractClientIp(req) {
  if (!req) return '127.0.0.1';

  // 1. Direct req.ip (populated by Express if trust proxy is enabled)
  if (req.ip && typeof req.ip === 'string') {
    return req.ip;
  }

  const headers = req.headers || (req.header ? {
    'cf-connecting-ip': req.header('cf-connecting-ip'),
    'x-forwarded-for': req.header('x-forwarded-for'),
    'x-real-ip': req.header('x-real-ip'),
    'fastly-client-ip': req.header('fastly-client-ip'),
  } : {});

  // 2. Cloudflare Connecting IP
  const cfIp = headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') {
    return cfIp.trim();
  }

  // 3. Fastly / Akamai / True-Client-IP
  const fastlyIp = headers['fastly-client-ip'] || headers['true-client-ip'];
  if (fastlyIp && typeof fastlyIp === 'string') {
    return fastlyIp.trim();
  }

  // 4. Standard X-Forwarded-For (take the first client IP in chain)
  const forwardedFor = headers['x-forwarded-for'];
  if (forwardedFor && typeof forwardedFor === 'string') {
    const parts = forwardedFor.split(',');
    if (parts.length > 0 && parts[0].trim()) {
      return parts[0].trim();
    }
  }

  // 5. X-Real-IP
  const realIp = headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') {
    return realIp.trim();
  }

  // 6. Socket remote address
  const socketIp = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (socketIp && typeof socketIp === 'string') {
    return socketIp.replace(/^::ffff:/, ''); // Normalize IPv4-mapped IPv6
  }

  return '127.0.0.1';
}

/**
 * Format reset time as seconds remaining from current timestamp
 * @param {Date|number} resetTime
 * @returns {number} seconds until reset
 */
function formatResetSeconds(resetTime) {
  const targetTime = resetTime instanceof Date ? resetTime.getTime() : Number(resetTime);
  const diffMs = targetTime - Date.now();
  return Math.max(0, Math.ceil(diffMs / 1000));
}

module.exports = {
  parseWindow,
  extractClientIp,
  formatResetSeconds,
};
