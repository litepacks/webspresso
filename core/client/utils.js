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

/**
 * Convert kebab-case or mixed string to camelCase (e.g. "todo-id" -> "todoId").
 * @param {string} str
 * @returns {string}
 */
function toCamelCase(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/-([a-z0-9])/gi, (_, char) => char.toUpperCase());
}

/**
 * Convert camelCase to kebab-case (e.g. "todoId" -> "todo-id").
 * @param {string} str
 * @returns {string}
 */
function toKebabCase(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-+/, '');
}

/**
 * Parse string representation of data-* attributes into typed primitives.
 * Mirrors jQuery / standard data coercion without unintended leading-zero mutation.
 * @param {unknown} val
 * @returns {unknown}
 */
function parseDataValue(val) {
  if (typeof val !== 'string') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null') return null;
  if (val === 'undefined') return undefined;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(val)) {
    const num = Number(val);
    if (!Number.isNaN(num)) return num;
  }
  if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
    try {
      return JSON.parse(val);
    } catch (_e) {
      return val;
    }
  }
  return val;
}

/**
 * Decorate an HTMLElement with a chainable `.data(key?, val?)` helper.
 *
 * Usage:
 * - `el.data('priority')` -> reads dataset / data-priority (coerces numbers, booleans, JSON)
 * - `el.data('priority', 'high')` -> sets data-priority="high" and returns `el`
 * - `el.data({ priority: 'high', count: 1 })` -> sets multiple data attributes and returns `el`
 * - `el.data()` -> returns object with all parsed data attributes
 *
 * @template {Element} T
 * @param {T} el
 * @returns {T}
 */
function decorateElement(el) {
  if (!el || typeof el !== 'object') return el;
  if (typeof el.data === 'function') return el;

  try {
    Object.defineProperty(el, 'data', {
      value: function data(key, val) {
        if (arguments.length === 0) {
          const result = {};
          if (el.dataset) {
            for (const [k, v] of Object.entries(el.dataset)) {
              result[k] = parseDataValue(v);
            }
          }
          return result;
        }

        if (typeof key === 'object' && key !== null) {
          for (const [k, v] of Object.entries(key)) {
            el.data(k, v);
          }
          return el;
        }

        const strKey = String(key);
        const camelKey = toCamelCase(strKey);
        const kebabKey = toKebabCase(strKey);

        if (arguments.length >= 2) {
          if (val === null || val === undefined) {
            if (el.dataset) delete el.dataset[camelKey];
            if (typeof el.removeAttribute === 'function') {
              el.removeAttribute(`data-${kebabKey}`);
              el.removeAttribute(strKey);
            }
          } else {
            const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
            if (el.dataset) el.dataset[camelKey] = strVal;
            if (typeof el.setAttribute === 'function') {
              el.setAttribute(`data-${kebabKey}`, strVal);
            }
          }
          return el;
        }

        let raw = null;
        if (el.dataset && el.dataset[camelKey] !== undefined) {
          raw = el.dataset[camelKey];
        } else if (typeof el.getAttribute === 'function') {
          raw = el.getAttribute(`data-${kebabKey}`);
          if (raw === null || raw === undefined) {
            raw = el.getAttribute(strKey);
          }
        }

        if (raw === null || raw === undefined) {
          return null;
        }
        return parseDataValue(raw);
      },
      configurable: true,
      writable: true,
      enumerable: false,
    });
  } catch (_e) {
    // Ignore in case object is non-extensible
  }

  return el;
}

module.exports = {
  isObject,
  isPlainObject,
  isPromise,
  safeTrim,
  getByPath,
  setByPath,
  NOOP_DEBUGGER,
  toCamelCase,
  toKebabCase,
  parseDataValue,
  decorateElement,
};

