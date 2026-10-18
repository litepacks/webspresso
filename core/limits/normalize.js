'use strict';

/**
 * Webspresso Payload Limits Normalization & Utility
 * Configures maximum body size limits and DoS protection for JSON, URL-encoded, raw, and text payloads.
 *
 * @module core/limits/normalize
 */

const DEFAULT_LIMITS = Object.freeze({
  json: '1mb',
  urlencoded: '1mb',
  parameterLimit: 1000,
  raw: false,
  text: false,
  captureRawBody: false,
  exclude: Object.freeze([]),
  routes: Object.freeze({}),
});

/**
 * Parses byte size strings (e.g. '100kb', '5mb', '1gb') into integer bytes.
 * If already a number or cannot be parsed, returns the value.
 *
 * @param {string|number} value
 * @returns {number|string}
 */
function parseByteSize(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/i.exec(trimmed);
  if (!match) {
    return value;
  }

  const num = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();

  const multipliers = {
    b: 1,
    byte: 1,
    bytes: 1,
    kb: 1024,
    k: 1024,
    kib: 1024,
    mb: 1024 * 1024,
    m: 1024 * 1024,
    mib: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    g: 1024 * 1024 * 1024,
    gib: 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
    t: 1024 * 1024 * 1024 * 1024,
    tib: 1024 * 1024 * 1024 * 1024,
  };

  if (unit in multipliers) {
    return Math.floor(num * multipliers[unit]);
  }

  return value;
}

/**
 * Normalizes user limits options into a structured, validated configuration.
 *
 * @param {Object|string|number} [options]
 * @returns {Object} Normalized limits configuration
 */
function normalizeLimits(options = {}) {
  // If options is top-level createApp options, unwrap options.limits ?? options.server?.limits
  let raw = options;
  if (options && typeof options === 'object') {
    if ('limits' in options || (options.server && 'limits' in options.server)) {
      raw = options.limits ?? options.server?.limits ?? {};
    }
  }

  // Shorthand string or number: e.g. limits: '5mb' or limits: 5242880
  if (typeof raw === 'string' || typeof raw === 'number') {
    const size = parseByteSize(raw);
    return {
      json: { enabled: true, limit: size, strict: true, options: {} },
      urlencoded: { enabled: true, limit: size, extended: true, parameterLimit: 1000, options: {} },
      raw: { enabled: false, limit: size, type: 'application/octet-stream', options: {} },
      text: { enabled: false, limit: size, type: 'text/plain', options: {} },
      parameterLimit: 1000,
      captureRawBody: false,
      exclude: [],
      routes: {},
    };
  }

  const opts = (raw && typeof raw === 'object') ? raw : {};

  // Global parameterLimit fallback
  const globalParamLimit = typeof opts.parameterLimit === 'number'
    ? Math.max(1, Math.floor(opts.parameterLimit))
    : 1000;

  // 1. JSON
  let json = { enabled: true, limit: '1mb', strict: true, options: {} };
  if (opts.json === false) {
    json.enabled = false;
  } else if (typeof opts.json === 'string' || typeof opts.json === 'number') {
    json.limit = parseByteSize(opts.json);
  } else if (opts.json && typeof opts.json === 'object') {
    const { limit, strict, verify, enabled, ...rest } = opts.json;
    json = {
      enabled: enabled !== false,
      limit: limit !== undefined ? parseByteSize(limit) : '1mb',
      strict: strict !== false,
      verify: typeof verify === 'function' ? verify : undefined,
      options: rest,
    };
  }

  // 2. URL-encoded
  let urlencoded = { enabled: true, limit: '1mb', extended: true, parameterLimit: globalParamLimit, options: {} };
  if (opts.urlencoded === false) {
    urlencoded.enabled = false;
  } else if (typeof opts.urlencoded === 'string' || typeof opts.urlencoded === 'number') {
    urlencoded.limit = parseByteSize(opts.urlencoded);
  } else if (opts.urlencoded && typeof opts.urlencoded === 'object') {
    const { limit, extended, parameterLimit, verify, enabled, ...rest } = opts.urlencoded;
    urlencoded = {
      enabled: enabled !== false,
      limit: limit !== undefined ? parseByteSize(limit) : '1mb',
      extended: extended !== false,
      parameterLimit: typeof parameterLimit === 'number' ? Math.max(1, Math.floor(parameterLimit)) : globalParamLimit,
      verify: typeof verify === 'function' ? verify : undefined,
      options: rest,
    };
  }

  // 3. Raw Body (application/octet-stream by default)
  let rawBody = { enabled: false, limit: '1mb', type: 'application/octet-stream', options: {} };
  if (opts.raw === true) {
    rawBody.enabled = true;
  } else if (typeof opts.raw === 'string' || typeof opts.raw === 'number') {
    rawBody.enabled = true;
    rawBody.limit = parseByteSize(opts.raw);
  } else if (opts.raw && typeof opts.raw === 'object') {
    const { limit, type, verify, enabled, ...rest } = opts.raw;
    rawBody = {
      enabled: enabled !== false,
      limit: limit !== undefined ? parseByteSize(limit) : '1mb',
      type: type || 'application/octet-stream',
      verify: typeof verify === 'function' ? verify : undefined,
      options: rest,
    };
  }

  // 4. Text Body (text/plain by default)
  let textBody = { enabled: false, limit: '1mb', type: 'text/plain', options: {} };
  if (opts.text === true) {
    textBody.enabled = true;
  } else if (typeof opts.text === 'string' || typeof opts.text === 'number') {
    textBody.enabled = true;
    textBody.limit = parseByteSize(opts.text);
  } else if (opts.text && typeof opts.text === 'object') {
    const { limit, type, verify, enabled, ...rest } = opts.text;
    textBody = {
      enabled: enabled !== false,
      limit: limit !== undefined ? parseByteSize(limit) : '1mb',
      type: type || 'text/plain',
      verify: typeof verify === 'function' ? verify : undefined,
      options: rest,
    };
  }

  // 5. Raw Body Capture setting
  const captureRawBody = opts.captureRawBody !== undefined ? opts.captureRawBody : false;

  // 6. Exclusions
  const exclude = Array.isArray(opts.exclude) ? opts.exclude.slice() : [];

  // 7. Route overrides
  const routes = {};
  if (opts.routes && typeof opts.routes === 'object') {
    for (const [pattern, routeConfig] of Object.entries(opts.routes)) {
      if (routeConfig === false) {
        routes[pattern] = false;
      } else if (typeof routeConfig === 'string' || typeof routeConfig === 'number') {
        const size = parseByteSize(routeConfig);
        routes[pattern] = {
          json: { enabled: true, limit: size, strict: true, options: {} },
          urlencoded: { enabled: true, limit: size, extended: true, parameterLimit: globalParamLimit, options: {} },
          raw: { enabled: false, limit: size, type: 'application/octet-stream', options: {} },
          text: { enabled: false, limit: size, type: 'text/plain', options: {} },
        };
      } else if (routeConfig && typeof routeConfig === 'object') {
        routes[pattern] = normalizeLimits(routeConfig);
      }
    }
  }

  return {
    json,
    urlencoded,
    raw: rawBody,
    text: textBody,
    parameterLimit: globalParamLimit,
    captureRawBody,
    exclude,
    routes,
  };
}

module.exports = {
  DEFAULT_LIMITS,
  parseByteSize,
  normalizeLimits,
};
