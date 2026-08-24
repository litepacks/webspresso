/**
 * Basic Auth Plugin — HTTP Basic Authentication (RFC 7617) for Webspresso
 * Zero external dependencies (uses native Node.js crypto for timing-safe equality)
 * @module plugins/basic-auth
 */

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
 * Parse an HTTP Authorization header for Basic credentials.
 * 
 * @param {string} header - e.g. "Basic dXNlcjpwYXNz"
 * @returns {{ username: string, password: string } | null}
 */
function parseBasicAuthHeader(header) {
  if (!header || typeof header !== 'string') {
    return null;
  }

  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'basic') {
    return null;
  }

  try {
    const decoded = Buffer.from(parts[1], 'base64').toString('utf8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      return null;
    }

    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);
    return { username, password };
  } catch {
    return null;
  }
}

/**
 * Extract credentials from request Authorization header or proxy headers
 * 
 * @param {import('express').Request} req
 * @returns {{ username: string, password: string } | null}
 */
function extractCredentials(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  return parseBasicAuthHeader(header);
}

/**
 * Check if request matches path prefix list
 * 
 * @param {string} path
 * @param {string|string[]|boolean} routes
 * @returns {boolean}
 */
function shouldApplyToRoute(path, routes) {
  if (routes === true || routes == null) return true;
  const list = Array.isArray(routes) ? routes : [routes];
  return list.some((prefix) => path.startsWith(prefix));
}

/**
 * Check if request path should be skipped
 * 
 * @param {import('express').Request} req
 * @param {string[]} skipPaths
 * @param {Function} [skipFn]
 * @returns {boolean}
 */
function isSkipped(req, skipPaths = [], skipFn) {
  if (typeof skipFn === 'function' && skipFn(req)) {
    return true;
  }
  const p = req.path || req.url || '';
  if (Array.isArray(skipPaths) && skipPaths.some((prefix) => p.startsWith(prefix))) {
    return true;
  }
  return false;
}

/**
 * Send 401 Unauthorized response with optional Basic challenge header
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Object} config
 */
function sendUnauthorized(req, res, config) {
  res.statusCode = 401;

  if (config.challenge !== false) {
    const realm = String(config.realm || 'Restricted Area')
      .split(/[\r\n]/)[0]
      .replace(/"/g, '\\"');
    res.setHeader('WWW-Authenticate', `Basic realm="${realm}"`);
  }

  if (typeof config.unauthorizedResponse === 'function') {
    return config.unauthorizedResponse(req, res);
  }

  if (config.unauthorizedResponse && typeof config.unauthorizedResponse === 'object') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(config.unauthorizedResponse));
  }

  if (typeof config.unauthorizedResponse === 'string') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(config.unauthorizedResponse);
  }

  const acceptsJson = req.headers.accept && req.headers.accept.includes('application/json');
  if (acceptsJson) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Unauthorized', message: 'Authentication required.' }));
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Unauthorized');
}

/**
 * Create Basic Auth Express middleware
 * 
 * @param {Object} [options]
 * @param {Record<string, string>} [options.users] - Static username-password map
 * @param {Function} [options.verify] - Custom verification function (username, password, req) => boolean | object | Promise<boolean | object>
 * @param {string} [options.realm='Restricted Area'] - Realm name in WWW-Authenticate header
 * @param {boolean} [options.challenge=true] - Whether to send WWW-Authenticate challenge header
 * @param {string|string[]|boolean} [options.routes=true] - Route prefixes to protect (used in global mode)
 * @param {string[]} [options.skipPaths] - Array of path prefixes to skip authentication
 * @param {Function} [options.skip] - Custom predicate function (req) => boolean
 * @param {Function|string|Object} [options.unauthorizedResponse] - Custom 401 response
 * @param {Function} [options.onAuthenticated] - Callback hook (req, user) => void
 * @returns {Function} Express middleware handler
 */
