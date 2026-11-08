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
 * @param {string} [options.cookieName]
 * @param {boolean} [options.signed]
 * @param {string|string[]} [options.secret]
 * @returns {import('express').RequestHandler}
 */
function createFlashMiddleware(options = {}) {
  const cookieName = options.cookieName || FLASH_COOKIE_NAME;

  // Helpers are created once per middleware and read per-request state from req.__flash /
  // req.__outgoingFlash (`this` is the req or res they are called on), instead of allocating
  // six closures on every request.

  function saveOutgoingFlash(req, res) {
    const outgoingFlash = req.__outgoingFlash;
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
      const shouldSign = options.signed !== undefined
        ? Boolean(options.signed)
        : Boolean(req.secret || options.secret);
      const cookieOpts = {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 300000, // 5 minutes
      };
      if (shouldSign && (req.secret || options.secret)) {
        cookieOpts.signed = true;
      }
      res.cookie(cookieName, encoded, cookieOpts);
    }
  }

  /**
   * Set or get a flash message
   * @this {import('express').Request}
   * @param {string} [key]
   * @param {any} [value]
   * @returns {any}
   */
  function flash(key, value) {
    if (arguments.length === 0) {
      return this.__flash;
    }
    if (arguments.length === 1) {
      return this.__flash[key];
    }
    this.__outgoingFlash[key] = value;
    saveOutgoingFlash(this, this.res);
    return value;
  }

  /**
   * Get old input value from previous request
   * @this {import('express').Request}
   * @param {string} [name]
   * @param {any} [defaultValue=null]
   * @returns {any}
   */
  function old(name, defaultValue = null) {
    const oldInputs = this.__flash.old || {};
    if (!name) return oldInputs;
    return oldInputs[name] !== undefined ? oldInputs[name] : defaultValue;
  }

  /**
   * Flash current request body / input for the next request
   * @this {import('express').Response}
   * @param {Object} [customInput]
   * @returns {import('express').Response}
   */
  function withInput(customInput) {
    const req = this.req;
    const input = customInput || req.body || {};
    // Exclude sensitive fields by default
    const sanitized = { ...input };
    delete sanitized.password;
    delete sanitized.password_confirmation;
    delete sanitized.confirmPassword;
    delete sanitized._csrf;

    req.__outgoingFlash.old = sanitized;
    saveOutgoingFlash(req, this);
    return this;
  }

  /**
   * Flash validation errors for the next request
   * @this {import('express').Response}
   * @param {any} errors - ZodError, object, array, or string
   * @returns {import('express').Response}
   */
  function withErrors(errors) {
    this.req.__outgoingFlash.errors = normalizeErrors(errors);
    saveOutgoingFlash(this.req, this);
    return this;
  }

  /**
   * Flash a key-value message for the next request
   * @this {import('express').Response}
   * @param {string} key - e.g. 'success', 'warning', 'info'
   * @param {any} message
   * @returns {import('express').Response}
   */
  function withFlash(key, message) {
    this.req.__outgoingFlash[key] = message;
    saveOutgoingFlash(this.req, this);
    return this;
  }

  return function flashMiddleware(req, res, next) {
    if (options.secret && !req.secret) {
      req.secret = options.secret;
    }

    // 1. Load incoming flash messages from session or cookie
    let incomingFlash = {};

    if (req.session && req.session[FLASH_SESSION_KEY]) {
      incomingFlash = req.session[FLASH_SESSION_KEY] || {};
      // Delete from session for next request (consume)
      delete req.session[FLASH_SESSION_KEY];
    } else if (req.signedCookies && cookieName in req.signedCookies) {
      const signedVal = req.signedCookies[cookieName];
      incomingFlash = (signedVal && typeof signedVal === 'string') ? (decodeFlashCookie(signedVal) || {}) : {};
      // Clear cookie immediately
      res.clearCookie(cookieName, { path: '/' });
    } else if (req.cookies && req.cookies[cookieName]) {
      incomingFlash = decodeFlashCookie(req.cookies[cookieName]) || {};
      // Clear cookie immediately
      res.clearCookie(cookieName, { path: '/' });
    }

    // Attach to request context for Nunjucks helpers; outgoing state is persisted for the NEXT request
    req.__flash = incomingFlash;
    req.__outgoingFlash = {};
    if (!res.req) res.req = req;

    req.flash = flash;
    req.old = old;
    res.withInput = withInput;
    res.withErrors = withErrors;
    res.withFlash = withFlash;

    next();
  };
}

module.exports = {
  createFlashMiddleware,
  normalizeErrors,
  FLASH_SESSION_KEY,
  FLASH_COOKIE_NAME,
};
