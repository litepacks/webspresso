/**
 * Native Zero-Dependency HTTP Security Headers Engine
 * Inspired by Helmet, built exclusively using Node.js native primitives.
 * @module plugins/security/headers
 */

'use strict';

const crypto = require('crypto');

/**
 * Default Content Security Policy directives
 */
const DEFAULT_CSP = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'font-src': ["'self'", 'https:', 'data:'],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
  'img-src': ["'self'", 'data:', 'https:', 'blob:'],
  'object-src': ["'none'"],
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  'script-src-attr': ["'none'"],
  'style-src': ["'self'", 'https:', "'unsafe-inline'"],
  'connect-src': ["'self'", 'https:', 'wss:', 'ws:'],
  'upgrade-insecure-requests': [],
};

/**
 * Format CSP object to directive string
 * @param {Record<string, string[]|boolean>} cspConfig
 * @param {string} [nonce]
 * @returns {string}
 */
function buildCspHeader(cspConfig, nonce) {
  if (!cspConfig || typeof cspConfig !== 'object') return '';

  const directives = [];

  for (const [key, rawValues] of Object.entries(cspConfig)) {
    if (rawValues === false || rawValues === null || rawValues === undefined) {
      continue;
    }

    if (Array.isArray(rawValues)) {
      const values = [...rawValues];
      if (nonce && (key === 'script-src' || key === 'style-src')) {
        values.push(`'nonce-${nonce}'`);
      }
      directives.push(values.length > 0 ? `${key} ${values.join(' ')}` : key);
    } else if (typeof rawValues === 'string') {
      directives.push(`${key} ${rawValues}`);
    } else if (rawValues === true) {
      directives.push(key);
    }
  }

  return directives.join('; ');
}

/**
 * Create security headers middleware
 * 
 * @param {Object} [options]
 * @param {boolean|Object} [options.csp=true] - Content Security Policy config or boolean
 * @param {boolean} [options.cspReportOnly=false] - Use Content-Security-Policy-Report-Only
 * @param {boolean|Object} [options.hsts=true] - Strict-Transport-Security config
 * @param {string|boolean} [options.frameGuard='SAMEORIGIN'] - X-Frame-Options ('DENY', 'SAMEORIGIN' or false)
 * @param {boolean} [options.noSniff=true] - X-Content-Type-Options: nosniff
 * @param {string|boolean} [options.referrerPolicy='strict-origin-when-cross-origin'] - Referrer-Policy
 * @param {string|boolean} [options.permissionsPolicy=true] - Permissions-Policy
 * @param {boolean} [options.xssFilter=true] - X-XSS-Protection (0 per OWASP)
 * @param {boolean} [options.dnsPrefetchControl=true] - X-DNS-Prefetch-Control: off
 * @param {string|boolean} [options.crossOriginOpenerPolicy='same-origin-allow-popups'] - Cross-Origin-Opener-Policy
 * @param {string|boolean} [options.crossOriginResourcePolicy='same-origin'] - Cross-Origin-Resource-Policy
 * @param {boolean} [options.hidePoweredBy=true] - Remove X-Powered-By
 * @param {boolean} [options.generateNonce=false] - Generate crypto nonce on req/res.locals
 * @returns {Function} Express/Connect middleware
 */
