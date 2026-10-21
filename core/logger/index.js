/**
 * Structured Cloud Logging System for Webspresso
 * Zero-dependency cloud logger supporting Google Cloud Logging (Cloud Run / GKE),
 * AWS CloudWatch (App Runner / ECS Fargate / Lambda), JSON streams, and local pretty printing.
 *
 * @module core/logger
 */

'use strict';

const { extractTraceContext } = require('./trace');
const {
  formatGcp,
  formatAws,
  formatJson,
  formatPretty,
} = require('./formatters');

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
  silent: 100,
};

/**
 * Auto-detect optimal cloud logging format from runtime environment
 * @returns {'gcp'|'aws'|'json'|'pretty'}
 */
function autoDetectFormat() {
  // 1. Google Cloud (Cloud Run, Cloud Functions, GKE, App Engine)
  if (process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT) {
    return 'gcp';
  }

  // 2. AWS (App Runner, ECS, Lambda, Elastic Beanstalk)
  if (
    process.env.AWS_EXECUTION_ENV ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.ECS_CONTAINER_METADATA_URI ||
    process.env.AWS_REGION
  ) {
    return 'aws';
  }

  // 3. Container / Production environment
  if (process.env.NODE_ENV === 'production') {
    return 'json';
  }

  // 4. Default to Pretty for local development
  return 'pretty';
}

class CloudLogger {
  /**
   * @param {Object} [options={}]
   * @param {'auto'|'gcp'|'aws'|'json'|'pretty'} [options.format='auto']
   * @param {'debug'|'info'|'warn'|'error'|'fatal'|'silent'} [options.level]
   * @param {NodeJS.WritableStream} [options.stream]
   * @param {Object} [options.defaultMeta={}]
   * @param {string[]} [options.redact]
   * @param {string} [options.project] - GCP Project ID
   */
  constructor(options = {}) {
    this.options = options;
    const requestedFormat = options.format || 'auto';
    this.format = requestedFormat === 'auto' ? autoDetectFormat() : requestedFormat;

    const defaultLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
    this.level = options.level || process.env.LOG_LEVEL || defaultLevel;
    this.minLevelValue = LOG_LEVELS[this.level.toLowerCase()] || LOG_LEVELS.info;

    this.stream = options.stream || null;
    this.defaultMeta = { ...(options.defaultMeta || {}) };
    this.redact = options.redact;
    this.project = options.project;
  }

  /**
   * Check if a log level is enabled
   * @param {string} level
   * @returns {boolean}
   */
  isLevelEnabled(level) {
    const val = LOG_LEVELS[level.toLowerCase()] || LOG_LEVELS.info;
    return val >= this.minLevelValue;
  }

  /**
   * Create a child logger with inherited configuration and merged metadata
   * @param {Object} additionalMeta
   * @returns {CloudLogger}
   */
  child(additionalMeta = {}) {
    return new CloudLogger({
      ...this.options,
      format: this.format,
      level: this.level,
      stream: this.stream,
      defaultMeta: {
        ...this.defaultMeta,
        ...additionalMeta,
      },
      redact: this.redact,
      project: this.project,
    });
  }

  /**
   * Core logging method
   * @param {string} level
   * @param {string} message
   * @param {Object} [meta]
   */
  log(level, message, meta = {}) {
    const normLevel = level.toLowerCase();
    if (!this.isLevelEnabled(normLevel)) return;

    const entry = {
      level: normLevel,
      message: typeof message === 'string' ? message : (message?.message || String(message)),
      timestamp: new Date().toISOString(),
      ...this.defaultMeta,
      ...meta,
    };

    let formatted = '';
    const formatOpts = {
      project: this.project,
      redact: this.redact,
    };

    switch (this.format) {
      case 'gcp':
        formatted = formatGcp(entry, formatOpts);
        break;
      case 'aws':
        formatted = formatAws(entry, formatOpts);
        break;
      case 'json':
        formatted = formatJson(entry, formatOpts);
        break;
      case 'pretty':
      default:
        formatted = formatPretty(entry);
        break;
    }

    if (this.stream && typeof this.stream.write === 'function') {
      this.stream.write(formatted + '\n');
    } else {
      if (normLevel === 'error' || normLevel === 'fatal') {
        process.stderr.write(formatted + '\n');
      } else {
        process.stdout.write(formatted + '\n');
      }
    }
  }

  debug(message, meta) {
    this.log('debug', message, meta);
  }

  info(message, meta) {
    this.log('info', message, meta);
  }

  warn(message, meta) {
    this.log('warn', message, meta);
  }

  error(message, meta) {
    this.log('error', message, meta);
  }

  fatal(message, meta) {
    this.log('fatal', message, meta);
  }
}

/**
 * Create a new CloudLogger instance
 * @param {Object} [options]
 * @returns {CloudLogger}
 */
function createLogger(options = {}) {
  return new CloudLogger(options);
}

/**
 * Express middleware for automatic request logging and trace context propagation
 * Injects req.logger and logs HTTP request completion with latency, status and trace headers
 *
 * @param {CloudLogger} [logger]
 * @param {Object} [options]
 * @param {string[]} [options.exclude=['/healthz', '/readyz', '/favicon.ico']]
 * @returns {import('express').RequestHandler}
 */
function createLogMiddleware(logger, options = {}) {
  const activeLogger = logger instanceof CloudLogger ? logger : createLogger(options);
  const excludePaths = new Set(options.exclude || ['/healthz', '/readyz', '/favicon.ico']);

  return function cloudLogMiddleware(req, res, next) {
    const traceContext = extractTraceContext(req);

    // Create contextual child logger bound to this request's trace ID
    req.logger = activeLogger.child({
      traceContext,
      requestId: traceContext.traceId,
    });

    const startTime = Date.now();
    const url = req.originalUrl || req.url;

    res.on('finish', () => {
      const pathname = url.split('?')[0];
      if (excludePaths.has(pathname)) return;

      const durationMs = Date.now() - startTime;
      const status = res.statusCode;

      // Classify log level based on HTTP status code
      let level = 'info';
      if (status >= 500) {
        level = 'error';
      } else if (status >= 400) {
        level = 'warn';
      }

      const httpRequest = {
        method: req.method,
        url,
        status,
        latencyMs: durationMs,
        userAgent: req.headers['user-agent'] || '',
        ip: req.ip || req.socket?.remoteAddress || '',
      };

      const logMsg = `${req.method} ${pathname} ${status} (${durationMs}ms)`;

      req.logger.log(level, logMsg, {
        httpRequest,
      });
    });

    next();
  };
}

module.exports = {
  CloudLogger,
  createLogger,
  createLogMiddleware,
  extractTraceContext,
  autoDetectFormat,
  LOG_LEVELS,
};
