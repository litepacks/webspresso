'use strict';

/**
 * Webspresso - Zero-Dependency Centralized Timeout Engine & Middleware
 *
 * Provides:
 * - Centralized global timeouts configuration hierarchy (`normalizeTimeouts`, `DEFAULT_TIMEOUTS`)
 * - Universal async wrapper with timer unref and AbortSignal support (`withTimeout`)
 * - Native, zero-dependency drop-in replacement for connect-timeout (`createTimeoutMiddleware`)
 * - Semantic `TimeoutError`
 *
 * @module core/utils/timeout
 */

const { parseDurationMs } = require('./time');
const { WebspressoError } = require('../errors/base');

/**
 * Default framework timeout thresholds (in milliseconds)
 */
const DEFAULT_TIMEOUTS = Object.freeze({
  request: 30_000,   // HTTP request processing timeout (30s)
  service: 15_000,   // Services layer execution timeout (15s)
  queue: 30_000,     // Background job queue worker timeout (30s)
  fetch: 10_000,     // Outgoing external fetchWithTimeout (10s)
  webhook: 10_000,   // Outgoing webhook dispatch timeout (10s)
  shutdown: 10_000,  // Graceful shutdown server draining timeout (10s)
  loader: 10_000,    // SSR page data loader load() execution timeout (10s)
});

/**
 * Normalizes application timeout settings from createApp options into a single,
 * cohesive configuration object with sensible defaults and backward compatibility.
 *
 * @param {Object} [options={}] - Options passed to createApp() or framework components
 * @returns {Readonly<{
 *   request: number | false,
 *   service: number | false,
 *   queue: number | false,
 *   fetch: number | false,
 *   webhook: number | false,
 *   shutdown: number | false,
 *   loader: number | false,
 * }>}
 */
function normalizeTimeouts(options = {}) {
  const rootTimeouts = (options && typeof options.timeouts === 'object' && options.timeouts !== null)
    ? options.timeouts
    : {};

  function parseVal(val, defaultVal) {
    if (val === false || val === 'false' || val === 0 || val === '0') {
      return false;
    }
    if (val === null || val === undefined) {
      return defaultVal;
    }
    return parseDurationMs(val, defaultVal);
  }

  // Request timeout: timeouts.request -> options.timeout -> options.server.timeout -> default (30s)
  const requestRaw = rootTimeouts.request !== undefined
    ? rootTimeouts.request
    : (options.timeout !== undefined
      ? options.timeout
      : (options.server?.timeout !== undefined ? options.server.timeout : DEFAULT_TIMEOUTS.request));

  // Service timeout: timeouts.service -> options.services.timeout -> options.serviceTimeout -> default (15s)
  const serviceRaw = rootTimeouts.service !== undefined
    ? rootTimeouts.service
    : (options.services?.timeout !== undefined
      ? options.services.timeout
      : (options.serviceTimeout !== undefined ? options.serviceTimeout : DEFAULT_TIMEOUTS.service));

  // Queue timeout: timeouts.queue -> options.queue.timeout -> options.queueTimeout -> default (30s)
  const queueRaw = rootTimeouts.queue !== undefined
    ? rootTimeouts.queue
    : (options.queue?.timeout !== undefined
      ? options.queue.timeout
      : (options.queueTimeout !== undefined ? options.queueTimeout : DEFAULT_TIMEOUTS.queue));

  // Fetch timeout: timeouts.fetch -> options.fetch.timeout -> options.fetchTimeout -> default (10s)
  const fetchRaw = rootTimeouts.fetch !== undefined
    ? rootTimeouts.fetch
    : (options.fetch?.timeout !== undefined
      ? options.fetch.timeout
      : (options.fetchTimeout !== undefined ? options.fetchTimeout : DEFAULT_TIMEOUTS.fetch));

  // Webhook timeout: timeouts.webhook -> options.webhooks.timeout -> options.webhookTimeout -> default (10s)
  const webhookRaw = rootTimeouts.webhook !== undefined
    ? rootTimeouts.webhook
    : (options.webhooks?.timeout !== undefined
      ? options.webhooks.timeout
      : (options.webhookTimeout !== undefined ? options.webhookTimeout : DEFAULT_TIMEOUTS.webhook));

  // Shutdown timeout: timeouts.shutdown -> options.shutdown.timeout -> options.server.shutdown.timeout -> default (10s)
  const shutdownRaw = rootTimeouts.shutdown !== undefined
    ? rootTimeouts.shutdown
    : (options.shutdown?.timeout !== undefined
      ? options.shutdown.timeout
      : (options.server?.shutdown?.timeout !== undefined ? options.server.shutdown.timeout : DEFAULT_TIMEOUTS.shutdown));

  // Page loader timeout: timeouts.loader -> options.loader.timeout -> options.loaderTimeout -> default (10s)
  const loaderRaw = rootTimeouts.loader !== undefined
    ? rootTimeouts.loader
    : (options.loader?.timeout !== undefined
      ? options.loader.timeout
      : (options.loaderTimeout !== undefined ? options.loaderTimeout : DEFAULT_TIMEOUTS.loader));

  return Object.freeze({
    request: parseVal(requestRaw, DEFAULT_TIMEOUTS.request),
    service: parseVal(serviceRaw, DEFAULT_TIMEOUTS.service),
    queue: parseVal(queueRaw, DEFAULT_TIMEOUTS.queue),
    fetch: parseVal(fetchRaw, DEFAULT_TIMEOUTS.fetch),
    webhook: parseVal(webhookRaw, DEFAULT_TIMEOUTS.webhook),
    shutdown: parseVal(shutdownRaw, DEFAULT_TIMEOUTS.shutdown),
    loader: parseVal(loaderRaw, DEFAULT_TIMEOUTS.loader),
  });
}

