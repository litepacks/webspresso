/**
 * Standard Async & Polling Test Utilities
 * Provides timing, polling, assertion retry, and deferred promise helpers for asynchronous tests.
 * @module tests/utils/async
 */

/**
 * Pauses execution for a specified duration in milliseconds.
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function wait(ms = 0) {
  const duration = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/**
 * Alias for wait(ms)
 */
const sleep = wait;

/**
 * Creates a deferred promise with exposed resolve and reject handles.
 *
 * @template T
 * @returns {{ promise: Promise<T>, resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void }}
 */
function deferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Alias for deferredPromise()
 */
const createDeferred = deferredPromise;

/**
 * Repeatedly polls a predicate function until it returns a truthy value or times out.
 *
 * @template T
 * @param {() => Promise<T>|T} predicate - Condition check function
 * @param {Object} [options={}] - Polling options
 * @param {number} [options.timeout=2000] - Total timeout in milliseconds
 * @param {number} [options.interval=20] - Polling interval in milliseconds
 * @param {string} [options.message] - Custom error message on timeout
 * @returns {Promise<T>} Truthy value returned by predicate
 */
async function waitForCondition(predicate, options = {}) {
  const timeout = options.timeout ?? 2000;
  const interval = options.interval ?? 20;
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeout) {
    try {
      const result = await predicate();
      if (result) {
        return result;
      }
    } catch (err) {
      lastError = err;
    }
    await wait(interval);
  }

  const defaultMsg = lastError
    ? `waitForCondition timed out after ${timeout}ms: ${lastError.message}`
    : `waitForCondition timed out after ${timeout}ms`;
  const error = new Error(options.message || defaultMsg);
  if (lastError) {
    error.cause = lastError;
  }
  throw error;
}

/**
 * Repeatedly executes an assertion block until it succeeds without throwing, or times out.
 * Useful for asserting on asynchronous state changes (e.g. queue jobs, event emissions).
 *
 * @template T
 * @param {() => Promise<T>|T} assertionFn - Callback containing test assertions
 * @param {Object} [options={}] - Retry options
 * @param {number} [options.timeout=2000] - Total timeout in milliseconds
 * @param {number} [options.interval=20] - Retry interval in milliseconds
 * @param {string} [options.message] - Custom error message on timeout
 * @returns {Promise<T>} Result of assertionFn
 */
async function waitFor(assertionFn, options = {}) {
  const timeout = options.timeout ?? 2000;
  const interval = options.interval ?? 20;
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeout) {
    try {
      return await assertionFn();
    } catch (err) {
      lastError = err;
    }
    await wait(interval);
  }

  if (lastError && !options.message) {
    throw lastError;
  }

  const message = options.message || `waitFor timed out after ${timeout}ms`;
  const error = new Error(message);
  if (lastError) {
    error.cause = lastError;
  }
  throw error;
}

/**
 * Wraps a promise with a timeout deadline.
 *
 * @template T
 * @param {Promise<T>} promise - Promise to wait for
 * @param {number} [ms=2000] - Timeout duration in milliseconds
 * @param {string} [message='Operation timed out'] - Timeout error message
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms = 2000, message = 'Operation timed out') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

module.exports = {
  wait,
  sleep,
  deferredPromise,
  createDeferred,
  waitForCondition,
  waitFor,
  withTimeout,
};