function createBasicAuthMiddleware(options = {}) {
  const config = {
    realm: 'Restricted Area',
    challenge: true,
    routes: true,
    skipPaths: [],
    ...options,
  };

  return async (req, res, next) => {
    const reqPath = req.path || req.url || '/';

    if (!shouldApplyToRoute(reqPath, config.routes)) {
      return next();
    }

    if (isSkipped(req, config.skipPaths, config.skip)) {
      return next();
    }

    const credentials = extractCredentials(req);
    if (!credentials) {
      return sendUnauthorized(req, res, config);
    }

    const { username, password } = credentials;
    let authResult = false;

    if (typeof config.verify === 'function') {
      try {
        authResult = await config.verify(username, password, req);
      } catch (err) {
        return next(err);
      }
    } else if (config.users && typeof config.users === 'object') {
      const expectedPassword = config.users[username];
      if (typeof expectedPassword === 'string') {
        authResult = safeCompare(password, expectedPassword);
      }
    }

    if (!authResult) {
      return sendUnauthorized(req, res, config);
    }

    // Attach authentication context to request
    req.basicAuth = { username };
    req.auth = req.auth || {};
    const userObj = typeof authResult === 'object' && authResult !== null
      ? authResult
      : { username, type: 'basic' };

    req.auth.user = userObj;
    if (!req.user) {
      req.user = userObj;
    }

    if (typeof config.onAuthenticated === 'function') {
      try {
        config.onAuthenticated(req, userObj);
      } catch (err) {
        return next(err);
      }
    }

    next();
  };
}

/**
 * Webspresso Basic Auth Plugin Factory
 * 
 * @param {Object} [options] - Plugin configuration options
 * @param {boolean} [options.global=false] - Whether to apply basic auth as a global middleware on the app
 * @param {Record<string, string>} [options.users] - Default static username-password dictionary
 * @param {Function} [options.verify] - Default custom verification function
 * @param {string} [options.realm='Restricted Area'] - Default realm name
 * @param {boolean} [options.challenge=true] - Default challenge header flag
 * @param {string|string[]|boolean} [options.routes=true] - Route prefixes (when global: true)
 * @param {string[]} [options.skipPaths] - Default skip path prefixes
 * @param {Function} [options.skip] - Default skip predicate function
 * @param {Function|string|Object} [options.unauthorizedResponse] - Custom 401 response
 * @param {Function} [options.onAuthenticated] - Callback hook on successful login
 * @returns {Object} Webspresso Plugin Definition
 */
function basicAuthPlugin(options = {}) {
  const { global: applyGlobal = false, ...pluginDefaults } = options;

  return {
    name: 'basic-auth',
    version: '1.0.0',
    description: 'HTTP Basic Authentication (RFC 7617) plugin with named middleware and global guard',
    options,

    api: {
      createMiddleware: (routeOpts = {}) =>
        createBasicAuthMiddleware({ ...pluginDefaults, ...routeOpts }),
      parseHeader: parseBasicAuthHeader,
      safeCompare,
      extractCredentials,
    },

    register(ctx) {
      // Register named middleware factory for file routes: middleware: ['basicAuth'] or [['basicAuth', { ... }]]
      if (ctx.middlewares) {
        ctx.middlewares.basicAuth = (routeOpts = {}) =>
          createBasicAuthMiddleware({ ...pluginDefaults, ...routeOpts });
      }

      // Mount global middleware if global: true
      if (applyGlobal && ctx.app) {
        const globalMw = createBasicAuthMiddleware(options);
        ctx.app.use(globalMw);
      }
    },
  };
}

basicAuthPlugin.basicAuthPlugin = basicAuthPlugin;
basicAuthPlugin.createBasicAuthMiddleware = createBasicAuthMiddleware;
basicAuthPlugin.parseBasicAuthHeader = parseBasicAuthHeader;
basicAuthPlugin.safeCompare = safeCompare;
basicAuthPlugin.extractCredentials = extractCredentials;

module.exports = basicAuthPlugin;
module.exports.basicAuthPlugin = basicAuthPlugin;
module.exports.createBasicAuthMiddleware = createBasicAuthMiddleware;
module.exports.parseBasicAuthHeader = parseBasicAuthHeader;
module.exports.safeCompare = safeCompare;
module.exports.extractCredentials = extractCredentials;