/**
 * Standard framework Timeout Error
 */
class TimeoutError extends WebspressoError {
  /**
   * @param {string} [message='Operation timed out']
   * @param {Object} [options]
   * @param {number} [options.timeout]
   * @param {string} [options.code='ETIMEDOUT']
   * @param {number} [options.status=504]
   * @param {number} [options.statusCode=504]
   * @param {string} [options.scope='timeout']
   */
  constructor(message = 'Operation timed out', options = {}) {
    super(message, { code: options.code || 'ETIMEDOUT', ...options });
    this.name = 'TimeoutError';
    this.status = typeof options.status === 'number' ? options.status : (options.statusCode || 504);
    this.statusCode = this.status;
    this.timeout = options.timeout !== undefined ? options.timeout : null;
    this.scope = options.scope || 'timeout';
  }
}

/**
 * Universal async execution wrapper with timeout, timer unreferencing,
 * and AbortController / AbortSignal cancellation support.
 *
 * @template T
 * @param {Promise<T> | ((signal?: AbortSignal) => Promise<T> | T)} promiseOrFn
 * @param {number | string | boolean} timeout - Timeout duration (ms number, '5s', or false)
 * @param {Object} [options={}]
 * @param {AbortController} [options.controller] - Optional AbortController to abort on timeout
 * @param {AbortSignal} [options.signal] - Optional external AbortSignal to monitor
 * @param {string} [options.errorMessage] - Custom error message
 * @param {string} [options.errorCode='ETIMEDOUT'] - Custom error code
 * @param {number} [options.statusCode=504] - HTTP status code
 * @param {string} [options.scope='timeout'] - Scope identifier ('service', 'queue', 'fetch', etc.)
 * @param {boolean} [options.unref=true] - Whether to unref the timer
 * @param {((timeoutMs: number) => Error)} [options.createError] - Custom error factory
 * @returns {Promise<T>}
 */
