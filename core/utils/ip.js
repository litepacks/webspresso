'use strict';

/**
 * Universal Client IP Extraction Utility
 * Safely extracts client IP address with proxy support, header normalizations,
 * and customizable fallbacks.
 *
 * Precedence:
 * 1. x-forwarded-for header (first IP if comma-separated or array)
 * 2. x-real-ip header
 * 3. req.ip (Express trust proxy / custom assignment)
 * 4. req.connection.remoteAddress
 * 5. req.socket.remoteAddress
 * 6. req.info.remoteAddress (Fastify/Hapi compatibility)
 * 7. fallback (defaults to '127.0.0.1' if not explicitly provided)
 *
 * @param {Object} [req] - Express / Node.js HTTP request object
 * @param {any} [fallback='127.0.0.1'] - Fallback value if no IP could be extracted
 * @returns {any}
 */
function getClientIp(req, fallback) {
  const defaultFallback = arguments.length > 1 ? fallback : '127.0.0.1';
  if (!req || typeof req !== 'object') {
    return defaultFallback;
  }

  const headers = req.headers;

  // 1. x-forwarded-for (can be string or array in Node HTTP/proxies)
  let forwarded = headers ? (headers['x-forwarded-for'] || headers['X-Forwarded-For']) : undefined;
  if (!forwarded && typeof req.get === 'function') {
    forwarded = req.get('x-forwarded-for');
  }

  if (forwarded) {
    const ips = typeof forwarded === 'string' ? forwarded.split(',') : forwarded;
    const first = Array.isArray(ips) ? ips[0] : ips;
    if (first && typeof first === 'string') {
      const trimmed = first.trim();
      if (trimmed) return trimmed;
    }
  }

  // 2. x-real-ip
  let realIp = headers ? (headers['x-real-ip'] || headers['X-Real-IP']) : undefined;
  if (!realIp && typeof req.get === 'function') {
    realIp = req.get('x-real-ip');
  }
  if (realIp && typeof realIp === 'string') {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }

  // 3. req.ip
  if (req.ip && typeof req.ip === 'string') {
    const trimmed = req.ip.trim();
    if (trimmed) return trimmed;
  }

  // 4. req.connection.remoteAddress
  const connAddr = req.connection && req.connection.remoteAddress;
  if (connAddr && typeof connAddr === 'string') {
    const trimmed = connAddr.trim();
    if (trimmed) return trimmed;
  }

  // 5. req.socket.remoteAddress
  const sockAddr = req.socket && req.socket.remoteAddress;
  if (sockAddr && typeof sockAddr === 'string') {
    const trimmed = sockAddr.trim();
    if (trimmed) return trimmed;
  }

  // 6. req.info.remoteAddress (Fastify/Hapi compatibility)
  const infoAddr = req.info && req.info.remoteAddress;
  if (infoAddr && typeof infoAddr === 'string') {
    const trimmed = infoAddr.trim();
    if (trimmed) return trimmed;
  }

  return defaultFallback;
}

module.exports = {
  getClientIp,
};
