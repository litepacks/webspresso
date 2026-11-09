'use strict';

/**
 * Webspresso Client Shared Micro-utilities (`core/client/utils.js`)
 * Zero-dependency, lightweight helpers to avoid duplicate logic across client modules.
 */

/**
 * Check if a value is a non-null object.
 * @param {unknown} val
 * @returns {val is Record<string, unknown>}
 */
function isObject(val) {
  return val !== null && typeof val === 'object';
}

/**
 * Check if a value is a plain JavaScript object (not an Array, Map, FormData, etc.).
 * @param {unknown} val
 * @returns {boolean}
 */
function isPlainObject(val) {
  return isObject(val) && !Array.isArray(val) && Object.prototype.toString.call(val) === '[object Object]';
}

/**
 * Check if a value is thenable (Promise-like).
 * @param {unknown} val
 * @returns {boolean}
 */
function isPromise(val) {
  return val !== null && (typeof val === 'object' || typeof val === 'function') && typeof val.then === 'function';
}

/**
 * Safe string trim helper.
 * @param {unknown} str
 * @returns {string}
 */
function safeTrim(str) {
  return typeof str === 'string' ? str.trim() : '';
}

/**
 * Resolve a dot-separated property path on an object (e.g. "user.profile.name" or "items.length").
 * Protects against prototype pollution (`__proto__`, `prototype`, `constructor`).
 *
 * @param {object} target
 * @param {string} rawPath
 * @returns {unknown}
 */
function getByPath(target, rawPath) {
  if (!target || typeof rawPath !== 'string') return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split('.');
  let current = target;
  for (let i = 0; i < parts.length; i++) {
    if (current === null || current === undefined) return undefined;
    const key = parts[i].trim();
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/**
 * Set a dot-separated property path on an object (e.g. "filter.search").
 * Protects against prototype pollution (`__proto__`, `prototype`, `constructor`).
 *
 * @param {object} target
 * @param {string} rawPath
 * @param {unknown} value
 */
function setByPath(target, rawPath, value) {
  if (!target || typeof rawPath !== 'string') return;
  const trimmed = rawPath.trim();
  if (!trimmed) return;
  const parts = trimmed.split('.');
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i].trim();
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
    if (current[key] === null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  const lastKey = parts[parts.length - 1].trim();
  if (lastKey === '__proto__' || lastKey === 'prototype' || lastKey === 'constructor') return;
  current[lastKey] = value;
}

/**
 * Reusable zero-allocation no-op debugger for production and disabled-by-default states.
 */
const NOOP_DEBUGGER = Object.freeze({
  enabled: false,
  setEnabled() {},
  trackControllerMount() {},
  trackControllerUnmount() {},
  trackCleanupError() {},
  trackRequestStart() {
    return { requestId: '', status: 'in-flight' };
  },
  trackRequestEnd() {
    return { status: 'completed' };
  },
  trackDiscardedResponse() {
    return { reason: 'stale' };
  },
  startCausalChain() {
    return '';
  },
  recordChainRefresh() {},
  recordChainPatch() {},
  recordEvent() {},
  getSnapshot() {
    return {
      enabled: false,
      activeControllers: [],
      activeRequests: [],
      causalChains: [],
      fragmentTimings: [],
      discardedResponses: [],
      cleanupErrors: [],
      events: [],
    };
  },
  clear() {},
});

module.exports = {
  isObject,
  isPlainObject,
  isPromise,
  safeTrim,
  getByPath,
  setByPath,
  NOOP_DEBUGGER,
};

