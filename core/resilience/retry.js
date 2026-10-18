'use strict';

/**
 * Webspresso - Zero-Dependency Retry Engine
 * Exponential backoff with jitter and transient error detection to prevent thundering herd spikes.
 * @module core/resilience/retry
 */

const { parseDurationMs } = require('../utils/time');

/**
 * Standard transient network error codes that benefit from retries
 */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
]);

/**
 * Default predicate determining if an error is transient and safe to retry
 *
 * @param {Error} error
 * @returns {boolean}
 */
function isTransientError(error) {
  if (!error) return false;

  // 1. Check network error code
  if (error.code && TRANSIENT_NETWORK_CODES.has(error.code)) {
    return true;
  }

  // 2. Check HTTP status code (if available)
  const status = error.status || error.statusCode || error.response?.status;
  if (typeof status === 'number') {
    // 429 Too Many Requests, 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout
    if (status === 429 || status === 502 || status === 503 || status === 504) {
      return true;
    }
    // Standard 4xx client errors (400, 401, 403, 404, 422) will not succeed on retry
    if (status >= 400 && status < 500) {
      return false;
    }
    // Internal server errors 500
    if (status >= 500) {
      return true;
    }
  }

  // 3. Fallback: Check common error message keywords
  const message = error.message || '';
  if (/timeout|connection reset|temporarily unavailable|network error/i.test(message)) {
    return true;
  }

  return true;
}

/**
 * Calculate exponential backoff delay with optional random jitter
 *
 * @param {number} attempt - Current retry attempt (1-based)
 * @param {number} minTimeoutMs - Initial delay in ms
 * @param {number} maxTimeoutMs - Maximum delay cap in ms
 * @param {number} factor - Backoff factor (e.g. 2)
 * @param {boolean} jitter - Whether to apply full jitter
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attempt, minTimeoutMs, maxTimeoutMs, factor, jitter) {
  const exponential = minTimeoutMs * Math.pow(factor, attempt - 1);
  const capped = Math.min(maxTimeoutMs, exponential);

  if (!jitter) {
    return Math.floor(capped);
  }

  // Full jitter: uniformly distributed between 0 and capped delay
  return Math.floor(Math.random() * capped);
}

/**
 * Sleep helper respecting AbortSignal
 * @private
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason || new Error('Aborted'));
    }

    let timer = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(signal.reason || new Error('Aborted'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    if (typeof timer?.unref === 'function') {
      timer.unref();
    }
  });
}

/**
 * @typedef {Object} RetryOptions
 * @property {number} [retries=3] - Maximum retry attempts (0 = no retry)
 * @property {number|string} [delay=100] - Initial delay in ms or duration string
 * @property {number|string} [minTimeout=100] - Alias for delay
 * @property {number|string} [maxTimeout=10000] - Max backoff delay cap in ms or duration string
 * @property {number} [factor=2] - Exponential multiplier
 * @property {boolean} [jitter=true] - Whether to apply random jitter
 * @property {function(Error, number): boolean} [shouldRetry] - Error classifier predicate
 * @property {function({ attempt: number, error: Error, delayMs: number }): void} [onRetry] - Notification callback
 * @property {AbortSignal} [signal] - Optional abort signal
 */

/**
 * Execute an async operation with automatic exponential backoff retries.
 *
 * @param {function(number): Promise<*>} asyncFn - Async function to execute (receives attempt index)
 * @param {RetryOptions} [options]
 * @returns {Promise<*>}
 */
async function retry(asyncFn, options = {}) {
  const maxRetries = typeof options.retries === 'number' ? Math.max(0, options.retries) : 3;
  
  const minTimeoutMs = options.delay !== undefined
    ? parseDurationMs(options.delay, 100)
    : (options.minTimeout !== undefined ? parseDurationMs(options.minTimeout, 100) : 100);

  const maxTimeoutMs = options.maxTimeout !== undefined
    ? parseDurationMs(options.maxTimeout, 10000)
    : 10000;

  const factor = typeof options.factor === 'number' && options.factor >= 1 ? options.factor : 2;
  const jitter = options.jitter !== false;
  const shouldRetry = typeof options.shouldRetry === 'function' ? options.shouldRetry : isTransientError;
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;
  const signal = options.signal || null;

  let attempt = 0;

  while (true) {
    attempt++;
    if (signal?.aborted) {
      throw signal.reason || new Error('Aborted');
    }

    try {
      return await asyncFn(attempt);
    } catch (err) {
      const isLastAttempt = attempt > maxRetries;
      const canRetry = shouldRetry(err, attempt);

      if (isLastAttempt || !canRetry || signal?.aborted) {
        throw err;
      }

      const delayMs = calculateBackoffDelay(attempt, minTimeoutMs, maxTimeoutMs, factor, jitter);

      if (onRetry) {
        try {
          onRetry({ attempt, error: err, delayMs });
        } catch {
          // Callback must never break retry loop
        }
      }

      await sleep(delayMs, signal);
    }
  }
}

/**
 * Wrap an async function with retry behavior
 *
 * @param {Function} asyncFn
 * @param {RetryOptions} [options]
 * @returns {Function}
 */
function withRetry(asyncFn, options = {}) {
  return (...args) => retry((attempt) => asyncFn(...args), options);
}

module.exports = {
  retry,
  withRetry,
  isTransientError,
  calculateBackoffDelay,
};
