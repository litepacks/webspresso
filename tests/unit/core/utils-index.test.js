'use strict';

import { describe, it, expect } from 'vitest';
const utils = require('../../../core/utils');

describe('core/utils/index - Centralized Utilities Barrel Export', () => {
  it('exports all 12 domain submodules', () => {
    expect(utils.crypto).toBeDefined();
    expect(utils.fetch).toBeDefined();
    expect(utils.fs).toBeDefined();
    expect(utils.html).toBeDefined();
    expect(utils.ip).toBeDefined();
    expect(utils.json).toBeDefined();
    expect(utils.object).toBeDefined();
    expect(utils.regex).toBeDefined();
    expect(utils.string).toBeDefined();
    expect(utils.time).toBeDefined();
    expect(utils.timeout).toBeDefined();
    expect(utils.url).toBeDefined();
  });

  it('exports cryptographic helpers', () => {
    expect(typeof utils.safeCompare).toBe('function');
    expect(typeof utils.timingSafeEqual).toBe('function');
    expect(typeof utils.sha256).toBe('function');
    expect(typeof utils.hashSha256).toBe('function');
    expect(typeof utils.hmacSha256).toBe('function');
    expect(typeof utils.createHmacSha256).toBe('function');
    expect(typeof utils.randomToken).toBe('function');
    expect(typeof utils.randomId).toBe('function');
    expect(typeof utils.randomTimestampedId).toBe('function');
    expect(typeof utils.base64UrlEncode).toBe('function');
    expect(typeof utils.base64UrlDecode).toBe('function');
  });

  it('exports filesystem & discovery helpers', () => {
    expect(typeof utils.walkDirectory).toBe('function');
    expect(typeof utils.walkDirectoryDetailed).toBe('function');
    expect(Array.isArray(utils.DEFAULT_TEST_SUFFIXES)).toBe(true);
  });

  it('exports string & object helpers', () => {
    expect(typeof utils.toCamelCase).toBe('function');
    expect(typeof utils.snakeToCamel).toBe('function');
    expect(typeof utils.toSnakeCase).toBe('function');
    expect(typeof utils.camelToSnake).toBe('function');
    expect(typeof utils.toKebabCase).toBe('function');
    expect(typeof utils.toPascalCase).toBe('function');
    expect(typeof utils.ensureArray).toBe('function');
    expect(typeof utils.pick).toBe('function');
    expect(typeof utils.omit).toBe('function');
    expect(typeof utils.deepClone).toBe('function');
  });

  it('exports time, timeout, json, html, ip, and url helpers', () => {
    expect(typeof utils.parseDurationSec).toBe('function');
    expect(typeof utils.parseDurationMs).toBe('function');
    expect(typeof utils.sleep).toBe('function');
    expect(typeof utils.fetchWithTimeout).toBe('function');
    expect(typeof utils.escapeHtml).toBe('function');
    expect(typeof utils.unescapeHtml).toBe('function');
    expect(typeof utils.getClientIp).toBe('function');
    expect(typeof utils.safeJsonParse).toBe('function');
    expect(typeof utils.safeJsonStringify).toBe('function');
    expect(typeof utils.isValidJson).toBe('function');
    expect(typeof utils.escapeRegExp).toBe('function');
    expect(typeof utils.globToRegExp).toBe('function');
    expect(typeof utils.stripTrailingSlash).toBe('function');
    expect(typeof utils.ensureLeadingSlash).toBe('function');
    expect(typeof utils.withTimeout).toBe('function');
  });
});
