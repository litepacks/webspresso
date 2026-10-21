/**
 * Structured Cloud Logging Formatters & Redaction Engine
 * Generates RFC & Platform compliant payloads for Google Cloud Logging, AWS CloudWatch, JSON, and Local Pretty
 * @module core/logger/formatters
 */

'use strict';

const DEFAULT_REDACT_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'private_key',
  'credit_card',
  'creditcard',
  'cvv',
];

/**
 * Deeply redact sensitive keys in objects
 * @param {any} val
 * @param {string[]} [redactKeys=DEFAULT_REDACT_KEYS]
 * @param {Set<any>} [visited=new Set()]
 * @returns {any}
 */
function redactSensitive(val, redactKeys = DEFAULT_REDACT_KEYS, visited = new Set()) {
  if (!val || typeof val !== 'object') return val;
  if (visited.has(val)) return '[Circular]';
  visited.add(val);

  if (Array.isArray(val)) {
    return val.map((item) => redactSensitive(item, redactKeys, visited));
  }

  if (val instanceof Error) {
    return {
      message: val.message,
      name: val.name,
      stack: val.stack,
      ...(val.code ? { code: val.code } : {}),
      ...(val.status ? { status: val.status } : {}),
    };
  }

  const result = {};
  const lowerKeys = redactKeys.map((k) => k.toLowerCase());

  for (const [key, value] of Object.entries(val)) {
    const isSensitive = lowerKeys.some((k) => key.toLowerCase().includes(k));
    if (isSensitive) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitive(value, redactKeys, visited);
    } else {
      result[key] = value;
    }
  }

  return result;
}

const GCP_SEVERITY_MAP = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

const AWS_LEVEL_MAP = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  fatal: 'FATAL',
};

/**
 * Format entry for Google Cloud Logging (Cloud Run, GKE, Cloud Functions)
 * Specification: https://cloud.google.com/logging/docs/structured-logging
 * @param {Object} entry
 * @param {Object} [options]
 * @returns {string} JSON string
 */
function formatGcp(entry, options = {}) {
  const {
    level = 'info',
    message = '',
    timestamp = new Date().toISOString(),
    traceContext,
    httpRequest,
    ...meta
  } = entry;

  const projectId = options.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
  const severity = GCP_SEVERITY_MAP[level] || 'DEFAULT';

  const payload = {
    severity,
    message,
    timestamp,
  };

  // Google Cloud Trace Context
  if (traceContext && traceContext.traceId) {
    payload['logging.googleapis.com/trace'] = projectId
      ? `projects/${projectId}/traces/${traceContext.traceId}`
      : traceContext.traceId;

    if (traceContext.spanId) {
      payload['logging.googleapis.com/spanId'] = traceContext.spanId;
    }
    if (traceContext.sampled !== undefined) {
      payload['logging.googleapis.com/trace_sampled'] = Boolean(traceContext.sampled);
    }
  }

  // Google Cloud HTTP Request specification
  if (httpRequest) {
    const latencySec = typeof httpRequest.latencyMs === 'number'
      ? `${(httpRequest.latencyMs / 1000).toFixed(4)}s`
      : undefined;

    payload.httpRequest = {
      requestMethod: httpRequest.method || 'GET',
      requestUrl: httpRequest.url || '/',
      status: httpRequest.status || 200,
      ...(httpRequest.responseSize ? { responseSize: httpRequest.responseSize } : {}),
      ...(httpRequest.userAgent ? { userAgent: httpRequest.userAgent } : {}),
      ...(httpRequest.ip ? { remoteIp: httpRequest.ip } : {}),
      ...(latencySec ? { latency: latencySec } : {}),
    };
  }

  // Merge remaining metadata (redacted)
  const cleanedMeta = redactSensitive(meta, options.redact);
  Object.assign(payload, cleanedMeta);

  return JSON.stringify(payload);
}

/**
 * Format entry for AWS CloudWatch (App Runner, ECS Fargate, Lambda)
 * @param {Object} entry
 * @param {Object} [options]
 * @returns {string} JSON string
 */
function formatAws(entry, options = {}) {
  const {
    level = 'info',
    message = '',
    timestamp = new Date().toISOString(),
    traceContext,
    httpRequest,
    ...meta
  } = entry;

  const payload = {
    level: AWS_LEVEL_MAP[level] || 'INFO',
    timestamp,
    message,
  };

  if (traceContext) {
    if (traceContext.traceId) payload.requestId = traceContext.traceId;
    if (traceContext.platform === 'aws' && traceContext.raw) {
      payload.xrayTraceId = traceContext.raw;
    }
  }

  if (httpRequest) {
    payload.http = {
      method: httpRequest.method || 'GET',
      path: httpRequest.url || '/',
      status: httpRequest.status || 200,
      ...(typeof httpRequest.latencyMs === 'number' ? { durationMs: httpRequest.latencyMs } : {}),
      ...(httpRequest.ip ? { ip: httpRequest.ip } : {}),
      ...(httpRequest.userAgent ? { userAgent: httpRequest.userAgent } : {}),
    };
  }

  const cleanedMeta = redactSensitive(meta, options.redact);
  Object.assign(payload, cleanedMeta);

  return JSON.stringify(payload);
}

/**
 * Standard JSON format
 * @param {Object} entry
 * @param {Object} [options]
 * @returns {string} JSON string
 */
function formatJson(entry, options = {}) {
  const { level = 'info', message = '', timestamp = new Date().toISOString(), ...meta } = entry;
  const payload = {
    timestamp,
    level,
    message,
    ...redactSensitive(meta, options.redact),
  };
  return JSON.stringify(payload);
}

/**
 * Terminal Pretty format for local development
 * @param {Object} entry
 * @returns {string}
 */
function formatPretty(entry) {
  const {
    level = 'info',
    message = '',
    timestamp = new Date().toISOString(),
    httpRequest,
    ...meta
  } = entry;

  const timeStr = timestamp.slice(11, 19);

  const colors = {
    debug: '\x1b[90m', // gray
    info: '\x1b[36m',  // cyan
    warn: '\x1b[33m',  // yellow
    error: '\x1b[31m', // red
    fatal: '\x1b[35m', // magenta
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
  };

  const lvlColor = colors[level] || colors.info;
  const badge = `${lvlColor}[${level.toUpperCase()}]${colors.reset}`;

  if (httpRequest) {
    const status = httpRequest.status || 200;
    const statusColor = status >= 500 ? colors.error : status >= 400 ? colors.warn : colors.green;
    const latency = httpRequest.latencyMs !== undefined ? `${httpRequest.latencyMs}ms` : '';
    return `${colors.dim}${timeStr}${colors.reset} ${badge} ${colors.bold}${httpRequest.method}${colors.reset} ${httpRequest.url} ${statusColor}${status}${colors.reset} ${colors.dim}${latency}${colors.reset}`;
  }

  const hasMeta = Object.keys(meta).length > 0;
  const metaStr = hasMeta ? ` ${colors.dim}${JSON.stringify(meta)}${colors.reset}` : '';

  return `${colors.dim}${timeStr}${colors.reset} ${badge} ${message}${metaStr}`;
}

module.exports = {
  redactSensitive,
  formatGcp,
  formatAws,
  formatJson,
  formatPretty,
  GCP_SEVERITY_MAP,
  AWS_LEVEL_MAP,
};
