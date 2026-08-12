/**
 * CSRF protection plugin — session/cookie double-submit CSRF validation + Nunjucks helpers
 * @module plugins/csrf
 */

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const cookieParser = require('cookie-parser');
const nunjucks = require('nunjucks');

// Storage to pass the active request to Nunjucks template helpers in a thread-safe manner
const csrfStorage = new AsyncLocalStorage();

/**
 * Compare two strings in constant time to prevent timing attacks
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (err) {
    return false;
  }
}

/**
 * Check if the request path matches any ignore patterns
 * @param {import('express').Request} req
 * @param {Array<string|RegExp|Function>} ignorePaths
 * @returns {boolean}
 */
function isIgnored(req, ignorePaths) {
  if (!ignorePaths || !Array.isArray(ignorePaths)) return false;
  const path = req.path || '';

  for (const pattern of ignorePaths) {
    if (typeof pattern === 'string') {
      // Prefix matching
      if (path.startsWith(pattern)) return true;
      // Basic glob matching
      if (pattern.includes('*')) {
        const regexPattern = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*');
        if (new RegExp(`^${regexPattern}$`).test(path)) return true;
      }
    } else if (pattern instanceof RegExp) {
      if (pattern.test(path)) return true;
    } else if (typeof pattern === 'function') {
      if (pattern(req)) return true;
    }
  }
  return false;
}

/**
 * Nunjucks Helper: Get raw CSRF token
 * @returns {string}
 */
function csrfToken() {
  const req = csrfStorage.getStore();
  if (req && typeof req.csrfToken === 'function') {
    return req.csrfToken();
  }
  return '';
}

/**
 * Nunjucks Helper: Get hidden input HTML element with CSRF token
 * @returns {nunjucks.runtime.SafeString}
 */
function csrfInput() {
  const token = csrfToken();
  if (!token) return '';
  return new nunjucks.runtime.SafeString(
    `<input type="hidden" name="_csrf" value="${token}">`
  );
}

/**
 * CSRF Plugin
 * @param {Object} [options]
 * @param {boolean|Object} [options.cookie=false] - Cookie options. If true or object, cookie-based storage is used.
 * @param {string} [options.cookie.key='_csrf'] - Cookie name.
 * @param {boolean} [options.cookie.signed=false] - Whether to sign the cookie.
 * @param {string} [options.cookie.path='/'] - Cookie path.
 * @param {boolean} [options.cookie.httpOnly=true] - Cookie httpOnly flag.
 * @param {boolean} [options.cookie.secure] - Cookie secure flag.
 * @param {'lax'|'strict'|'none'} [options.cookie.sameSite='lax'] - Cookie SameSite policy.
 * @param {number} [options.cookie.maxAge] - Cookie maxAge.
 * @param {string} [options.sessionKey='csrfToken'] - Session key name.
 * @param {string[]} [options.methods=['POST', 'PUT', 'DELETE', 'PATCH']] - Methods to protect.
 * @param {Array<string|RegExp|Function>} [options.ignorePaths=[]] - Routes to skip verification.
 * @param {boolean} [options.global=false] - Mount CSRF middleware globally on all routes.
 * @param {string} [options.errorMessage='Invalid or missing CSRF token'] - Error message on failure.
 * @param {number} [options.errorStatus=403] - HTTP status code on failure.
 */
function csrfPlugin(options = {}) {
  const {
    cookie = false,
    sessionKey = 'csrfToken',
    methods = ['POST', 'PUT', 'DELETE', 'PATCH'],
    ignorePaths = [],
    global: applyGlobal = false,
    errorMessage = 'Invalid or missing CSRF token',
    errorStatus = 403,
  } = options;

  // Resolve cookie config
  const cookieEnabled = !!cookie;
  const cookieOpts = typeof cookie === 'object' ? cookie : {};
  const cookieKey = cookieOpts.key || '_csrf';
  const cookieOptions = {
    httpOnly: cookieOpts.httpOnly !== undefined ? cookieOpts.httpOnly : true,
    path: cookieOpts.path || '/',
    secure: cookieOpts.secure !== undefined ? cookieOpts.secure : (process.env.NODE_ENV === 'production'),
    sameSite: cookieOpts.sameSite || 'lax',
    signed: !!cookieOpts.signed,
  };
  if (cookieOpts.maxAge !== undefined) {
    cookieOptions.maxAge = cookieOpts.maxAge;
  }

  /**
   * Internal middleware creator
   * @param {Object} [overrideOpts]
   */
  function createMiddleware(overrideOpts = {}) {
    const activeMethods = overrideOpts.methods || methods;
    const activeIgnorePaths = overrideOpts.ignorePaths || ignorePaths;

    return (req, res, next) => {
      // Determine if cookie or session storage should be used
      const useCookie = cookieEnabled || !req.session;

      // Initialize cookie parser dynamically if needed
      if (useCookie && !req.cookies) {
        const secret = cookieOptions.signed ? (cookieOpts.secret || process.env.SESSION_SECRET) : undefined;
        cookieParser(secret)(req, res, () => {});
      }

      // 1. Retrieve or generate secret token
      let secret;
      if (useCookie) {
        secret = cookieOptions.signed ? req.signedCookies[cookieKey] : req.cookies[cookieKey];
        if (!secret) {
          secret = crypto.randomBytes(32).toString('hex');
          const isHttps = req.secure || req.headers?.['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
          const effectiveCookieOptions = {
            httpOnly: true,
            sameSite: 'lax',
            ...cookieOptions,
            secure: cookieOpts.secure !== undefined ? cookieOpts.secure : isHttps,
          };
          res.cookie(cookieKey, secret, effectiveCookieOptions);
        }
      } else {
        // Session based
        if (!req.session[sessionKey]) {
          req.session[sessionKey] = crypto.randomBytes(32).toString('hex');
        }
        secret = req.session[sessionKey];
      }

      // Define standard req.csrfToken()
      req.csrfToken = () => secret;

      // 2. Perform CSRF verification for mutating HTTP methods
      const method = req.method ? req.method.toUpperCase() : 'GET';
      if (activeMethods.includes(method) && !isIgnored(req, activeIgnorePaths)) {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const query = req.query && typeof req.query === 'object' ? req.query : {};
        const submitted = (
          body._csrf ||
          query._csrf ||
          req.headers['x-csrf-token'] ||
          req.headers['xsrf-token'] ||
          req.headers['x-xsrf-token']
        );

        if (!submitted || !safeCompare(submitted, secret)) {
          res.status(errorStatus);
          if (req.accepts('html') && !req.path.startsWith('/api')) {
            return res.send(`<h1>${errorStatus} Forbidden</h1><p>${errorMessage}</p>`);
          } else {
            return res.json({ error: errorMessage });
          }
        }
      }

      // 3. Run downstream handlers inside AsyncLocalStorage context
      csrfStorage.run(req, () => {
        next();
      });
    };
  }

  return {
    name: 'csrf',
    version: '1.0.0',
    description: 'CSRF protection plugin for Webspresso with cookie/session storage and template helpers',

    api: {
      createMiddleware,
    },

    register(ctx) {
      // Register named route middleware
      ctx.middlewares.csrf = (routeOpts = {}) => createMiddleware(routeOpts);

      // Register template helpers
      ctx.addHelper('csrfToken', csrfToken);
      ctx.addHelper('csrfInput', csrfInput);

      // If global validation is enabled, mount the middleware globally on the Express app
      if (applyGlobal) {
        ctx.app.use(createMiddleware());
      }
    },
  };
}

module.exports = csrfPlugin;
module.exports.csrfPlugin = csrfPlugin;
