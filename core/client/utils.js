'use strict';

/**
 * Webspresso Client Shared Micro-utilities (`core/client/utils.js`)
 * Zero-dependency, lightweight helpers to avoid duplicate logic across client modules.
 */

/**
 * Check if a value is an Array.
 * @param {unknown} val
 * @returns {val is any[]}
 */
const isArray = Array.isArray;

/**
 * Check if a value is a finite number (`typeof val === 'number' && Number.isFinite(val)`).
 * @param {unknown} val
 * @returns {val is number}
 */
function isNumber(val) {
  return typeof val === 'number' && Number.isFinite(val);
}

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
  return isObject(val) && !isArray(val) && Object.prototype.toString.call(val) === '[object Object]';
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
    if (isNumber(num)) {
      if (/^-?(?:0|[1-9]\d*)$/.test(val) && !Number.isSafeInteger(num)) {
        return val;
      }
      return num;
    }
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

/**
 * Parse a duration value (number in ms, numeric string, or human duration string like '500ms', '10s', '2m', '1h')
 * into milliseconds. Returns `defaultMs` (0) when false/null/undefined/invalid.
 *
 * @param {unknown} val
 * @param {number} [defaultMs=0]
 * @returns {number}
 */
function parseDurationMs(val, defaultMs = 0) {
  if (val === false || val === null || val === undefined || val === '' || val === 'false') {
    return 0;
  }
  if (isNumber(val)) {
    return val > 0 ? Math.floor(val) : 0;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim().toLowerCase();
    if (!trimmed || trimmed === 'false' || trimmed === '0') return 0;
    const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(trimmed);
    if (!match) return defaultMs;
    const num = parseFloat(match[1]);
    if (!isNumber(num) || num <= 0) return 0;
    const unit = match[2] || 'ms';
    if (unit === 's') return Math.floor(num * 1000);
    if (unit === 'm') return Math.floor(num * 60 * 1000);
    if (unit === 'h') return Math.floor(num * 60 * 60 * 1000);
    return Math.floor(num);
  }
  return defaultMs;
}

/**
 * Normalize a React Query-style refetch policy (`true`, `false`, `'always'`, `'true'`, `'false'`).
 *
 * @param {unknown} val
 * @param {boolean|'always'} [defaultMode=false]
 * @returns {boolean|'always'}
 */
function parseRefetchMode(val, defaultMode = false) {
  if (val === undefined || val === null || val === '') {
    return defaultMode;
  }
  if (val === 'always') return 'always';
  if (val === true || val === 'true' || val === '1') return true;
  if (val === false || val === 'false' || val === '0') return false;
  return Boolean(val);
}

/**
 * Generate a short base-36 random token (`Math.random().toString(36).slice(2, 2 + len)`).
 *
 * @param {number} [len=5]
 * @returns {string}
 */
function randomId(len = 5) {
  return Math.random().toString(36).slice(2, 2 + len);
}

/**
 * Generate a timestamped unique ID with an optional prefix (e.g. `uid('evt')` -> `'evt_1730000000_a1b2c'`).
 *
 * @param {string} [prefix='id']
 * @param {number} [len=5]
 * @returns {string}
 */
function uid(prefix = 'id', len = 5) {
  return `${prefix}_${Date.now()}_${randomId(len)}`;
}

/**
 * Apply or restore automatic busy/loading state (`data-w-busy`, `aria-busy`, `disabled`,
 * `data-w-loading-text` / `data-w-disable-with`, and `data-w-loading-class`) on an interactive element.
 *
 * @param {Element|null|undefined} el
 * @param {boolean} isBusy
 */
function setElementBusyState(el, isBusy) {
  if (!el || typeof el.setAttribute !== 'function') return;

  if (isBusy) {
    el.__wBusyCount = (el.__wBusyCount || 0) + 1;
    if (el.__wBusyCount > 1) return;

    el.__wActionBusy = true;
    el.setAttribute('data-w-busy', 'true');
    el.setAttribute('aria-busy', 'true');

    const tag = el.tagName || '';
    const isInteractive =
      tag === 'BUTTON' ||
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA' ||
      'disabled' in el ||
      el.hasAttribute('data-w-loading-text') ||
      el.hasAttribute('data-w-disable-with');

    if (isInteractive && !el.hasAttribute('data-w-disabled') && !el.hasAttribute('data-w-no-disable')) {
      el.__wWasDisabled = Boolean(el.disabled);
      el.__wHadDisabledAttr = el.hasAttribute('disabled');
      el.disabled = true;
      el.setAttribute('disabled', '');
      el.setAttribute('aria-disabled', 'true');
    }

    const loadingText = el.getAttribute('data-w-loading-text') ?? el.getAttribute('data-w-disable-with');
    if (loadingText !== null) {
      if (tag === 'INPUT' && (el.type === 'submit' || el.type === 'button')) {
        el.__wOrigValue = el.value;
        el.value = loadingText;
      } else {
        el.__wOrigText = el.textContent;
        el.textContent = loadingText;
      }
    }

    const loadingClass = safeTrim(el.getAttribute('data-w-loading-class'));
    if (loadingClass && el.classList) {
      const classes = loadingClass.split(/\s+/).filter(Boolean);
      el.__wAddedClasses = classes;
      for (let i = 0; i < classes.length; i++) {
        el.classList.add(classes[i]);
      }
    }
  } else {
    if (!el.__wBusyCount) return;
    el.__wBusyCount -= 1;
    if (el.__wBusyCount > 0) return;

    el.__wActionBusy = false;
    el.removeAttribute('data-w-busy');
    el.removeAttribute('aria-busy');

    if (!el.hasAttribute('data-w-disabled') && !el.hasAttribute('data-w-no-disable')) {
      if (!el.__wWasDisabled) {
        el.disabled = false;
        if (!el.__wHadDisabledAttr) {
          el.removeAttribute('disabled');
        }
        el.removeAttribute('aria-disabled');
      }
      delete el.__wWasDisabled;
      delete el.__wHadDisabledAttr;
    }

    if (el.__wOrigValue !== undefined) {
      el.value = el.__wOrigValue;
      delete el.__wOrigValue;
    }
    if (el.__wOrigText !== undefined) {
      el.textContent = el.__wOrigText;
      delete el.__wOrigText;
    }

    if (el.__wAddedClasses && el.classList) {
      for (let i = 0; i < el.__wAddedClasses.length; i++) {
        el.classList.remove(el.__wAddedClasses[i]);
      }
      delete el.__wAddedClasses;
    }
  }
}

module.exports = {
  isArray,
  isNumber,
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
  parseDurationMs,
  parseRefetchMode,
  randomId,
  uid,
  setElementBusyState,
};

