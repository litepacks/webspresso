/**
 * Cookie parsing and signing (express cookie-parser compatible subset)
 * @module src/http/cookies
 */

const crypto = require('crypto');

/**
 * @param {string} header
 * @returns {Record<string, string>}
 */
function parseCookieHeader(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    let val = part.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

/**
 * @param {string} val
 * @param {string} secret
 * @returns {string|false}
 */
function unsign(val, secret) {
  if (!val || typeof val !== 'string') return false;
  const dot = val.lastIndexOf('.');
  if (dot === -1) return false;
  const str = val.slice(0, dot);
  const mac = val.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(str).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  return str;
}

/**
 * @param {string} val
 * @param {string} secret
 * @returns {string}
 */
function sign(val, secret) {
  const mac = crypto.createHmac('sha256', secret).update(val).digest('base64url');
  return `${val}.${mac}`;
}

/**
 * @param {Record<string, string>} cookies
 * @param {string} secret
 * @returns {Record<string, string>}
 */
function getSignedCookies(cookies, secret) {
  const signed = {};
  if (!secret) return signed;
  for (const [key, val] of Object.entries(cookies)) {
    if (val.startsWith('s:')) {
      const raw = unsign(val.slice(2), secret);
      if (raw !== false) signed[key] = raw;
    }
  }
  return signed;
}

/**
 * @param {string} name
 * @param {string} value
 * @param {object} [opts]
 * @returns {string}
 */
function serializeCookie(name, value, opts = {}) {
  let out = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  if (opts.maxAge != null) out += `; Max-Age=${Math.floor(opts.maxAge / 1000)}`;
  if (opts.expires) out += `; Expires=${opts.expires.toUTCString()}`;
  if (opts.path) out += `; Path=${opts.path}`;
  else out += '; Path=/';
  if (opts.httpOnly) out += '; HttpOnly';
  if (opts.secure) out += '; Secure';
  if (opts.sameSite) out += `; SameSite=${opts.sameSite}`;
  return out;
}

module.exports = {
  parseCookieHeader,
  getSignedCookies,
  sign,
  unsign,
  serializeCookie,
};
