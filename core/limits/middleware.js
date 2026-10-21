'use strict';

/**
 * Webspresso Payload Limits Middleware
 * Zero-dependency body size enforcement, DoS protection, and raw body capture.
 *
 * @module core/limits/middleware
 */

let _express = null;
function getExpress() {
  if (!_express) {
    _express = require('express');
  }
  return _express;
}
const { normalizeLimits } = require('./normalize');

/**
 * Checks if a given URL pathname matches a path pattern (string, glob wildcard, or RegExp).
 *
 * @param {string|RegExp|Function} pattern
 * @param {string} pathname
 * @returns {boolean}
 */
function matchesPath(pattern, pathname) {
  if (!pathname || !pattern) return false;

  if (typeof pattern === 'function') {
    try {
      return Boolean(pattern(pathname));
    } catch {
      return false;
    }
  }

  if (pattern instanceof RegExp) {
    return pattern.test(pathname);
  }

  if (typeof pattern !== 'string') return false;

  // Exact match
  if (pattern === pathname) return true;

  // Wildcard match (e.g. /api/webhooks/* or /api/webhooks/**)
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3);
    return pathname === base || pathname.startsWith(base.endsWith('/') ? base : `${base}/`);
  }
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return pathname === base || pathname.startsWith(base.endsWith('/') ? base : `${base}/`);
  }

  // Parameterized express pattern: /api/users/:id/upload
  if (pattern.includes(':')) {
    const regexPattern = '^' + pattern.replace(/\/:[^/]+/g, '/[^/]+') + '$';
    try {
      return new RegExp(regexPattern).test(pathname);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Determines whether body parsing should be skipped for the incoming request.
 *
 * @param {import('express').Request} req
 * @param {Array<string|RegExp|Function>} excludeList
 * @returns {boolean}
 */
function shouldSkipBodyParser(req, excludeList) {
  if (!Array.isArray(excludeList) || excludeList.length === 0) {
    return false;
  }
  const currentPath = req.path || '';
  const originalUrl = req.originalUrl ? req.originalUrl.split('?')[0] : '';

  return excludeList.some(
    (pattern) => matchesPath(pattern, currentPath) || matchesPath(pattern, originalUrl)
  );
}

/**
 * Determines whether raw body buffer should be captured into `req.rawBody`.
 *
 * @param {import('express').Request} req
 * @param {boolean|Array<string|RegExp>|Function} captureSetting
 * @returns {boolean}
 */
function shouldCaptureRawBody(req, captureSetting) {
  if (!captureSetting) return false;
  if (captureSetting === true) return true;

  if (typeof captureSetting === 'function') {
    try {
      return Boolean(captureSetting(req));
    } catch {
      return false;
    }
  }

  if (Array.isArray(captureSetting)) {
    const currentPath = req.path || '';
    const originalUrl = req.originalUrl ? req.originalUrl.split('?')[0] : '';
    return captureSetting.some(
      (pattern) => matchesPath(pattern, currentPath) || matchesPath(pattern, originalUrl)
    );
  }

  return false;
}

/**
 * Creates route-level limits middleware executing custom body parsers.
 *
 * @param {Object} [routeOptions]
 * @returns {import('express').RequestHandler}
 */
function createLimitsMiddleware(routeOptions = {}) {
  const express = getExpress();
  const limits = normalizeLimits(routeOptions);
  const parsers = [];

  function makeVerify(userVerify) {
    return (req, res, buf, encoding) => {
      if (typeof userVerify === 'function') {
        userVerify(req, res, buf, encoding);
      }
      if (shouldCaptureRawBody(req, limits.captureRawBody)) {
        req.rawBody = buf;
      }
    };
  }

  if (limits.json.enabled) {
    parsers.push(
      express.json({
        ...limits.json.options,
        limit: limits.json.limit,
        strict: limits.json.strict,
        verify: makeVerify(limits.json.verify),
      })
    );
  }

  if (limits.urlencoded.enabled) {
    parsers.push(
      express.urlencoded({
        ...limits.urlencoded.options,
        limit: limits.urlencoded.limit,
        extended: limits.urlencoded.extended,
        parameterLimit: limits.urlencoded.parameterLimit,
        verify: makeVerify(limits.urlencoded.verify),
      })
    );
  }

  if (limits.raw.enabled) {
    parsers.push(
      express.raw({
        ...limits.raw.options,
        limit: limits.raw.limit,
        type: limits.raw.type,
        verify: makeVerify(limits.raw.verify),
      })
    );
  }

  if (limits.text.enabled) {
    parsers.push(
      express.text({
        ...limits.text.options,
        limit: limits.text.limit,
        type: limits.text.type,
        verify: makeVerify(limits.text.verify),
      })
    );
  }

  return function routeLimitsMiddleware(req, res, next) {
    if (shouldSkipBodyParser(req, limits.exclude)) {
      return next();
    }

    let idx = 0;
    function runNextParser(err) {
      if (err) return next(err);
      if (idx >= parsers.length) return next();
      const parser = parsers[idx++];
      parser(req, res, runNextParser);
    }

    runNextParser();
  };
}

/**
 * Mounts payload limits and body parsing middleware onto an Express application.
 *
 * @param {import('express').Application} app
 * @param {Object} [options]
 * @returns {Object} Normalized limits configuration
 */
function setupLimitsMiddleware(app, options = {}) {
  const express = getExpress();
  const limits = normalizeLimits(options);

  // Expose limits on app instance for introspection
  app.limits = limits;
  if (typeof app.set === 'function') {
    app.set('webspresso.limits', limits);
  }

  const allExcludes = [...limits.exclude];

  // 1. Mount route-specific overrides (mounted first so they take precedence)
  if (limits.routes && typeof limits.routes === 'object') {
    for (const [routePattern, routeConfig] of Object.entries(limits.routes)) {
      if (routeConfig === false) {
        // Entirely exclude this route from global body parsing
        allExcludes.push(routePattern);
      } else if (routeConfig && typeof routeConfig === 'object') {
        // Mount route-specific body parsers on the path
        const routeMw = createLimitsMiddleware(routeConfig);
        app.use(routePattern, routeMw);
      }
    }
  }

  // 2. Setup Global Body Parsers with exclusion checking and raw body capture
  function globalVerify(userVerify) {
    return (req, res, buf, encoding) => {
      if (typeof userVerify === 'function') {
        userVerify(req, res, buf, encoding);
      }
      if (shouldCaptureRawBody(req, limits.captureRawBody)) {
        req.rawBody = buf;
      }
    };
  }

  // Global JSON Parser
  if (limits.json.enabled) {
    const jsonParserFn = express.json({
      ...limits.json.options,
      limit: limits.json.limit,
      strict: limits.json.strict,
      verify: globalVerify(limits.json.verify),
    });

    app.use(function jsonParser(req, res, next) {
      if (req._body || shouldSkipBodyParser(req, allExcludes)) {
        return next();
      }
      jsonParserFn(req, res, next);
    });
  }

  // Global URL-Encoded Parser
  if (limits.urlencoded.enabled) {
    const urlencodedParserFn = express.urlencoded({
      ...limits.urlencoded.options,
      limit: limits.urlencoded.limit,
      extended: limits.urlencoded.extended,
      parameterLimit: limits.urlencoded.parameterLimit,
      verify: globalVerify(limits.urlencoded.verify),
    });

    app.use(function urlencodedParser(req, res, next) {
      if (req._body || shouldSkipBodyParser(req, allExcludes)) {
        return next();
      }
      urlencodedParserFn(req, res, next);
    });
  }

  // Global Raw Body Parser
  if (limits.raw.enabled) {
    const rawParser = express.raw({
      ...limits.raw.options,
      limit: limits.raw.limit,
      type: limits.raw.type,
      verify: globalVerify(limits.raw.verify),
    });

    app.use((req, res, next) => {
      if (req._body || shouldSkipBodyParser(req, allExcludes)) {
        return next();
      }
      rawParser(req, res, next);
    });
  }

  // Global Text Parser
  if (limits.text.enabled) {
    const textParser = express.text({
      ...limits.text.options,
      limit: limits.text.limit,
      type: limits.text.type,
      verify: globalVerify(limits.text.verify),
    });

    app.use((req, res, next) => {
      if (req._body || shouldSkipBodyParser(req, allExcludes)) {
        return next();
      }
      textParser(req, res, next);
    });
  }

  return limits;
}

module.exports = {
  matchesPath,
  shouldSkipBodyParser,
  shouldCaptureRawBody,
  createLimitsMiddleware,
  setupLimitsMiddleware,
};
