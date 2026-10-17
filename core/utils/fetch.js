/**
 * Webspresso Zero-Dependency Fetch Utility
 *
 * Lightweight, production-grade wrapper around native `fetch` with built-in:
 * - Configurable timeout with automatic AbortController
 * - Seamless signal composition (external AbortSignal + timeout AbortSignal)
 * - Timer unreferencing (`timer.unref()`) to prevent hanging Node.js event loop
 * - Semantic error wrapping (ETIMEDOUT / TimeoutError)
 * - JSON convenience helper (`fetchWithTimeout.json`)
 *
 * @module core/utils/fetch
 */

'use strict';

/**
 * Executes a fetch request with timeout and abort controller support.
 *
 * @param {string | URL | Request} url - Target URL or Request instance
 * @param {RequestInit & { timeout?: number }} [options] - Standard RequestInit plus optional timeout (ms)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const { timeout = 10000, signal, ...fetchOptions } = options;

  if (signal && signal.aborted) {
    const reason = (signal.reason !== undefined && signal.reason !== null)
      ? signal.reason
      : new Error('This operation was aborted');
    throw reason;
  }

  if (typeof AbortController === 'undefined') {
    return fetch(url, { ...fetchOptions, signal });
  }

  const controller = new AbortController();
  let timer = null;
  let callerSignalListener = null;

  if (typeof timeout === 'number' && timeout > 0) {
    timer = setTimeout(() => {
      const err = new Error(`Request timed out after ${timeout}ms`);
      err.name = 'TimeoutError';
      err.code = 'ETIMEDOUT';
      controller.abort(err);
    }, timeout);
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  if (signal) {
    callerSignalListener = () => {
      controller.abort(signal.reason);
    };
    signal.addEventListener('abort', callerSignalListener, { once: true });
  }

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason) {
      const reason = controller.signal.reason;
      if (reason instanceof Error && (reason.name === 'TimeoutError' || reason.code === 'ETIMEDOUT')) {
        throw reason;
      }
    }
    if (err && err.name === 'AbortError' && controller.signal.aborted && controller.signal.reason) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (signal && callerSignalListener) {
      signal.removeEventListener('abort', callerSignalListener);
    }
  }
}

/**
 * Fetch with timeout and automatically parse JSON response.
 *
 * @param {string | URL | Request} url
 * @param {RequestInit & { timeout?: number }} [options]
 * @returns {Promise<{ res: Response, data: any }>}
 */
fetchWithTimeout.json = async function fetchJson(url, options = {}) {
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  let data = null;
  const contentType = (res.headers && typeof res.headers.get === 'function')
    ? (res.headers.get('content-type') || '')
    : '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { res, data };
};

module.exports = {
  fetchWithTimeout,
};