function createSecurityHeadersMiddleware(options = {}) {
  const {
    csp = true,
    cspReportOnly = false,
    hsts = true,
    frameGuard = 'SAMEORIGIN',
    noSniff = true,
    referrerPolicy = 'strict-origin-when-cross-origin',
    permissionsPolicy = 'camera=(), microphone=(), geolocation=()',
    xssFilter = true,
    dnsPrefetchControl = true,
    crossOriginOpenerPolicy = 'same-origin-allow-popups',
    crossOriginResourcePolicy = 'same-origin',
    hidePoweredBy = true,
    generateNonce = false,
  } = options;

  // Normalized CSP directives
  let cspDirectives = null;
  if (csp === true) {
    cspDirectives = { ...DEFAULT_CSP };
    if (cspReportOnly) {
      delete cspDirectives['upgrade-insecure-requests'];
    }
  } else if (typeof csp === 'object' && csp !== null) {
    cspDirectives = { ...DEFAULT_CSP, ...csp };
    if (cspReportOnly && !Object.prototype.hasOwnProperty.call(csp, 'upgrade-insecure-requests')) {
      delete cspDirectives['upgrade-insecure-requests'];
    }
  }

  // Normalized HSTS string
  let hstsHeaderValue = null;
  if (hsts === true) {
    hstsHeaderValue = 'max-age=31536000; includeSubDomains; preload';
  } else if (typeof hsts === 'object' && hsts !== null) {
    const maxAge = hsts.maxAge !== undefined ? hsts.maxAge : 31536000;
    const includeSubDomains = hsts.includeSubDomains !== false ? '; includeSubDomains' : '';
    const preload = hsts.preload ? '; preload' : '';
    hstsHeaderValue = `max-age=${maxAge}${includeSubDomains}${preload}`;
  }

  return function securityHeadersMiddleware(req, res, next) {
    // 1. Hide X-Powered-By
    if (hidePoweredBy) {
      if (typeof res.removeHeader === 'function') {
        res.removeHeader('X-Powered-By');
      }
      if (res.headers && res.headers['x-powered-by']) {
        delete res.headers['x-powered-by'];
      }
    }

    // 2. Generate CSP Nonce if requested
    let nonce = null;
    if (generateNonce) {
      nonce = crypto.randomBytes(16).toString('base64');
      req.cspNonce = nonce;
      if (!res.locals) res.locals = {};
      res.locals.cspNonce = nonce;
    }

    // 3. Content-Security-Policy
    if (cspDirectives) {
      const headerName = cspReportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
      const headerValue = buildCspHeader(cspDirectives, nonce);
      if (headerValue && typeof res.setHeader === 'function') {
        res.setHeader(headerName, headerValue);
      }
    }

    // 4. Strict-Transport-Security (Apply if HTTPS or trust proxy indicates secure)
    if (hstsHeaderValue) {
      const isHttps = req.secure || req.headers?.['x-forwarded-proto'] === 'https' || req.protocol === 'https';
      const forceHsts = typeof hsts === 'object' && hsts?.force === true;
      if (isHttps || forceHsts) {
        if (typeof res.setHeader === 'function') {
          res.setHeader('Strict-Transport-Security', hstsHeaderValue);
        }
      }
    }

    // 5. X-Frame-Options
    if (frameGuard && typeof res.setHeader === 'function') {
      const val = typeof frameGuard === 'string' ? frameGuard.toUpperCase() : 'SAMEORIGIN';
      res.setHeader('X-Frame-Options', val);
    }

    // 6. X-Content-Type-Options: nosniff
    if (noSniff && typeof res.setHeader === 'function') {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    // 7. Referrer-Policy
    if (referrerPolicy && typeof res.setHeader === 'function') {
      res.setHeader('Referrer-Policy', String(referrerPolicy));
    }

    // 8. Permissions-Policy
    if (permissionsPolicy && typeof res.setHeader === 'function') {
      const policyVal = typeof permissionsPolicy === 'string'
        ? permissionsPolicy
        : 'camera=(), microphone=(), geolocation=()';
      res.setHeader('Permissions-Policy', policyVal);
    }

    // 9. X-XSS-Protection (0 disables buggy legacy XSS auditor per OWASP)
    if (xssFilter && typeof res.setHeader === 'function') {
      res.setHeader('X-XSS-Protection', '0');
    }

    // 10. X-DNS-Prefetch-Control: off
    if (dnsPrefetchControl && typeof res.setHeader === 'function') {
      res.setHeader('X-DNS-Prefetch-Control', 'off');
    }

    // 11. Cross-Origin-Opener-Policy
    if (crossOriginOpenerPolicy && typeof res.setHeader === 'function') {
      res.setHeader('Cross-Origin-Opener-Policy', String(crossOriginOpenerPolicy));
    }

    // 12. Cross-Origin-Resource-Policy
    if (crossOriginResourcePolicy && typeof res.setHeader === 'function') {
      res.setHeader('Cross-Origin-Resource-Policy', String(crossOriginResourcePolicy));
    }

    next();
  };
}

module.exports = {
  createSecurityHeadersMiddleware,
  buildCspHeader,
  DEFAULT_CSP,
};
