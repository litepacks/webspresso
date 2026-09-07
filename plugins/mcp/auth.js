/**
 * Webspresso MCP Authentication & Security
 * Provides token validation and localhost IP restrictions for HTTP/SSE transports
 * @module plugins/mcp/auth
 */

const crypto = require('crypto');

/**
 * Constant-time string comparison to avoid timing attacks
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Check if incoming request is from localhost
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isLocalhost(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.endsWith('127.0.0.1') ||
    req.hostname === 'localhost'
  );
}

/**
 * Creates authentication middleware for MCP HTTP/SSE endpoints
 * @param {Object} [options={}]
 * @param {string} [options.token] - Pre-shared secret token
 * @param {boolean} [options.localhostOnly=false] - Only allow localhost connections
 * @param {function(import('express').Request): (boolean|Promise<boolean>)} [options.verify] - Custom verify function
 * @returns {import('express').RequestHandler}
 */
function createMcpAuthMiddleware(options = {}) {
  const { token, localhostOnly = false, verify } = options;

  return async function mcpAuthMiddleware(req, res, next) {
    // 1. Localhost check
    if (localhostOnly && !isLocalhost(req)) {
      return res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Forbidden: MCP server only allows localhost connections' },
      });
    }

    // 2. Custom verification
    if (typeof verify === 'function') {
      try {
        const ok = await verify(req);
        if (!ok) {
          return res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Unauthorized: Custom MCP verification failed' },
          });
        }
        return next();
      } catch (err) {
        return res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: `Unauthorized: ${err.message}` },
        });
      }
    }

    // 3. Pre-shared token check
    if (token) {
      let clientToken = '';
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        clientToken = authHeader.slice('Bearer '.length).trim();
      } else if (req.query && req.query.token) {
        clientToken = String(req.query.token).trim();
      }

      if (!clientToken || !safeEqual(clientToken, token)) {
        return res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Unauthorized: Invalid or missing MCP bearer token' },
        });
      }
    }

    next();
  };
}

module.exports = {
  createMcpAuthMiddleware,
  isLocalhost,
  safeEqual,
};
