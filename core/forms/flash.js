/**
 * Webspresso - Flash Messages & Old Input Manager (AdonisJS & Django-inspired)
 * Provides session-backed or cookie-backed one-time flash storage across redirects
 * @module core/forms/flash
 */

const FLASH_SESSION_KEY = '__ws_flash';
const FLASH_COOKIE_NAME = '__ws_flash';

/**
 * Format and normalize errors into a standard `{ fieldName: string[] }` shape
 * Supports ZodError, plain object, array, or string error.
 * @param {any} errors
 * @returns {Record<string, string[]>}
 */
function normalizeErrors(errors) {
  if (!errors) return {};

  // 1. ZodError with format() or flatten() or issues
  if (errors.issues && Array.isArray(errors.issues)) {
    const result = {};
    for (const issue of errors.issues) {
      const field = issue.path && issue.path.length > 0 ? issue.path.join('.') : '_form';
      if (!result[field]) result[field] = [];
      result[field].push(issue.message || 'Invalid value');
    }
    return result;
  }

  if (typeof errors.flatten === 'function') {
    const flat = errors.flatten();
    const result = { ...(flat.fieldErrors || {}) };
    if (flat.formErrors && flat.formErrors.length > 0) {
      result._form = flat.formErrors;
    }
    return result;
  }

  // 2. Simple string error
  if (typeof errors === 'string') {
    return { _form: [errors] };
  }

  // 3. Array of strings or objects
  if (Array.isArray(errors)) {
    return {
      _form: errors.map((e) => (typeof e === 'string' ? e : e.message || String(e))),
    };
  }

  // 4. Plain object `{ field: string | string[] }`
  if (typeof errors === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(errors)) {
      if (Array.isArray(val)) {
        result[key] = val.map((v) => (typeof v === 'string' ? v : v.message || String(v)));
      } else if (typeof val === 'string') {
        result[key] = [val];
      } else if (val && typeof val === 'object' && val.message) {
        result[key] = [String(val.message)];
      } else if (val !== null && val !== undefined) {
        result[key] = [String(val)];
      }
    }
    return result;
  }

  return { _form: [String(errors)] };
}

/**
 * Encode flash data for cookie transport (base64url JSON)
 * @param {Object} data
 * @returns {string}
 */
function encodeFlashCookie(data) {
  try {
    return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  } catch {
    return '';
  }
}

/**
 * Decode flash data from cookie
 * @param {string} raw
 * @returns {Object|null}
 */
function decodeFlashCookie(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Flash and Old Input Express Middleware
 * @param {Object} [options={}]
 * @returns {import('express').RequestHandler}
 */
function createFlashMiddleware(options = {}) {
  const cookieName = options.cookieName || FLASH_COOKIE_NAME;

  return function flashMiddleware(req, res, next) {
    // 1. Load incoming flash messages from session or cookie
    let incomingFlash = {};

    if (req.session && req.session[FLASH_SESSION_KEY]) {
      incomingFlash = req.session[FLASH_SESSION_KEY] || {};
      // Delete from session for next request (consume)
      delete req.session[FLASH_SESSION_KEY];
    } else if (req.cookies && req.cookies[cookieName]) {
      incomingFlash = decodeFlashCookie(req.cookies[cookieName]) || {};
      // Clear cookie immediately
      res.clearCookie(cookieName, { path: '/' });
    }

    // Outgoing flash state to be persisted for the NEXT request
    const outgoingFlash = {};

    /**
     * Set or get a flash message
     * @param {string} [key]
     * @param {any} [value]
     * @returns {any}
     */
    req.flash = function (key, value) {
      if (arguments.length === 0) {
        return incomingFlash;
      }
      if (arguments.length === 1) {
        return incomingFlash[key];
      }
      outgoingFlash[key] = value;
      saveOutgoingFlash();
      return value;
    };

    /**
     * Get old input value from previous request
     * @param {string} [name]
     * @param {any} [defaultValue=null]
     * @returns {any}
     */
    req.old = function (name, defaultValue = null) {
      const oldInputs = incomingFlash.old || {};
      if (!name) return oldInputs;
      return oldInputs[name] !== undefined ? oldInputs[name] : defaultValue;
    };

    /**
     * Flash current request body / input for the next request
     * @param {Object} [customInput]
     * @returns {res}
     */
    res.withInput = function (customInput) {
      const input = customInput || req.body || {};
      // Exclude sensitive fields by default
      const sanitized = { ...input };
      delete sanitized.password;
      delete sanitized.password_confirmation;
      delete sanitized.confirmPassword;
      delete sanitized._csrf;

      outgoingFlash.old = sanitized;
      saveOutgoingFlash();
      return res;
    };

    /**
     * Flash validation errors for the next request
     * @param {any} errors - ZodError, object, array, or string
     * @returns {res}
     */
    res.withErrors = function (errors) {
      outgoingFlash.errors = normalizeErrors(errors);
      saveOutgoingFlash();
      return res;
    };

    /**
     * Flash a key-value message for the next request
     * @param {string} key - e.g. 'success', 'warning', 'info'
     * @param {any} message
     * @returns {res}
     */
    res.withFlash = function (key, message) {
      outgoingFlash[key] = message;
      saveOutgoingFlash();
      return res;
    };

    function saveOutgoingFlash() {
      if (req.session) {
        req.session[FLASH_SESSION_KEY] = outgoingFlash;
      } else {
        // Remove any previously set cookie with the same name from response headers
        const existing = res.getHeader('Set-Cookie');
        if (existing) {
          const arr = Array.isArray(existing) ? existing : [existing];
          const filtered = arr.filter((c) => !c.startsWith(`${cookieName}=`));
          if (filtered.length > 0) {
            res.setHeader('Set-Cookie', filtered);
          } else {
            res.removeHeader('Set-Cookie');
          }
        }
        const encoded = encodeFlashCookie(outgoingFlash);
        res.cookie(cookieName, encoded, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 300000, // 5 minutes
        });
      }
    }

    // Attach to request context for Nunjucks helpers
    req.__flash = incomingFlash;
    req.__outgoingFlash = outgoingFlash;

    next();
  };
}

module.exports = {
  createFlashMiddleware,
  normalizeErrors,
  FLASH_SESSION_KEY,
  FLASH_COOKIE_NAME,
};
