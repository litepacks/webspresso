'use strict';

/**
 * Webspresso Payload Limits & DoS Protection Module
 * Configurable body size limits for JSON, URL-encoded, raw, and text payloads,
 * with route-level overrides, raw body capture, and seamless 413 PayloadTooLargeError handling.
 *
 * @module core/limits
 */

const {
  DEFAULT_LIMITS,
  parseByteSize,
  normalizeLimits,
} = require('./normalize');

const {
  matchesPath,
  shouldSkipBodyParser,
  shouldCaptureRawBody,
  createLimitsMiddleware,
  setupLimitsMiddleware,
} = require('./middleware');

module.exports = {
  DEFAULT_LIMITS,
  parseByteSize,
  normalizeLimits,
  matchesPath,
  shouldSkipBodyParser,
  shouldCaptureRawBody,
  createLimitsMiddleware,
  setupLimitsMiddleware,
};