async function withTimeout(promiseOrFn, timeout, options = {}) {
  const timeoutMs = (timeout === false || timeout === 0 || timeout === null || timeout === undefined)
    ? 0
    : parseDurationMs(timeout, 0);

  // If timeout is disabled or <= 0, run directly
  if (timeoutMs <= 0) {
    if (typeof promiseOrFn === 'function') {
      return await promiseOrFn(options.controller?.signal || options.signal);
    }
    return await promiseOrFn;
  }

  // If external signal is already aborted, reject immediately
  if (options.signal && options.signal.aborted) {
    const reason = options.signal.reason || new Error('This operation was aborted');
    throw reason;
  }

  let timer = null;
  let callerSignalListener = null;

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timer = null;
        let err;
        if (typeof options.createError === 'function') {
          err = options.createError(timeoutMs);
        } else {
          const msg = options.errorMessage || `Operation timed out after ${timeoutMs}ms`;
          err = new TimeoutError(msg, {
            timeout: timeoutMs,
            code: options.errorCode || 'ETIMEDOUT',
            statusCode: options.statusCode || 504,
            scope: options.scope || 'timeout',
          });
        }

        if (options.controller && typeof options.controller.abort === 'function') {
          try {
            options.controller.abort(err);
          } catch (_) {}
        }

        reject(err);
      }, timeoutMs);

      if (options.unref !== false && timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    const executionSignal = options.controller ? options.controller.signal : options.signal;
    const executionPromise = typeof promiseOrFn === 'function'
      ? promiseOrFn(executionSignal)
      : promiseOrFn;

    if (options.signal) {
      const abortPromise = new Promise((_, reject) => {
        callerSignalListener = () => {
          const reason = options.signal.reason || new Error('This operation was aborted');
          reject(reason);
        };
        options.signal.addEventListener('abort', callerSignalListener, { once: true });
      });

      return await Promise.race([executionPromise, timeoutPromise, abortPromise]);
    }

    return await Promise.race([executionPromise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (options.signal && callerSignalListener) {
      options.signal.removeEventListener('abort', callerSignalListener);
    }
  }
}

/**
 * Creates an Express request timeout middleware.
 * Zero-dependency replacement for connect-timeout with native AbortController,
 * timer unreferencing, and automatic request cleanup.
 *
 * @param {string | number | boolean} timeoutConfig - Timeout duration (e.g. '30s', 30000, or false)
 * @param {Object} [options={}]
 * @param {boolean} [options.respond=true] - Whether to pass 503 error to next() when timed out
 * @returns {Function} Express middleware (req, res, next)
 */
function createTimeoutMiddleware(timeoutConfig, options = {}) {
  if (timeoutConfig === false || timeoutConfig === 'false' || timeoutConfig === 0) {
    return function disabledTimeoutMiddleware(req, res, next) {
      req.timedout = false;
      req.clearTimeout = () => {};
      next();
    };
  }

  const timeoutMs = parseDurationMs(timeoutConfig, DEFAULT_TIMEOUTS.request);
  if (timeoutMs <= 0) {
    return function zeroTimeoutMiddleware(req, res, next) {
      req.timedout = false;
      req.clearTimeout = () => {};
      next();
    };
  }

  return function requestTimeoutMiddleware(req, res, next) {
    req.timedout = false;

    // Attach native AbortController and AbortSignal to req
    let controller = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      req.abortController = controller;
      req.signal = controller.signal;
    }

    let timer = setTimeout(() => {
      timer = null;
      req.timedout = true;

      const err = new Error(`Response timeout after ${timeoutMs}ms`);
      err.timeout = timeoutMs;
      err.status = 503;
      err.statusCode = 503;
      err.code = 'ETIMEDOUT';

      if (controller) {
        try {
          controller.abort(err);
        } catch (_) {}
      }

      try {
        req.emit('timeout', timeoutMs);
      } catch (_) {}

      if (!res.headersSent && !res.writableEnded) {
        if (options.respond !== false) {
          next(err);
        }
      }
    }, timeoutMs);

    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }

    req.clearTimeout = function clearTimeoutHandler() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    res.once('finish', cleanup);
    res.once('close', () => {
      cleanup();
      if (!res.writableEnded && !req.timedout && controller) {
        try {
          controller.abort(new Error('Client connection closed'));
        } catch (_) {}
      }
    });

    next();
  };
}

module.exports = {
  DEFAULT_TIMEOUTS,
  normalizeTimeouts,
  TimeoutError,
  withTimeout,
  createTimeoutMiddleware,
};
