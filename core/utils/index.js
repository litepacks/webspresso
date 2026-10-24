'use strict';

/**
 * Webspresso Core Utilities
 * Zero-dependency helper functions organized by domain.
 * @module core/utils
 */

const crypto = require('./crypto');
const fetch = require('./fetch');
const fs = require('./fs');
const html = require('./html');
const ip = require('./ip');
const json = require('./json');
const object = require('./object');
const regex = require('./regex');
const string = require('./string');
const time = require('./time');
const timeout = require('./timeout');
const url = require('./url');

module.exports = {
  // Domain submodules
  crypto,
  fetch,
  fs,
  html,
  ip,
  json,
  object,
  regex,
  string,
  time,
  timeout,
  url,

  // Cryptographic utilities
  safeCompare: crypto.safeCompare,
  timingSafeEqual: crypto.timingSafeEqual,
  sha256: crypto.sha256,
  hashSha256: crypto.hashSha256,
  hmacSha256: crypto.hmacSha256,
  createHmacSha256: crypto.createHmacSha256,
  randomToken: crypto.randomToken,
  randomId: crypto.randomId,
  randomTimestampedId: crypto.randomTimestampedId,
  base64UrlEncode: crypto.base64UrlEncode,
  base64UrlDecode: crypto.base64UrlDecode,

  // Fetch utilities
  fetchWithTimeout: fetch.fetchWithTimeout,

  // Filesystem utilities
  walkDirectory: fs.walkDirectory,
  walkDirectoryDetailed: fs.walkDirectoryDetailed,
  DEFAULT_TEST_SUFFIXES: fs.DEFAULT_TEST_SUFFIXES,

  // HTML utilities
  escapeHtml: html.escapeHtml,
  unescapeHtml: html.unescapeHtml,

  // IP utilities
  getClientIp: ip.getClientIp,

  // JSON utilities
  safeJsonParse: json.safeJsonParse,
  safeJsonStringify: json.safeJsonStringify,
  isValidJson: json.isValidJson,

  // Object utilities
  ensureArray: object.ensureArray,
  pick: object.pick,
  omit: object.omit,
  deepClone: object.deepClone,

  // RegExp utilities
  escapeRegExp: regex.escapeRegExp,
  escapeRegex: regex.escapeRegex,
  globToRegExp: regex.globToRegExp,

  // String utilities
  toCamelCase: string.toCamelCase,
  snakeToCamel: string.snakeToCamel,
  toSnakeCase: string.toSnakeCase,
  camelToSnake: string.camelToSnake,
  toKebabCase: string.toKebabCase,
  toPascalCase: string.toPascalCase,

  // Time & duration utilities
  parseDurationSec: time.parseDurationSec,
  parseDurationMs: time.parseDurationMs,
  parseDuration: time.parseDuration,
  parseTtlMs: time.parseTtlMs,
  sleep: time.sleep,

  // Timeout utilities
  DEFAULT_TIMEOUTS: timeout.DEFAULT_TIMEOUTS,
  normalizeTimeouts: timeout.normalizeTimeouts,
  TimeoutError: timeout.TimeoutError,
  withTimeout: timeout.withTimeout,
  createTimeoutMiddleware: timeout.createTimeoutMiddleware,

  // URL utilities
  stripTrailingSlash: url.stripTrailingSlash,
  ensureLeadingSlash: url.ensureLeadingSlash,
  ensureTrailingSlash: url.ensureTrailingSlash,
  stripLeadingSlash: url.stripLeadingSlash,
  joinUrl: url.joinUrl,
  trimUrlPathSlashes: url.trimUrlPathSlashes,
};
