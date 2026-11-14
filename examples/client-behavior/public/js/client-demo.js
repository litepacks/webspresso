(function() {
  var modules = {
    "./utils": function(module, exports, require) {
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
 * Parse a delay/duration attribute such as `"200"`, `"200ms"`, or `"1s"` into milliseconds.
 *
 * @param {string|number|null|undefined} raw
 * @param {number} [fallback=0]
 * @returns {number}
 */
function parseDelayMs(raw, fallback = 0) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  const s = String(raw).trim().toLowerCase();
  if (!s) return fallback;
  const msMatch = s.match(/^(\d+(?:\.\d+)?)\s*ms$/);
  if (msMatch) return Math.max(0, Math.round(Number(msMatch[1])));
  const sMatch = s.match(/^(\d+(?:\.\d+)?)\s*s$/);
  if (sMatch) return Math.max(0, Math.round(Number(sMatch[1]) * 1000));
  const num = Number(s);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : fallback;
}

/**
 * Apply or restore automatic busy/loading state (`data-w-busy`, `aria-busy`, `disabled`,
 * `data-w-loading-text` / `data-w-disable-with`, and `data-w-loading-class`) on an interactive element.
 * Respects `data-w-loading-delay` for visual indicators (`loading-text`, `loading-class`) while
 * applying `data-w-busy`, `aria-busy`, and `disabled` double-submit protection immediately.
 *
 * @param {Element|null|undefined} el
 * @param {boolean} isBusy
 */
function setElementBusyState(el, isBusy) {
  if (!el || typeof el.setAttribute !== 'function') return;

  const applyVisualBusy = () => {
    const tag = el.tagName || '';
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
  };

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

    const delayMs = parseDelayMs(el.getAttribute('data-w-loading-delay'), 0);
    el.__wBusyGen = (el.__wBusyGen || 0) + 1;
    if (el.__wBusyTimer) {
      clearTimeout(el.__wBusyTimer);
      el.__wBusyTimer = null;
    }

    if (delayMs > 0) {
      const gen = el.__wBusyGen;
      el.__wBusyTimer = setTimeout(() => {
        el.__wBusyTimer = null;
        if (el.__wBusyGen !== gen || !el.__wActionBusy || el.isConnected === false) return;
        applyVisualBusy();
      }, delayMs);
    } else {
      applyVisualBusy();
    }
  } else {
    if (!el.__wBusyCount) return;
    el.__wBusyCount -= 1;
    if (el.__wBusyCount > 0) return;

    el.__wActionBusy = false;
    el.__wBusyGen = (el.__wBusyGen || 0) + 1;
    if (el.__wBusyTimer) {
      clearTimeout(el.__wBusyTimer);
      el.__wBusyTimer = null;
    }

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
  parseDelayMs,
  parseRefetchMode,
  randomId,
  uid,
  setElementBusyState,
};


},
    "../utils": function(module, exports, require) {
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
 * Parse a delay/duration attribute such as `"200"`, `"200ms"`, or `"1s"` into milliseconds.
 *
 * @param {string|number|null|undefined} raw
 * @param {number} [fallback=0]
 * @returns {number}
 */
function parseDelayMs(raw, fallback = 0) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  const s = String(raw).trim().toLowerCase();
  if (!s) return fallback;
  const msMatch = s.match(/^(\d+(?:\.\d+)?)\s*ms$/);
  if (msMatch) return Math.max(0, Math.round(Number(msMatch[1])));
  const sMatch = s.match(/^(\d+(?:\.\d+)?)\s*s$/);
  if (sMatch) return Math.max(0, Math.round(Number(sMatch[1]) * 1000));
  const num = Number(s);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : fallback;
}

/**
 * Apply or restore automatic busy/loading state (`data-w-busy`, `aria-busy`, `disabled`,
 * `data-w-loading-text` / `data-w-disable-with`, and `data-w-loading-class`) on an interactive element.
 * Respects `data-w-loading-delay` for visual indicators (`loading-text`, `loading-class`) while
 * applying `data-w-busy`, `aria-busy`, and `disabled` double-submit protection immediately.
 *
 * @param {Element|null|undefined} el
 * @param {boolean} isBusy
 */
function setElementBusyState(el, isBusy) {
  if (!el || typeof el.setAttribute !== 'function') return;

  const applyVisualBusy = () => {
    const tag = el.tagName || '';
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
  };

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

    const delayMs = parseDelayMs(el.getAttribute('data-w-loading-delay'), 0);
    el.__wBusyGen = (el.__wBusyGen || 0) + 1;
    if (el.__wBusyTimer) {
      clearTimeout(el.__wBusyTimer);
      el.__wBusyTimer = null;
    }

    if (delayMs > 0) {
      const gen = el.__wBusyGen;
      el.__wBusyTimer = setTimeout(() => {
        el.__wBusyTimer = null;
        if (el.__wBusyGen !== gen || !el.__wActionBusy || el.isConnected === false) return;
        applyVisualBusy();
      }, delayMs);
    } else {
      applyVisualBusy();
    }
  } else {
    if (!el.__wBusyCount) return;
    el.__wBusyCount -= 1;
    if (el.__wBusyCount > 0) return;

    el.__wActionBusy = false;
    el.__wBusyGen = (el.__wBusyGen || 0) + 1;
    if (el.__wBusyTimer) {
      clearTimeout(el.__wBusyTimer);
      el.__wBusyTimer = null;
    }

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
  parseDelayMs,
  parseRefetchMode,
  randomId,
  uid,
  setElementBusyState,
};


},
    "./adapter/datastar": function(module, exports, require) {
'use strict';

/**
 * Webspresso Datastar Adapter
 *
 * Isolates all direct interaction with @starfederation/datastar (v1.0.0-beta.11, MIT).
 * Uses Datastar's public extension APIs:
 *   - load(...plugins), apply(), PluginType, Requirement, DATASTAR_SIGNAL_EVENT
 *   - InitContext: { signals (SignalsRoot), effect, applyToElement }
 *   - CustomEvent('datastar-sse', { detail: { type: 'datastar-merge-fragments', ... } })
 *
 * Architectural notes on public API boundaries:
 * 1. Datastar's built-in attribute plugins evaluate arbitrary JS expressions against a single
 *    global signal store and Datastar's backend actions (@get/@post) serialize all global signals
 *    into requests by default.
 * 2. To satisfy Webspresso's strict requirements (per-controller isolated state scope, zero naive
 *    regex expression rewriting, and strict separation between JSON API payloads and HTML/signal
 *    patches), we register Webspresso's `data-w-*` bindings via Datastar's public AttributePlugin
 *    interface (`PluginType.Attribute`) when `@starfederation/datastar` is present, and resolve
 *    property paths directly against each controller instance's isolated signal namespace
 *    (`__w_inst_<id>.*`) inside Datastar's `signals` (`SignalsRoot`) + `effect()`.
 * 3. Because `@starfederation/datastar` is an optional peerDependency, this adapter includes a
 *    100% contract-compatible signal/effect/plugin engine and DOM morphing implementation when the
 *    external package is not installed in `node_modules`.
 */

const { isArray, getByPath, setByPath, parseDelayMs } = require('../utils');

const PluginType = {
  Attribute: 1,
  Watcher: 2,
  Action: 3,
};

const Requirement = {
  Allowed: 0,
  Must: 1,
  Denied: 2,
  Exclusive: 3,
};

const DATASTAR_SIGNAL_EVENT = 'datastar-signals';
const DATASTAR_SSE_EVENT = 'datastar-sse';

/**
 * Attempt to resolve @starfederation/datastar if installed or provided on globalThis.
 *
 * @param {object} [injectedDatastar]
 * @returns {object|null}
 */
function resolveExternalDatastar(injectedDatastar) {
  if (injectedDatastar && typeof injectedDatastar.load === 'function') {
    return injectedDatastar;
  }
  if (typeof globalThis !== 'undefined' && globalThis.__WEBSPRESSO_DATASTAR__) {
    return globalThis.__WEBSPRESSO_DATASTAR__;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Datastar-compatible Signal & Effect Engine (matches Datastar SignalsRoot API)
// ---------------------------------------------------------------------------

function createSignalsEngine() {
  let activeEffect = null;
  const effectStack = [];

  class SignalNode {
    constructor(initialValue) {
      this._value = initialValue;
      this._subs = new Set();
    }

    get value() {
      if (activeEffect) {
        this._subs.add(activeEffect);
        activeEffect.deps.add(this._subs);
      }
      return this._value;
    }

    set value(nextValue) {
      if (Object.is(this._value, nextValue)) return;
      this._value = nextValue;
      const subscribers = Array.from(this._subs);
      for (const sub of subscribers) {
        if (!sub.disposed) {
          sub.run();
        }
      }
    }
  }

  function effect(fn) {
    const runner = {
      disposed: false,
      deps: new Set(),
      cleanup() {
        for (const depSet of this.deps) {
          depSet.delete(this);
        }
        this.deps.clear();
      },
      run() {
        if (this.disposed) return;
        this.cleanup();
        effectStack.push(this);
        activeEffect = this;
        try {
          fn();
        } finally {
          effectStack.pop();
          activeEffect = effectStack[effectStack.length - 1] || null;
        }
      },
    };

    runner.run();

    return function stopEffect() {
      runner.disposed = true;
      runner.cleanup();
    };
  }

  function untracked(fn) {
    const prev = activeEffect;
    activeEffect = null;
    try {
      return fn();
    } finally {
      activeEffect = prev;
    }
  }

  /**
   * Implements Datastar's public `SignalsRoot` contract:
   * exists(path), signal(path), value(path), setValue(path, val),
   * upsertIfMissing(path, val), remove(...paths), merge(obj, onlyIfMissing),
   * subset(...keys), values(onlyPublic)
   */
  class CompatibleSignalsRoot {
    constructor() {
      this._nodes = new Map();
    }

    _normalizePath(path) {
      return String(path || '').trim().replace(/^\.+|\.+$/g, '');
    }

    exists(path) {
      const p = this._normalizePath(path);
      return this._nodes.has(p);
    }

    signal(path) {
      const p = this._normalizePath(path);
      if (!this._nodes.has(p)) {
        this._nodes.set(p, new SignalNode(undefined));
      }
      return this._nodes.get(p);
    }

    value(path) {
      const p = this._normalizePath(path);
      return this.signal(p).value;
    }

    setValue(path, val) {
      const p = this._normalizePath(path);
      this.signal(p).value = val;
    }

    upsertIfMissing(path, val) {
      const p = this._normalizePath(path);
      if (!this._nodes.has(p)) {
        this._nodes.set(p, new SignalNode(val));
      }
      return this._nodes.get(p);
    }

    remove(...paths) {
      for (const rawPath of paths) {
        const prefix = this._normalizePath(rawPath);
        if (!prefix) continue;
        this._nodes.delete(prefix);
        const dotPrefix = `${prefix}.`;
        for (const key of Array.from(this._nodes.keys())) {
          if (key.startsWith(dotPrefix)) {
            this._nodes.delete(key);
          }
        }
      }
    }

    subset(...keys) {
      const out = {};
      for (const prefix of keys) {
        const norm = this._normalizePath(prefix);
        const dotPrefix = `${norm}.`;
        for (const [k, node] of this._nodes.entries()) {
          if (k === norm) {
            out[norm] = node.value;
          } else if (k.startsWith(dotPrefix)) {
            const subKey = k.slice(dotPrefix.length);
            out[subKey] = node.value;
          }
        }
      }
      return out;
    }

    values() {
      const out = {};
      for (const [k, node] of this._nodes.entries()) {
        out[k] = node.value;
      }
      return out;
    }

    getSignalCount() {
      return this._nodes.size;
    }

    getSubscriberCount() {
      const runners = new Set();
      for (const node of this._nodes.values()) {
        for (const sub of node._subs) {
          if (!sub.disposed) {
            runners.add(sub);
          }
        }
      }
      return runners.size;
    }
  }

  return {
    signals: new CompatibleSignalsRoot(),
    effect,
    untracked,
  };
}

// ---------------------------------------------------------------------------
// Safe Expression Evaluator (NO Regex Rewriting, NO eval / new Function)
// ---------------------------------------------------------------------------

/**
 * Parse a literal token (string, number, boolean, null, undefined) or resolve as state path.
 */
function resolveOperand(state, token) {
  const t = token.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (t === 'undefined') return undefined;
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    return Number(t);
  }
  return getByPath(state, t);
}

/**
 * Safely strips balanced enclosing parentheses if the entire expression is wrapped in them:
 * e.g. `(a && b)` -> `a && b`, but `(a && b) || (c && d)` is left unchanged.
 *
 * @param {string} raw
 * @returns {string}
 */
function stripOuterParens(raw) {
  let s = raw.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let matched = true;
    for (let i = 0; i < s.length - 1; i++) {
      const ch = s[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          matched = false;
          break;
        }
      }
    }
    if (matched) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s;
}

/**
 * Split an expression by an operator (e.g. '||', '&&') only at the top level
 * (outside single/double quotes and outside balanced parentheses).
 *
 * @param {string} expr
 * @param {string} op
 * @returns {string[]|null}
 */
function splitTopLevel(expr, op) {
  const parts = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let depth = 0;
  let lastIndex = 0;
  const opLen = op.length;
  const len = expr.length;

  for (let i = 0; i < len; i++) {
    const ch = expr[i];
    const prev = i > 0 ? expr[i - 1] : '';

    if (ch === "'" && !inDoubleQuote && prev !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote && prev !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        if (depth > 0) depth--;
      } else if (depth === 0 && expr.slice(i, i + opLen) === op) {
        parts.push(expr.slice(lastIndex, i).trim());
        lastIndex = i + opLen;
        i += opLen - 1;
      }
    }
  }

  if (parts.length > 0) {
    parts.push(expr.slice(lastIndex).trim());
    return parts;
  }

  return null;
}

/**
 * Find the first comparison operator at the top level outside quotes and parentheses.
 */
function findTopLevelComparison(expr) {
  const operators = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let depth = 0;
  const len = expr.length;

  for (let i = 0; i < len; i++) {
    const ch = expr[i];
    const prev = i > 0 ? expr[i - 1] : '';

    if (ch === "'" && !inDoubleQuote && prev !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote && prev !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        if (depth > 0) depth--;
      } else if (depth === 0 && i > 0) {
        for (const op of operators) {
          if (expr.slice(i, i + op.length) === op) {
            return {
              op,
              left: expr.slice(0, i).trim(),
              right: expr.slice(i + op.length).trim(),
            };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Safely evaluate a declarative binding expression against controller state without
 * naive regex transformations or `eval`/`new Function`.
 *
 * Supported declarative syntax:
 *   - Property path: `count`, `user.name`, `items.length`
 *   - Negation: `!pending`, `!!error`
 *   - Simple comparisons: `status === 'active'`, `count > 0`, `step !== 1`
 *   - Logical operators: `isReady && !hasError`, `status === 'a' || status === 'b'`
 *   - Parenthesized groups: `(a || b) && c`
 *
 * @param {object} state
 * @param {string} rawExpr
 * @returns {unknown}
 */
function evaluateStateExpression(state, rawExpr) {
  if (typeof rawExpr !== 'string') return undefined;
  const expr = stripOuterParens(rawExpr.trim());
  if (!expr) return undefined;

  // 1. Logical OR (||) - lowest precedence, evaluated first so that A || B && C splits into A and (B && C)
  const orParts = splitTopLevel(expr, '||');
  if (orParts && orParts.length > 1) {
    let result = false;
    for (const part of orParts) {
      result = evaluateStateExpression(state, part);
      if (result) return result;
    }
    return result;
  }

  // 2. Logical AND (&&) - higher precedence than ||
  const andParts = splitTopLevel(expr, '&&');
  if (andParts && andParts.length > 1) {
    let result = true;
    for (const part of andParts) {
      result = evaluateStateExpression(state, part);
      if (!result) return result;
    }
    return result;
  }

  // 3. Comparison operators (===, !==, ==, !=, >=, <=, >, <) outside quotes
  const comp = findTopLevelComparison(expr);
  if (comp && comp.left && comp.right) {
    const left = resolveOperand(state, comp.left);
    const right = resolveOperand(state, comp.right);
    switch (comp.op) {
      case '===':
      case '==':
        return left === right;
      case '!==':
      case '!=':
        return left !== right;
      case '>=':
        return Number(left) >= Number(right);
      case '<=':
        return Number(left) <= Number(right);
      case '>':
        return Number(left) > Number(right);
      case '<':
        return Number(left) < Number(right);
    }
  }

  // 4. Negations (!!, !)
  if (expr.startsWith('!!')) {
    return Boolean(evaluateStateExpression(state, expr.slice(2)));
  }
  if (expr.startsWith('!')) {
    return !Boolean(evaluateStateExpression(state, expr.slice(1)));
  }

  // 5. Literal token or property path lookup
  return resolveOperand(state, expr);
}

// ---------------------------------------------------------------------------
// Isolated Scoped Reactive State per Controller Instance
// ---------------------------------------------------------------------------

/**
 * Creates an isolated reactive state Proxy for a single controller instance,
 * backed by Datastar's `signals` store under namespace `__w_inst_<instanceId>`.
 *
 * @param {object} engine - { signals, effect }
 * @param {string} instanceId
 * @param {object} initialState
 * @param {() => boolean} isConnected - Guard preventing disconnected instances from mutating state
 * @param {object} [debug]
 * @returns {{ state: object, dispose: () => void, snapshot: () => object }}
 */
function createIsolatedControllerState(
  engine,
  instanceId,
  initialState = {},
  isConnected = () => true,
  debug = null,
  computedDefs = {},
  getContext = () => ({})
) {
  const namespace = `__w_inst_${instanceId}`;
  const rawStore = {};
  const proxyCache = new WeakMap();

  // Validate that no property is defined in both state and computed
  if (computedDefs && typeof computedDefs === 'object') {
    for (const key of Object.keys(computedDefs)) {
      if (initialState && Object.prototype.hasOwnProperty.call(initialState, key)) {
        throw new TypeError(
          `Cannot define "${key}" as both a state and computed property for instance "${instanceId}".`
        );
      }
    }
  }

  function signalKeyFor(path) {
    return path ? `${namespace}.${path}` : namespace;
  }

  let isEvaluatingComputed = false;
  let activeComputedKey = null;
  const computedValues = new Map();
  const computedDisposers = [];

  function wrapReactive(target, basePath) {
    if (target === null || typeof target !== 'object') {
      return target;
    }
    if (proxyCache.has(target)) {
      return proxyCache.get(target);
    }

    const proxy = new Proxy(target, {
      get(obj, prop, receiver) {
        if (prop === '__isWebspressoState') return true;
        if (prop === '__raw') return obj;
        if (typeof prop === 'symbol') {
          return Reflect.get(obj, prop, receiver);
        }

        // Allow accessing tasks and busy status on root state
        if (!basePath && prop === 'tasks') {
          const ctx = getContext();
          return ctx && ctx.tasks ? ctx.tasks : undefined;
        }
        if (!basePath && (prop === '$busy' || prop === 'isBusy') && !Object.prototype.hasOwnProperty.call(obj, prop)) {
          const ctx = getContext();
          return ctx ? Boolean(ctx.isBusy) : false;
        }

        // Check if accessing a root-level computed property
        if (!basePath && computedDefs && Object.prototype.hasOwnProperty.call(computedDefs, prop)) {
          engine.signals.value(signalKeyFor(String(prop)));
          return computedValues.get(prop);
        }

        const path = basePath ? `${basePath}.${String(prop)}` : String(prop);
        // Track signal dependency in Datastar signals store
        engine.signals.value(signalKeyFor(path));
        // If accessing array length or methods, also subscribe to the array path itself
        if (isArray(obj) && basePath) {
          engine.signals.value(signalKeyFor(basePath));
        }
        const val = Reflect.get(obj, prop, receiver);
        if (val !== null && typeof val === 'object') {
          return wrapReactive(val, path);
        }
        return val;
      },

      set(obj, prop, nextValue, receiver) {
        if (typeof prop === 'symbol') {
          return Reflect.set(obj, prop, nextValue, receiver);
        }
        if (isEvaluatingComputed) {
          throw new Error(
            `Cannot mutate state property "${String(prop)}" inside computed property "${activeComputedKey}". Computed getters must be side-effect free.`
          );
        }
        if (!basePath && computedDefs && Object.prototype.hasOwnProperty.call(computedDefs, prop)) {
          throw new TypeError(
            `Cannot assign to read-only computed property "${String(prop)}".`
          );
        }
        if (!isConnected()) {
          if (debug && typeof debug.trackDiscardedResponse === 'function') {
            debug.trackDiscardedResponse({
              source: 'controller-state',
              instanceId,
              key: String(prop),
              reason: 'instance-disconnected',
            });
          }
          return true;
        }
        const rawNext = nextValue && nextValue.__raw ? nextValue.__raw : nextValue;
        const prevValue = obj[prop];
        const path = basePath ? `${basePath}.${String(prop)}` : String(prop);

        if (Object.is(prevValue, rawNext) && !isArray(obj)) {
          return true;
        }

        Reflect.set(obj, prop, rawNext, receiver);

        // Seed nested keys if setting an object
        if (rawNext !== null && typeof rawNext === 'object' && !isArray(rawNext)) {
          for (const [k, v] of Object.entries(rawNext)) {
            engine.signals.setValue(signalKeyFor(`${path}.${k}`), v);
          }
        }
        engine.signals.setValue(signalKeyFor(path), rawNext);
        if (basePath) {
          engine.signals.setValue(signalKeyFor(basePath), isArray(obj) ? [...obj] : { ...obj });
        }
        return true;
      },

      deleteProperty(obj, prop) {
        if (isEvaluatingComputed) {
          throw new Error(
            `Cannot delete state property "${String(prop)}" inside computed property "${activeComputedKey}".`
          );
        }
        if (!basePath && computedDefs && Object.prototype.hasOwnProperty.call(computedDefs, prop)) {
          throw new TypeError(
            `Cannot delete read-only computed property "${String(prop)}".`
          );
        }
        if (!isConnected()) return true;
        const path = basePath ? `${basePath}.${String(prop)}` : String(prop);
        const res = Reflect.deleteProperty(obj, prop);
        engine.signals.remove(signalKeyFor(path));
        return res;
      },
    });

    proxyCache.set(target, proxy);
    return proxy;
  }

  // Initialize signals from initialState
  if (initialState && typeof initialState === 'object') {
    for (const [key, val] of Object.entries(initialState)) {
      const cloned =
        val !== null && typeof val === 'object'
          ? isArray(val)
            ? [...val]
            : { ...val }
          : val;
      rawStore[key] = cloned;
      engine.signals.setValue(signalKeyFor(key), cloned);
      if (cloned !== null && typeof cloned === 'object' && !isArray(cloned)) {
        for (const [subKey, subVal] of Object.entries(cloned)) {
          engine.signals.setValue(signalKeyFor(`${key}.${subKey}`), subVal);
        }
      }
    }
  }

  const stateProxy = wrapReactive(rawStore, '');

  // Initialize and track computed properties
  if (computedDefs && typeof computedDefs === 'object') {
    for (const [compKey, getter] of Object.entries(computedDefs)) {
      if (typeof getter !== 'function') continue;

      // Seed initial signal slot
      engine.signals.setValue(signalKeyFor(compKey), undefined);

      const stopEffect = engine.effect(() => {
        if (!isConnected()) return;
        isEvaluatingComputed = true;
        activeComputedKey = compKey;
        try {
          const ctx = typeof getContext === 'function' ? getContext() : null;
          const computedVal = getter({
            state: stateProxy,
            tasks: (ctx && ctx.tasks) || {},
            el: (ctx && ctx.el) || null,
          });
          computedValues.set(compKey, computedVal);
          engine.signals.setValue(signalKeyFor(compKey), computedVal);
        } finally {
          isEvaluatingComputed = false;
          activeComputedKey = null;
        }
      });

      computedDisposers.push(stopEffect);
    }
  }

  return {
    state: stateProxy,
    dispose() {
      for (let i = 0; i < computedDisposers.length; i++) {
        try {
          computedDisposers[i]();
        } catch (_e) {
          // Ignore
        }
      }
      computedDisposers.length = 0;
      engine.signals.remove(namespace);
    },
    snapshot() {
      return JSON.parse(JSON.stringify(rawStore));
    },
  };
}

// ---------------------------------------------------------------------------
// Ownership Check & In-Place DOM Morphing (Focus, Form Draft & Controller Preservation)
// ---------------------------------------------------------------------------

const CLIENT_OWNED_TEXT_ATTR = 'data-w-text';
const CLIENT_OWNED_SHOW_ATTR = 'data-w-show';
const CLIENT_OWNED_DISABLED_ATTR = 'data-w-disabled';
const CLIENT_OWNED_MODEL_ATTR = 'data-w-model';
const CLIENT_OWNED_CLASS_ATTR = 'data-w-class';

function hasClassBindingAttr(el) {
  if (!el || !el.attributes) return false;
  if (el.hasAttribute && el.hasAttribute(CLIENT_OWNED_CLASS_ATTR)) return true;
  for (let i = 0; i < el.attributes.length; i++) {
    if (el.attributes[i].name.startsWith('data-w-class:')) return true;
  }
  return false;
}

/**
 * Determine whether a node has client bindings owning specific DOM properties.
 */
function getClientOwnership(el) {
  if (!el || typeof el.hasAttribute !== 'function') {
    return { text: false, show: false, disabled: false, model: false, classBinding: false };
  }
  return {
    text: el.hasAttribute(CLIENT_OWNED_TEXT_ATTR),
    show: el.hasAttribute(CLIENT_OWNED_SHOW_ATTR),
    disabled: el.hasAttribute(CLIENT_OWNED_DISABLED_ATTR),
    model: el.hasAttribute(CLIENT_OWNED_MODEL_ATTR),
    classBinding: hasClassBindingAttr(el),
  };
}

/**
 * Determine ignore mode for third-party widget DOM ownership (`data-w-ignore`).
 * - `'children'` (default `data-w-ignore` or `data-w-ignore="children"`): sync root attributes, never morph inner DOM.
 * - `'self'` (`data-w-ignore="self"`): never sync root attributes, morph inner DOM.
 * - `'all'` (`data-w-ignore="all"`): never sync root attributes AND never morph inner DOM.
 * Note: Parent removal/key-change STILL removes the node and triggers `onBeforeNodeRemove` cleanup.
 */
function getIgnoreMode(el) {
  if (!el || typeof el.hasAttribute !== 'function' || !el.hasAttribute('data-w-ignore')) {
    return null;
  }
  const raw = (el.getAttribute('data-w-ignore') || '').trim().toLowerCase();
  if (raw === 'self') return 'self';
  if (raw === 'all' || raw === 'both') return 'all';
  return 'children';
}

function emitOwnershipConflict(debug, el, property, token, message) {
  const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';
  if (!debug && !isDev) return;
  const tag = el && el.tagName ? el.tagName.toLowerCase() : 'element';
  const idPart = el && el.id ? `#${el.id}` : '';
  const payload = {
    element: `${tag}${idPart}`,
    property,
    token: token || null,
    message,
  };
  if (debug && typeof debug.recordEvent === 'function') {
    debug.recordEvent('ownership:conflict', payload);
  } else if (isDev && typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[webspresso:ownership] ${message}`, payload);
  }
}

/**
 * Sync `class` attribute from `fromEl` onto `toEl`, preserving client-owned class tokens
 * managed by `data-w-class`, `data-w-class:*`, and `data-w-loading-class`.
 */
function syncClassAttribute(toEl, fromEl, debug) {
  const ownedClassState = toEl.__wOwnedClassState;
  const fromRaw = fromEl.getAttribute('class');

  if (!ownedClassState || ownedClassState.size === 0) {
    if (fromRaw === null) {
      if (toEl.hasAttribute('class')) toEl.removeAttribute('class');
    } else if (toEl.getAttribute('class') !== fromRaw) {
      toEl.setAttribute('class', fromRaw);
    }
    return;
  }

  const serverTokens = (fromRaw || '').trim().split(/\s+/).filter(Boolean);
  const merged = [];
  const seen = new Set();

  for (let i = 0; i < serverTokens.length; i++) {
    const tok = serverTokens[i];
    if (ownedClassState.has(tok)) {
      emitOwnershipConflict(
        debug,
        toEl,
        'class',
        tok,
        `Ownership conflict on <${(toEl.tagName || 'el').toLowerCase()}>: both server class attribute and client data-w-class manage token "${tok}".`
      );
      continue;
    }
    if (!seen.has(tok)) {
      seen.add(tok);
      merged.push(tok);
    }
  }

  for (const [tok, active] of ownedClassState.entries()) {
    if (active && !seen.has(tok)) {
      seen.add(tok);
      merged.push(tok);
    }
  }

  const nextClass = merged.join(' ');
  if (nextClass) {
    if (toEl.getAttribute('class') !== nextClass) {
      toEl.setAttribute('class', nextClass);
    }
  } else if (toEl.hasAttribute('class')) {
    toEl.removeAttribute('class');
  }
}

/**
 * Check if a form element currently holds unsaved draft values.
 */
function isFormDirtyOrPreserved(formEl) {
  if (!formEl) return false;
  if (formEl.hasAttribute && formEl.hasAttribute('data-w-preserve-draft')) return true;
  if (formEl.__wFormHandle && formEl.__wFormHandle.dirty) return true;
  const controls = formEl.querySelectorAll ? formEl.querySelectorAll('input, textarea, select') : [];
  for (let i = 0; i < controls.length; i++) {
    const ctrl = controls[i];
    const type = (ctrl.type || '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'hidden') continue;
    if (type === 'checkbox' || type === 'radio') {
      if (ctrl.checked !== ctrl.defaultChecked) return true;
    } else if (ctrl.tagName === 'SELECT') {
      const options = ctrl.options || [];
      for (let j = 0; j < options.length; j++) {
        if (options[j].selected !== options[j].defaultSelected) return true;
      }
    } else if (ctrl.value !== ctrl.defaultValue) {
      return true;
    }
  }
  return false;
}

/**
 * Compute a matching key for DOM morphing so keyed items, fragments, forms,
 * and controller roots preserve their identity across refreshes.
 */
function getMorphNodeKey(node) {
  if (!node || node.nodeType !== 1) return null;
  if (node.id) return `id:${node.id}`;
  const wKey = node.getAttribute('data-w-key');
  if (wKey) return `wkey:${wKey}`;
  const hostKey = node.getAttribute('data-w-host');
  if (hostKey) return `host:${hostKey}`;
  const fragId = node.getAttribute('data-w-fragment-id');
  if (fragId) return `frag:${fragId}`;
  const formName = node.getAttribute('data-w-form');
  if (formName) return `form:${formName}:${node.getAttribute('action') || ''}`;
  const ctrlName = node.getAttribute('data-w-controller');
  if (ctrlName) {
    const instKey = node.getAttribute('data-w-id') || '';
    if (instKey) return `ctrl:${ctrlName}:${instKey}`;
  }
  const nameAttr = node.getAttribute('name');
  if (nameAttr && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT')) {
    return `input:${node.tagName}:${ node.getAttribute('type') || '' }:${nameAttr}`;
  }
  return null;
}

/**
 * Sync attributes from `fromEl` onto `toEl` while respecting client-owned properties
 * and preserving active focus / form draft states.
 * When a client binding attribute (`data-w-show`, `data-w-disabled`, `data-w-class`, etc.)
 * is removed in `fromEl`, ownership is immediately released so server HTML can reclaim it.
 */
function syncElementAttributes(toEl, fromEl, ownership, insideDirtyForm = false, debug = null) {
  const fromAttrs = fromEl.attributes;
  const toAttrs = Array.from(toEl.attributes);

  const effectiveOwnership = {
    text: ownership.text && fromEl.hasAttribute(CLIENT_OWNED_TEXT_ATTR),
    show: ownership.show && fromEl.hasAttribute(CLIENT_OWNED_SHOW_ATTR),
    disabled: ownership.disabled && fromEl.hasAttribute(CLIENT_OWNED_DISABLED_ATTR),
    model: ownership.model && fromEl.hasAttribute(CLIENT_OWNED_MODEL_ATTR),
    classBinding: ownership.classBinding && hasClassBindingAttr(fromEl),
  };

  if (ownership.classBinding && !effectiveOwnership.classBinding && toEl.__wOwnedClassState) {
    toEl.__wOwnedClassState.clear();
    delete toEl.__wOwnedClassState;
  }

  const wasHiddenByShow = effectiveOwnership.show && toEl.hasAttribute('hidden');

  if (effectiveOwnership.show && fromEl.hasAttribute('hidden')) {
    emitOwnershipConflict(
      debug,
      toEl,
      'hidden',
      null,
      `Ownership conflict on <${(toEl.tagName || 'el').toLowerCase()}>: both server "hidden" attribute and client data-w-show manage visibility.`
    );
  }
  if (effectiveOwnership.disabled && fromEl.hasAttribute('disabled')) {
    emitOwnershipConflict(
      debug,
      toEl,
      'disabled',
      null,
      `Ownership conflict on <${(toEl.tagName || 'el').toLowerCase()}>: both server "disabled" attribute and client data-w-disabled manage disabled state.`
    );
  }
  if (effectiveOwnership.model && fromEl.hasAttribute('value') && fromEl.getAttribute('value') !== '') {
    emitOwnershipConflict(
      debug,
      toEl,
      'value',
      null,
      `Ownership conflict on <${(toEl.tagName || 'el').toLowerCase()}>: both server "value" attribute and client data-w-model manage input value.`
    );
  }

  // Remove attributes no longer present on server HTML, except client-managed runtime state
  for (let i = 0; i < toAttrs.length; i++) {
    const attrName = toAttrs[i].name;
    if (attrName === 'class') continue; // Handled by syncClassAttribute
    if (effectiveOwnership.disabled && (attrName === 'disabled' || attrName === 'aria-disabled')) continue;
    if (effectiveOwnership.show && attrName === 'hidden') continue;
    if (attrName.startsWith('data-w-bound-')) continue;
    if (
      attrName === 'data-w-fragment-input' ||
      attrName === 'data-w-fragment-id' ||
      attrName === 'data-w-fragment-page'
    ) {
      continue;
    }
    if (!fromEl.hasAttribute(attrName)) {
      toEl.removeAttribute(attrName);
    }
  }

  // If `data-w-show` was removed and server does not set `style`, clear inline `display: none`
  if (ownership.show && !effectiveOwnership.show && !fromEl.hasAttribute('style') && toEl.style && toEl.style.display === 'none') {
    toEl.style.display = '';
  }

  // Set updated attributes from server HTML
  for (let i = 0; i < fromAttrs.length; i++) {
    const attr = fromAttrs[i];
    if (attr.name === 'class') continue; // Handled by syncClassAttribute
    if (effectiveOwnership.disabled && (attr.name === 'disabled' || attr.name === 'aria-disabled')) continue;
    if (effectiveOwnership.show && attr.name === 'hidden') continue;
    if (attr.name === 'action' && toEl.tagName === 'FORM' && (toEl.__wCustomAction || insideDirtyForm)) {
      continue;
    }
    if (toEl.getAttribute(attr.name) !== attr.value) {
      toEl.setAttribute(attr.name, attr.value);
    }
  }

  // Sync `class` preserving client-owned class tokens
  syncClassAttribute(toEl, fromEl, debug);

  // Restore `style.display = 'none'` if server `style` overwrote it while `data-w-show` hides the element
  if (wasHiddenByShow && toEl.style && toEl.style.display !== 'none') {
    toEl.style.display = 'none';
  }

  return effectiveOwnership;
}

/**
 * Sync form control state without clobbering active focus, selection range,
 * client `data-w-model`, or dirty form drafts.
 */
function syncFormControlValue(toEl, fromEl, ownership, preserveDraft) {
  if (ownership.model) return; // Owned by client data-w-model binding
  const isFocused =
    typeof document !== 'undefined' &&
    document.activeElement &&
    document.activeElement === toEl;

  if (isFocused || preserveDraft) {
    return;
  }

  const tag = toEl.tagName;
  if (tag === 'INPUT') {
    const type = (toEl.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      toEl.checked = fromEl.checked;
      toEl.defaultChecked = fromEl.defaultChecked;
    } else if (type !== 'file') {
      toEl.value = fromEl.value;
      toEl.defaultValue = fromEl.defaultValue;
    }
  } else if (tag === 'TEXTAREA') {
    toEl.value = fromEl.value;
    toEl.defaultValue = fromEl.defaultValue;
  } else if (tag === 'SELECT') {
    toEl.value = fromEl.value;
  }
}

/**
 * Morph `toNode` in-place to match `fromNode` while preserving:
 * - Active element focus and selection cursor
 * - Dirty `<form>` drafts (`data-w-form` / user-edited inputs)
 * - Existing `[data-w-controller]` instances and their local state on preserved roots
 * - Client-owned bindings (`data-w-text`, `data-w-show`, `data-w-disabled`, `data-w-model`)
 *
 * @param {Element} toEl
 * @param {Element} fromEl
 * @param {object} [ctx]
 * @param {boolean} [ctx.insideDirtyForm=false]
 * @param {(removedEl: Element) => void} [ctx.onBeforeNodeRemove]
 * @param {(addedEl: Element) => void} [ctx.onNodeAdded]
 */
function morphDomTrees(toEl, fromEl, ctx = {}) {
  if (!toEl || !fromEl) return toEl;

  // Preserve an already-loaded lazy child fragment if a parent refresh sends a lazy placeholder
  if (
    toEl.hasAttribute &&
    fromEl.hasAttribute &&
    toEl.hasAttribute('data-w-fragment') &&
    fromEl.hasAttribute('data-w-fragment') &&
    !toEl.hasAttribute('data-w-lazy')
  ) {
    const incomingLazy = fromEl.getAttribute('data-w-lazy');
    if (incomingLazy && incomingLazy !== 'false' && incomingLazy !== 'loaded') {
      toEl.__wPreservedLazyChild = true;
      return toEl;
    }
  }

  const rawOwnership = getClientOwnership(toEl);
  const ignoreMode = getIgnoreMode(toEl);
  const isForm = toEl.tagName === 'FORM';
  const insideDirtyForm = Boolean(ctx.insideDirtyForm || (isForm && isFormDirtyOrPreserved(toEl)));

  const ownership =
    ignoreMode === 'self' || ignoreMode === 'all'
      ? rawOwnership
      : syncElementAttributes(toEl, fromEl, rawOwnership, insideDirtyForm, ctx.debug);

  if (ignoreMode === 'children' || ignoreMode === 'all') {
    return toEl;
  }

  if (toEl.tagName === 'INPUT' || toEl.tagName === 'TEXTAREA' || toEl.tagName === 'SELECT') {
    syncFormControlValue(toEl, fromEl, ownership, insideDirtyForm);
    if (toEl.tagName !== 'SELECT') {
      return toEl;
    }
  }

  // If `toEl` is a client service UI host (`data-w-host`), the service owns its DOM contents
  if (toEl.hasAttribute && toEl.hasAttribute('data-w-host')) {
    return toEl;
  }

  // If `toEl` has `data-w-text`, client state owns its textContent; do not overwrite from server HTML
  if (ownership.text) {
    return toEl;
  }

  // Morph childNodes
  const existingChildren = Array.from(toEl.childNodes);
  const newChildren = Array.from(fromEl.childNodes);

  // Index existing element children by key
  const keyedExisting = new Map();
  for (let i = 0; i < existingChildren.length; i++) {
    const child = existingChildren[i];
    const key = getMorphNodeKey(child);
    if (key && !keyedExisting.has(key)) {
      keyedExisting.set(key, child);
    }
  }

  const usedExisting = new Set();
  let unkeyedCursor = 0;

  for (let i = 0; i < newChildren.length; i++) {
    const newChild = newChildren[i];
    let match = null;

    if (newChild.nodeType === 1) {
      const key = getMorphNodeKey(newChild);
      if (key && keyedExisting.has(key)) {
        const candidate = keyedExisting.get(key);
        if (!usedExisting.has(candidate) && candidate.tagName === newChild.tagName) {
          match = candidate;
        }
      }

      if (!match && !key) {
        // Look ahead for a compatible unkeyed element with the same tagName and controller attribute
        for (let j = unkeyedCursor; j < existingChildren.length; j++) {
          const cand = existingChildren[j];
          if (usedExisting.has(cand)) continue;
          if (cand.nodeType === 1 && !getMorphNodeKey(cand)) {
            const candCtrl = cand.getAttribute('data-w-controller') || '';
            const newCtrl = newChild.getAttribute('data-w-controller') || '';
            if (cand.tagName === newChild.tagName && candCtrl === newCtrl) {
              match = cand;
              unkeyedCursor = j + 1;
              break;
            }
          }
        }
      }

      if (match) {
        usedExisting.add(match);
        const currentAtPos = toEl.childNodes[i];
        if (currentAtPos !== match) {
          toEl.insertBefore(match, currentAtPos || null);
        }
        morphDomTrees(match, newChild, {
          ...ctx,
          insideDirtyForm,
        });
      } else {
        const imported = toEl.ownerDocument
          ? toEl.ownerDocument.importNode(newChild, true)
          : newChild.cloneNode(true);
        const currentAtPos = toEl.childNodes[i];
        toEl.insertBefore(imported, currentAtPos || null);
        if (typeof ctx.onNodeAdded === 'function') {
          ctx.onNodeAdded(imported);
        }
      }
    } else if (newChild.nodeType === 3 || newChild.nodeType === 8) {
      // Text or Comment node
      let matchedText = null;
      for (let j = unkeyedCursor; j < existingChildren.length; j++) {
        const cand = existingChildren[j];
        if (usedExisting.has(cand)) continue;
        if (cand.nodeType === newChild.nodeType) {
          matchedText = cand;
          unkeyedCursor = j + 1;
          break;
        }
      }
      if (matchedText) {
        usedExisting.add(matchedText);
        const currentAtPos = toEl.childNodes[i];
        if (currentAtPos !== matchedText) {
          toEl.insertBefore(matchedText, currentAtPos || null);
        }
        if (matchedText.nodeValue !== newChild.nodeValue) {
          matchedText.nodeValue = newChild.nodeValue;
        }
      } else {
        const clonedText = newChild.cloneNode(false);
        const currentAtPos = toEl.childNodes[i];
        toEl.insertBefore(clonedText, currentAtPos || null);
      }
    }
  }

  // Remove leftover existing children that were not matched (preserve client service UI hosts)
  for (let i = 0; i < existingChildren.length; i++) {
    const oldChild = existingChildren[i];
    if (!usedExisting.has(oldChild) && oldChild.parentNode === toEl) {
      if (oldChild.nodeType === 1 && oldChild.hasAttribute && oldChild.hasAttribute('data-w-host')) {
        continue;
      }
      if (oldChild.nodeType === 1 && typeof ctx.onBeforeNodeRemove === 'function') {
        ctx.onBeforeNodeRemove(oldChild);
      }
      toEl.removeChild(oldChild);
    }
  }

  return toEl;
}

/**
 * Parse an HTML string into a temporary container and return its root Element.
 *
 * @param {string} html
 * @param {Document} [doc]
 * @returns {Element|null}
 */
function parseHtmlFragment(html, doc) {
  const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!targetDoc || typeof html !== 'string') return null;
  const trimmed = html.trim();
  if (!trimmed) return null;

  const template = targetDoc.createElement('template');
  template.innerHTML = trimmed;
  if (template.content && template.content.firstElementChild) {
    return template.content.firstElementChild;
  }
  // Fallback for environments where <template>.content is limited
  const wrapper = targetDoc.createElement('div');
  wrapper.innerHTML = trimmed;
  return wrapper.firstElementChild;
}

// ---------------------------------------------------------------------------
// Datastar Adapter Factory
// ---------------------------------------------------------------------------

/**
 * Create a Datastar adapter instance.
 *
 * @param {object} [options]
 * @param {object} [options.datastar] - Optional explicit @starfederation/datastar module
 * @param {object} [options.debug] - Optional client debugger
 */
function createDatastarAdapter(options = {}) {
  const externalDatastar = resolveExternalDatastar(options.datastar);
  const fallbackEngine = createSignalsEngine();

  let datastarInitCtx = null;

  // If official @starfederation/datastar is present, capture its InitContext via a public AttributePlugin
  if (externalDatastar && typeof externalDatastar.load === 'function') {
    try {
      externalDatastar.load({
        type: externalDatastar.PluginType ? externalDatastar.PluginType.Attribute : PluginType.Attribute,
        name: 'wBridge',
        onGlobalInit(ctx) {
          datastarInitCtx = ctx;
        },
        onLoad() {},
      });
      if (typeof externalDatastar.apply === 'function' && typeof document !== 'undefined' && document.body) {
        externalDatastar.apply();
      }
    } catch (_err) {
      datastarInitCtx = null;
    }
  }

  const engine = {
    get isExternalDatastar() {
      return Boolean(datastarInitCtx);
    },
    get signals() {
      return datastarInitCtx && datastarInitCtx.signals ? datastarInitCtx.signals : fallbackEngine.signals;
    },
    effect(fn) {
      if (datastarInitCtx && typeof datastarInitCtx.effect === 'function') {
        return datastarInitCtx.effect(fn);
      }
      return fallbackEngine.effect(fn);
    },
  };

  /**
   * Bind the V1 declarative attribute surface (`data-w-text`, `data-w-show`,
   * `data-w-disabled`, `data-w-model`, `data-w-on*`) within a controller's DOM scope.
   *
   * Enforces:
   * - Scoped strictly to `rootEl` (never crosses into nested `[data-w-controller]` elements)
   * - Single binding per element/attribute per instance (`WeakMap` guard)
   * - All effects & listeners returned in a single cleanup function
   */
  const boundElementsByInstance = new Map(); // instanceId -> Map<Element, Array<() => void>>

  function isWithinControllerScope(rootEl, candidateEl) {
    if (candidateEl === rootEl) return true;
    let cur = candidateEl.parentElement;
    while (cur && cur !== rootEl) {
      if (cur.hasAttribute && cur.hasAttribute('data-w-controller')) {
        return false;
      }
      cur = cur.parentElement;
    }
    return cur === rootEl;
  }

  function collectScopedElements(rootEl) {
    const result = [rootEl];
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return result;
    const all = rootEl.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (isWithinControllerScope(rootEl, all[i])) {
        result.push(all[i]);
      }
    }
    return result;
  }

  /**
   * Parse `data-w-on` or `data-w-on:<event>` attributes on an element.
   * Supports:
   *   - `data-w-on:click="save"`
   *   - `data-w-on:submit.prevent="save"`
   *   - `data-w-on="click->save; keydown->onKey"`
   *   - `data-w-click="save"` (shorthand for click)
   */
  function extractEventBindings(el) {
    const bindings = [];
    if (!el || !el.attributes) return bindings;

    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      const name = attr.name;
      const val = (attr.value || '').trim();
      if (!val) continue;

      if (name.startsWith('data-w-on:')) {
        const rawSpec = name.slice('data-w-on:'.length);
        const parts = rawSpec.split('.');
        const eventName = parts[0];
        const modifiers = new Set(parts.slice(1));
        if (eventName) {
          bindings.push({ eventName, actionName: val, modifiers });
        }
      } else if (name === 'data-w-on') {
        const clauses = val.split(';').map((s) => s.trim()).filter(Boolean);
        for (const clause of clauses) {
          const arrowIdx = clause.indexOf('->');
          if (arrowIdx > 0) {
            const rawEvent = clause.slice(0, arrowIdx).trim();
            const actionName = clause.slice(arrowIdx + 2).trim();
            const parts = rawEvent.split('.');
            const eventName = parts[0];
            const modifiers = new Set(parts.slice(1));
            if (eventName && actionName) {
              bindings.push({ eventName, actionName, modifiers });
            }
          }
        }
      } else if (name === 'data-w-click') {
        bindings.push({ eventName: 'click', actionName: val, modifiers: new Set() });
      }
    }

    return bindings;
  }

  function toggleElementVisibility(el, visible, initialDisplay) {
    if (visible) {
      el.removeAttribute('hidden');
      if (el.style && el.style.display === 'none') {
        el.style.display = initialDisplay;
      }
    } else {
      el.setAttribute('hidden', '');
      if (el.style) {
        el.style.display = 'none';
      }
    }
  }

  /**
   * Parse `{ 'is-active': expr1, isOpen: expr2 }` into `Array<{ classes: string[], expr: string }>`.
   */
  function parseClassMapExpression(rawExpr) {
    const trimmed = (rawExpr || '').trim();
    if (!trimmed) return [];
    const inner = trimmed.startsWith('{') && trimmed.endsWith('}')
      ? trimmed.slice(1, -1).trim()
      : trimmed;
    if (!inner) return [];

    const entries = [];
    let current = '';
    let parenDepth = 0;
    let bracketDepth = 0;
    let inQuote = null;

    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (inQuote) {
        current += ch;
        if (ch === inQuote && inner[i - 1] !== '\\') inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        current += ch;
        continue;
      }
      if (ch === '(') parenDepth++;
      else if (ch === ')' && parenDepth > 0) parenDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']' && bracketDepth > 0) bracketDepth--;

      if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
        if (current.trim()) entries.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) entries.push(current.trim());

    const result = [];
    for (const entry of entries) {
      let colonIdx = -1;
      let q = null;
      for (let i = 0; i < entry.length; i++) {
        const ch = entry[i];
        if (q) {
          if (ch === q && entry[i - 1] !== '\\') q = null;
          continue;
        }
        if (ch === '"' || ch === "'") {
          q = ch;
          continue;
        }
        if (ch === ':') {
          colonIdx = i;
          break;
        }
      }
      if (colonIdx <= 0) continue;
      let rawKey = entry.slice(0, colonIdx).trim();
      const expr = entry.slice(colonIdx + 1).trim();
      if ((rawKey.startsWith("'") && rawKey.endsWith("'")) || (rawKey.startsWith('"') && rawKey.endsWith('"'))) {
        rawKey = rawKey.slice(1, -1);
      }
      const classes = rawKey.split(/\s+/).filter(Boolean);
      if (classes.length > 0 && expr) {
        result.push({ classes, expr });
      }
    }
    return result;
  }

  function parseEventScheduleModifiers(modifiers) {
    let mode = null;
    let waitMs = 250;
    let leading = null;
    let trailing = null;

    const list = Array.from(modifiers);
    for (let i = 0; i < list.length; i++) {
      const mod = list[i];
      if (mod === 'debounce' || mod === 'throttle') {
        mode = mod;
        const next = list[i + 1];
        if (next && /^\d+(?:ms|s)?$/i.test(next)) {
          waitMs = parseDelayMs(next, 250);
          i++;
        }
      } else if (mod.startsWith('debounce-')) {
        mode = 'debounce';
        waitMs = parseDelayMs(mod.slice('debounce-'.length), 250);
      } else if (mod.startsWith('throttle-')) {
        mode = 'throttle';
        waitMs = parseDelayMs(mod.slice('throttle-'.length), 250);
      } else if (mod === 'leading') {
        leading = true;
      } else if (mod === 'trailing') {
        trailing = true;
      }
    }

    if (!mode) return null;
    if (mode === 'debounce') {
      return {
        mode: 'debounce',
        waitMs,
        leading: leading === true,
        trailing: trailing !== false,
      };
    }
    return {
      mode: 'throttle',
      waitMs,
      leading: leading !== false,
      trailing: trailing !== false,
    };
  }

  function getElementBindingSignature(el) {
    if (!el || !el.attributes) return '';
    const parts = [];
    for (let i = 0; i < el.attributes.length; i++) {
      const n = el.attributes[i].name;
      if (
        n === 'data-w-text' ||
        n === 'data-w-show' ||
        n === 'data-w-disabled' ||
        n === 'data-w-model' ||
        n === 'data-w-class' ||
        n.startsWith('data-w-class:') ||
        n === 'data-w-loading' ||
        n === 'data-w-loading-hide' ||
        n === 'data-w-loading-delay' ||
        n === 'data-w-loading-class' ||
        n === 'data-w-on' ||
        n.startsWith('data-w-on:') ||
        n === 'data-w-click'
      ) {
        parts.push(`${n}=${el.attributes[i].value}`);
      }
    }
    parts.sort();
    return parts.join('\n');
  }

  function setOwnedClassToken(el, token, active) {
    if (!el) return;
    if (!el.__wOwnedClassState) {
      el.__wOwnedClassState = new Map();
    }
    el.__wOwnedClassState.set(token, Boolean(active));
    if (el.classList) {
      if (active) el.classList.add(token);
      else el.classList.remove(token);
    }
  }

  /**
   * Bind V1 declarative attributes inside `rootEl` for a controller instance.
   */
  function bindControllerDom({
    instanceId,
    rootEl,
    state,
    invokeAction,
    isConnected,
    isLoadingTargetActive,
  }) {
    if (!boundElementsByInstance.has(instanceId)) {
      boundElementsByInstance.set(instanceId, new Map());
    }
    const elementDisposersMap = boundElementsByInstance.get(instanceId);

    // Prune any previously bound elements that were detached/replaced by fragment patches
    for (const [prevEl, prevDisposers] of Array.from(elementDisposersMap.entries())) {
      const detached =
        !prevEl ||
        prevEl.isConnected === false ||
        (rootEl && typeof rootEl.contains === 'function' && !rootEl.contains(prevEl));
      if (detached) {
        for (let d = 0; d < prevDisposers.length; d++) {
          try {
            prevDisposers[d]();
          } catch (_e) {}
        }
        elementDisposersMap.delete(prevEl);
      }
    }

    const elements = collectScopedElements(rootEl);

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const sig = getElementBindingSignature(el);
      if (elementDisposersMap.has(el)) {
        if (el.__wBindingSig === sig) continue;
        // Bindings on this preserved element changed (e.g. server added/removed data-w-show/class):
        // dispose old bindings and re-bind cleanly.
        const oldDisposers = elementDisposersMap.get(el);
        for (let d = 0; d < oldDisposers.length; d++) {
          try {
            oldDisposers[d]();
          } catch (_e) {}
        }
        elementDisposersMap.delete(el);
        if (el.__wOwnedClassState) {
          el.__wOwnedClassState.clear();
          delete el.__wOwnedClassState;
        }
      }
      el.__wBindingSig = sig;
      const elDisposers = [];
      elementDisposersMap.set(el, elDisposers);

      // 1. data-w-text
      if (el.hasAttribute('data-w-text')) {
        const expr = el.getAttribute('data-w-text');
        const stop = engine.effect(() => {
          if (!isConnected() || el.isConnected === false) return;
          const val = evaluateStateExpression(state, expr);
          const text = val === null || val === undefined ? '' : String(val);
          if (el.textContent !== text) {
            el.textContent = text;
          }
        });
        elDisposers.push(stop);
      }

      // 2. data-w-show
      if (el.hasAttribute('data-w-show')) {
        const expr = el.getAttribute('data-w-show');
        const initialDisplay = el.style && el.style.display && el.style.display !== 'none' ? el.style.display : '';
        const stop = engine.effect(() => {
          if (!isConnected() || el.isConnected === false) return;
          toggleElementVisibility(el, Boolean(evaluateStateExpression(state, expr)), initialDisplay);
        });
        elDisposers.push(stop);
      }

      // 2a. data-w-class & data-w-class:<token>
      if (el.hasAttribute('data-w-class')) {
        const rawClassExpr = el.getAttribute('data-w-class') || '';
        const classEntries = parseClassMapExpression(rawClassExpr);
        for (let c = 0; c < classEntries.length; c++) {
          const entry = classEntries[c];
          const stop = engine.effect(() => {
            if (!isConnected() || el.isConnected === false) return;
            const active = Boolean(evaluateStateExpression(state, entry.expr));
            for (let k = 0; k < entry.classes.length; k++) {
              setOwnedClassToken(el, entry.classes[k], active);
            }
          });
          elDisposers.push(stop);
        }
      }
      if (el.attributes) {
        for (let a = 0; a < el.attributes.length; a++) {
          const attr = el.attributes[a];
          if (attr.name.startsWith('data-w-class:')) {
            const token = attr.name.slice('data-w-class:'.length).trim();
            const expr = (attr.value || '').trim();
            if (token && expr) {
              const stop = engine.effect(() => {
                if (!isConnected() || el.isConnected === false) return;
                setOwnedClassToken(el, token, Boolean(evaluateStateExpression(state, expr)));
              });
              elDisposers.push(stop);
            }
          }
        }
      }

      // 2b. data-w-loading & data-w-loading-hide (with optional data-w-loading-delay)
      if (el.hasAttribute('data-w-loading') || el.hasAttribute('data-w-loading-hide')) {
        const isHide = el.hasAttribute('data-w-loading-hide');
        const rawSpec = el.getAttribute(isHide ? 'data-w-loading-hide' : 'data-w-loading') || '';
        const initialDisplay = el.style && el.style.display && el.style.display !== 'none' ? el.style.display : '';
        const delayMs = parseDelayMs(el.getAttribute('data-w-loading-delay'), 0);
        const loadingClasses = (el.getAttribute('data-w-loading-class') || '')
          .trim()
          .split(/\s+/)
          .filter(Boolean);

        let delayTimer = null;
        let generation = 0;
        let visuallyActive = false;

        const applyVisualLoading = (active) => {
          visuallyActive = active;
          toggleElementVisibility(el, isHide ? !active : active, initialDisplay);
          if (loadingClasses.length > 0 && el.classList) {
            for (let c = 0; c < loadingClasses.length; c++) {
              setOwnedClassToken(el, loadingClasses[c], active);
            }
          }
        };

        // Initialize non-loading state synchronously when delay > 0
        if (delayMs > 0) {
          applyVisualLoading(false);
        }

        const stop = engine.effect(() => {
          if (!isConnected() || el.isConnected === false) return;
          const active =
            typeof isLoadingTargetActive === 'function'
              ? Boolean(isLoadingTargetActive(rawSpec))
              : Boolean(evaluateStateExpression(state, rawSpec || '$busy'));

          if (delayMs <= 0) {
            applyVisualLoading(active);
            return;
          }

          if (active) {
            if (visuallyActive || delayTimer) return;
            const gen = ++generation;
            delayTimer = setTimeout(() => {
              delayTimer = null;
              if (gen !== generation || !isConnected() || el.isConnected === false) return;
              applyVisualLoading(true);
            }, delayMs);
          } else {
            generation++;
            if (delayTimer) {
              clearTimeout(delayTimer);
              delayTimer = null;
            }
            applyVisualLoading(false);
          }
        });
        elDisposers.push(() => {
          generation++;
          if (delayTimer) {
            clearTimeout(delayTimer);
            delayTimer = null;
          }
          stop();
        });
      }

      // 3. data-w-disabled
      if (el.hasAttribute('data-w-disabled')) {
        const expr = el.getAttribute('data-w-disabled');
        const stop = engine.effect(() => {
          if (!isConnected() || el.isConnected === false) return;
          const disabled = Boolean(evaluateStateExpression(state, expr));
          if ('disabled' in el) {
            el.disabled = disabled;
          }
          if (disabled) {
            el.setAttribute('disabled', '');
            el.setAttribute('aria-disabled', 'true');
          } else {
            el.removeAttribute('disabled');
            el.removeAttribute('aria-disabled');
          }
        });
        elDisposers.push(stop);
      }

      // 4. data-w-model (two-way binding between input/select/textarea and controller state)
      if (el.hasAttribute('data-w-model')) {
        const modelPath = (el.getAttribute('data-w-model') || '').trim();
        const type = (el.type || '').toLowerCase();

        // Security & DOM standard: Never bind file inputs to programmatic value bindings
        if (modelPath && type !== 'file') {
          // Binding initialization: determine value ownership
          // If state defines the value (even if null, false, 0, or empty string), state owns it.
          // Only if state is undefined, seed from the DOM control's initial value.
          const initialStateVal = getByPath(state, modelPath);
          if (initialStateVal === undefined) {
            if (type === 'checkbox') {
              setByPath(state, modelPath, Boolean(el.checked));
            } else if (type === 'number' || type === 'range') {
              setByPath(state, modelPath, el.value === '' ? null : (Number.isNaN(Number(el.value)) ? null : Number(el.value)));
            } else if (el.tagName === 'SELECT' && el.multiple) {
              const selected = [];
              const opts = el.options || [];
              for (let j = 0; j < opts.length; j++) {
                if (opts[j].selected) selected.push(opts[j].value);
              }
              setByPath(state, modelPath, selected);
            } else {
              setByPath(state, modelPath, el.value !== undefined ? el.value : '');
            }
          }

          // Track IME composition state so typing during composition doesn't jump or corrupt input
          let isComposing = false;
          const onCompositionStart = () => {
            isComposing = true;
          };
          const onCompositionEnd = () => {
            isComposing = false;
            onModelInput();
          };
          el.addEventListener('compositionstart', onCompositionStart);
          el.addEventListener('compositionend', onCompositionEnd);
          elDisposers.push(() => {
            try {
              el.removeEventListener('compositionstart', onCompositionStart);
              el.removeEventListener('compositionend', onCompositionEnd);
            } catch (_e) {}
          });

          // State -> DOM effect (synchronizes changes in state to the DOM control)
          const stopModelEffect = engine.effect(() => {
            if (!isConnected() || el.isConnected === false || isComposing) return;
            const currentVal = getByPath(state, modelPath);

            if (type === 'checkbox') {
              if (isArray(currentVal)) {
                el.checked = currentVal.map(String).includes(String(el.value));
              } else {
                el.checked = Boolean(currentVal);
              }
            } else if (type === 'radio') {
              el.checked = String(currentVal) === String(el.value);
            } else if (el.tagName === 'SELECT' && el.multiple) {
              const arr = isArray(currentVal) ? currentVal.map(String) : [];
              const opts = el.options || [];
              for (let j = 0; j < opts.length; j++) {
                opts[j].selected = arr.includes(String(opts[j].value));
              }
            } else {
              const formatted = currentVal === null || currentVal === undefined ? '' : String(currentVal);
              if (el.value !== formatted) {
                el.value = formatted;
              }
            }
          });
          elDisposers.push(stopModelEffect);

          // DOM -> State listener (synchronizes user interactions to state)
          const evtType =
            type === 'checkbox' || type === 'radio' || el.tagName === 'SELECT'
              ? 'change'
              : 'input';

          const onModelInput = () => {
            if (!isConnected() || el.isConnected === false || isComposing) return;

            if (type === 'checkbox') {
              const cur = getByPath(state, modelPath);
              if (isArray(cur)) {
                const next = el.checked
                  ? Array.from(new Set([...cur, el.value]))
                  : cur.filter((item) => String(item) !== String(el.value));
                setByPath(state, modelPath, next);
              } else {
                setByPath(state, modelPath, Boolean(el.checked));
              }
            } else if (type === 'radio') {
              if (el.checked) {
                setByPath(state, modelPath, el.value);
              }
            } else if (type === 'number' || type === 'range') {
              // Explicit empty number behavior: empty string converts to null, never 0!
              setByPath(state, modelPath, el.value === '' ? null : (Number.isNaN(Number(el.value)) ? null : Number(el.value)));
            } else if (el.tagName === 'SELECT' && el.multiple) {
              const selected = [];
              const opts = el.options || [];
              for (let j = 0; j < opts.length; j++) {
                if (opts[j].selected) selected.push(opts[j].value);
              }
              setByPath(state, modelPath, selected);
            } else {
              setByPath(state, modelPath, el.value);
            }
          };

          el.addEventListener(evtType, onModelInput);
          elDisposers.push(() => el.removeEventListener(evtType, onModelInput));
        }
      }

      // 5. Event bindings (data-w-on:<event>, data-w-on, data-w-click)
      const eventBindings = extractEventBindings(el);
      if (eventBindings.length > 0) {
        let isEventComposing = false;
        const hasScheduled = eventBindings.some((b) => parseEventScheduleModifiers(b.modifiers) !== null);
        if (hasScheduled) {
          const onCompStart = () => {
            isEventComposing = true;
          };
          const onCompEnd = () => {
            isEventComposing = false;
          };
          el.addEventListener('compositionstart', onCompStart);
          el.addEventListener('compositionend', onCompEnd);
          elDisposers.push(() => {
            try {
              el.removeEventListener('compositionstart', onCompStart);
              el.removeEventListener('compositionend', onCompEnd);
            } catch (_e) {}
          });
        }

        const parentForm = typeof el.closest === 'function' ? el.closest('form') : el.form || null;

        for (const binding of eventBindings) {
          const schedule = parseEventScheduleModifiers(binding.modifiers);
          if (!schedule) {
            const listener = (event) => {
              if (!isConnected() || el.isConnected === false) return;
              if (binding.modifiers.has('prevent')) event.preventDefault();
              if (binding.modifiers.has('stop')) event.stopPropagation();
              invokeAction(binding.actionName, event, el);
            };
            el.addEventListener(binding.eventName, listener);
            elDisposers.push(() => el.removeEventListener(binding.eventName, listener));
            continue;
          }

          let timer = null;
          let lastExecTime = 0;
          let pendingEvent = null;
          let generation = 0;

          const cancelPending = () => {
            generation++;
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            pendingEvent = null;
          };

          const fireScheduled = (capturedEvent) => {
            if (!isConnected() || el.isConnected === false) return;
            invokeAction(binding.actionName, capturedEvent, el);
          };

          const listener = (event) => {
            if (!isConnected() || el.isConnected === false) return;
            if (binding.modifiers.has('prevent')) event.preventDefault();
            if (binding.modifiers.has('stop')) event.stopPropagation();
            if (
              (event.isComposing || isEventComposing) &&
              (binding.eventName === 'input' || binding.eventName === 'keydown' || binding.eventName === 'keyup')
            ) {
              return;
            }

            // Capture a safe event reference (never rely on event.currentTarget after async delay)
            const capturedEvent = event;
            const gen = generation;

            if (schedule.mode === 'debounce') {
              const callNow = schedule.leading && !timer;
              if (timer) clearTimeout(timer);
              pendingEvent = capturedEvent;
              timer = setTimeout(() => {
                timer = null;
                if (gen !== generation) return;
                const evtToPass = pendingEvent;
                pendingEvent = null;
                if (schedule.trailing && evtToPass) {
                  fireScheduled(evtToPass);
                }
              }, schedule.waitMs);
              if (callNow) {
                pendingEvent = null;
                fireScheduled(capturedEvent);
              }
            } else {
              // Throttle: default leading + trailing
              const now = Date.now();
              const remaining = schedule.waitMs - (now - lastExecTime);
              if (remaining <= 0 || remaining > schedule.waitMs) {
                if (timer) {
                  clearTimeout(timer);
                  timer = null;
                }
                pendingEvent = null;
                if (schedule.leading) {
                  lastExecTime = now;
                  fireScheduled(capturedEvent);
                } else if (schedule.trailing) {
                  pendingEvent = capturedEvent;
                  timer = setTimeout(() => {
                    timer = null;
                    if (gen !== generation) return;
                    lastExecTime = Date.now();
                    const evtToPass = pendingEvent;
                    pendingEvent = null;
                    if (evtToPass) fireScheduled(evtToPass);
                  }, schedule.waitMs);
                }
              } else if (schedule.trailing) {
                pendingEvent = capturedEvent;
                if (!timer) {
                  timer = setTimeout(() => {
                    timer = null;
                    if (gen !== generation) return;
                    lastExecTime = schedule.leading ? Date.now() : 0;
                    const evtToPass = pendingEvent;
                    pendingEvent = null;
                    if (evtToPass) fireScheduled(evtToPass);
                  }, remaining);
                }
              }
            }
          };

          el.addEventListener(binding.eventName, listener);
          elDisposers.push(() => {
            cancelPending();
            el.removeEventListener(binding.eventName, listener);
          });

          if (parentForm && typeof parentForm.addEventListener === 'function') {
            const onFormReset = () => cancelPending();
            parentForm.addEventListener('reset', onFormReset);
            elDisposers.push(() => {
              try {
                parentForm.removeEventListener('reset', onFormReset);
              } catch (_e) {}
            });
          }
        }
      }
    }

    return function unbindInstanceDom() {
      const map = boundElementsByInstance.get(instanceId);
      if (map) {
        for (const elDisposers of map.values()) {
          for (let i = 0; i < elDisposers.length; i++) {
            try {
              elDisposers[i]();
            } catch (_err) {
              // Ignore individual unbind errors
            }
          }
        }
        map.clear();
        boundElementsByInstance.delete(instanceId);
      }
    };
  }

  /**
   * Morph a fragment element in place using the Datastar-compatible morph engine.
   */
  function patchFragmentElement(targetEl, htmlString, lifecycleCallbacks = {}) {
    if (!targetEl || typeof htmlString !== 'string') return targetEl;
    const doc = targetEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const parsed = parseHtmlFragment(htmlString, doc);
    if (!parsed) return targetEl;

    // Capture active focus & text selection if inside targetEl before morphing
    let focusedEl = null;
    let selStart = null;
    let selEnd = null;
    if (
      doc &&
      doc.activeElement &&
      typeof targetEl.contains === 'function' &&
      targetEl.contains(doc.activeElement)
    ) {
      focusedEl = doc.activeElement;
      try {
        if (typeof focusedEl.selectionStart === 'number') selStart = focusedEl.selectionStart;
        if (typeof focusedEl.selectionEnd === 'number') selEnd = focusedEl.selectionEnd;
      } catch (_e) {}
    }

    const morphed = morphDomTrees(targetEl, parsed, {
      onBeforeNodeRemove: lifecycleCallbacks.onBeforeNodeRemove,
      onNodeAdded: lifecycleCallbacks.onNodeAdded,
      debug: options.debug || null,
    });

    // Restore focus & selection range if the focused element was preserved inside targetEl
    if (
      focusedEl &&
      focusedEl.isConnected !== false &&
      typeof targetEl.contains === 'function' &&
      targetEl.contains(focusedEl)
    ) {
      try {
        if (doc && doc.activeElement !== focusedEl && typeof focusedEl.focus === 'function') {
          focusedEl.focus();
        }
        if (
          typeof selStart === 'number' &&
          typeof selEnd === 'number' &&
          typeof focusedEl.setSelectionRange === 'function'
        ) {
          focusedEl.setSelectionRange(selStart, selEnd);
        }
      } catch (_e) {}
    }

    // If external @starfederation/datastar is active, notify apply() on updated subtree
    if (externalDatastar && typeof externalDatastar.apply === 'function') {
      try {
        externalDatastar.apply();
      } catch (_err) {
        // Ignore
      }
    }

    return morphed;
  }

  return {
    PluginType,
    Requirement,
    DATASTAR_SIGNAL_EVENT,
    DATASTAR_SSE_EVENT,
    engine,
    createIsolatedControllerState: (instanceId, initialState, isConnected, debug, computedDefs, getContext) =>
      createIsolatedControllerState(engine, instanceId, initialState, isConnected, debug, computedDefs, getContext),
    bindControllerDom,
    patchFragmentElement,
    patchElements: patchFragmentElement,
    morphDomTrees,
    parseHtmlFragment,
    evaluateStateExpression,
    getByPath,
    setByPath,
    isWithinControllerScope,
    collectScopedElements,
    getBoundInstanceCount: () => boundElementsByInstance.size,
    getBoundElementCount: () => {
      let total = 0;
      for (const m of boundElementsByInstance.values()) {
        total += m.size;
      }
      return total;
    },
  };
}

module.exports = {
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,
};


},
    "./api": function(module, exports, require) {
'use strict';

/**
 * Webspresso Typed API Client & Request Coordinator
 *
 * Provides:
 * - Explicit concurrency policies per request key: 'latest' | 'drop' | 'queue' | 'parallel'
 * - Zero automatic retry on mutations (POST, PUT, PATCH, DELETE)
 * - Structured error taxonomy: 'http' | 'network' | 'validation' | 'canceled'
 * - Wire format modeling (Date -> ISO, undefined query stripping, 204/empty -> undefined, File/Blob/FormData)
 * - Automatic CSRF token & same-origin credential attachment
 * - Two-phase mutation -> invalidation dispatch where refresh failure never fails a succeeded mutation
 * - Raw & streaming escape hatches (`api.raw`, `api.stream`)
 */

const { isArray, isNumber } = require('./utils');

const VALID_POLICIES = new Set(['latest', 'drop', 'queue', 'parallel']);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RESERVED_OPTION_KEYS = new Set([
  'query',
  'params',
  'headers',
  'signal',
  'key',
  'policy',
  'concurrency',
  'credentials',
  'csrfToken',
  'parseResponse',
  'onRefreshError',
  'timeout',
  'retry',
  'retryMutations',
  'raw',
]);

/**
 * Structured Client Request Error
 * Distinguishes 'http', 'network', 'validation', 'canceled', and 'timeout' failure modes.
 */
class ClientRequestError extends Error {
  /**
   * @param {string} message
   * @param {object} details
   * @param {'http'|'network'|'validation'|'canceled'|'timeout'} details.kind
   * @param {number|null} [details.status]
   * @param {string} [details.code]
   * @param {string} [details.method]
   * @param {string} [details.url]
   * @param {string} [details.key]
   * @param {Record<string, string>} [details.fieldErrors]
   * @param {Record<string, string[]>} [details.fieldErrorList]
   * @param {Array<{path: string, message: string, code?: string}>} [details.issues]
   * @param {string|null} [details.formError]
   * @param {unknown} [details.data]
   * @param {boolean} [details.isDropped]
   * @param {boolean} [details.isSuperseded]
   * @param {boolean} [details.isTimedOut]
   * @param {Error} [details.cause]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'ClientRequestError';
    this.kind = details.kind || 'http';
    this.status = details.status !== undefined ? details.status : null;
    this.code = details.code || defaultCodeForKind(this.kind, this.status);
    this.method = details.method || 'GET';
    this.url = details.url || '';
    this.key = details.key || '';
    this.fieldErrors = details.fieldErrors || {};
    this.fieldErrorList = details.fieldErrorList || {};
    this.issues = isArray(details.issues) ? details.issues : [];
    this.formError = details.formError || null;
    this.data = details.data !== undefined ? details.data : null;
    this.isCanceled = this.kind === 'canceled';
    this.isValidation = this.kind === 'validation';
    this.isNetwork = this.kind === 'network';
    this.isHttp = this.kind === 'http';
    this.isTimedOut =
      this.kind === 'timeout' ||
      Boolean(details.isTimedOut) ||
      this.code === 'REQUEST_TIMED_OUT' ||
      this.status === 408;
    this.isDropped = Boolean(details.isDropped);
    this.isSuperseded = Boolean(details.isSuperseded);
    this.dispatched =
      details.dispatched !== undefined
        ? Boolean(details.dispatched)
        : !this.isDropped && (this.kind !== 'canceled' || Boolean(details.cause));
    this.outcomeUnknown =
      details.outcomeUnknown !== undefined
        ? Boolean(details.outcomeUnknown)
        : MUTATION_METHODS.has(this.method) &&
          this.dispatched &&
          !this.isDropped &&
          (this.kind === 'timeout' || this.kind === 'network' || this.kind === 'canceled');
    this.outcome = this.outcomeUnknown
      ? 'unknown'
      : !this.dispatched || this.isDropped
        ? 'not_sent'
        : 'failed';
    this.serverRollbackGuaranteed = false;
    if (this.isCanceled) {
      this.note = 'Client request cancellation/abort does not roll back server-side execution.';
    } else if (this.outcomeUnknown) {
      this.note =
        'Mutation request was dispatched before response delivery failed; the server may have committed the operation.';
    }
    if (details.cause) {
      this.cause = details.cause;
    }
  }
}

function defaultCodeForKind(kind, status) {
  if (kind === 'timeout' || status === 408) return 'REQUEST_TIMED_OUT';
  if (kind === 'validation') return 'VALIDATION_ERROR';
  if (kind === 'canceled') return 'REQUEST_CANCELED';
  if (kind === 'network') return 'NETWORK_ERROR';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return 'HTTP_ERROR';
}

/**
 * Discover CSRF token from DOM meta tag, hidden `_csrf` input, or cookies.
 *
 * @param {Document} [doc]
 * @returns {string|null}
 */
function discoverCsrfToken(doc) {
  const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!targetDoc) return null;

  if (typeof targetDoc.querySelector === 'function') {
    const meta =
      targetDoc.querySelector('meta[name="csrf-token"]') ||
      targetDoc.querySelector('meta[name="xsrf-token"]');
    if (meta && typeof meta.getAttribute === 'function') {
      const content = meta.getAttribute('content');
      if (content) return content.trim();
    }

    const input = targetDoc.querySelector('input[name="_csrf"]');
    if (input && input.value) {
      return String(input.value).trim();
    }
  }

  if (typeof targetDoc.cookie === 'string' && targetDoc.cookie) {
    const cookies = targetDoc.cookie.split(';');
    for (const raw of cookies) {
      const [rawName, ...rest] = raw.trim().split('=');
      if (rawName === 'XSRF-TOKEN' || rawName === '_csrf' || rawName === 'csrf_token') {
        try {
          return decodeURIComponent(rest.join('='));
        } catch (_e) {
          return rest.join('=');
        }
      }
    }
  }

  return null;
}

/**
 * Interpolate `:param` or `[param]` segments in URL paths and append query parameters.
 * Strips `undefined` values and formats `Date` instances as ISO strings.
 *
 * @param {string} urlTemplate
 * @param {Record<string, unknown>} [params]
 * @param {Record<string, unknown>} [query]
 * @returns {string}
 */
function buildRequestUrl(urlTemplate, params, query) {
  let resolvedPath = String(urlTemplate || '');

  if (params && typeof params === 'object') {
    for (const [key, val] of Object.entries(params)) {
      if (val === undefined || val === null) continue;
      const encoded = encodeURIComponent(val instanceof Date ? val.toISOString() : String(val));
      resolvedPath = resolvedPath
        .replace(new RegExp(`:${key}(?=/|$|\\?)`, 'g'), encoded)
        .replace(new RegExp(`\\[${key}\\]`, 'g'), encoded);
    }
  }

  if (!query || typeof query !== 'object') {
    return resolvedPath;
  }

  const searchParams = new URLSearchParams();
  for (const [key, rawVal] of Object.entries(query)) {
    if (rawVal === undefined) continue;
    if (isArray(rawVal)) {
      for (const item of rawVal) {
        if (item === undefined) continue;
        searchParams.append(key, item instanceof Date ? item.toISOString() : String(item));
      }
    } else if (rawVal instanceof Date) {
      searchParams.append(key, rawVal.toISOString());
    } else if (rawVal === null) {
      searchParams.append(key, '');
    } else if (typeof rawVal === 'object') {
      searchParams.append(key, JSON.stringify(rawVal));
    } else {
      searchParams.append(key, String(rawVal));
    }
  }

  const qs = searchParams.toString();
  if (!qs) return resolvedPath;
  return resolvedPath.includes('?') ? `${resolvedPath}&${qs}` : `${resolvedPath}?${qs}`;
}

/**
 * Check whether an object contains binary File or Blob instances that require FormData transport.
 */
function containsBinaryValue(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof File !== 'undefined' && value instanceof File) return true;
  if (typeof FormData !== 'undefined' && value instanceof FormData) return true;
  if (isArray(value)) {
    return value.some(containsBinaryValue);
  }
  for (const v of Object.values(value)) {
    if (containsBinaryValue(v)) return true;
  }
  return false;
}

/**
 * Convert a plain object containing File/Blob values into FormData.
 */
function objectToFormData(obj) {
  const fd = new FormData();
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (isArray(val)) {
      for (const item of val) {
        if (item === undefined) continue;
        if (typeof Blob !== 'undefined' && item instanceof Blob) {
          fd.append(key, item);
        } else if (item instanceof Date) {
          fd.append(key, item.toISOString());
        } else if (item !== null) {
          fd.append(key, String(item));
        }
      }
    } else if (typeof Blob !== 'undefined' && val instanceof Blob) {
      fd.append(key, val);
    } else if (val instanceof Date) {
      fd.append(key, val.toISOString());
    } else if (val === null) {
      fd.append(key, '');
    } else if (typeof val === 'object') {
      fd.append(key, JSON.stringify(val));
    } else {
      fd.append(key, String(val));
    }
  }
  return fd;
}

/**
 * Serialize JSON payload while converting Date objects to ISO strings.
 */
function serializeRequestBody(body, headers) {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return body;
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    return body.toString();
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return body;
  }
  if (typeof body === 'string') {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'text/plain;charset=UTF-8';
    }
    return body;
  }
  if (containsBinaryValue(body) && typeof FormData !== 'undefined') {
    return objectToFormData(body);
  }
  if (!headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  return JSON.stringify(body);
}

/**
 * Extract structured validation field errors from Webspresso / Zod error payloads.
 *
 * @param {unknown} payload
 * @returns {{ fieldErrors: Record<string, string>, fieldErrorList: Record<string, string[]>, issues: Array<{path: string, message: string, code?: string}>, formError: string|null }}
 */
function extractValidationErrors(payload) {
  const fieldErrors = {};
  const fieldErrorList = {};
  const issues = [];
  let formError = null;

  if (!payload || typeof payload !== 'object') {
    return { fieldErrors, fieldErrorList, issues, formError };
  }

  const errObj = payload.error && typeof payload.error === 'object' ? payload.error : payload;

  if (typeof errObj.formError === 'string' && errObj.formError) {
    formError = errObj.formError;
  } else if (typeof payload.formError === 'string' && payload.formError) {
    formError = payload.formError;
  }

  // 1. Direct fieldErrors map (e.g. { title: 'Required' } or { title: ['Required'] })
  const rawFieldErrors = errObj.fieldErrors || payload.fieldErrors || errObj.fields || null;
  if (rawFieldErrors && typeof rawFieldErrors === 'object' && !isArray(rawFieldErrors)) {
    for (const [field, msgOrArr] of Object.entries(rawFieldErrors)) {
      const list = isArray(msgOrArr) ? msgOrArr.map(String) : [String(msgOrArr)];
      if (list.length > 0) {
        fieldErrors[field] = list[0];
        fieldErrorList[field] = list;
        issues.push({ path: field, message: list[0] });
      }
    }
  }

  // 2. Zod / Webspresso `issues` or `details` array
  const rawIssues =
    (isArray(errObj.issues) && errObj.issues) ||
    (isArray(payload.issues) && payload.issues) ||
    (isArray(errObj.details) && errObj.details) ||
    (isArray(payload.details) && payload.details) ||
    (isArray(errObj.errors) && errObj.errors) ||
    [];

  for (const issue of rawIssues) {
    if (!issue || typeof issue !== 'object') continue;
    let rawPath = '';
    if (isArray(issue.path)) {
      // Strip leading 'body' / 'query' / 'params' prefix from route validation paths
      const cleanParts =
        issue.path.length > 1 &&
        (issue.path[0] === 'body' || issue.path[0] === 'query' || issue.path[0] === 'params')
          ? issue.path.slice(1)
          : issue.path;
      rawPath = cleanParts.join('.');
    } else if (typeof issue.path === 'string') {
      rawPath = issue.path.replace(/^(body|query|params)\./, '');
    } else if (typeof issue.field === 'string') {
      rawPath = issue.field.replace(/^(body|query|params)\./, '');
    }

    const message = issue.message ? String(issue.message) : 'Invalid value';
    issues.push({ path: rawPath, message, code: issue.code });

    if (rawPath) {
      if (!fieldErrors[rawPath]) {
        fieldErrors[rawPath] = message;
      }
      if (!fieldErrorList[rawPath]) {
        fieldErrorList[rawPath] = [];
      }
      if (!fieldErrorList[rawPath].includes(message)) {
        fieldErrorList[rawPath].push(message);
      }
    } else if (!formError) {
      formError = message;
    }
  }

  if (!formError && typeof errObj.message === 'string' && Object.keys(fieldErrors).length === 0) {
    formError = errObj.message;
  }

  return { fieldErrors, fieldErrorList, issues, formError };
}

/**
 * Separate invalidation infrastructure metadata from application data.
 * Supports:
 * - `X-Webspresso-Invalidate` response header
 * - `{ data, invalidate }` mutation result envelope
 */
function unwrapApiResultAndInvalidate(parsedBody, responseHeaders) {
  const headerTags = [];
  if (responseHeaders && typeof responseHeaders.get === 'function') {
    const rawHeader = responseHeaders.get('x-webspresso-invalidate');
    if (rawHeader) {
      for (const tag of rawHeader.split(',')) {
        const trimmed = tag.trim();
        if (trimmed) headerTags.push(trimmed);
      }
    }
  }

  let data = parsedBody;
  const bodyTags = [];

  if (
    parsedBody &&
    typeof parsedBody === 'object' &&
    !isArray(parsedBody) &&
    isArray(parsedBody.invalidate) &&
    'data' in parsedBody
  ) {
    for (const tag of parsedBody.invalidate) {
      if (typeof tag === 'string' && tag.trim()) {
        bodyTags.push(tag.trim());
      }
    }
    data = parsedBody.data;
    // Provide non-enumerable `.data` self-reference on object payloads so both
    // `result.id` and `result.data.id` work seamlessly.
    if (data && typeof data === 'object' && !('data' in data)) {
      Object.defineProperty(data, 'data', {
        value: data,
        enumerable: false,
        configurable: true,
      });
    }
  }

  const invalidate = Array.from(new Set([...headerTags, ...bodyTags]));
  return { data, invalidate };
}

/**
 * Normalize arguments for `api.get(url, inputOrOptions?, options?)`.
 */
function normalizeGetArgs(inputOrOptions, explicitOptions) {
  if (explicitOptions && typeof explicitOptions === 'object') {
    const inp = inputOrOptions && typeof inputOrOptions === 'object' ? inputOrOptions : {};
    const query = inp.query && typeof inp.query === 'object' ? inp.query : inp;
    const params = explicitOptions.params || inp.params;
    return {
      ...explicitOptions,
      query,
      params,
    };
  }

  if (!inputOrOptions || typeof inputOrOptions !== 'object') {
    return {};
  }

  const keys = Object.keys(inputOrOptions);
  const hasExplicitWrapper =
    'query' in inputOrOptions ||
    'params' in inputOrOptions ||
    'policy' in inputOrOptions ||
    'concurrency' in inputOrOptions ||
    'key' in inputOrOptions ||
    'signal' in inputOrOptions ||
    'headers' in inputOrOptions ||
    'timeout' in inputOrOptions ||
    'retry' in inputOrOptions ||
    'retryMutations' in inputOrOptions;

  if (hasExplicitWrapper && keys.every((k) => RESERVED_OPTION_KEYS.has(k))) {
    return { ...inputOrOptions };
  }

  // Mix of query keys and reserved options or pure query object
  const query = {};
  const opts = {};
  for (const [k, v] of Object.entries(inputOrOptions)) {
    if (RESERVED_OPTION_KEYS.has(k)) {
      opts[k] = v;
    } else {
      query[k] = v;
    }
  }
  if (opts.query && typeof opts.query === 'object') {
    Object.assign(query, opts.query);
  }
  opts.query = query;
  return opts;
}

/**
 * Normalize retry options into an actionable execution descriptor.
 * Never allows retries on mutations unless `retryMutations: true` is explicitly opted into.
 *
 * @param {boolean|number|object} [retryOpt]
 * @param {string} upperMethod
 * @param {boolean} [retryMutations=false]
 * @returns {object|null}
 */
function normalizeRetryConfig(retryOpt, upperMethod, retryMutations = false) {
  if (!retryOpt) return null;

  // Strict invariant: never automatically retry mutation methods (POST, PUT, PATCH, DELETE)
  if (MUTATION_METHODS.has(upperMethod) && !retryMutations) {
    return null;
  }

  let count = 0;
  let delay = 300;
  let maxDelay = 5000;
  let backoff = 'exponential';
  let statusCodes = new Set([408, 429, 502, 503, 504]);
  let onRetry = null;

  if (isNumber(retryOpt)) {
    count = Math.max(0, Math.floor(retryOpt));
  } else if (retryOpt === true) {
    count = 2;
  } else if (typeof retryOpt === 'object' && retryOpt !== null) {
    count = isNumber(retryOpt.count) ? Math.max(0, Math.floor(retryOpt.count)) : 2;
    if (isNumber(retryOpt.delay)) delay = Math.max(0, retryOpt.delay);
    if (isNumber(retryOpt.maxDelay)) maxDelay = Math.max(delay, retryOpt.maxDelay);
    if (retryOpt.backoff === 'linear' || retryOpt.backoff === 'exponential') {
      backoff = retryOpt.backoff;
    }
    if (isArray(retryOpt.statusCodes)) {
      statusCodes = new Set(retryOpt.statusCodes);
    }
    if (typeof retryOpt.onRetry === 'function') {
      onRetry = retryOpt.onRetry;
    }
  }

  if (count <= 0) return null;

  return {
    count,
    delay,
    maxDelay,
    backoff,
    statusCodes,
    onRetry,
  };
}

/**
 * Determine whether an error is transient and eligible for retry.
 */
function isRetryableError(err, statusCodes) {
  if (!err) return false;
  // Canceled, dropped, or superseded requests must never retry
  if (err.isCanceled || err.isDropped || err.isSuperseded) return false;
  // Network failures and timeouts are retryable
  if (err.kind === 'network' || err.kind === 'timeout' || err.isTimedOut) return true;
  // Transient HTTP status codes
  if (isNumber(err.status) && statusCodes && statusCodes.has(err.status)) {
    return true;
  }
  return false;
}

/**
 * Calculate retry delay with jitter.
 */
function calculateRetryDelay(attempt, config) {
  const base = config.delay;
  const max = config.maxDelay;
  let calculated;
  if (config.backoff === 'linear') {
    calculated = base * attempt;
  } else {
    calculated = base * Math.pow(2, attempt - 1);
  }
  const jitter = Math.random() * 50;
  return Math.min(max, calculated + jitter);
}

/**
 * Abortable delay helper that rejects immediately if any signal aborts during wait.
 */
function abortableSleep(ms, signals = []) {
  return new Promise((resolve, reject) => {
    for (const sig of signals) {
      if (sig && sig.aborted) {
        return reject(new Error('Sleep aborted'));
      }
    }

    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      for (const sig of signals) {
        if (sig && typeof sig.removeEventListener === 'function') {
          sig.removeEventListener('abort', onAbort);
        }
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Sleep aborted'));
    };

    for (const sig of signals) {
      if (sig && typeof sig.addEventListener === 'function') {
        sig.addEventListener('abort', onAbort, { once: true });
      }
    }

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
  });
}

function parseXhrHeaders(rawHeaders) {
  const map = new Map();
  if (typeof rawHeaders === 'string' && rawHeaders) {
    const lines = rawHeaders.trim().split(/[\r\n]+/);
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].indexOf(':');
      if (idx > 0) {
        const k = lines[i].slice(0, idx).trim().toLowerCase();
        const v = lines[i].slice(idx + 1).trim();
        map.set(k, v);
      }
    }
  }
  return {
    get(name) {
      return map.get(String(name || '').toLowerCase()) ?? null;
    },
    has(name) {
      return map.has(String(name || '').toLowerCase());
    },
  };
}

function executeXhrUpload({ url, method, headers, body, credentials, signal, onUploadProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    if (credentials === 'include' || credentials === 'same-origin') {
      xhr.withCredentials = credentials === 'include';
    }
    if (headers && typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        if (v !== undefined && v !== null) {
          xhr.setRequestHeader(k, String(v));
        }
      }
    }

    if (xhr.upload && typeof onUploadProgress === 'function') {
      xhr.upload.onprogress = (evt) => {
        const lengthComputable = Boolean(evt && evt.lengthComputable);
        const loaded = evt && typeof evt.loaded === 'number' ? evt.loaded : 0;
        const total = lengthComputable && evt && typeof evt.total === 'number' ? evt.total : 0;
        const percent = lengthComputable && total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
        try {
          onUploadProgress({ loaded, total, percent, lengthComputable });
        } catch (_e) {}
      };
    }

    const onAbort = () => {
      try {
        xhr.abort();
      } catch (_e) {}
    };
    if (signal) {
      if (signal.aborted) {
        const abortErr = new Error('The operation was aborted.');
        abortErr.name = 'AbortError';
        reject(abortErr);
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (signal) {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (_e) {}
      }
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status === 0) {
        reject(new TypeError('Network request failed'));
        return;
      }
      const status = xhr.status === 1223 ? 204 : xhr.status;
      const rawText = typeof xhr.responseText === 'string' ? xhr.responseText : '';
      const headerObj = parseXhrHeaders(xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : '');
      resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText: xhr.statusText || '',
        headers: headerObj,
        text: async () => rawText,
        json: async () => (rawText ? JSON.parse(rawText) : null),
      });
    };

    xhr.onerror = () => {
      cleanup();
      reject(new TypeError('Network request failed'));
    };

    xhr.onabort = () => {
      cleanup();
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      reject(abortErr);
    };

    xhr.send(body === undefined ? null : body);
  });
}

/**
 * Create a Typed API Client instance.
 *
 * @param {object} [config]
 * @param {typeof fetch} [config.fetch] - Custom fetch implementation
 * @param {string} [config.baseUrl=''] - Optional base URL prefix
 * @param {() => string|null} [config.getCsrfToken] - Custom CSRF token provider
 * @param {(tags: string[], meta: object) => Promise<unknown>|unknown} [config.onInvalidate] - Fragment invalidation callback
 * @param {(err: Error, meta: object) => void} [config.onRefreshError] - Callback if background fragment refresh fails after mutation
 * @param {AbortSignal} [config.lifecycleSignal] - Controller lifecycle signal (aborts in-flight requests on unmount)
 * @param {() => boolean} [config.isConnected] - Controller connection check
 * @param {object} [config.debug] - Client debugger instance
 */
function trimTrailingSlashes(str) {
  if (!str) return '';
  let end = str.length;
  while (end > 0 && str.charCodeAt(end - 1) === 47) {
    end--;
  }
  return end === str.length ? str : str.slice(0, end);
}

function createApiClient(config = {}) {
  const fetchImpl =
    config.fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const baseUrl = config.baseUrl ? trimTrailingSlashes(String(config.baseUrl)) : '';
  const lifecycleSignal = config.lifecycleSignal || null;
  const isConnected = typeof config.isConnected === 'function' ? config.isConnected : () => true;
  const debug = config.debug || null;
  const onInvalidate = typeof config.onInvalidate === 'function' ? config.onInvalidate : null;
  const onRefreshError = typeof config.onRefreshError === 'function' ? config.onRefreshError : null;

  // Concurrency state maps per request key
  const latestMap = new Map(); // key -> { seq: number, controller: AbortController, requestId: string }
  const inFlightMap = new Map(); // key -> Set<string> (active requestIds)
  const queueMap = new Map(); // key -> Promise<unknown>
  let reqCounter = 0;
  let lastRefreshPromise = null;

  function resolvePolicy(policy) {
    if (!policy) return 'parallel';
    const normalized = String(policy).toLowerCase();
    if (!VALID_POLICIES.has(normalized)) {
      throw new Error(
        `Invalid request concurrency policy "${policy}". Expected one of: latest, drop, queue, parallel.`
      );
    }
    return normalized;
  }

  /**
   * Core request executor supporting concurrency policies.
   */
  async function executeRequest(method, urlTemplate, body, options = {}) {
    if (!fetchImpl) {
      throw new Error('Global fetch is not available in this environment.');
    }

    const upperMethod = String(method || 'GET').toUpperCase();
    const policy = resolvePolicy(options.policy || options.concurrency);
    const requestUrl = buildRequestUrl(
      baseUrl ? `${baseUrl}${urlTemplate}` : urlTemplate,
      options.params,
      options.query
    );
    const baseKeyPath = String(urlTemplate || '').split('?')[0];
    const requestKey = options.key ? String(options.key) : `${upperMethod}:${baseKeyPath}`;
    const requestId = `req_${++reqCounter}_${Date.now()}`;

    // Check controller lifecycle before starting
    if (!isConnected() || (lifecycleSignal && lifecycleSignal.aborted)) {
      throw new ClientRequestError(`Request canceled: controller is disconnected (${upperMethod} ${requestUrl})`, {
        kind: 'canceled',
        method: upperMethod,
        url: requestUrl,
        key: requestKey,
        dispatched: false,
        outcomeUnknown: false,
      });
    }

    // Policy: 'drop' -> Do not start if another request with the same key is currently in flight
    const activeSet = inFlightMap.get(requestKey);
    if (policy === 'drop' && activeSet && activeSet.size > 0) {
      if (debug) {
        debug.trackDiscardedResponse({
          source: 'api',
          key: requestKey,
          url: requestUrl,
          reason: 'dropped-by-policy',
        });
      }
      throw new ClientRequestError(
        `Request dropped by 'drop' concurrency policy: "${requestKey}" is already in flight.`,
        {
          kind: 'canceled',
          code: 'REQUEST_DROPPED',
          method: upperMethod,
          url: requestUrl,
          key: requestKey,
          isDropped: true,
        }
      );
    }

    // Policy: 'queue' -> Chain onto existing queue for this key
    const retryConfig = normalizeRetryConfig(
      options.retry,
      upperMethod,
      Boolean(options.retryMutations)
    );

    async function executeWithRetry(runFn) {
      if (!retryConfig) {
        return runFn(requestId);
      }

      let attempt = 0;
      while (true) {
        attempt++;
        const currentReqId = attempt === 1 ? requestId : `req_${++reqCounter}_${Date.now()}`;
        try {
          return await runFn(currentReqId);
        } catch (err) {
          const canRetry =
            attempt <= retryConfig.count &&
            isConnected() &&
            (!lifecycleSignal || !lifecycleSignal.aborted) &&
            (!options.signal || !options.signal.aborted) &&
            isRetryableError(err, retryConfig.statusCodes);

          if (!canRetry) {
            throw err;
          }

          const delayMs = calculateRetryDelay(attempt, retryConfig);

          if (typeof retryConfig.onRetry === 'function') {
            try {
              retryConfig.onRetry(err, attempt, delayMs);
            } catch (_cbErr) {
              // Ignore callback error
            }
          }

          if (debug && typeof debug.trackRequestRetry === 'function') {
            debug.trackRequestRetry({
              requestId: currentReqId,
              key: requestKey,
              attempt,
              delay: delayMs,
              error: err,
            });
          }

          const activeSignals = [options.signal, lifecycleSignal].filter(Boolean);
          try {
            await abortableSleep(delayMs, activeSignals);
          } catch (_sleepErr) {
            throw new ClientRequestError(
              `Request canceled during retry backoff (${upperMethod} ${requestUrl}).`,
              {
                kind: 'canceled',
                code: 'REQUEST_CANCELED',
                method: upperMethod,
                url: requestUrl,
                key: requestKey,
              }
            );
          }
        }
      }
    }

    if (policy === 'queue') {
      const prevTail = queueMap.get(requestKey) || Promise.resolve();
      const nextTask = prevTail
        .catch(() => {})
        .then(() =>
          executeWithRetry((subReqId) =>
            runSingleRequest(upperMethod, requestUrl, body, options, requestKey, subReqId, 'queue')
          )
        );
      queueMap.set(
        requestKey,
        nextTask.catch(() => {})
      );
      return nextTask;
    }

    return executeWithRetry((subReqId) =>
      runSingleRequest(upperMethod, requestUrl, body, options, requestKey, subReqId, policy)
    );
  }

  async function runSingleRequest(upperMethod, requestUrl, body, options, requestKey, requestId, policy) {
    const abortController = new AbortController();
    let superseded = false;
    let timedOut = false;
    let timeoutTimer = null;
    let currentSeq = 1;

    if (isNumber(options.timeout) && options.timeout > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        abortController.abort();
      }, options.timeout);
    }

    // Policy: 'latest' -> Abort previous in-flight request for this key and increment sequence
    if (policy === 'latest') {
      const prev = latestMap.get(requestKey);
      if (prev) {
        currentSeq = prev.seq + 1;
        prev.superseded = true;
        try {
          prev.controller.abort();
        } catch (_e) {
          // Ignore
        }
      }
      latestMap.set(requestKey, {
        seq: currentSeq,
        controller: abortController,
        requestId,
        superseded: false,
      });
    }

    // Link caller AbortSignal and controller lifecycleSignal
    const onCallerAbort = () => abortController.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        abortController.abort();
      } else {
        options.signal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }
    if (lifecycleSignal) {
      if (lifecycleSignal.aborted) {
        abortController.abort();
      } else {
        lifecycleSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    if (!inFlightMap.has(requestKey)) {
      inFlightMap.set(requestKey, new Set());
    }
    inFlightMap.get(requestKey).add(requestId);

    if (debug) {
      debug.trackRequestStart({
        requestId,
        key: requestKey,
        method: upperMethod,
        url: requestUrl,
        policy,
        payload: body,
      });
    }

    const headers = {
      Accept: options.raw ? '*/*' : 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers || {}),
    };

    // Attach CSRF token on state-changing requests
    if (MUTATION_METHODS.has(upperMethod)) {
      const csrfToken =
        options.csrfToken ||
        (typeof config.getCsrfToken === 'function' ? config.getCsrfToken() : discoverCsrfToken());
      if (csrfToken && !headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }

    const serializedBody =
      upperMethod === 'GET' || upperMethod === 'HEAD'
        ? undefined
        : serializeRequestBody(body, headers);

    try {
      let response;
      try {
        if (typeof options.onUploadProgress === 'function' && typeof XMLHttpRequest !== 'undefined') {
          response = await executeXhrUpload({
            url: requestUrl,
            method: upperMethod,
            headers,
            body: serializedBody,
            credentials: options.credentials || 'same-origin',
            signal: abortController.signal,
            onUploadProgress: options.onUploadProgress,
          });
        } else {
          response = await fetchImpl(requestUrl, {
            method: upperMethod,
            headers,
            body: serializedBody,
            credentials: options.credentials || 'same-origin',
            signal: abortController.signal,
          });
        }
      } catch (fetchErr) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        const latestEntry = policy === 'latest' ? latestMap.get(requestKey) : null;
        if (latestEntry && (latestEntry.seq !== currentSeq || latestEntry.superseded)) {
          superseded = true;
        }

        if (timedOut) {
          if (debug) {
            debug.trackRequestEnd(requestId, { status: 'failed', errorKind: 'timeout' });
          }
          throw new ClientRequestError(
            `Request timed out after ${options.timeout}ms (${upperMethod} ${requestUrl}).`,
            {
              kind: 'timeout',
              status: 408,
              code: 'REQUEST_TIMED_OUT',
              method: upperMethod,
              url: requestUrl,
              key: requestKey,
              isTimedOut: true,
              dispatched: true,
              cause: fetchErr,
            }
          );
        }

        const isAbort =
          superseded ||
          abortController.signal.aborted ||
          (fetchErr && (fetchErr.name === 'AbortError' || fetchErr.code === 'ABORT_ERR'));

        if (isAbort) {
          if (debug) {
            debug.trackDiscardedResponse({
              source: 'api',
              key: requestKey,
              url: requestUrl,
              reason: superseded ? 'superseded-by-latest' : 'aborted',
              version: currentSeq,
              currentVersion: latestEntry ? latestEntry.seq : currentSeq,
            });
            debug.trackRequestEnd(requestId, { status: 'canceled', errorKind: 'canceled' });
          }
          throw new ClientRequestError(
            superseded
              ? `Request superseded by newer '${requestKey}' request.`
              : `Request canceled (${upperMethod} ${requestUrl}).`,
            {
              kind: 'canceled',
              code: superseded ? 'REQUEST_SUPERSEDED' : 'REQUEST_CANCELED',
              method: upperMethod,
              url: requestUrl,
              key: requestKey,
              isSuperseded: superseded,
              dispatched: true,
              cause: fetchErr,
            }
          );
        }

        if (debug) {
          debug.trackRequestEnd(requestId, { status: 'failed', errorKind: 'network' });
        }
        throw new ClientRequestError(
          fetchErr && fetchErr.message ? fetchErr.message : `Network error (${upperMethod} ${requestUrl})`,
          {
            kind: 'network',
            method: upperMethod,
            url: requestUrl,
            key: requestKey,
            dispatched: true,
            cause: fetchErr,
          }
        );
      }

      // Check if superseded by a newer 'latest' request while awaiting response/body
      const checkSupersededOrDisconnected = () => {
        if (policy === 'latest') {
          const latestEntry = latestMap.get(requestKey);
          if (latestEntry && (latestEntry.seq !== currentSeq || latestEntry.superseded)) {
            if (debug) {
              debug.trackDiscardedResponse({
                source: 'api',
                key: requestKey,
                url: requestUrl,
                reason: 'superseded-by-latest',
                version: currentSeq,
                currentVersion: latestEntry.seq,
              });
              debug.trackRequestEnd(requestId, {
                status: 'discarded',
                httpStatus: response.status,
                errorKind: 'canceled',
              });
            }
            throw new ClientRequestError(`Stale response discarded for '${requestKey}'.`, {
              kind: 'canceled',
              code: 'REQUEST_SUPERSEDED',
              status: response.status,
              method: upperMethod,
              url: requestUrl,
              key: requestKey,
              isSuperseded: true,
            });
          }
        }
        if (!isConnected()) {
          if (debug) {
            debug.trackDiscardedResponse({
              source: 'api',
              key: requestKey,
              url: requestUrl,
              reason: 'controller-disconnected',
            });
            debug.trackRequestEnd(requestId, {
              status: 'discarded',
              httpStatus: response.status,
              errorKind: 'canceled',
            });
          }
          throw new ClientRequestError(
            `Response discarded: controller disconnected (${upperMethod} ${requestUrl}).`,
            {
              kind: 'canceled',
              code: 'CONTROLLER_DISCONNECTED',
              status: response.status,
              method: upperMethod,
              url: requestUrl,
              key: requestKey,
            }
          );
        }
      };

      checkSupersededOrDisconnected();

      // Escape hatch: return raw Response without body consumption
      if (options.raw) {
        if (!response.ok) {
          throw new ClientRequestError(`HTTP ${response.status} (${upperMethod} ${requestUrl})`, {
            kind: 'http',
            status: response.status,
            method: upperMethod,
            url: requestUrl,
            key: requestKey,
          });
        }
        if (debug) {
          debug.trackRequestEnd(requestId, { status: 'completed', httpStatus: response.status });
        }
        return response;
      }

      // Parse response body according to wire format
      let parsedBody;
      const status = response.status;
      const contentType =
        response.headers && typeof response.headers.get === 'function'
          ? response.headers.get('content-type') || ''
          : '';

      if (status === 204 || status === 205) {
        parsedBody = undefined;
      } else if (typeof response.text === 'function') {
        let rawText;
        try {
          rawText = await response.text();
        } catch (bodyErr) {
          if (timedOut) {
            throw new ClientRequestError(
              `Request timed out after ${options.timeout}ms (${upperMethod} ${requestUrl}).`,
              {
                kind: 'timeout',
                status: 408,
                code: 'REQUEST_TIMED_OUT',
                method: upperMethod,
                url: requestUrl,
                key: requestKey,
                isTimedOut: true,
                cause: bodyErr,
              }
            );
          }
          throw bodyErr;
        }
        checkSupersededOrDisconnected();
        if (!rawText || !rawText.trim()) {
          parsedBody = undefined;
        } else if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
          try {
            parsedBody = JSON.parse(rawText);
          } catch (_jsonErr) {
            parsedBody = rawText;
          }
        } else {
          parsedBody = rawText;
        }
      } else if (typeof response.json === 'function') {
        try {
          parsedBody = await response.json();
        } catch (bodyErr) {
          if (timedOut) {
            throw new ClientRequestError(
              `Request timed out after ${options.timeout}ms (${upperMethod} ${requestUrl}).`,
              {
                kind: 'timeout',
                status: 408,
                code: 'REQUEST_TIMED_OUT',
                method: upperMethod,
                url: requestUrl,
                key: requestKey,
                isTimedOut: true,
                cause: bodyErr,
              }
            );
          }
          throw bodyErr;
        }
        checkSupersededOrDisconnected();
      }

      // Handle non-2xx HTTP responses
      if (!response.ok) {
        const errPayload = parsedBody && typeof parsedBody === 'object' ? parsedBody : {};
        const errBlock = errPayload.error && typeof errPayload.error === 'object' ? errPayload.error : errPayload;
        const errCode = errBlock.code || errPayload.code || null;
        const { fieldErrors, fieldErrorList, issues, formError } = extractValidationErrors(parsedBody);

        const isValidationStatus =
          status === 422 ||
          errCode === 'VALIDATION_ERROR' ||
          (status === 400 && (issues.length > 0 || Object.keys(fieldErrors).length > 0));

        const errorKind = isValidationStatus ? 'validation' : 'http';
        const message =
          formError ||
          (typeof errBlock.message === 'string' && errBlock.message) ||
          (typeof errPayload.message === 'string' && errPayload.message) ||
          `HTTP ${status} (${upperMethod} ${requestUrl})`;

        if (debug) {
          debug.trackRequestEnd(requestId, {
            status: 'failed',
            httpStatus: status,
            errorKind,
          });
        }

        throw new ClientRequestError(message, {
          kind: errorKind,
          status,
          code: errCode || defaultCodeForKind(errorKind, status),
          method: upperMethod,
          url: requestUrl,
          key: requestKey,
          fieldErrors,
          fieldErrorList,
          issues,
          formError,
          data: parsedBody,
        });
      }

      // 2xx Success: unwrap data and check for fragment invalidations
      const { data, invalidate } = unwrapApiResultAndInvalidate(parsedBody, response.headers);

      if (debug) {
        debug.trackRequestEnd(requestId, { status: 'completed', httpStatus: status });
      }

      // Trigger two-phase fragment invalidation if tags are present.
      // IMPORTANT: Refresh failure MUST NOT reject or fail the completed mutation!
      if (invalidate.length > 0 && onInvalidate) {
        const chainId = debug
          ? debug.startCausalChain({
              method: upperMethod,
              url: requestUrl,
              requestId,
              tags: invalidate,
            })
          : null;

        const refreshTask = Promise.resolve()
          .then(() =>
            onInvalidate(invalidate, {
              method: upperMethod,
              url: requestUrl,
              requestId,
              chainId,
            })
          )
          .catch((refreshErr) => {
            const notifyErr =
              typeof options.onRefreshError === 'function' ? options.onRefreshError : onRefreshError;
            if (notifyErr) {
              try {
                notifyErr(refreshErr, { tags: invalidate, method: upperMethod, url: requestUrl, chainId });
              } catch (_e) {
                // Ignore
              }
            }
            return { ok: false, error: refreshErr };
          });

        lastRefreshPromise = refreshTask;

        if (data && typeof data === 'object') {
          Object.defineProperty(data, '__invalidate', {
            value: invalidate,
            enumerable: false,
            configurable: true,
          });
          Object.defineProperty(data, '__refreshPromise', {
            value: refreshTask,
            enumerable: false,
            configurable: true,
          });
        }
      }

      return data;
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      const set = inFlightMap.get(requestKey);
      if (set) {
        set.delete(requestId);
        if (set.size === 0) {
          inFlightMap.delete(requestKey);
        }
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onCallerAbort);
      }
      if (lifecycleSignal) {
        lifecycleSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  const client = {
    get(url, inputOrOptions, explicitOptions) {
      const opts = normalizeGetArgs(inputOrOptions, explicitOptions);
      return executeRequest('GET', url, undefined, opts);
    },

    post(url, body, options = {}) {
      return executeRequest('POST', url, body, options);
    },

    put(url, body, options = {}) {
      return executeRequest('PUT', url, body, options);
    },

    patch(url, body, options = {}) {
      return executeRequest('PATCH', url, body, options);
    },

    delete(url, bodyOrOptions, explicitOptions) {
      if (explicitOptions && typeof explicitOptions === 'object') {
        return executeRequest('DELETE', url, bodyOrOptions, explicitOptions);
      }
      if (
        bodyOrOptions &&
        typeof bodyOrOptions === 'object' &&
        Object.keys(bodyOrOptions).every((k) => RESERVED_OPTION_KEYS.has(k))
      ) {
        return executeRequest('DELETE', url, undefined, bodyOrOptions);
      }
      return executeRequest('DELETE', url, bodyOrOptions, {});
    },

    request(method, url, body, options = {}) {
      return executeRequest(method, url, body, options);
    },

    /**
     * Escape hatch for arbitrary raw responses (blobs, downloads, custom headers).
     */
    raw(url, options = {}) {
      const method = options.method || 'GET';
      return executeRequest(method, url, options.body, { ...options, raw: true });
    },

    /**
     * Escape hatch for streaming endpoints (chunked text / NDJSON / SSE).
     * Yields decoded UTF-8 string chunks as an async generator.
     */
    async *stream(url, options = {}) {
      const response = await client.raw(url, options);
      if (!response.body) {
        const text = await response.text();
        if (text) yield text;
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield decoder.decode(value, { stream: true });
        }
        const tail = decoder.decode();
        if (tail) yield tail;
      } finally {
        try {
          reader.releaseLock();
        } catch (_e) {
          // Ignore
        }
      }
    },

    isInFlight(key) {
      if (key) {
        const set = inFlightMap.get(key);
        return Boolean(set && set.size > 0);
      }
      return inFlightMap.size > 0;
    },

    get lastRefreshPromise() {
      return lastRefreshPromise;
    },
  };

  return client;
}

module.exports = {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
  normalizeRetryConfig,
  isRetryableError,
  calculateRetryDelay,
  abortableSleep,
};


},
    "./forms": function(module, exports, require) {
'use strict';

const { defaultStorage } = require('./storage');
const { isArray, setElementBusyState } = require('./utils');

/**
 * Webspresso Native HTML Form Layer & Typed Form Handle
 *
 * Principles:
 * - Built on native HTML <form action="/api/..." method="post" data-w-form="name"> semantics
 * - Zero client JS required for standard form submission, validation error display, and fragment invalidation
 * - Explicit, deterministic form-to-payload conversion rules
 * - Starts with native constraint validation (`form.reportValidity()`); server validation remains authoritative
 * - Accessible field error binding (`aria-invalid`, `aria-describedby`) and focus on first invalid field
 * - Separation of `reset()` (restores initial default values) vs `clear()` (empties all controls)
 * - Mutation success vs refresh failure separation: a refresh failure never puts a succeeded form into validation error state
 */

/**
 * Validate that a redirect URL uses a safe protocol (http/https) or relative path
 * to prevent DOM-based XSS (e.g. javascript: URIs) and protocol injection.
 *
 * @param {string} target
 * @returns {boolean}
 */
function resolveSafeRedirectUrl(target) {
  if (!target || typeof target !== 'string') return null;
  const trimmed = target.trim();
  if (!trimmed) return null;

  // Block control characters
  if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) return null;

  // Block protocol-relative URLs (//example.com) and backslash traversal (/\ or \\)
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.startsWith('\\')) {
    return null;
  }

  // Relative path starting with single slash (e.g. /dashboard)
  if (trimmed.startsWith('/')) {
    try {
      const parsed = new URL(trimmed, 'http://localhost');
      if (parsed.origin !== 'http://localhost' || !parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) {
        return null;
      }
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }

  // Absolute URL: MUST explicitly parse as http: or https:
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function isSafeRedirectUrl(target) {
  return resolveSafeRedirectUrl(target) !== null;
}

let errorIdSeq = 0;

/**
 * Check if a form control is disabled (either directly or via an ancestor <fieldset disabled>).
 * Note: Per HTML spec, controls inside the first <legend> of a disabled <fieldset> remain enabled.
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isControlDisabled(el) {
  if (!el) return true;
  if (el.disabled) return true;
  let parent = el.parentElement;
  while (parent) {
    if (parent.tagName === 'FIELDSET' && parent.disabled) {
      // Check if el is inside the first <legend> child of this fieldset
      let firstLegend = null;
      for (let i = 0; i < parent.children.length; i++) {
        if (parent.children[i].tagName === 'LEGEND') {
          firstLegend = parent.children[i];
          break;
        }
      }
      if (!firstLegend || !firstLegend.contains(el)) {
        return true;
      }
    }
    parent = parent.parentElement;
  }
  return false;
}

/**
 * Coerce a single raw string value according to control type and `data-w-*` hints.
 *
 * @param {Element} el
 * @param {string} rawValue
 * @returns {unknown}
 */
function coerceScalarControlValue(el, rawValue) {
  const inputType = ((el.getAttribute && el.getAttribute('type')) || el.type || 'text').toLowerCase();
  const dataType = ((el.getAttribute && el.getAttribute('data-w-type')) || '').toLowerCase();
  const emptyMode = ((el.getAttribute && el.getAttribute('data-w-empty')) || '').toLowerCase();

  if (rawValue === '') {
    if (emptyMode === 'null') return null;
    if (emptyMode === 'undefined' || emptyMode === 'omit') return undefined;
    if (inputType === 'number' || inputType === 'range' || dataType === 'number') {
      return null;
    }
    return '';
  }

  if (inputType === 'number' || inputType === 'range' || dataType === 'number') {
    const num = Number(rawValue);
    return Number.isNaN(num) ? rawValue : num;
  }

  if (dataType === 'boolean') {
    if (rawValue === 'true' || rawValue === '1' || rawValue === 'on') return true;
    if (rawValue === 'false' || rawValue === '0' || rawValue === 'off') return false;
    return Boolean(rawValue);
  }

  return rawValue;
}

/**
 * Parse a `<form>` element into a structured payload and transport descriptor.
 *
 * Explicit Coercion Rules:
 * 1. `disabled` controls (including inside disabled `<fieldset>`) are excluded.
 * 2. `submitter`: if a submit button with `name` triggered the submit and is not disabled, its `name`/`value` is included.
 * 3. `checkbox`:
 *    - Single checkbox for a given `name`:
 *      - Boolean checkbox (no custom `value` attribute, or `value="true"|"on"`, or `data-w-type="boolean"`): `true` when checked, `false` when unchecked.
 *      - Custom value checkbox (e.g. `value="yes"`): `"yes"` when checked, `null` (or `data-w-unchecked` value) when unchecked.
 *    - Multiple checkboxes sharing the same `name` (or `name="tags[]"`): `Array` of checked values (`[]` when none checked).
 * 4. `number` / `range`: coerced to `number` (`null` when empty, or `undefined` with `data-w-empty="undefined"`).
 * 5. `empty string`: preserved as `""` for text controls unless `data-w-empty="null|undefined"` is specified.
 * 6. `repeated field names`: collected into an `Array` in DOM order. Trailing `[]` in `name="tags[]"` is normalized to `tags`.
 * 7. `select[multiple]`: always returns an `Array` of selected option values (`[]` when none selected).
 * 8. `file`:
 *    - Empty file input (`files.length === 0` or single 0-byte unnamed file): omitted (`undefined`).
 *    - `input[ type="file" multiple ]`: `File[]`.
 *    - Single `input[type="file"]`: `File`.
 *    - When any non-empty `File` is present or `form.enctype === 'multipart/form-data'`, `isMultipart` is `true` and `formData` is populated.
 *
 * @param {HTMLFormElement} formEl
 * @param {HTMLElement|null} [submitter]
 * @returns {{ data: Record<string, unknown>, formData: FormData|null, isMultipart: boolean }}
 */
function parseFormElement(formEl, submitterOrOptions = null) {
  if (!formEl || typeof formEl.querySelectorAll !== 'function') {
    return { data: {}, values: {}, formData: null, isMultipart: false };
  }

  const submitter =
    submitterOrOptions &&
    typeof submitterOrOptions === 'object' &&
    !submitterOrOptions.nodeType &&
    !('tagName' in submitterOrOptions) &&
    'submitter' in submitterOrOptions
      ? submitterOrOptions.submitter
      : submitterOrOptions;

  const rawControls = Array.from(
    formEl.querySelectorAll('input, select, textarea')
  );

  // Filter out disabled controls and button/submit/reset inputs (handled via submitter)
  const controls = rawControls.filter((el) => {
    if (isControlDisabled(el)) return false;
    const rawName = el.getAttribute('name');
    if (!rawName || !rawName.trim()) return false;
    const type = (el.type || '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
      return false;
    }
    return true;
  });

  // Count occurrences per normalized field name and per checkbox/radio group
  const nameCounts = new Map();
  const checkboxCounts = new Map();
  const radioNames = new Set();

  function normalizeFieldName(rawName) {
    const trimmed = String(rawName || '').trim();
    return trimmed.endsWith('[]') ? trimmed.slice(0, -2) : trimmed;
  }

  for (const el of controls) {
    const rawName = el.getAttribute('name').trim();
    const normName = normalizeFieldName(rawName);
    const isExplicitArray = rawName.endsWith('[]');
    const type = (el.type || '').toLowerCase();

    if (type === 'checkbox') {
      checkboxCounts.set(normName, (checkboxCounts.get(normName) || 0) + (isExplicitArray ? 2 : 1));
    } else if (type === 'radio') {
      radioNames.add(normName);
    } else {
      nameCounts.set(normName, (nameCounts.get(normName) || 0) + (isExplicitArray ? 2 : 1));
    }
  }

  const data = {};
  let hasBinaryFile = false;

  function appendValue(normName, val, forceArray) {
    if (val === undefined) return;
    if (forceArray) {
      if (!isArray(data[normName])) {
        data[normName] = [];
      }
      data[normName].push(val);
    } else if (normName in data) {
      if (!isArray(data[normName])) {
        data[normName] = [data[normName]];
      }
      data[normName].push(val);
    } else {
      data[normName] = val;
    }
  }

  // Initialize multi-checkbox groups to [] and radio groups to null if none checked
  for (const [normName, count] of checkboxCounts.entries()) {
    if (count > 1) {
      data[normName] = [];
    }
  }
  for (const normName of radioNames) {
    if (!(normName in data)) {
      data[normName] = null;
    }
  }

  for (const el of controls) {
    const rawName = el.getAttribute('name').trim();
    const normName = normalizeFieldName(rawName);
    const isExplicitArray = rawName.endsWith('[]');
    const tag = el.tagName;
    const type = (el.type || '').toLowerCase();

    if (tag === 'SELECT' && el.multiple) {
      const selectedValues = [];
      const options = Array.from(el.options || []);
      for (const opt of options) {
        if (opt.selected && !opt.disabled) {
          selectedValues.push(coerceScalarControlValue(el, opt.value));
        }
      }
      data[normName] = selectedValues;
      continue;
    }

    if (type === 'checkbox') {
      const totalCheckboxes = checkboxCounts.get(normName) || 1;
      if (totalCheckboxes > 1 || isExplicitArray) {
        if (el.checked) {
          const valAttr = el.getAttribute('value');
          const rawVal = valAttr !== null ? valAttr : 'on';
          data[normName].push(coerceScalarControlValue(el, rawVal));
        }
      } else {
        const valAttr = el.getAttribute('value');
        const dataType = (el.getAttribute('data-w-type') || '').toLowerCase();
        const isBooleanCheckbox =
          dataType === 'boolean' ||
          valAttr === null ||
          valAttr === '' ||
          valAttr === 'on' ||
          valAttr === 'true';

        if (isBooleanCheckbox) {
          data[normName] = Boolean(el.checked);
        } else if (el.checked) {
          data[normName] = coerceScalarControlValue(el, valAttr);
        } else {
          const uncheckedAttr = el.getAttribute('data-w-unchecked');
          data[normName] = uncheckedAttr !== null ? uncheckedAttr : null;
        }
      }
      continue;
    }

    if (type === 'radio') {
      if (el.checked) {
        data[normName] = coerceScalarControlValue(el, el.value);
      }
      continue;
    }

    if (type === 'file') {
      const files = el.files ? Array.from(el.files).filter((f) => f && (f.size > 0 || f.name)) : [];
      if (files.length > 0) {
        hasBinaryFile = true;
        if (el.multiple || isExplicitArray || (nameCounts.get(normName) || 0) > 1) {
          appendValue(normName, files.length === 1 && !el.multiple ? files[0] : files, !el.multiple);
          if (el.multiple) {
            data[normName] = files;
          }
        } else {
          data[normName] = files[0];
        }
      }
      continue;
    }

    const totalForName = nameCounts.get(normName) || 1;
    const coerced = coerceScalarControlValue(el, el.value !== undefined ? String(el.value) : '');
    appendValue(normName, coerced, totalForName > 1 || isExplicitArray);
  }

  // Include submitter name/value if provided and enabled
  if (submitter && !isControlDisabled(submitter)) {
    const subName = submitter.getAttribute ? submitter.getAttribute('name') : submitter.name;
    if (subName && String(subName).trim()) {
      const normSubName = normalizeFieldName(subName);
      const subValue =
        (submitter.getAttribute && submitter.getAttribute('value')) ??
        submitter.value ??
        '';
      data[normSubName] = coerceScalarControlValue(submitter, String(subValue));
    }
  }

  const enctype = ((formEl.getAttribute && formEl.getAttribute('enctype')) || formEl.enctype || '').toLowerCase();
  const isMultipart = hasBinaryFile || enctype === 'multipart/form-data';

  let formData = null;
  if (isMultipart && typeof FormData !== 'undefined') {
    formData = new FormData();
    for (const [key, val] of Object.entries(data)) {
      if (val === undefined) continue;
      if (isArray(val)) {
        for (const item of val) {
          if (item === undefined) continue;
          if (typeof Blob !== 'undefined' && item instanceof Blob) {
            formData.append(key, item);
          } else if (item !== null) {
            formData.append(key, String(item));
          }
        }
      } else if (typeof Blob !== 'undefined' && val instanceof Blob) {
        formData.append(key, val);
      } else if (val === null) {
        formData.append(key, '');
      } else {
        formData.append(key, String(val));
      }
    }
  }

  return { data, values: data, formData, isMultipart };
}

/**
 * Snapshot initial default values on a form so `reset()` restores them accurately
 * and `dirty` can compare current values against initial state.
 */
function captureInitialFormSnapshot(formEl) {
  const snapshot = new Map();
  if (!formEl || typeof formEl.querySelectorAll !== 'function') return snapshot;
  const controls = formEl.querySelectorAll('input, select, textarea');
  for (let i = 0; i < controls.length; i++) {
    const el = controls[i];
    const type = (el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      snapshot.set(el, { checked: Boolean(el.checked) });
    } else if (el.tagName === 'SELECT') {
      const selectedIndices = [];
      const opts = el.options || [];
      for (let j = 0; j < opts.length; j++) {
        if (opts[j].selected) selectedIndices.push(j);
      }
      snapshot.set(el, { selectedIndices, value: el.value });
    } else if (type !== 'file') {
      snapshot.set(el, { value: el.value !== undefined ? String(el.value) : '' });
    }
  }
  return snapshot;
}

/**
 * Check if any control in `formEl` differs from its captured initial snapshot.
 */
function computeFormDirty(formEl, initialSnapshot) {
  if (!formEl || typeof formEl.querySelectorAll !== 'function') return false;
  const controls = formEl.querySelectorAll('input, select, textarea');
  for (let i = 0; i < controls.length; i++) {
    const el = controls[i];
    const type = (el.type || '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'hidden') continue;
    const init = initialSnapshot.get(el);
    if (type === 'checkbox' || type === 'radio') {
      const expected = init ? init.checked : Boolean(el.defaultChecked);
      if (Boolean(el.checked) !== expected) return true;
    } else if (el.tagName === 'SELECT') {
      if (init) {
        if (el.value !== init.value) return true;
      }
    } else if (type === 'file') {
      if (el.files && el.files.length > 0) return true;
    } else {
      const expected = init ? init.value : (el.defaultValue || '');
      if (String(el.value || '') !== expected) return true;
    }
  }
  return false;
}

/**
 * Create a Form Handle managing a `<form>` element's lifecycle, validation errors,
 * accessibility attributes, pending lock, and submission.
 *
 * @param {HTMLFormElement} formEl
 * @param {object} options
 * @param {object} options.api - Typed API client instance
 * @param {object} [options.datastar] - Datastar adapter for reactive signals
 * @param {(url: string) => void} [options.navigate] - Navigation handler for explicit redirects
 * @param {object} [options.debug] - Client debugger
 */
function createFormHandle(formEl, options = {}) {
  if (formEl && formEl.__wFormHandle) {
    if (options.services && typeof formEl.__wFormHandle.__setServices === 'function') {
      formEl.__wFormHandle.__setServices(options.services);
    }
    return formEl.__wFormHandle;
  }

  const api = options.api;
  const debug = options.debug || null;
  let services = options.services || null;
  const formName =
    (formEl && formEl.getAttribute && formEl.getAttribute('data-w-form')) ||
    (formEl && formEl.getAttribute && formEl.getAttribute('name')) ||
    'form';

  let initialSnapshot = captureInitialFormSnapshot(formEl);
  let baselineValues = parseFormElement(formEl).data;
  let pending = false;
  let dirty = false;
  let submitted = false;
  let inputRevision = 0;
  let fieldErrors = {};
  let formError = null;
  let lastError = null;
  let lastData = null;
  let draftDebounceTimer = null;
  let resetTimer = null;

  const touchedFields = new Set();
  const errorDisplayMode =
    options.errorDisplay === 'touched' ||
    (formEl && formEl.getAttribute && formEl.getAttribute('data-w-error-mode') === 'touched')
      ? 'touched'
      : 'always';

  const validationSeqByField = new Map();
  const validationTimersByField = new Map();
  const validationAbortByField = new Map();
  let validationEpoch = 0;

  let activeSubmitAbort = null;
  let uploadEntries = [];
  const previewUrlsByField = new Map();

  function cancelFieldValidation(fieldName) {
    if (fieldName) {
      validationSeqByField.set(fieldName, (validationSeqByField.get(fieldName) || 0) + 1);
      const t = validationTimersByField.get(fieldName);
      if (t) {
        clearTimeout(t);
        validationTimersByField.delete(fieldName);
      }
      const ac = validationAbortByField.get(fieldName);
      if (ac) {
        try {
          ac.abort();
        } catch (_e) {}
        validationAbortByField.delete(fieldName);
      }
      return;
    }
    validationEpoch += 1;
    for (const t of validationTimersByField.values()) clearTimeout(t);
    validationTimersByField.clear();
    for (const ac of validationAbortByField.values()) {
      try {
        ac.abort();
      } catch (_e) {}
    }
    validationAbortByField.clear();
  }

  function revokePreviewUrls(fieldName) {
    const revokeUrl = (u) => {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(u);
        } catch (_e) {}
      }
    };
    if (fieldName) {
      const set = previewUrlsByField.get(fieldName);
      if (set) {
        for (const u of set) revokeUrl(u);
        set.clear();
        previewUrlsByField.delete(fieldName);
      }
      return;
    }
    for (const set of previewUrlsByField.values()) {
      for (const u of set) revokeUrl(u);
      set.clear();
    }
    previewUrlsByField.clear();
  }

  function createPreviewUrl(file, fieldName = '_default') {
    if (!file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    const url = URL.createObjectURL(file);
    let set = previewUrlsByField.get(fieldName);
    if (!set) {
      set = new Set();
      previewUrlsByField.set(fieldName, set);
    }
    set.add(url);
    return url;
  }

  const beforeSubmitListeners = new Set();
  const successListeners = new Set();
  const errorListeners = new Set();
  const stateListeners = new Set();

  function cancelDraftDebounce() {
    if (draftDebounceTimer) {
      clearTimeout(draftDebounceTimer);
      draftDebounceTimer = null;
    }
  }

  // Form draft persistence setup (sessionStorage by default, or localStorage)
  const rawDraftAttr = formEl
    ? formEl.getAttribute('data-w-persist-draft') || formEl.getAttribute('data-w-draft')
    : null;
  const isDraftEnabled =
    options.persistDraft !== undefined
      ? Boolean(options.persistDraft)
      : rawDraftAttr !== null && rawDraftAttr !== 'false';

  let draftStorageType = 'session';
  if (typeof options.persistDraft === 'string') {
    draftStorageType = options.persistDraft.toLowerCase() === 'local' ? 'local' : 'session';
  } else if (rawDraftAttr && rawDraftAttr.toLowerCase() === 'local') {
    draftStorageType = 'local';
  }

  const draftScope =
    options.draftScope ||
    (formEl && formEl.getAttribute && formEl.getAttribute('data-w-draft-scope')) ||
    '';

  const baseDraftKey =
    options.draftKey ||
    (formEl && (formEl.getAttribute('data-w-draft-key') || formEl.getAttribute('data-w-persist-key'))) ||
    `form_draft:${formName || 'anon'}`;

  let draftKey = draftScope ? `${baseDraftKey}:${draftScope}` : baseDraftKey;

  const draftStorage =
    (options.storage && options.storage[draftStorageType]) ||
    (draftStorageType === 'local' ? defaultStorage.local : defaultStorage.session);

  function extractDraftValues(el) {
    if (!el || typeof el.querySelectorAll !== 'function') return {};
    const { data } = parseFormElement(el);
    const safeData = {};
    for (const [key, val] of Object.entries(data)) {
      const ctrl = el.querySelector(`[name="${key}"], [name="${key}[]"]`);
      if (!ctrl) {
        safeData[key] = val;
        continue;
      }
      const type = (ctrl.type || '').toLowerCase();
      if (type === 'password' || type === 'file') continue;
      if (ctrl.hasAttribute('data-w-no-draft') || ctrl.getAttribute('data-w-persist') === 'false') continue;
      safeData[key] = val;
    }
    return safeData;
  }

  function sanitizeDraftObject(raw) {
    if (!raw || typeof raw !== 'object' || isArray(raw)) return null;
    const clean = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        clean[k] = v;
      } else if (isArray(v) && v.every((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
        clean[k] = v;
      }
    }
    return Object.keys(clean).length > 0 ? clean : null;
  }

  function saveDraft() {
    cancelDraftDebounce();
    if (!formEl || !isDraftEnabled) return false;
    const draftPayload = extractDraftValues(formEl);
    return draftStorage.set(draftKey, draftPayload);
  }

  function restoreDraft() {
    if (!formEl || !isDraftEnabled) return false;
    let saved = null;
    try {
      saved = draftStorage.get(draftKey, null);
    } catch (_e) {
      saved = null;
    }
    const cleanDraft = sanitizeDraftObject(saved);
    if (cleanDraft) {
      fill(cleanDraft, { baseline: false });
      if (typeof formEl.dispatchEvent === 'function') {
        const CustomEventCtor =
          (formEl.ownerDocument && formEl.ownerDocument.defaultView && formEl.ownerDocument.defaultView.CustomEvent) ||
          (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
        if (CustomEventCtor) {
          formEl.dispatchEvent(
            new CustomEventCtor('w-form:draft-restored', {
              bubbles: true,
              cancelable: true,
              detail: { form: handle, draft: cleanDraft, key: draftKey },
            })
          );
        }
      }
      return true;
    }
    return false;
  }

  function clearDraft() {
    cancelDraftDebounce();
    if (!isDraftEnabled) return false;
    return draftStorage.remove(draftKey);
  }

  function hasDraft() {
    if (!isDraftEnabled) return false;
    return draftStorage.has(draftKey);
  }

  function setDraftKey(nextKey, keyOpts = {}) {
    cancelDraftDebounce();
    if (typeof nextKey === 'string' && nextKey.trim()) {
      draftKey = nextKey.trim();
      if (formEl && typeof formEl.setAttribute === 'function') {
        formEl.setAttribute('data-w-draft-key', draftKey);
      }
      if (keyOpts && keyOpts.restore === true && isDraftEnabled) {
        restoreDraft();
      }
    }
    return handle;
  }

  function notifyStateChange() {
    for (const fn of stateListeners) {
      try {
        fn(handle);
      } catch (_e) {
        // Ignore
      }
    }
  }

  function isFieldErrorVisible(fieldName) {
    if (errorDisplayMode !== 'touched') return true;
    if (submitted) return true;
    return touchedFields.has(fieldName);
  }

  /**
   * Render field errors and form-level error into the DOM with accessible ARIA bindings.
   * Optionally focuses the first invalid control.
   */
  function syncErrorsToDom(focusFirstInvalid = false) {
    if (!formEl || typeof formEl.querySelectorAll !== 'function') return;

    // 1. Clear previous error elements and aria-invalid states
    const errorSpans = formEl.querySelectorAll('[data-w-error]');
    for (let i = 0; i < errorSpans.length; i++) {
      const span = errorSpans[i];
      const fieldName = span.getAttribute('data-w-error');
      const normName = fieldName && fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;
      const rawMsg = fieldName && (fieldErrors[fieldName] || (normName && fieldErrors[normName]))
        ? String(fieldErrors[fieldName] || fieldErrors[normName])
        : '';
      const msg = rawMsg && (isFieldErrorVisible(fieldName) || (normName && isFieldErrorVisible(normName))) ? rawMsg : '';
      span.textContent = msg;
      if (msg) {
        span.removeAttribute('hidden');
        if (!span.id) {
          span.id = `w-err-${formName}-${fieldName}-${++errorIdSeq}`;
        }
        if (!span.getAttribute('role')) {
          span.setAttribute('role', 'alert');
        }
      } else {
        span.setAttribute('hidden', '');
      }
    }

    // 2. Bind aria-invalid and aria-describedby on form controls, and find first invalid control
    let firstInvalidControl = null;
    const controls = formEl.querySelectorAll('input, select, textarea');
    for (let i = 0; i < controls.length; i++) {
      const ctrl = controls[i];
      const rawName = ctrl.getAttribute('name');
      if (!rawName) continue;
      const normName = rawName.endsWith('[]') ? rawName.slice(0, -2) : rawName;
      const rawErrMsg = fieldErrors[normName] || fieldErrors[rawName];
      const errMsg = rawErrMsg && (isFieldErrorVisible(normName) || isFieldErrorVisible(rawName)) ? rawErrMsg : '';

      if (errMsg) {
        ctrl.setAttribute('aria-invalid', 'true');
        const errSpan =
          formEl.querySelector(`[data-w-error="${normName}"]`) ||
          formEl.querySelector(`[data-w-error="${rawName}"]`);
        if (errSpan && errSpan.id) {
          ctrl.setAttribute('aria-describedby', errSpan.id);
        }
        if (!firstInvalidControl && typeof ctrl.focus === 'function' && !isControlDisabled(ctrl)) {
          firstInvalidControl = ctrl;
        }
      } else {
        ctrl.removeAttribute('aria-invalid');
        const desc = ctrl.getAttribute('aria-describedby');
        if (desc && desc.startsWith('w-err-')) {
          ctrl.removeAttribute('aria-describedby');
        }
      }
    }

    // 3. Form-level error element `[data-w-form-error]`
    const formErrorEl = formEl.querySelector('[data-w-form-error]');
    if (formErrorEl) {
      if (formError) {
        formErrorEl.textContent = String(formError);
        formErrorEl.removeAttribute('hidden');
        if (!formErrorEl.getAttribute('role')) {
          formErrorEl.setAttribute('role', 'alert');
        }
      } else {
        formErrorEl.textContent = '';
        formErrorEl.setAttribute('hidden', '');
      }
    }

    if (focusFirstInvalid && firstInvalidControl) {
      try {
        firstInvalidControl.focus();
      } catch (_e) {
        // Ignore focus errors in headless environments
      }
    }
  }

  /**
   * Toggle pending state on the form and submit buttons to prevent double submissions.
   */
  function setPendingState(nextPending, activeSubmitter = null) {
    const next = Boolean(nextPending);
    if (pending === next) return;
    pending = next;
    if (!formEl) return;

    if (pending) {
      formEl.setAttribute('aria-busy', 'true');
      formEl.setAttribute('data-w-pending', 'true');
      formEl.setAttribute('data-w-busy', 'true');
    } else {
      formEl.removeAttribute('aria-busy');
      formEl.removeAttribute('data-w-pending');
      formEl.removeAttribute('data-w-busy');
    }

    const submitButtons = formEl.querySelectorAll
      ? formEl.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]')
      : [];
    let submitterHandled = false;
    for (let i = 0; i < submitButtons.length; i++) {
      const btn = submitButtons[i];
      if (btn === activeSubmitter) submitterHandled = true;
      setElementBusyState(btn, pending);
    }
    if (activeSubmitter && !submitterHandled) {
      setElementBusyState(activeSubmitter, pending);
    }
    notifyStateChange();
  }

  /**
   * Reset form controls back to their initial default values (NOT emptying non-empty defaults).
   */
  function reset() {
    cancelDraftDebounce();
    cancelFieldValidation();
    revokePreviewUrls();
    if (!formEl) return;
    if (typeof formEl.reset === 'function') {
      formEl.reset();
    }
    // Restore exact captured initial snapshot
    for (const [el, init] of initialSnapshot.entries()) {
      const type = (el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        el.checked = init.checked;
      } else if (el.tagName === 'SELECT') {
        const opts = el.options || [];
        for (let j = 0; j < opts.length; j++) {
          opts[j].selected = init.selectedIndices.includes(j);
        }
      } else if (type !== 'file') {
        el.value = init.value;
      }
    }
    dirty = false;
    submitted = false;
    touchedFields.clear();
    fieldErrors = {};
    formError = null;
    syncErrorsToDom(false);
    notifyStateChange();
  }

  /**
   * Completely clear all user-editable controls to empty values (distinct from `reset()`).
   */
  function clear() {
    cancelDraftDebounce();
    cancelFieldValidation();
    revokePreviewUrls();
    if (!formEl || typeof formEl.querySelectorAll !== 'function') return;
    const controls = formEl.querySelectorAll('input, select, textarea');
    for (let i = 0; i < controls.length; i++) {
      const el = controls[i];
      const type = (el.type || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'hidden') continue;
      if (type === 'checkbox' || type === 'radio') {
        el.checked = false;
      } else if (el.tagName === 'SELECT') {
        const opts = el.options || [];
        for (let j = 0; j < opts.length; j++) {
          opts[j].selected = false;
        }
        if (!el.multiple && opts.length > 0) {
          el.value = '';
        }
      } else {
        el.value = '';
      }
    }
    dirty = computeFormDirty(formEl, initialSnapshot);
    submitted = false;
    touchedFields.clear();
    fieldErrors = {};
    formError = null;
    syncErrorsToDom(false);
    notifyStateChange();
  }

  /**
   * Programmatically fill form fields.
   *
   * @param {Record<string, unknown>} values - Object containing field name -> value mappings
   * @param {object} [options]
   * @param {boolean} [options.baseline=false] - If true, treats the filled values as the new baseline
   *                                            snapshot, clears `dirty`, and clears previous validation errors.
   */
  function fill(values = {}, options = {}) {
    if (!formEl || typeof formEl.querySelectorAll !== 'function' || !values || typeof values !== 'object' || isArray(values)) {
      return handle;
    }

    const isBaseline = Boolean(options.baseline);
    if (isBaseline) {
      cancelDraftDebounce();
    }

    for (const [key, val] of Object.entries(values)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

      const normKey = key.endsWith('[]') ? key.slice(0, -2) : key;
      const matchingControls = Array.from(
        formEl.querySelectorAll(`[name="${key}"], [name="${normKey}"], [name="${normKey}[]"]`)
      );

      for (const ctrl of matchingControls) {
        if (!ctrl || ctrl.tagName === 'BUTTON') continue;
        const type = (ctrl.type || '').toLowerCase();
        if (type === 'file') continue; // Browser security prevents setting file input value

        if (type === 'checkbox') {
          if (isArray(val)) {
            ctrl.checked = val.map(String).includes(String(ctrl.value));
          } else {
            ctrl.checked = Boolean(val);
          }
        } else if (type === 'radio') {
          ctrl.checked = String(val) === String(ctrl.value);
        } else if (ctrl.tagName === 'SELECT') {
          if (ctrl.multiple) {
            const arr = isArray(val) ? val.map(String) : [String(val)];
            const opts = ctrl.options || [];
            for (let j = 0; j < opts.length; j++) {
              opts[j].selected = arr.includes(String(opts[j].value));
            }
          } else {
            ctrl.value = val === null || val === undefined ? '' : String(val);
          }
        } else {
          if (val !== null && typeof val === 'object') continue;
          ctrl.value = val === null || val === undefined ? '' : String(val);
        }

        // Clear error for this field
        delete fieldErrors[normKey];
        delete fieldErrors[key];
      }
    }

    if (isBaseline) {
      cancelFieldValidation();
      initialSnapshot = captureInitialFormSnapshot(formEl);
      baselineValues = parseFormElement(formEl).data;
      dirty = false;
      submitted = false;
      touchedFields.clear();
      fieldErrors = {};
      formError = null;
      lastError = null;
      syncErrorsToDom(false);
    } else {
      dirty = computeFormDirty(formEl, initialSnapshot);
      syncErrorsToDom(false);
    }

    notifyStateChange();
    return handle;
  }

  function setAction(url) {
    if (formEl && url) {
      const nextAction = String(url);
      formEl.setAttribute('action', nextAction);
      formEl.__wCustomAction = nextAction;
    }
    return handle;
  }

  function setRouteParams(params = {}) {
    if (!formEl || !params) return handle;
    let action = formEl.getAttribute('action') || '';
    for (const [k, v] of Object.entries(params)) {
      action = action.replace(new RegExp(`\\[${k}\\]`, 'g'), encodeURIComponent(String(v)));
      action = action.replace(new RegExp(`:${k}\\b`, 'g'), encodeURIComponent(String(v)));
    }
    formEl.setAttribute('action', action);
    formEl.__wCustomAction = action;
    return handle;
  }

  let _manuallyDisabled = false;
  function setDisabled(val) {
    _manuallyDisabled = Boolean(val);
    if (!formEl) return handle;
    if (_manuallyDisabled) {
      if (formEl.setAttribute) {
        formEl.setAttribute('aria-disabled', 'true');
        formEl.setAttribute('disabled', '');
      }
    } else {
      if (formEl.removeAttribute) {
        formEl.removeAttribute('aria-disabled');
        formEl.removeAttribute('disabled');
      }
    }
    const controls = formEl.querySelectorAll ? formEl.querySelectorAll('input, select, textarea, button') : [];
    for (let i = 0; i < controls.length; i++) {
      controls[i].disabled = _manuallyDisabled;
    }
    notifyStateChange();
    return handle;
  }

  /**
   * Execute form submission.
   */
  async function submit(eventOrOptions = null) {
    let event = null;
    let submitOptions = {};

    if (eventOrOptions && typeof eventOrOptions.preventDefault === 'function') {
      event = eventOrOptions;
      event.preventDefault();
    } else if (eventOrOptions && typeof eventOrOptions === 'object') {
      submitOptions = eventOrOptions;
    }

    // Prevent double submit while pending
    if (pending) {
      return { submitted: false, reason: 'pending' };
    }

    // 1. Native HTML5 constraint validation first
    if (
      submitOptions.validate !== false &&
      formEl &&
      !formEl.noValidate &&
      typeof formEl.reportValidity === 'function'
    ) {
      const isValid = formEl.reportValidity();
      if (!isValid) {
        return { submitted: false, reason: 'native-constraint-invalid' };
      }
    }

    const submitter =
      submitOptions.submitter || (event && event.submitter ? event.submitter : null);
    const actionUrl =
      submitOptions.action ||
      (submitter && submitter.getAttribute && submitter.getAttribute('formaction')) ||
      (formEl && formEl.getAttribute && formEl.getAttribute('action')) ||
      (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
    const rawMethod =
      submitOptions.method ||
      (submitter && submitter.getAttribute && submitter.getAttribute('formmethod')) ||
      (formEl && formEl.getAttribute && formEl.getAttribute('method')) ||
      'POST';
    const method = String(rawMethod).toUpperCase();

    const { data: payloadData, formData, isMultipart } = parseFormElement(formEl, submitter);

    // Execute beforeSubmit hooks before initiating network request
    for (const guardFn of beforeSubmitListeners) {
      let allowed = true;
      try {
        allowed = await guardFn(payloadData, { form: handle, submitter, action: actionUrl, method });
      } catch (guardErr) {
        return { ok: false, submitted: false, canceled: true, reason: 'before-submit-error', error: guardErr };
      }
      if (allowed === false) {
        return { ok: false, submitted: false, canceled: true, reason: 'before-submit' };
      }
    }

    // Clear previous errors before request starts, mark submitted = true
    cancelFieldValidation();
    submitted = true;
    fieldErrors = {};
    formError = null;
    lastError = null;
    syncErrorsToDom(false);
    const submitRevision = inputRevision;
    const submittedSnapshot = captureInitialFormSnapshot(formEl);
    setPendingState(true, submitter);

    // Track per-file upload state if multipart
    const submitAbortController = new AbortController();
    activeSubmitAbort = submitAbortController;
    if (isMultipart && formEl && typeof formEl.querySelectorAll === 'function') {
      const nextUploads = [];
      const fileInputs = formEl.querySelectorAll('input[type="file"]');
      for (let i = 0; i < fileInputs.length; i++) {
        const fi = fileInputs[i];
        const fName = fi.getAttribute('name') || 'file';
        const files = fi.files || [];
        for (let j = 0; j < files.length; j++) {
          const f = files[j];
          nextUploads.push({
            field: fName,
            name: f.name || 'file',
            size: typeof f.size === 'number' ? f.size : 0,
            status: 'uploading',
            loaded: 0,
            total: typeof f.size === 'number' ? f.size : 0,
            percent: null,
            error: null,
          });
        }
      }
      uploadEntries = nextUploads;
      if (uploadEntries.length > 0) notifyStateChange();
    } else {
      uploadEntries = [];
    }

    try {
      let responseData;
      const reqKey = `form:${formName}:${method}:${actionUrl}`;
      if (method === 'GET') {
        responseData = await api.get(actionUrl, payloadData, {
          key: reqKey,
          policy: 'latest',
          signal: submitAbortController.signal,
        });
      } else {
        const bodyToSend = isMultipart && formData ? formData : payloadData;
        const reqOpts = {
          key: reqKey,
          policy: 'drop',
          signal: submitAbortController.signal,
        };
        if (isMultipart && uploadEntries.length > 0) {
          reqOpts.onUploadProgress = (prog) => {
            for (let i = 0; i < uploadEntries.length; i++) {
              uploadEntries[i].loaded = prog.loaded;
              uploadEntries[i].total = prog.total || uploadEntries[i].total;
              uploadEntries[i].percent = prog.percent;
            }
            if (typeof submitOptions.onUploadProgress === 'function') {
              submitOptions.onUploadProgress(prog, uploadEntries);
            }
            notifyStateChange();
          };
        }
        responseData = await api.request(method, actionUrl, bodyToSend, reqOpts);
      }

      if (uploadEntries.length > 0) {
        for (let i = 0; i < uploadEntries.length; i++) {
          uploadEntries[i].status = 'done';
          if (uploadEntries[i].percent !== null) uploadEntries[i].percent = 100;
        }
      }

      lastData = responseData;
      fieldErrors = {};
      formError = null;
      syncErrorsToDom(false);

      // Explicit reset / clear behavior on success
      const resetAttr = formEl ? formEl.getAttribute('data-w-reset') : null;
      const clearAttr = formEl ? formEl.getAttribute('data-w-clear') : null;
      const shouldReset =
        submitOptions.resetOnSuccess === true ||
        options.resetOnSuccess === true ||
        resetAttr === '' ||
        resetAttr === 'true' ||
        resetAttr === '1';
      const shouldClear =
        submitOptions.clearOnSuccess === true ||
        options.clearOnSuccess === true ||
        clearAttr === '' ||
        clearAttr === 'true' ||
        clearAttr === '1';

      const editedDuringSubmit = inputRevision !== submitRevision;

      if (!editedDuringSubmit) {
        dirty = false;
        if (shouldClear) {
          clear();
        } else if (shouldReset) {
          reset();
        } else {
          // Current state becomes the new clean baseline after successful save
          initialSnapshot = captureInitialFormSnapshot(formEl);
          baselineValues = parseFormElement(formEl).data;
        }

        if (isDraftEnabled) {
          clearDraft();
        }
      } else {
        // User edited form controls while submit was in flight:
        // Never wipe out the new unsubmitted edits via reset() or clear().
        // Update baseline to what was actually committed on the server (or empty baseline if clearOnSuccess).
        if (shouldClear) {
          const clearedSnapshot = new Map();
          for (const [ctrl, snap] of submittedSnapshot.entries()) {
            clearedSnapshot.set(ctrl, {
              ...snap,
              checked: false,
              value: '',
              selectedValues: [],
            });
          }
          initialSnapshot = clearedSnapshot;
          baselineValues = {};
        } else if (!shouldReset) {
          initialSnapshot = submittedSnapshot;
          baselineValues = payloadData && typeof payloadData === 'object' ? { ...payloadData } : {};
        }
        dirty = computeFormDirty(formEl, initialSnapshot);
        if (isDraftEnabled) {
          if (dirty) {
            saveDraft();
          } else {
            clearDraft();
          }
        }
      }

      // Invoke registered success hooks. Note: Any background fragment refresh failure
      // or side-effect service error in onSuccess NEVER puts a succeeded form into validation error
      // state or makes the completed mutation appear rolled back!
      let hookError = null;
      for (const listener of successListeners) {
        try {
          await listener(responseData, { values: payloadData, form: handle, services });
        } catch (listenerErr) {
          if (!hookError) hookError = listenerErr;
          if (debug && typeof debug.trackCleanupError === 'function') {
            debug.trackCleanupError(`form_${formName}`, formName, 'form:onSuccess', listenerErr);
          }
        }
      }

      // Explicit redirect behavior
      const rawRedirectTarget =
        submitOptions.redirectOnSuccess ||
        (formEl && formEl.getAttribute('data-w-redirect')) ||
        null;
      const redirectTarget = resolveSafeRedirectUrl(rawRedirectTarget);
      if (redirectTarget) {
        if (typeof options.navigate === 'function') {
          options.navigate(redirectTarget);
        } else if (typeof window !== 'undefined' && window.location) {
          window.location.assign(redirectTarget);
        }
      }

      let refreshOk = true;
      let refreshError = null;
      if (responseData && typeof responseData === 'object' && responseData.__refreshPromise) {
        const refreshOutcome = await responseData.__refreshPromise;
        if (refreshOutcome && refreshOutcome.ok === false) {
          refreshOk = false;
          refreshError = refreshOutcome.error || null;
        }
      }

      return { ok: true, submitted: true, data: responseData, refreshOk, refreshError, hookError };
    } catch (err) {
      lastError = err || null;
      if (uploadEntries.length > 0) {
        const isCanceled = Boolean(err && err.isCanceled);
        for (let i = 0; i < uploadEntries.length; i++) {
          if (uploadEntries[i].status === 'uploading') {
            uploadEntries[i].status = isCanceled ? 'canceled' : 'error';
            uploadEntries[i].error = isCanceled ? null : (err && err.message ? err.message : 'Upload failed');
          }
        }
      }
      if (err && err.kind === 'validation') {
        fieldErrors = { ...(err.fieldErrors || {}) };
        formError = err.formError || (Object.keys(fieldErrors).length === 0 ? err.message : null);
        syncErrorsToDom(true);
      } else if (err && err.isCanceled) {
        // Canceled or dropped duplicate submit — do not overwrite form with error
      } else {
        formError = err && err.message ? err.message : 'Form submission failed.';
        syncErrorsToDom(false);
      }

      for (const listener of errorListeners) {
        try {
          await listener(err, { values: payloadData, form: handle, services });
        } catch (_e) {
          // Ignore
        }
      }

      if (submitOptions.throwOnError) {
        throw err;
      }
      return {
        ok: false,
        submitted: false,
        outcomeUnknown: Boolean(err && err.outcomeUnknown),
        outcome: (err && err.outcome) || 'failed',
        error: err,
      };
    } finally {
      if (activeSubmitAbort === submitAbortController) {
        activeSubmitAbort = null;
      }
      setPendingState(false, submitter);
    }
  }

  function parseFieldValidateConfig(ctrl) {
    const ctrlAttr = ctrl && ctrl.getAttribute ? ctrl.getAttribute('data-w-validate') : null;
    const formAttr = formEl && formEl.getAttribute ? formEl.getAttribute('data-w-validate') : null;
    const raw = ctrlAttr !== null ? ctrlAttr : formAttr;
    if (!raw || raw === 'false') return null;
    const parts = String(raw).split(/[\s,|]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const onBlur = parts.includes('blur') || parts.includes('true') || raw === '';
    let debounceMs = null;
    for (const p of parts) {
      if (p.startsWith('debounce:')) {
        const ms = Number(p.slice('debounce:'.length).replace(/ms$/i, ''));
        debounceMs = Number.isFinite(ms) && ms >= 0 ? ms : 300;
      } else if (p === 'debounce') {
        debounceMs = 300;
      }
    }
    return { onBlur, debounceMs };
  }

  async function validateField(fieldName, vOpts = {}) {
    if (!formEl || !api || !fieldName) return { ok: true, valid: true, errors: {} };
    const norm = fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;

    const epoch = validationEpoch;
    const seq = (validationSeqByField.get(norm) || 0) + 1;
    validationSeqByField.set(norm, seq);

    const prevAbort = validationAbortByField.get(norm);
    if (prevAbort) {
      try {
        prevAbort.abort();
      } catch (_e) {}
    }
    const ac = new AbortController();
    validationAbortByField.set(norm, ac);

    const validateUrl =
      vOpts.url ||
      (formEl.getAttribute && (formEl.getAttribute('data-w-validate-url') || formEl.getAttribute('action'))) ||
      (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
    const method = String(vOpts.method || (formEl.getAttribute && formEl.getAttribute('method')) || 'POST').toUpperCase();

    const { data: allValues } = parseFormElement(formEl);
    const ctrl = formEl.querySelector ? (formEl.querySelector(`[name="${norm}"]`) || formEl.querySelector(`[name="${fieldName}"]`)) : null;
    const contextAttr = ctrl && ctrl.getAttribute ? ctrl.getAttribute('data-w-validate-context') : null;

    let payload = { [norm]: allValues[norm] };
    if (vOpts.contextFields === '*' || contextAttr === '*') {
      payload = { ...allValues };
    } else {
      const ctxList = isArray(vOpts.contextFields)
        ? vOpts.contextFields
        : typeof contextAttr === 'string' && contextAttr.trim()
          ? contextAttr.split(',').map((s) => s.trim()).filter(Boolean)
          : [];
      for (const cf of ctxList) {
        if (Object.prototype.hasOwnProperty.call(allValues, cf)) {
          payload[cf] = allValues[cf];
        }
      }
    }

    try {
      const resp = await api.request(method, validateUrl, payload, {
        headers: { 'X-Webspresso-Validate-Fields': norm },
        signal: ac.signal,
      });

      if (epoch !== validationEpoch || seq !== validationSeqByField.get(norm)) {
        return { ok: true, stale: true, valid: true, errors: {} };
      }

      const respErrors = resp && resp.errors && typeof resp.errors === 'object' ? resp.errors : {};
      if (respErrors[norm]) {
        fieldErrors[norm] = String(respErrors[norm]);
      } else {
        delete fieldErrors[norm];
      }
      syncErrorsToDom(false);
      notifyStateChange();
      return {
        ok: true,
        valid: !fieldErrors[norm],
        errors: fieldErrors[norm] ? { [norm]: fieldErrors[norm] } : {},
      };
    } catch (err) {
      if (epoch !== validationEpoch || seq !== validationSeqByField.get(norm) || (err && err.isCanceled)) {
        return { ok: true, stale: true, canceled: Boolean(err && err.isCanceled), errors: {} };
      }
      // If server returned a 400/422 validation envelope, extract only this field's error
      if (err && err.kind === 'validation' && err.fieldErrors) {
        if (err.fieldErrors[norm]) {
          fieldErrors[norm] = String(err.fieldErrors[norm]);
        } else {
          delete fieldErrors[norm];
        }
        syncErrorsToDom(false);
        notifyStateChange();
        return { ok: true, valid: !fieldErrors[norm], errors: fieldErrors[norm] ? { [norm]: fieldErrors[norm] } : {} };
      }
      // Network or 5xx error: NEVER mark the field as invalid!
      if (typeof formEl.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
        formEl.dispatchEvent(
          new CustomEvent('w-form:validation-error', {
            bubbles: true,
            detail: { field: norm, error: err },
          })
        );
      }
      return { ok: false, networkError: true, error: err };
    } finally {
      if (validationAbortByField.get(norm) === ac) {
        validationAbortByField.delete(norm);
      }
    }
  }

  function cancelUpload() {
    if (activeSubmitAbort) {
      try {
        activeSubmitAbort.abort();
      } catch (_e) {}
      activeSubmitAbort = null;
      return true;
    }
    return false;
  }

  // Listen to native submit, focusout, and input/change events on `formEl`
  const onDomInput = (evt) => {
    inputRevision += 1;
    dirty = computeFormDirty(formEl, initialSnapshot);
    const target = evt && evt.target;
    if (target && target.getAttribute) {
      const type = (target.type || '').toLowerCase();
      const rawName = target.getAttribute('name');
      if (type === 'file' && evt.type === 'change' && rawName) {
        revokePreviewUrls(rawName);
      }
      if (rawName) {
        const norm = rawName.endsWith('[]') ? rawName.slice(0, -2) : rawName;
        if (evt.type === 'change' && (type === 'checkbox' || type === 'radio' || target.tagName === 'SELECT')) {
          touchedFields.add(norm);
        }
        if (fieldErrors[norm] || fieldErrors[rawName]) {
          delete fieldErrors[norm];
          delete fieldErrors[rawName];
          syncErrorsToDom(false);
        }
        if (evt.type === 'input') {
          const vCfg = parseFieldValidateConfig(target);
          if (vCfg && vCfg.debounceMs !== null) {
            const prevTimer = validationTimersByField.get(norm);
            if (prevTimer) clearTimeout(prevTimer);
            const t = setTimeout(() => {
              validationTimersByField.delete(norm);
              validateField(norm).catch(() => {});
            }, vCfg.debounceMs);
            validationTimersByField.set(norm, t);
          }
        }
      }
    }
    if (isDraftEnabled) {
      cancelDraftDebounce();
      draftDebounceTimer = setTimeout(() => {
        draftDebounceTimer = null;
        saveDraft();
      }, 150);
    }
    notifyStateChange();
  };

  const onDomFocusOut = (evt) => {
    const target = evt && evt.target;
    if (!target || !target.getAttribute) return;
    const rawName = target.getAttribute('name');
    if (!rawName) return;
    const type = (target.type || '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'hidden') return;
    const norm = rawName.endsWith('[]') ? rawName.slice(0, -2) : rawName;
    const wasTouched = touchedFields.has(norm);
    touchedFields.add(norm);
    if (!wasTouched) {
      syncErrorsToDom(false);
      notifyStateChange();
    }
    const vCfg = parseFieldValidateConfig(target);
    if (vCfg && vCfg.onBlur) {
      validateField(norm).catch(() => {});
    }
  };

  const onDomSubmit = (evt) => {
    submit(evt);
  };

  const onDomReset = () => {
    cancelDraftDebounce();
    cancelFieldValidation();
    revokePreviewUrls();
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      resetTimer = null;
      dirty = false;
      submitted = false;
      touchedFields.clear();
      fieldErrors = {};
      formError = null;
      syncErrorsToDom(false);
      notifyStateChange();
    }, 0);
  };

  if (formEl && typeof formEl.addEventListener === 'function') {
    formEl.addEventListener('input', onDomInput);
    formEl.addEventListener('change', onDomInput);
    formEl.addEventListener('focusout', onDomFocusOut);
    formEl.addEventListener('submit', onDomSubmit);
    formEl.addEventListener('reset', onDomReset);
  }

  // Initialize hidden state on empty error placeholders
  syncErrorsToDom(false);

  let handle = null;

  handle = {
    name: formName,
    el: formEl,
    get services() {
      return services;
    },
    __setServices(nextServices) {
      if (nextServices) services = nextServices;
    },
    get pending() {
      return pending;
    },
    get dirty() {
      dirty = computeFormDirty(formEl, initialSnapshot);
      return dirty;
    },
    get touched() {
      return touchedFields.size > 0;
    },
    get touchedFields() {
      return Array.from(touchedFields);
    },
    get submitted() {
      return submitted;
    },
    isTouched(fieldName) {
      if (!fieldName) return touchedFields.size > 0;
      const norm = fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;
      return touchedFields.has(norm) || touchedFields.has(fieldName);
    },
    touch(fieldName) {
      if (fieldName) {
        const norm = fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;
        touchedFields.add(norm);
      } else if (formEl && typeof formEl.querySelectorAll === 'function') {
        const controls = formEl.querySelectorAll('input, select, textarea');
        for (let i = 0; i < controls.length; i++) {
          const n = controls[i].getAttribute && controls[i].getAttribute('name');
          if (n) touchedFields.add(n.endsWith('[]') ? n.slice(0, -2) : n);
        }
      }
      syncErrorsToDom(false);
      notifyStateChange();
      return handle;
    },
    untouch(fieldName) {
      if (fieldName) {
        const norm = fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;
        touchedFields.delete(norm);
        touchedFields.delete(fieldName);
      } else {
        touchedFields.clear();
      }
      syncErrorsToDom(false);
      notifyStateChange();
      return handle;
    },
    validateField,
    get uploads() {
      return uploadEntries.map((u) => ({ ...u }));
    },
    cancelUpload,
    createPreviewUrl,
    revokePreviewUrls,
    get inputRevision() {
      return inputRevision;
    },
    get draftKey() {
      return draftKey;
    },
    get values() {
      return parseFormElement(formEl).data;
    },
    get baseline() {
      return { ...(baselineValues || {}) };
    },
    get errors() {
      return { ...fieldErrors };
    },
    get fieldErrors() {
      return { ...fieldErrors };
    },
    get formError() {
      return formError;
    },
    get lastError() {
      return lastError;
    },
    get lastData() {
      return lastData;
    },
    get disabled() {
      return _manuallyDisabled;
    },
    set disabled(val) {
      setDisabled(val);
    },
    read(submitter) {
      return parseFormElement(formEl, submitter).data;
    },
    getValues(submitter) {
      return parseFormElement(formEl, submitter).data;
    },
    fill,
    saveDraft,
    restoreDraft,
    clearDraft,
    setDraftKey,
    get hasDraft() {
      return hasDraft();
    },
    setAction,
    setRouteParams,
    setDisabled,
    setFieldErrors(nextFieldErrors = {}, focusFirst = true) {
      fieldErrors = { ...nextFieldErrors };
      syncErrorsToDom(focusFirst);
      notifyStateChange();
    },
    setFormError(message) {
      formError = message ? String(message) : null;
      syncErrorsToDom(false);
      notifyStateChange();
    },
    clearErrors() {
      fieldErrors = {};
      formError = null;
      lastError = null;
      syncErrorsToDom(false);
      notifyStateChange();
    },
    reset,
    clear,
    submit,
    beforeSubmit(fn) {
      if (typeof fn === 'function') {
        beforeSubmitListeners.add(fn);
        return () => beforeSubmitListeners.delete(fn);
      }
      return () => {};
    },
    onSuccess(fn) {
      if (typeof fn === 'function') {
        successListeners.add(fn);
        return () => successListeners.delete(fn);
      }
      return () => {};
    },
    onError(fn) {
      if (typeof fn === 'function') {
        errorListeners.add(fn);
        return () => errorListeners.delete(fn);
      }
      return () => {};
    },
    subscribe(fn) {
      if (typeof fn === 'function') {
        stateListeners.add(fn);
        return () => stateListeners.delete(fn);
      }
      return () => {};
    },
    destroy() {
      cancelDraftDebounce();
      cancelFieldValidation();
      cancelUpload();
      revokePreviewUrls();
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      if (formEl && typeof formEl.removeEventListener === 'function') {
        formEl.removeEventListener('input', onDomInput);
        formEl.removeEventListener('change', onDomInput);
        formEl.removeEventListener('focusout', onDomFocusOut);
        formEl.removeEventListener('submit', onDomSubmit);
        formEl.removeEventListener('reset', onDomReset);
      }
      if (formEl) {
        delete formEl.__wFormHandle;
      }
      beforeSubmitListeners.clear();
      successListeners.clear();
      errorListeners.clear();
      stateListeners.clear();
    },
  };

  if (formEl) {
    Object.defineProperty(formEl, '__wFormHandle', {
      value: handle,
      configurable: true,
      enumerable: false,
    });
  }

  if (debug) {
    debug.recordEvent('form:bind', { name: formName });
  }

  if (isDraftEnabled) {
    restoreDraft();
  }

  return handle;
}

module.exports = {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
  isSafeRedirectUrl,
};


},
    "./storage": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Storage & Persistence Layer (`core/client/storage.js`)
 *
 * Capabilities:
 * - Unified, SSR-safe Storage Adapter for `localStorage`, `sessionStorage`, and in-memory fallback.
 * - Graceful fallback to `MemoryStorage` when running in Node.js (SSR), sandboxed iframes,
 *   or when private browsing blocks web storage with SecurityError/DOMException.
 * - Automatic JSON serialization and deserialization with fallback to raw strings.
 * - Built-in namespace prefixing (default: `w:`) to prevent collision with other applications.
 * - Safe `clear()` that only removes keys belonging to the current namespace prefix.
 * - Quota error resilience: catches `QuotaExceededError` without throwing fatal runtime crashes.
 * - Sub-namespace scoping via `storage.scoped(prefix)`.
 */

/**
 * Map-backed standard Storage implementation for Node.js SSR and private browsing fallbacks.
 */
class MemoryStorage {
  constructor() {
    this._data = new Map();
  }

  get length() {
    return this._data.size;
  }

  getItem(key) {
    const k = String(key);
    return this._data.has(k) ? this._data.get(k) : null;
  }

  setItem(key, value) {
    this._data.set(String(key), String(value));
  }

  removeItem(key) {
    this._data.delete(String(key));
  }

  clear() {
    this._data.clear();
  }

  key(index) {
    const idx = Number(index);
    if (idx < 0 || idx >= this._data.size) return null;
    let i = 0;
    for (const k of this._data.keys()) {
      if (i === idx) return k;
      i++;
    }
    return null;
  }
}

const GLOBAL_STORAGE_KEY = '__webspresso_memory_storage__';
if (!globalThis[GLOBAL_STORAGE_KEY]) {
  globalThis[GLOBAL_STORAGE_KEY] = {
    local: new MemoryStorage(),
    session: new MemoryStorage(),
    memory: new MemoryStorage(),
  };
}
const sharedMemoryBackends = globalThis[GLOBAL_STORAGE_KEY];

/**
 * Safely probe and acquire the native browser storage backend or fallback to MemoryStorage.
 *
 * @param {'local' | 'session' | 'memory'} type
 * @returns {Storage | MemoryStorage}
 */
function getNativeStorageBackend(type) {
  if (type === 'memory' || typeof window === 'undefined') {
    return sharedMemoryBackends[type] || sharedMemoryBackends.local;
  }

  try {
    const storage = type === 'session' ? window.sessionStorage : window.localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return sharedMemoryBackends[type] || sharedMemoryBackends.local;
    }
    // Verify write access (Safari private browsing or sandboxed iframes may throw here)
    const probeKey = '__w_storage_probe__';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch (_e) {
    return sharedMemoryBackends[type] || sharedMemoryBackends.local;
  }
}

/**
 * Strongly-typed, prefix-aware storage adapter.
 */
class StorageAdapter {
  /**
   * @param {'local' | 'session' | 'memory'} type
   * @param {object} [options]
   * @param {string} [options.prefix='w:']
   * @param {Storage | MemoryStorage} [options.backend]
   */
  constructor(type = 'local', options = {}) {
    this.type = type;
    this.prefix = options.prefix !== undefined ? String(options.prefix) : 'w:';
    this._backend = options.backend || null;
  }

  /**
   * Resolve active storage backend.
   * @private
   */
  _getBackend() {
    if (!this._backend) {
      this._backend = getNativeStorageBackend(this.type);
    }
    return this._backend;
  }

  /**
   * Build prefixed key.
   * @private
   */
  _fullKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Retrieve and deserialize a value from storage.
   *
   * @param {string} key
   * @param {any} [defaultValue=null]
   * @returns {any}
   */
  get(key, defaultValue = null) {
    if (!key) return defaultValue;
    try {
      const backend = this._getBackend();
      const raw = backend.getItem(this._fullKey(key));
      if (raw === null || raw === undefined) {
        return defaultValue;
      }
      try {
        return JSON.parse(raw);
      } catch (_parseErr) {
        // Return raw string if not valid JSON
        return raw;
      }
    } catch (_err) {
      return defaultValue;
    }
  }

  /**
   * Serialize and store a value in storage.
   *
   * @param {string} key
   * @param {any} value - If undefined, the key is removed
   * @returns {boolean} True if successfully stored, false on failure (e.g. quota exceeded)
   */
  set(key, value) {
    if (!key) return false;
    if (value === undefined) {
      return this.remove(key);
    }
    try {
      const backend = this._getBackend();
      const serialized = JSON.stringify(value);
      backend.setItem(this._fullKey(key), serialized);
      return true;
    } catch (_err) {
      // QuotaExceededError or security restrictions
      return false;
    }
  }

  /**
   * Remove a key from storage.
   *
   * @param {string} key
   * @returns {boolean}
   */
  remove(key) {
    if (!key) return false;
    try {
      const backend = this._getBackend();
      backend.removeItem(this._fullKey(key));
      return true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Check whether a key exists in storage.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    if (!key) return false;
    try {
      const backend = this._getBackend();
      return backend.getItem(this._fullKey(key)) !== null;
    } catch (_err) {
      return false;
    }
  }

  /**
   * List all unprefixed keys stored under this adapter's namespace prefix.
   *
   * @returns {string[]}
   */
  keys() {
    try {
      const backend = this._getBackend();
      const result = [];
      const prefixLen = this.prefix.length;

      if (backend instanceof MemoryStorage) {
        for (const k of backend._data.keys()) {
          if (!this.prefix || k.startsWith(this.prefix)) {
            result.push(k.slice(prefixLen));
          }
        }
        return result;
      }

      if (typeof backend.length === 'number') {
        for (let i = 0; i < backend.length; i++) {
          const k = backend.key(i);
          if (k && (!this.prefix || k.startsWith(this.prefix))) {
            result.push(k.slice(prefixLen));
          }
        }
      }
      return result;
    } catch (_err) {
      return [];
    }
  }

  /**
   * Clear only keys belonging to this adapter's prefix. Never touches outside keys.
   *
   * @returns {boolean}
   */
  clear() {
    try {
      const backend = this._getBackend();
      if (!this.prefix) {
        backend.clear();
        return true;
      }
      const matchedKeys = this.keys();
      for (const k of matchedKeys) {
        backend.removeItem(this._fullKey(k));
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Create a sub-scoped storage adapter inheriting the same backend.
   *
   * @param {string} subPrefix
   * @returns {StorageAdapter}
   */
  scoped(subPrefix) {
    const clean = String(subPrefix || '').trim();
    const nextPrefix = clean ? `${this.prefix}${clean}:` : this.prefix;
    return new StorageAdapter(this.type, {
      prefix: nextPrefix,
      backend: this._getBackend(),
    });
  }
}

/**
 * Create a complete client storage bundle exposing `local`, `session`, `memory`, and `scoped()`.
 *
 * @param {object} [options]
 * @param {string} [options.prefix='w:'] - Root key namespace prefix
 * @param {Storage | MemoryStorage} [options.localBackend] - Custom backend for localStorage
 * @param {Storage | MemoryStorage} [options.sessionBackend] - Custom backend for sessionStorage
 * @param {MemoryStorage} [options.memoryBackend] - Custom backend for memory storage
 * @returns {ClientStorage}
 */
function createClientStorage(options = {}) {
  const prefix = options.prefix !== undefined ? String(options.prefix) : 'w:';
  const local = new StorageAdapter('local', {
    prefix,
    backend: options.localBackend || null,
  });
  const session = new StorageAdapter('session', {
    prefix,
    backend: options.sessionBackend || null,
  });
  const memory = new StorageAdapter('memory', {
    prefix,
    backend: options.memoryBackend || null,
  });

  return Object.freeze({
    local,
    session,
    memory,
    get prefix() {
      return prefix;
    },
    scoped(subPrefix) {
      const clean = String(subPrefix || '').trim();
      const nextPrefix = clean ? `${prefix}${clean}:` : prefix;
      return createClientStorage({
        ...options,
        prefix: nextPrefix,
        localBackend: local._getBackend(),
        sessionBackend: session._getBackend(),
        memoryBackend: memory._getBackend(),
      });
    },
  });
}

const defaultStorage = createClientStorage();

module.exports = {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
  sharedMemoryBackends,
};


},
    "./host": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client UI Host Lifecycle Helper (`core/client/host.js`)
 *
 * Manages optional, lazy DOM host containers for client services that need
 * to render shared UI outside normal SSR fragment patch regions.
 *
 * Principles:
 * - Zero DOM creation until a service explicitly requests a host (`mountHost`).
 * - Idempotent per host key within a runtime: repeated calls return the same host handle
 *   and never create duplicate DOM containers.
 * - Supports attaching to an existing layout element (`target` / `selector` / `[data-w-host]`)
 *   or lazily creating a container appended outside fragment areas (default: `document.body`).
 * - Clean unmount and resource disposal contract when the owning service or runtime is destroyed.
 * - Agnostic to UI rendering: does not impose any template language, virtual DOM, or widget type.
 */

const { decorateElement } = require('./utils');

/**
 * Resolve the owning Document from a root Document or Element.
 *
 * @param {Document|Element|null} [root]
 * @returns {Document|null}
 */
function resolveDocument(root) {
  if (root) {
    if (root.nodeType === 9) return root;
    if (root.ownerDocument) return root.ownerDocument;
  }
  return typeof document !== 'undefined' ? document : null;
}

/**
 * Resolve the default mount container outside `[data-w-fragment]` areas.
 *
 * @param {Document|Element|null} [root]
 * @param {Document|null} [doc]
 * @returns {Element|null}
 */
function resolveDefaultContainer(root, doc) {
  if (root && root.nodeType === 1 && root.tagName !== 'HTML') {
    if (doc && doc.body && (root === doc.body || root === doc.documentElement)) {
      return doc.body;
    }
    const insideFragment =
      typeof root.closest === 'function' ? Boolean(root.closest('[data-w-fragment]')) : false;
    if (!insideFragment) {
      return root;
    }
    if (!doc || !doc.body) {
      return root;
    }
  }
  if (doc) {
    return doc.body || doc.documentElement || null;
  }
  return root && root.nodeType === 1 ? root : null;
}

/**
 * Create a runtime-scoped UI Host Manager.
 *
 * @param {object} [options]
 * @param {Document|Element|null} [options.root]
 * @param {object} [options.debug]
 * @returns {object}
 */
function createClientHostManager(options = {}) {
  const root = options.root || null;
  const debug = options.debug || null;
  const activeHosts = new Map(); // key -> hostRecord
  let disposed = false;

  /**
   * Mount or retrieve a shared UI host by key.
   *
   * @param {string|object} [keyOrOptions]
   * @param {object} [maybeOptions]
   * @param {string} [defaultKey]
   */
  function mount(keyOrOptions = {}, maybeOptions = {}, defaultKey = 'default') {
    if (disposed) {
      const err = new Error('Cannot mount UI host on a disposed client runtime.');
      err.code = 'CLIENT_RUNTIME_DISPOSED';
      throw err;
    }

    let opts = {};
    let key = defaultKey;

    if (typeof keyOrOptions === 'string') {
      key = keyOrOptions.trim() || defaultKey;
      opts = maybeOptions && typeof maybeOptions === 'object' ? maybeOptions : {};
    } else if (keyOrOptions && typeof keyOrOptions === 'object') {
      opts = keyOrOptions;
      if (typeof opts.key === 'string' && opts.key.trim()) {
        key = opts.key.trim();
      } else if (typeof opts.name === 'string' && opts.name.trim()) {
        key = opts.name.trim();
      }
    }

    if (!key) {
      throw new TypeError('mountHost() requires a non-empty host key.');
    }

    const existing = activeHosts.get(key);
    if (existing && existing.mounted) {
      // If the element is still connected (or in a headless/custom tree), reuse it
      if (!existing.el || existing.el.isConnected !== false || !existing.created) {
        return existing.handle;
      }
      // If a created host element was externally removed from DOM, clean up before re-creating
      existing.handle.unmount();
    }

    const doc = resolveDocument(opts.root || root);
    let el = null;
    let created = false;
    const prevAttributes = new Map();

    // 1. Explicit target Element
    if (opts.target && opts.target.nodeType === 1) {
      el = opts.target;
    }

    // 2. Explicit CSS selector
    if (!el && typeof opts.selector === 'string' && opts.selector.trim()) {
      const searchRoot = opts.root || root || doc;
      if (searchRoot && typeof searchRoot.querySelector === 'function') {
        el = searchRoot.querySelector(opts.selector.trim());
      }
      if (!el && doc && searchRoot !== doc && typeof doc.querySelector === 'function') {
        el = doc.querySelector(opts.selector.trim());
      }
    }

    // 3. Existing layout placeholder `[data-w-host="<key>"]` not owned by another active host manager
    if (!el && opts.createOnly !== true) {
      const searchRoot = opts.root || root || doc;
      if (searchRoot && typeof searchRoot.querySelectorAll === 'function') {
        const candidates = searchRoot.querySelectorAll(`[data-w-host="${key}"]`);
        for (let i = 0; i < candidates.length; i++) {
          const cand = candidates[i];
          if (!cand.__wHostManager || cand.__wHostManager === api) {
            el = cand;
            break;
          }
        }
      }
    }

    // 4. Create a new host container outside fragment regions
    if (!el) {
      if (!doc || typeof doc.createElement !== 'function') {
        const err = new Error(`Cannot create UI host "${key}": no Document is available in the current environment.`);
        err.code = 'CLIENT_HOST_NO_DOCUMENT';
        throw err;
      }
      const tagName = typeof opts.tagName === 'string' && opts.tagName.trim() ? opts.tagName.trim() : 'div';
      el = doc.createElement(tagName);
      created = true;

      const container =
        (opts.container && opts.container.nodeType === 1 ? opts.container : null) ||
        resolveDefaultContainer(opts.root || root, doc);

      if (container && typeof container.appendChild === 'function') {
        container.appendChild(el);
      }
    }

    function recordAndSetAttr(attrName, attrVal) {
      if (!el || typeof el.setAttribute !== 'function') return;
      if (!created && !prevAttributes.has(attrName)) {
        prevAttributes.set(attrName, el.hasAttribute(attrName) ? el.getAttribute(attrName) : null);
      }
      el.setAttribute(attrName, String(attrVal));
    }

    recordAndSetAttr('data-w-host', key);

    if (typeof opts.id === 'string' && opts.id.trim()) {
      recordAndSetAttr('id', opts.id.trim());
    }

    if (typeof opts.className === 'string' && opts.className.trim()) {
      if (created) {
        el.className = opts.className.trim();
      } else {
        recordAndSetAttr('class', opts.className.trim());
      }
    }

    if (opts.attributes && typeof opts.attributes === 'object') {
      for (const [attrName, attrVal] of Object.entries(opts.attributes)) {
        if (attrVal === undefined || attrVal === null || attrVal === false) continue;
        recordAndSetAttr(attrName, attrVal === true ? '' : String(attrVal));
      }
    }

    try {
      Object.defineProperty(el, '__wHostManager', {
        value: api,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch (_e) {
      el.__wHostManager = api;
    }

    const decoratedEl = decorateElement(el);
    const unmountCallbacks = [];
    let isMounted = true;

    function onUnmount(fn) {
      if (typeof fn !== 'function') return () => {};
      if (!isMounted) {
        try {
          fn();
        } catch (_e) {}
        return () => {};
      }
      unmountCallbacks.push(fn);
      return () => {
        const idx = unmountCallbacks.indexOf(fn);
        if (idx !== -1) unmountCallbacks.splice(idx, 1);
      };
    }

    function clear() {
      if (el) {
        el.innerHTML = '';
      }
    }

    function unmount() {
      if (!isMounted) return;
      isMounted = false;
      activeHosts.delete(key);

      for (let i = unmountCallbacks.length - 1; i >= 0; i--) {
        try {
          unmountCallbacks[i](decoratedEl);
        } catch (err) {
          if (debug && typeof debug.trackCleanupError === 'function') {
            debug.trackCleanupError(`host_${key}`, key, 'host:unmount', err);
          }
        }
      }
      unmountCallbacks.length = 0;

      if (el) {
        if (el.__wHostManager === api) {
          delete el.__wHostManager;
        }
        if (created) {
          if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
            el.parentNode.removeChild(el);
          } else if (typeof el.remove === 'function') {
            el.remove();
          }
        } else {
          if (opts.clearOnUnmount !== false) {
            el.innerHTML = '';
          }
          for (const [attrName, prevVal] of prevAttributes.entries()) {
            if (prevVal === null) {
              el.removeAttribute(attrName);
            } else {
              el.setAttribute(attrName, prevVal);
            }
          }
        }
      }

      if (debug && typeof debug.recordEvent === 'function') {
        debug.recordEvent('host:unmount', { key, created });
      }
    }

    const handle = Object.freeze({
      key,
      el: decoratedEl,
      created,
      get mounted() {
        return isMounted;
      },
      clear,
      onUnmount,
      unmount,
      destroy: unmount,
    });

    activeHosts.set(key, {
      key,
      el: decoratedEl,
      created,
      get mounted() {
        return isMounted;
      },
      handle,
    });

    if (debug && typeof debug.recordEvent === 'function') {
      debug.recordEvent('host:mount', { key, created });
    }

    return handle;
  }

  function get(key) {
    const record = activeHosts.get(String(key || '').trim());
    return record && record.mounted ? record.handle : null;
  }

  function has(key) {
    const record = activeHosts.get(String(key || '').trim());
    return Boolean(record && record.mounted);
  }

  function unmount(key) {
    const record = activeHosts.get(String(key || '').trim());
    if (record && record.mounted) {
      record.handle.unmount();
      return true;
    }
    return false;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const records = Array.from(activeHosts.values());
    activeHosts.clear();
    for (let i = records.length - 1; i >= 0; i--) {
      try {
        records[i].handle.unmount();
      } catch (err) {
        if (debug && typeof debug.trackCleanupError === 'function') {
          debug.trackCleanupError(`host_${records[i].key}`, records[i].key, 'host:dispose', err);
        }
      }
    }
  }

  const api = {
    mount,
    get,
    has,
    unmount,
    dispose,
    get isDisposed() {
      return disposed;
    },
  };

  return api;
}

module.exports = {
  createClientHostManager,
  resolveDocument,
  resolveDefaultContainer,
};


},
    "./services": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Services Registry & Lifecycle Manager (`core/client/services.js`)
 *
 * Provides runtime-scoped, lazily-initialized, strongly-typed shared client services
 * with optional lazy UI host mounting.
 *
 * Principles:
 * - Agnostic core: Core knows nothing about specific application services (toast, modal, etc.).
 * - Explicit lazy resolution: `const svc = await services.get('name')` — no magic Proxy
 *   hiding sync/async boundaries.
 * - Runtime-scoped isolation: Shared across controllers/forms within the same runtime;
 *   isolated across separate runtimes and SSR requests.
 * - Single-flight initialization: Concurrent `services.get('name')` calls share one promise.
 * - Failure recovery: Failed initialization cleans up partial resources/hosts and evicts
 *   the failed promise from cache so subsequent calls can retry.
 * - Deterministic teardown: Controller disconnect does NOT dispose shared services;
 *   `runtime.destroy()` disposes all initialized services, in-flight initializations, and UI hosts.
 */

const { createClientHostManager } = require('./host');
const { defaultStorage } = require('./storage');

function createServiceError(message, code, serviceName, cause) {
  const err = new Error(message);
  err.name = 'ClientServiceError';
  err.code = code;
  if (serviceName) {
    err.serviceName = serviceName;
  }
  if (cause !== undefined) {
    err.cause = cause;
  }
  return err;
}

/**
 * Define a client service for registration in `bootClient({ services })` or `createClientRuntime({ services })`.
 *
 * Supports:
 * - `defineClientService({ load: () => import('./services/toast') })`
 * - `defineClientService({ create(ctx) { ... }, dispose?(instance, ctx) { ... } })`
 * - `defineClientService((ctx) => ({ ... }))`
 *
 * @template TService
 * @param {object | ((ctx: object) => TService | Promise<TService>)} definition
 * @returns {object}
 */
function defineClientService(definition) {
  if (typeof definition === 'function') {
    return Object.freeze({
      __isWebspressoClientService: true,
      load: null,
      create: definition,
      dispose: null,
    });
  }

  if (!definition || typeof definition !== 'object') {
    throw new TypeError('defineClientService() requires a configuration object or factory function.');
  }

  const load = typeof definition.load === 'function' ? definition.load : null;
  const create =
    typeof definition.create === 'function'
      ? definition.create
      : typeof definition.setup === 'function'
        ? definition.setup
        : null;
  const dispose = typeof definition.dispose === 'function' ? definition.dispose : null;

  if (!load && !create) {
    throw new TypeError(
      'defineClientService() requires either a `load` function (`() => import(...)`) or a `create` / `setup` factory function.'
    );
  }

  return Object.freeze({
    __isWebspressoClientService: true,
    name: definition.name ? String(definition.name).trim() : null,
    load,
    create,
    dispose,
  });
}

/**
 * Resolve a service instance from a dynamically loaded module or factory descriptor.
 */
async function instantiateFromLoadedModule(loaded, outerDef, serviceCtx, registerDispose) {
  if (outerDef.dispose) registerDispose(outerDef.dispose);

  if (outerDef.load && outerDef.create) {
    return await outerDef.create(serviceCtx, loaded);
  }
  if (!outerDef.load && outerDef.create) {
    const res = await outerDef.create(serviceCtx);
    return res && typeof res === 'object' && res.__isWebspressoClientService
      ? instantiateFromLoadedModule(res, {}, serviceCtx, registerDispose)
      : res;
  }
  if (loaded == null) return loaded;

  let target = loaded;
  if (typeof loaded === 'object') {
    if (typeof loaded.dispose === 'function') registerDispose(loaded.dispose);
    if ('default' in loaded && loaded.default !== undefined) {
      target = loaded.default;
    }
  }

  if (target && typeof target === 'object' && target.__isWebspressoClientService) {
    if (typeof target.dispose === 'function') registerDispose(target.dispose);
    if (typeof target.load === 'function') {
      const nested = await target.load(serviceCtx);
      return instantiateFromLoadedModule(nested, { create: target.create }, serviceCtx, registerDispose);
    }
    return typeof target.create === 'function' ? await target.create(serviceCtx) : target;
  }

  if (typeof target === 'function') {
    const produced = await target(serviceCtx);
    return produced && typeof produced === 'object' && produced.__isWebspressoClientService
      ? instantiateFromLoadedModule(produced, {}, serviceCtx, registerDispose)
      : produced;
  }

  if (target && typeof target === 'object') {
    if (typeof target.dispose === 'function') registerDispose(target.dispose);
    const fn = target.createService || target.create || target.setup;
    if (typeof fn === 'function') return await fn.call(target, serviceCtx);
  }

  return target;
}

/**
 * Create a runtime-scoped Client Service Registry.
 *
 * @param {object} [options]
 * @param {Document|Element|null} [options.root]
 * @param {object} [options.api]
 * @param {object} [options.storage]
 * @param {object} [options.debug]
 * @param {() => object} [options.getRuntime]
 * @param {Record<string, object|Function>} [options.services]
 */
function createClientServiceRegistry(options = {}) {
  const root = options.root || null;
  const api = options.api || null;
  const baseStorage = options.storage || defaultStorage;
  const debug = options.debug || null;
  const getRuntime = typeof options.getRuntime === 'function' ? options.getRuntime : () => null;

  // Registered service definitions: name -> normalized definition
  const definitions = new Map();
  // Runtime state per service: name -> ServiceEntry
  const entries = new Map();
  // Initialization order for deterministic reverse disposal
  const initOrder = [];
  // Lazy host manager (only allocated if a service requests a UI host)
  let sharedHostManager = null;
  let disposed = false;

  function ensureHostManager() {
    if (!sharedHostManager) {
      sharedHostManager = createClientHostManager({ root, debug });
    }
    return sharedHostManager;
  }

  /**
   * Register a single client service definition.
   * Does NOT import or execute the service implementation at registration time.
   *
   * @param {string} name
   * @param {object|Function} rawDef
   */
  function register(name, rawDef) {
    if (disposed) {
      throw createServiceError(
        `Cannot register client service "${name}" on a disposed runtime.`,
        'CLIENT_RUNTIME_DISPOSED',
        name
      );
    }
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      throw new TypeError('Service registration requires a non-empty service name.');
    }

    const normalized =
      rawDef && rawDef.__isWebspressoClientService ? rawDef : defineClientService(rawDef);

    const existingEntry = entries.get(cleanName);
    if (existingEntry && existingEntry.definition !== normalized) {
      // If HMR or re-registration replaces an uninitialized or existing definition
      if (existingEntry.status === 'ready' || existingEntry.status === 'initializing') {
        disposeEntry(existingEntry);
        entries.delete(cleanName);
      }
    }

    definitions.set(cleanName, normalized);
    return normalized;
  }

  function registerAll(servicesMap) {
    if (!servicesMap || typeof servicesMap !== 'object') return;
    for (const [name, def] of Object.entries(servicesMap)) {
      if (def !== undefined && def !== null) {
        register(name, def);
      }
    }
  }

  /**
   * Clean up all resources, callbacks, and UI hosts associated with a single service attempt/entry.
   */
  function cleanupAttemptResources(attempt, serviceName, phase = 'service:dispose') {
    if (attempt.cleanedUp) return;
    attempt.cleanedUp = true;

    try {
      attempt.abortController.abort();
    } catch (_e) {}

    // 1. Run explicit dispose hook(s)
    const ranDisposeFns = new Set();
    for (let i = attempt.disposeFns.length - 1; i >= 0; i--) {
      const fn = attempt.disposeFns[i];
      if (typeof fn !== 'function' || ranDisposeFns.has(fn)) continue;
      ranDisposeFns.add(fn);
      try {
        fn(attempt.instance, attempt.serviceCtx);
      } catch (err) {
        if (debug && typeof debug.trackCleanupError === 'function') {
          debug.trackCleanupError(`service_${serviceName}`, serviceName, phase, err);
        }
      }
    }

    // 2. If instance itself has a `.dispose()` method not already in disposeFns, invoke it when no explicit dispose hook was provided
    if (
      attempt.disposeFns.length === 0 &&
      attempt.instance &&
      typeof attempt.instance === 'object' &&
      typeof attempt.instance.dispose === 'function' &&
      !ranDisposeFns.has(attempt.instance.dispose)
    ) {
      try {
        attempt.instance.dispose();
      } catch (err) {
        if (debug && typeof debug.trackCleanupError === 'function') {
          debug.trackCleanupError(`service_${serviceName}`, serviceName, phase, err);
        }
      }
    }

    // 3. Run registered `onCleanup` callbacks in LIFO order
    for (let i = attempt.cleanups.length - 1; i >= 0; i--) {
      try {
        attempt.cleanups[i]();
      } catch (err) {
        if (debug && typeof debug.trackCleanupError === 'function') {
          debug.trackCleanupError(`service_${serviceName}`, serviceName, `${phase}:cleanup`, err);
        }
      }
    }
    attempt.cleanups.length = 0;

    // 4. Unmount any UI hosts mounted by this service
    const hosts = Array.from(attempt.hosts);
    attempt.hosts.clear();
    for (let i = hosts.length - 1; i >= 0; i--) {
      try {
        hosts[i].unmount();
      } catch (err) {
        if (debug && typeof debug.trackCleanupError === 'function') {
          debug.trackCleanupError(`service_${serviceName}`, serviceName, `${phase}:host`, err);
        }
      }
    }
  }

  function disposeEntry(entry) {
    if (!entry || entry.disposed) return;
    entry.disposed = true;
    const wasReady = entry.status === 'ready';
    entry.status = 'disposed';
    entry.initPromise = null;
    entry.instance = undefined;

    if (entry.activeAttempt) {
      cleanupAttemptResources(entry.activeAttempt, entry.name, 'service:dispose');
      entry.activeAttempt = null;
    }

    if (wasReady && debug && typeof debug.recordEvent === 'function') {
      debug.recordEvent('service:dispose', { name: entry.name });
    }
  }

  /**
   * Lazily resolve and initialize a registered service by name.
   *
   * @template K
   * @param {K} name
   * @returns {Promise<any>}
   */
  async function get(name) {
    const cleanName = String(name || '').trim();

    if (disposed) {
      throw createServiceError(
        `Cannot resolve client service "${cleanName}": client runtime has been disposed.`,
        'CLIENT_RUNTIME_DISPOSED',
        cleanName
      );
    }

    const def = definitions.get(cleanName);
    if (!def) {
      throw createServiceError(
        `Unknown client service "${cleanName}". Register it in bootClient({ services }) or createClientRuntime({ services }).`,
        'UNKNOWN_CLIENT_SERVICE',
        cleanName
      );
    }

    let entry = entries.get(cleanName);
    if (entry) {
      if (entry.status === 'ready') {
        return entry.instance;
      }
      if (entry.status === 'initializing' && entry.initPromise) {
        return entry.initPromise;
      }
    }

    const attempt = {
      abortController: new AbortController(),
      cleanups: [],
      disposeFns: [],
      hosts: new Set(),
      instance: undefined,
      serviceCtx: null,
      cleanedUp: false,
    };

    const scopedStorage =
      baseStorage && typeof baseStorage.scoped === 'function'
        ? baseStorage.scoped(`service:${cleanName}`)
        : defaultStorage.scoped(`service:${cleanName}`);

    function onCleanup(fn) {
      if (typeof fn !== 'function') return () => {};
      if (disposed || attempt.cleanedUp) {
        try {
          fn();
        } catch (_e) {}
        return () => {};
      }
      attempt.cleanups.push(fn);
      return () => {
        const idx = attempt.cleanups.indexOf(fn);
        if (idx !== -1) attempt.cleanups.splice(idx, 1);
      };
    }

    function mountServiceHost(keyOrOptions = {}, maybeOptions = {}) {
      if (disposed || attempt.cleanedUp) {
        throw createServiceError(
          `Cannot mount UI host for service "${cleanName}": runtime or service is disposed.`,
          'CLIENT_RUNTIME_DISPOSED',
          cleanName
        );
      }
      const hostMgr = ensureHostManager();
      const handle = hostMgr.mount(keyOrOptions, maybeOptions, cleanName);
      attempt.hosts.add(handle);
      return handle;
    }

    const hostHelper = Object.freeze({
      mount: mountServiceHost,
      get: (hostKey = cleanName) => (sharedHostManager ? sharedHostManager.get(hostKey) : null),
      has: (hostKey = cleanName) => (sharedHostManager ? sharedHostManager.has(hostKey) : false),
      unmount: (hostKey = cleanName) => {
        if (!sharedHostManager) return false;
        const h = sharedHostManager.get(hostKey);
        if (h) attempt.hosts.delete(h);
        return sharedHostManager.unmount(hostKey);
      },
    });

    const serviceCtx = Object.freeze({
      name: cleanName,
      api,
      storage: Object.freeze({
        local: scopedStorage.local,
        session: scopedStorage.session,
        memory: scopedStorage.memory,
        scoped: (sub) => scopedStorage.scoped(sub),
        global: baseStorage,
        root: baseStorage,
      }),
      signal: attempt.abortController.signal,
      root,
      get runtime() {
        return getRuntime();
      },
      services: registryApi,
      host: hostHelper,
      mountHost: mountServiceHost,
      onCleanup,
      onDispose: onCleanup,
      isDisposed: () => disposed || attempt.cleanedUp,
    });

    attempt.serviceCtx = serviceCtx;

    entry = {
      name: cleanName,
      definition: def,
      status: 'initializing',
      instance: undefined,
      initPromise: null,
      activeAttempt: attempt,
      disposed: false,
    };
    entries.set(cleanName, entry);

    if (debug && typeof debug.recordEvent === 'function') {
      debug.recordEvent('service:init', { name: cleanName });
    }

    const initPromise = (async () => {
      try {
        const rawLoaded = def.load ? await def.load(serviceCtx) : null;

        // Check if runtime or entry was disposed while `load()` was in flight
        if (disposed || entry.disposed) {
          cleanupAttemptResources(attempt, cleanName, 'service:late-init-dispose');
          throw createServiceError(
            `Client service "${cleanName}" initialization aborted because runtime was disposed.`,
            'CLIENT_RUNTIME_DISPOSED',
            cleanName
          );
        }

        const instance = await instantiateFromLoadedModule(
          rawLoaded,
          def,
          serviceCtx,
          (disposeFn) => {
            if (typeof disposeFn === 'function') {
              attempt.disposeFns.push(disposeFn);
            }
          }
        );

        attempt.instance = instance;

        // Check again if runtime or entry was disposed while `create()` / `setup()` was in flight
        if (disposed || entry.disposed) {
          cleanupAttemptResources(attempt, cleanName, 'service:late-init-dispose');
          throw createServiceError(
            `Client service "${cleanName}" initialization aborted because runtime was disposed.`,
            'CLIENT_RUNTIME_DISPOSED',
            cleanName
          );
        }

        entry.status = 'ready';
        entry.instance = instance;
        entry.initPromise = null;
        if (!initOrder.includes(cleanName)) {
          initOrder.push(cleanName);
        }

        if (debug && typeof debug.recordEvent === 'function') {
          debug.recordEvent('service:ready', {
            name: cleanName,
            hasHost: attempt.hosts.size > 0,
          });
        }

        return instance;
      } catch (err) {
        // Clean up any partial resources or hosts created before the error
        cleanupAttemptResources(attempt, cleanName, 'service:init-error-cleanup');

        // Evict failed initialization from cache so subsequent calls can retry (unless runtime is disposed)
        if (!disposed && !entry.disposed && entries.get(cleanName) === entry) {
          entries.delete(cleanName);
        }

        if (debug && typeof debug.recordEvent === 'function') {
          debug.recordEvent('service:error', {
            name: cleanName,
            code: err && err.code ? err.code : null,
            message: err && err.message ? String(err.message) : String(err),
          });
        }

        throw err;
      }
    })();

    entry.initPromise = initPromise;
    return initPromise;
  }

  function has(name) {
    return definitions.has(String(name || '').trim());
  }

  function isInitialized(name) {
    const entry = entries.get(String(name || '').trim());
    return Boolean(entry && entry.status === 'ready');
  }

  function peek(name) {
    const entry = entries.get(String(name || '').trim());
    return entry && entry.status === 'ready' ? entry.instance : undefined;
  }

  /**
   * Idempotently dispose all initialized and in-flight services and their UI hosts.
   */
  function dispose() {
    if (disposed) return;
    disposed = true;

    // 1. Dispose in reverse initialization order first
    for (let i = initOrder.length - 1; i >= 0; i--) {
      const name = initOrder[i];
      const entry = entries.get(name);
      if (entry) {
        disposeEntry(entry);
      }
    }
    initOrder.length = 0;

    // 2. Dispose any remaining in-flight entries
    for (const entry of Array.from(entries.values())) {
      disposeEntry(entry);
    }
    entries.clear();

    // 3. Dispose shared host manager if allocated
    if (sharedHostManager) {
      sharedHostManager.dispose();
      sharedHostManager = null;
    }
  }

  if (options.services && typeof options.services === 'object') {
    registerAll(options.services);
  }

  const registryApi = {
    register,
    registerAll,
    get,
    has,
    isInitialized,
    peek,
    dispose,
    destroy: dispose,
    get isDisposed() {
      return disposed;
    },
    get hostManager() {
      return sharedHostManager;
    },
  };

  return registryApi;
}

module.exports = {
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
};

},
    "./devtool": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client DevTools Dock & Inspector
 *
 * Integrated development-mode toolbar and inspector for Webspresso client applications:
 *   - 🎮 Controllers: Live reactive state, computed values, bound forms, tasks (with manual trigger), watchers
 *   - 🧩 Fragments: Live SSR fragments, input parameters, dependsOn tags, on-demand refresh & DOM highlight
 *   - 🌐 Network & Causal Chains: Client API timeline, concurrency policies, invalidation-to-patch chains
 *   - 💾 Storage: Webspresso namespaced local/session storage viewer and cleaner
 *   - 🛠️ Studio & Server: Direct link to Webspresso DB Studio, Admin Panel, and SSE live-reload status
 *   - 🔌 Redux DevTools Bridge: Auto-connects to browser Redux DevTools extension if present
 *   - ⌨️ Hotkey: Alt+W (or Cmd+Shift+D) toggles the dock
 *   - 🖥️ Console API: window.__WEBSPRESSO_DEVTOOLS__
 */

const { defaultStorage } = require('./storage');
const { isArray, isNumber } = require('./utils');

const DEVTOOL_HOST_ID = 'webspresso-client-devtools-host';

const PKG_VERSION =
  (typeof window !== 'undefined' &&
    window.__WEBSPRESSO_DEV_META__ &&
    window.__WEBSPRESSO_DEV_META__.version) ||
  '0.0.110';

/**
 * Connect to Redux DevTools browser extension if installed.
 */
function setupReduxDevToolsBridge(runtime) {
  if (typeof window === 'undefined' || !window.__REDUX_DEVTOOLS_EXTENSION__) {
    return null;
  }
  try {
    const devTools = window.__REDUX_DEVTOOLS_EXTENSION__.connect({
      name: 'Webspresso Client',
      features: {
        jump: false,
        skip: false,
        reorder: false,
        dispatch: false,
        test: false,
      },
    });

    function getCombinedState() {
      const stateObj = {};
      const instances = runtime.controllers ? runtime.controllers.getActiveInstances() : [];
      for (const inst of instances) {
        stateObj[inst.name || inst.instanceId] = inst.state ? { ...inst.state } : {};
      }
      return stateObj;
    }

    devTools.init(getCombinedState());

    // Dispatches state snapshot when events occur
    if (runtime.debug && typeof runtime.debug.getSnapshot === 'function') {
      const origRecordEvent = runtime.debug.recordEvent;
      if (typeof origRecordEvent === 'function') {
        runtime.debug.recordEvent = function (type, detail) {
          const res = origRecordEvent.call(this, type, detail);
          try {
            devTools.send({ type: `[Webspresso] ${type}`, ...detail }, getCombinedState());
          } catch (_) {}
          return res;
        };
      }
    }

    return devTools;
  } catch (_) {
    return null;
  }
}

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHref(url, fallback = '#') {
  if (!url || typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  if (!trimmed || /[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) return fallback;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return escapeHtml(trimmed);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return escapeHtml(parsed.href);
    }
  } catch {
    return fallback;
  }
  return fallback;
}

/**
 * Format JSON with syntax-colored HTML or safe text.
 */
function formatJsonHtml(data) {
  if (data === undefined) return '<span style="color:#71717a">undefined</span>';
  if (data === null) return '<span style="color:#f43f5e">null</span>';
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    return escapeHtml(jsonStr).replace(
      /(&quot;(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\&])*&quot;(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'color:#38bdf8;'; // number
        if (/^&quot;/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'color:#a78bfa;font-weight:600;'; // key
          } else {
            cls = 'color:#34d399;'; // string
          }
        } else if (/true|false/.test(match)) {
          cls = 'color:#fbbf24;'; // boolean
        } else if (/null/.test(match)) {
          cls = 'color:#f43f5e;'; // null
        }
        return `<span style="${cls}">${match}</span>`;
      }
    );
  } catch (_) {
    return escapeHtml(data);
  }
}

/**
 * Highlight a DOM element with a temporary pulsing outline.
 */
function highlightElement(el) {
  if (!el || !el.style) return false;
  try {
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const origOutline = el.style.outline;
    const origOutlineOffset = el.style.outlineOffset;
    const origBoxShadow = el.style.boxShadow;
    const origTransition = el.style.transition;

    el.style.transition = 'outline 0.2s, box-shadow 0.2s';
    el.style.outline = '3px solid #f59e0b';
    el.style.outlineOffset = '4px';
    el.style.boxShadow = '0 0 25px rgba(245, 158, 11, 0.7)';

    setTimeout(() => {
      try {
        el.style.outline = origOutline;
        el.style.outlineOffset = origOutlineOffset;
        el.style.boxShadow = origBoxShadow;
        el.style.transition = origTransition;
      } catch (_) {}
    }, 2000);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Mount the Webspresso Client DevTool onto the document.
 *
 * @param {object} runtime - Webspresso Client Runtime instance
 * @param {object} [options]
 * @param {string} [options.position='bottom-right'] - 'bottom-right' | 'bottom-left'
 * @param {boolean} [options.open=false] - Initial drawer open state
 * @param {number} [options.pollInterval=1500] - Snapshot refresh interval (ms)
 * @param {string} [options.studioUrl='http://localhost:4567'] - URL to Webspresso DB Studio
 * @returns {object} DevTools handle with open(), close(), toggle(), destroy()
 */
function mountDevtool(runtime, options = {}) {
  if (typeof document === 'undefined') {
    return {
      open: () => {},
      close: () => {},
      toggle: () => {},
      destroy: () => {},
      isOpen: () => false,
      getSnapshot: () => ({}),
    };
  }

  // Prevent multiple devtool instances on the same page
  const existing = document.getElementById(DEVTOOL_HOST_ID);
  if (existing) {
    if (existing.__webspressoDevtoolInstance) {
      return existing.__webspressoDevtoolInstance;
    }
    existing.remove();
  }

  const position = options.position || 'bottom-right';
  const isRight = position.includes('right');
  const studioUrl = options.studioUrl || 'http://localhost:4567';
  let metaOverrides =
    options.meta && typeof options.meta === 'object' ? { ...options.meta } : {};
  let isOpen = Boolean(options.open);
  let activeTab = 'controllers'; // 'controllers' | 'fragments' | 'network' | 'storage' | 'studio'
  let selectedControllerId = null;

  function resolveDevFeatures() {
    const winMeta =
      typeof window !== 'undefined' &&
      window.__WEBSPRESSO_DEV_META__ &&
      typeof window.__WEBSPRESSO_DEV_META__ === 'object'
        ? window.__WEBSPRESSO_DEV_META__
        : {};
    const merged = { ...winMeta, ...metaOverrides };
    const pluginsList = isArray(merged.plugins)
      ? merged.plugins
      : isArray(options.plugins)
        ? options.plugins
        : [];

    const hasStudio =
      options.hasStudio !== undefined
        ? Boolean(options.hasStudio)
        : merged.hasStudio !== undefined
          ? Boolean(merged.hasStudio)
          : merged.hasDb !== undefined
            ? Boolean(merged.hasDb)
            : Boolean(
                options.studioUrl ||
                  pluginsList.includes('studio') ||
                  pluginsList.includes('db-studio')
              );

    const hasAdmin =
      options.hasAdmin !== undefined
        ? Boolean(options.hasAdmin)
        : merged.hasAdmin !== undefined
          ? Boolean(merged.hasAdmin)
          : Boolean(
              options.adminPath ||
                options.adminUrl ||
                pluginsList.includes('admin-panel') ||
                pluginsList.includes('adminPanel') ||
                pluginsList.includes('admin')
            );

    const adminPath = merged.adminPath || options.adminPath || options.adminUrl || '/_admin';
    return {
      hasStudio,
      hasAdmin,
      adminPath,
      plugins: pluginsList,
    };
  }

  // Initialize Redux DevTools extension bridge if available
  const reduxBridge = setupReduxDevToolsBridge(runtime);

  // Host container
  const host = document.createElement('div');
  host.id = DEVTOOL_HOST_ID;
  host.style.cssText = 'position:fixed;z-index:999998;pointer-events:none;';

  // Use Shadow DOM to completely isolate styles from user CSS
  const shadow = typeof host.attachShadow === 'function' ? host.attachShadow({ mode: 'open' }) : host;

  // Style block
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .ws-devtool-root {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      color: #f4f4f5;
      line-height: 1.5;
      pointer-events: auto;
    }
    .ws-pill {
      position: fixed;
      bottom: 16px;
      ${isRight ? 'right: 16px;' : 'left: 16px;'}
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 9999px;
      padding: 6px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5), 0 0 10px rgba(0,0,0,0.3);
      user-select: none;
      transition: all 0.2s ease;
      z-index: 999998;
    }
    .ws-pill:hover {
      background: #27272a;
      border-color: #f59e0b;
      transform: translateY(-1px);
      box-shadow: 0 12px 30px -5px rgba(245,158,11,0.25);
    }
    .ws-pill-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 700;
      background: #27272a;
      color: #a1a1aa;
    }
    .ws-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      display: inline-block;
      box-shadow: 0 0 8px #10b981;
    }
    .ws-drawer {
      position: fixed;
      bottom: 16px;
      ${isRight ? 'right: 16px;' : 'left: 16px;'}
      width: min(780px, calc(100vw - 32px));
      height: 520px;
      max-height: calc(100vh - 32px);
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 12px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7), 0 0 30px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 999999;
    }
    .ws-drawer.ws-drawer-enter {
      animation: wsFadeIn 0.15s ease-out;
    }
    @keyframes wsFadeIn {
      from { opacity: 0; transform: scale(0.98) translateY(6px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .ws-header {
      background: #121215;
      border-bottom: 1px solid #27272a;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      user-select: none;
    }
    .ws-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 13px;
      color: #fbbf24;
    }
    .ws-tabs {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .ws-tabs::-webkit-scrollbar { display: none; }
    .ws-tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: #a1a1aa;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .ws-tab-btn:hover {
      background: #27272a;
      color: #f4f4f5;
    }
    .ws-tab-btn.active {
      background: #27272a;
      border-color: #3f3f46;
      color: #fbbf24;
    }
    .ws-btn {
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #f4f4f5;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .ws-btn:hover {
      background: #3f3f46;
      border-color: #71717a;
      color: #fff;
    }
    .ws-btn-primary {
      background: #d97706;
      border-color: #f59e0b;
      color: #fff;
    }
    .ws-btn-primary:hover {
      background: #f59e0b;
    }
    .ws-btn-sm {
      padding: 2px 7px;
      font-size: 10px;
    }
    .ws-content {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      background: #09090b;
    }
    .ws-footer {
      background: #121215;
      border-top: 1px solid #27272a;
      padding: 6px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: #71717a;
    }
    .ws-code-block {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 10px;
      font-size: 11px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .ws-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
    }
    .ws-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .ws-badge-success { background: #064e3b; color: #34d399; }
    .ws-badge-warning { background: #78350f; color: #fbbf24; }
    .ws-badge-info { background: #1e3a8a; color: #60a5fa; }
    .ws-badge-danger { background: #881337; color: #fb7185; }
  `;
  shadow.appendChild(styleEl);

  const container = document.createElement('div');
  container.className = 'ws-devtool-root';
  shadow.appendChild(container);

  // --- Snapshot Data Fetchers ---
  function getControllersSnapshot() {
    if (!runtime.controllers) return [];
    return runtime.controllers.getActiveInstances().map((inst) => ({
      instanceId: inst.instanceId,
      name: inst.name,
      tagName: inst.el ? inst.el.tagName.toLowerCase() : 'div',
      isConnected: Boolean(inst.isConnected),
      state: inst.state ? { ...inst.state } : {},
      el: inst.el,
      actions: inst.actions ? Object.keys(inst.actions) : [],
    }));
  }

  function getFragmentsSnapshot() {
    if (!runtime.fragments) return [];
    return runtime.fragments.getInstances().map((inst) => ({
      instanceId: inst.instanceId,
      name: inst.name,
      input: inst.input ? { ...inst.input } : {},
      dependsOn: inst.dependsOn ? Array.from(inst.dependsOn) : [],
      version: inst.version || 1,
      pagePath: inst.pagePath || '/',
      el: inst.el,
    }));
  }

  function getNetworkSnapshot() {
    if (!runtime.debug || typeof runtime.debug.getSnapshot !== 'function') return [];
    const snap = runtime.debug.getSnapshot();
    return {
      activeRequests: snap.activeRequests || [],
      causalChains: snap.causalChains || [],
      fragmentTimings: snap.fragmentTimings || [],
      events: snap.events || [],
    };
  }

  function getStorageSnapshot() {
    const localEntries = [];
    const sessionEntries = [];
    try {
      if (typeof localStorage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('w:')) {
            localEntries.push({ key: k, value: localStorage.getItem(k) });
          }
        }
      }
      if (typeof sessionStorage !== 'undefined') {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('w:')) {
            sessionEntries.push({ key: k, value: sessionStorage.getItem(k) });
          }
        }
      }
    } catch (_) {}
    return { localEntries, sessionEntries };
  }

  // --- Renderers ---
  function renderPill() {
    const controllers = getControllersSnapshot();
    const fragments = getFragmentsSnapshot();
    return `
      <div class="ws-pill" id="ws-devtool-pill" title="Toggle Webspresso Client DevTools (Alt+W)">
        <span style="font-weight:700;color:#fbbf24;">⚡ Webspresso</span>
        <span class="ws-pill-badge">${controllers.length} ctrl${controllers.length !== 1 ? 's' : ''}</span>
        <span class="ws-pill-badge">${fragments.length} frag${fragments.length !== 1 ? 's' : ''}</span>
        <span class="ws-dot" title="Dev server connected"></span>
      </div>
    `;
  }

  function renderControllersTab(controllers) {
    if (controllers.length === 0) {
      return `
        <div class="ws-card" style="text-align:center;padding:32px;color:#a1a1aa;">
          <p style="font-size:14px;margin-bottom:6px;">No active controllers found on this page.</p>
          <p style="font-size:11px;color:#71717a;">Define a controller with <code>defineController(...)</code> and mount with <code>data-controller="..."</code>.</p>
        </div>
      `;
    }

    if (!selectedControllerId || !controllers.find((c) => c.instanceId === selectedControllerId)) {
      selectedControllerId = controllers[0].instanceId;
    }
    const current = controllers.find((c) => c.instanceId === selectedControllerId) || controllers[0];

    return `
      <div style="display:grid;grid-template-columns:220px 1fr;gap:14px;height:100%;">
        <!-- Sidebar list -->
        <div style="border-right:1px solid #27272a;padding-right:12px;overflow-y:auto;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#71717a;margin-bottom:8px;">Mounted Controllers (${controllers.length})</div>
          ${controllers
            .map(
              (c) => `
            <div
              class="ws-card ws-controller-item"
              data-inst-id="${escapeHtml(c.instanceId)}"
              style="cursor:pointer;padding:8px 10px;margin-bottom:6px;${
                c.instanceId === current.instanceId ? 'border-color:#f59e0b;background:#27272a;' : ''
              }">
              <div style="font-weight:700;color:#f4f4f5;">${escapeHtml(c.name || 'anonymous')}</div>
              <div style="font-size:10px;color:#a1a1aa;">&lt;${escapeHtml(c.tagName)}&gt; • ${escapeHtml(c.instanceId)}</div>
            </div>
          `
            )
            .join('')}
        </div>

        <!-- Details pane -->
        <div style="overflow-y:auto;padding-right:4px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <div>
              <h3 style="font-size:14px;font-weight:700;color:#fff;">${escapeHtml(current.name || 'anonymous')}</h3>
              <p style="font-size:10px;color:#71717a;">Instance: ${escapeHtml(current.instanceId)} • Connected: ${current.isConnected ? '✅' : '❌'}</p>
            </div>
            <button class="ws-btn ws-btn-sm" id="ws-btn-highlight-ctrl" data-inst-id="${escapeHtml(current.instanceId)}">
              🎯 Highlight in DOM
            </button>
          </div>

          <!-- Reactive State -->
          <div class="ws-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <strong style="color:#fbbf24;font-size:11px;">REACTIVE STATE</strong>
              <button class="ws-btn ws-btn-sm" id="ws-btn-copy-state" data-inst-id="${escapeHtml(current.instanceId)}">📋 Copy</button>
            </div>
            <div class="ws-code-block">${formatJsonHtml(current.state)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderFragmentsTab(fragments) {
    if (fragments.length === 0) {
      return `
        <div class="ws-card" style="text-align:center;padding:32px;color:#a1a1aa;">
          <p style="font-size:14px;margin-bottom:6px;">No SSR fragments found in DOM.</p>
          <p style="font-size:11px;color:#71717a;">Mark elements with <code>data-w-fragment="name"</code> to enable targeted server partial refreshes.</p>
        </div>
      `;
    }

    return `
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div>
            <strong style="font-size:13px;color:#fff;">Active SSR Fragments (${fragments.length})</strong>
            <p style="font-size:10px;color:#71717a;">Targeted server-rendered DOM segments that can be refreshed independently.</p>
          </div>
          <button class="ws-btn ws-btn-primary ws-btn-sm" id="ws-btn-refresh-all-frags">
            🔄 Refresh All
          </button>
        </div>

        ${fragments
          .map(
            (f) => `
          <div class="ws-card" style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div>
                <strong style="color:#38bdf8;font-size:12px;">${escapeHtml(f.name)}</strong>
                <span style="font-size:10px;color:#71717a;margin-left:6px;">#${escapeHtml(f.instanceId)}</span>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="ws-btn ws-btn-sm" id="ws-btn-highlight-frag" data-inst-id="${escapeHtml(f.instanceId)}">
                  🎯 Highlight
                </button>
                <button class="ws-btn ws-btn-primary ws-btn-sm" id="ws-btn-refresh-frag" data-frag-name="${escapeHtml(f.name)}">
                  🔄 Refresh
                </button>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
              <div>
                <span style="color:#a1a1aa;">Depends On Tags:</span>
                ${
                  f.dependsOn.length > 0
                    ? f.dependsOn.map((t) => `<span class="ws-badge ws-badge-info" style="margin-left:4px;">${escapeHtml(t)}</span>`).join('')
                    : '<span style="color:#71717a;margin-left:4px;">(none)</span>'
                }
              </div>
              <div>
                <span style="color:#a1a1aa;">Version:</span>
                <span style="color:#f4f4f5;margin-left:4px;">${escapeHtml(f.version)}</span>
              </div>
            </div>
            ${
              Object.keys(f.input).length > 0
                ? `<div style="margin-top:6px;"><span style="color:#a1a1aa;font-size:10px;">Parameters:</span><div class="ws-code-block" style="margin-top:4px;padding:6px;">${formatJsonHtml(
                    f.input
                  )}</div></div>`
                : ''
            }
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  function renderNetworkTab(network) {
    const { activeRequests, causalChains, fragmentTimings } = network;
    return `
      <div>
        <div style="margin-bottom:12px;">
          <strong style="font-size:13px;color:#fff;">Client Network & Causal Invalidation Chains</strong>
          <p style="font-size:10px;color:#71717a;">Tracks API calls, concurrency policies (latest, drop), and mutation-to-patch timings.</p>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px;">IN-FLIGHT & RECENT REQUESTS</div>
          ${
            activeRequests.length === 0
              ? '<div class="ws-card" style="padding:10px;color:#71717a;">No active or tracked requests in ring buffer.</div>'
              : activeRequests
                  .map(
                    (r) => `
            <div class="ws-card" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin-bottom:6px;">
              <div>
                <span class="ws-badge ws-badge-${r.method === 'GET' ? 'info' : 'warning'}">${escapeHtml(r.method)}</span>
                <span style="font-weight:600;margin-left:6px;">${escapeHtml(r.url)}</span>
              </div>
              <div style="font-size:10px;color:#a1a1aa;">
                Policy: <span style="color:#38bdf8;">${escapeHtml(r.policy || 'none')}</span> • Status: <span style="color:#34d399;">${escapeHtml(r.status)}</span>
              </div>
            </div>
          `
                  )
                  .join('')
          }
        </div>

        ${
          causalChains.length > 0
            ? `
          <div style="margin-bottom:14px;">
            <div style="font-size:11px;font-weight:700;color:#a78bfa;margin-bottom:6px;">CAUSAL CHAINS (MUTATION ➔ REFRESH ➔ PATCH)</div>
            ${causalChains
              .map(
                (c) => `
              <div class="ws-card" style="padding:10px;margin-bottom:6px;">
                <div style="font-weight:600;color:#f4f4f5;font-size:11px;">Chain: ${escapeHtml(c.chainId)}</div>
                <div class="ws-code-block" style="margin-top:4px;padding:6px;">${formatJsonHtml(c)}</div>
              </div>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }

        ${
          fragmentTimings.length > 0
            ? `
          <div>
            <div style="font-size:11px;font-weight:700;color:#34d399;margin-bottom:6px;">RECENT FRAGMENT TIMINGS</div>
            <div class="ws-card" style="padding:8px 12px;">
              ${fragmentTimings
                .slice(-5)
                .map(
                  (t) => `
                <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #27272a;font-size:11px;">
                  <span>${escapeHtml(t.fragmentName || t.instanceId)}</span>
                  <span style="color:#fbbf24;">patch: ${escapeHtml(t.patchMs)}ms ${t.loadMs ? `(load: ${escapeHtml(t.loadMs)}ms, render: ${escapeHtml(t.renderMs)}ms)` : ''}</span>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  function renderStorageTab(storage) {
    const { localEntries, sessionEntries } = storage;
    const totalCount = localEntries.length + sessionEntries.length;

    return `
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div>
            <strong style="font-size:13px;color:#fff;">Webspresso Storage Inspector (${totalCount})</strong>
            <p style="font-size:10px;color:#71717a;">Inspects namespaced keys (<code>w:*</code>) in localStorage and sessionStorage.</p>
          </div>
          <button class="ws-btn ws-btn-sm" id="ws-btn-clear-storage" style="color:#fb7185;border-color:#881337;">
            🗑️ Clear Webspresso Storage
          </button>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;color:#38bdf8;margin-bottom:6px;">LOCAL STORAGE (w:*)</div>
          ${
            localEntries.length === 0
              ? '<div class="ws-card" style="padding:8px 12px;color:#71717a;">No Webspresso entries in localStorage.</div>'
              : localEntries
                  .map(
                    (e) => `
            <div class="ws-card" style="margin-bottom:6px;">
              <div style="font-weight:600;color:#38bdf8;font-size:11px;">${escapeHtml(e.key)}</div>
              <div class="ws-code-block" style="margin-top:4px;padding:6px;">${formatJsonHtml(
                (() => {
                  try {
                    return JSON.parse(e.value);
                  } catch (_) {
                    return e.value;
                  }
                })()
              )}</div>
            </div>
          `
                  )
                  .join('')
          }
        </div>

        <div>
          <div style="font-size:11px;font-weight:700;color:#a78bfa;margin-bottom:6px;">SESSION STORAGE (w:*)</div>
          ${
            sessionEntries.length === 0
              ? '<div class="ws-card" style="padding:8px 12px;color:#71717a;">No Webspresso entries in sessionStorage.</div>'
              : sessionEntries
                  .map(
                    (e) => `
            <div class="ws-card" style="margin-bottom:6px;">
              <div style="font-weight:600;color:#a78bfa;font-size:11px;">${escapeHtml(e.key)}</div>
              <div class="ws-code-block" style="margin-top:4px;padding:6px;">${formatJsonHtml(
                (() => {
                  try {
                    return JSON.parse(e.value);
                  } catch (_) {
                    return e.value;
                  }
                })()
              )}</div>
            </div>
          `
                  )
                  .join('')
          }
        </div>
      </div>
    `;
  }

  function renderStudioTab() {
    const features = resolveDevFeatures();

    const studioCardHtml = features.hasStudio
      ? `
        <div class="ws-card" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;color:#fbbf24;font-size:13px;">🗄️ Webspresso DB Studio</div>
            <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">Visual database browser, query runner, and table inspector.</div>
            <div style="font-size:9px;color:#71717a;margin-top:4px;">Run in terminal: <code>npx webspresso studio</code> (port 4567)</div>
          </div>
          <a href="${sanitizeHref(studioUrl)}" target="_blank" rel="noopener noreferrer" class="ws-btn ws-btn-primary" id="ws-btn-open-studio" style="text-decoration:none;">
            Open DB Studio ↗
          </a>
        </div>
      `
      : '';

    const adminCardHtml = features.hasAdmin
      ? `
        <div class="ws-card" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;color:#38bdf8;font-size:13px;">⚙️ Admin Panel SPA</div>
            <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">Mithril.js model CRUD and staff administration cockpit.</div>
          </div>
          <a href="${sanitizeHref(features.adminPath)}" target="_blank" rel="noopener noreferrer" class="ws-btn" id="ws-btn-open-admin" style="text-decoration:none;">
            Open ${escapeHtml(features.adminPath)} ↗
          </a>
        </div>
      `
      : '';

    return `
      <div>
        <div style="margin-bottom:16px;">
          <strong style="font-size:13px;color:#fff;">Developer Tools & Studio Integrations</strong>
          <p style="font-size:10px;color:#71717a;">Direct shortcuts to Webspresso's integrated developer productivity tools.</p>
        </div>

        ${studioCardHtml}
        ${adminCardHtml}

        <div class="ws-card" style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;color:#34d399;font-size:13px;">⚡ Dev Live Reload Hub</div>
            <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">SSE-based CSS hot reload and server page reload connection.</div>
          </div>
          <button class="ws-btn ws-btn-sm" id="ws-btn-force-reload">
            🔄 Force Page Reload
          </button>
        </div>
      </div>
    `;
  }

  function renderDrawer() {
    const controllers = getControllersSnapshot();
    const fragments = getFragmentsSnapshot();
    const network = getNetworkSnapshot();
    const storage = getStorageSnapshot();

    return `
      <div class="ws-drawer" id="ws-devtool-drawer">
        <!-- Header -->
        <div class="ws-header">
          <div class="ws-title">
            <span>⚡ Webspresso DevTools</span>
            <span class="ws-badge ws-badge-warning">DEV</span>
          </div>

          <!-- Navigation tabs -->
          <div class="ws-tabs">
            <button class="ws-tab-btn ${activeTab === 'controllers' ? 'active' : ''}" data-tab="controllers">
              🎮 Controllers (${controllers.length})
            </button>
            <button class="ws-tab-btn ${activeTab === 'fragments' ? 'active' : ''}" data-tab="fragments">
              🧩 Fragments (${fragments.length})
            </button>
            <button class="ws-tab-btn ${activeTab === 'network' ? 'active' : ''}" data-tab="network">
              🌐 Network
            </button>
            <button class="ws-tab-btn ${activeTab === 'storage' ? 'active' : ''}" data-tab="storage">
              💾 Storage
            </button>
            <button class="ws-tab-btn ${activeTab === 'studio' ? 'active' : ''}" data-tab="studio">
              🛠️ Studio
            </button>
          </div>

          <!-- Controls -->
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="ws-btn ws-btn-sm" id="ws-btn-refresh-snap" title="Refresh Snapshot">🔄</button>
            <button class="ws-btn ws-btn-sm" id="ws-btn-close" title="Minimize DevTools (Alt+W)">✕</button>
          </div>
        </div>

        <!-- Body -->
        <div class="ws-content">
          ${
            activeTab === 'controllers'
              ? renderControllersTab(controllers)
              : activeTab === 'fragments'
                ? renderFragmentsTab(fragments)
                : activeTab === 'network'
                  ? renderNetworkTab(network)
                  : activeTab === 'storage'
                    ? renderStorageTab(storage)
                    : renderStudioTab()
          }
        </div>

        <!-- Footer -->
        <div class="ws-footer">
          <span>Shortcuts: <strong>Alt + W</strong> to toggle • Console: <code>window.__WEBSPRESSO_DEVTOOLS__</code></span>
          <span style="color:#a1a1aa;">Webspresso v${escapeHtml(PKG_VERSION)}</span>
        </div>
      </div>
    `;
  }

  let lastRenderedHtml = '';
  let wasOpen = false;

  function findInShadow(id) {
    if (shadow && typeof shadow.getElementById === 'function') {
      return shadow.getElementById(id);
    }
    return shadow && typeof shadow.querySelector === 'function' ? shadow.querySelector(`#${id}`) : null;
  }

  function updateDom(force = false) {
    const nextHtml = isOpen ? renderDrawer() : renderPill();
    if (!force && nextHtml === lastRenderedHtml && isOpen === wasOpen) {
      return;
    }

    // Preserve scroll positions inside drawer before updating DOM
    let prevContentScrollTop = 0;
    const prevContentEl =
      isOpen && wasOpen && shadow && typeof shadow.querySelector === 'function'
        ? shadow.querySelector('.ws-content')
        : null;
    if (prevContentEl) {
      prevContentScrollTop = prevContentEl.scrollTop || 0;
    }

    lastRenderedHtml = nextHtml;
    const openingTransition = isOpen && !wasOpen;
    wasOpen = isOpen;

    container.innerHTML = nextHtml;
    if (openingTransition) {
      const drawerEl = findInShadow('ws-devtool-drawer');
      if (drawerEl && drawerEl.classList) {
        drawerEl.classList.add('ws-drawer-enter');
      }
    }
    if (prevContentScrollTop > 0 && shadow && typeof shadow.querySelector === 'function') {
      const nextContentEl = shadow.querySelector('.ws-content');
      if (nextContentEl) {
        nextContentEl.scrollTop = prevContentScrollTop;
      }
    }
    bindEvents();
  }

  function bindEvents() {
    if (!isOpen) {
      const pill = findInShadow('ws-devtool-pill');
      if (pill) {
        pill.addEventListener('click', () => {
          isOpen = true;
          updateDom();
        });
      }
      return;
    }

    // Close button
    const closeBtn = findInShadow('ws-btn-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        isOpen = false;
        updateDom();
      });
    }

    // Refresh snapshot button
    const refreshSnapBtn = findInShadow('ws-btn-refresh-snap');
    if (refreshSnapBtn) {
      refreshSnapBtn.addEventListener('click', () => {
        updateDom();
      });
    }

    // Tab buttons
    const tabBtns = shadow.querySelectorAll('.ws-tab-btn');
    for (let i = 0; i < tabBtns.length; i++) {
      tabBtns[i].addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        if (tab) {
          activeTab = tab;
          updateDom();
        }
      });
    }

    // Controller selection in sidebar
    const ctrlItems = shadow.querySelectorAll('.ws-controller-item');
    for (let i = 0; i < ctrlItems.length; i++) {
      ctrlItems[i].addEventListener('click', (e) => {
        selectedControllerId = e.currentTarget.getAttribute('data-inst-id');
        updateDom();
      });
    }

    // Highlight controller in DOM
    const hlCtrlBtn = findInShadow('ws-btn-highlight-ctrl');
    if (hlCtrlBtn) {
      hlCtrlBtn.addEventListener('click', (e) => {
        const instId = e.currentTarget.getAttribute('data-inst-id');
        const instances = runtime.controllers ? runtime.controllers.getActiveInstances() : [];
        const target = instances.find((i) => i.instanceId === instId);
        if (target && target.el) {
          highlightElement(target.el);
        }
      });
    }

    // Copy state
    const copyStateBtn = findInShadow('ws-btn-copy-state');
    if (copyStateBtn) {
      copyStateBtn.addEventListener('click', (e) => {
        const instId = e.currentTarget.getAttribute('data-inst-id');
        const instances = runtime.controllers ? runtime.controllers.getActiveInstances() : [];
        const target = instances.find((i) => i.instanceId === instId);
        if (target && target.state && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(JSON.stringify(target.state, null, 2));
          copyStateBtn.textContent = '✅ Copied!';
          setTimeout(() => {
            try {
              copyStateBtn.textContent = '📋 Copy';
            } catch (_) {}
          }, 1500);
        }
      });
    }

    // Highlight fragment in DOM
    const hlFragBtns = shadow.querySelectorAll('#ws-btn-highlight-frag');
    for (let i = 0; i < hlFragBtns.length; i++) {
      hlFragBtns[i].addEventListener('click', (e) => {
        const instId = e.currentTarget.getAttribute('data-inst-id');
        const frag = runtime.fragments ? runtime.fragments.getInstance(instId) : null;
        if (frag && frag.el) {
          highlightElement(frag.el);
        }
      });
    }

    // Refresh fragment on demand
    const refreshFragBtns = shadow.querySelectorAll('#ws-btn-refresh-frag');
    for (let i = 0; i < refreshFragBtns.length; i++) {
      refreshFragBtns[i].addEventListener('click', async (e) => {
        const name = e.currentTarget.getAttribute('data-frag-name');
        if (name && runtime.fragments) {
          const btn = e.currentTarget;
          const origText = btn.textContent;
          btn.textContent = '⏳ ...';
          try {
            await runtime.fragments.refresh(name);
          } finally {
            setTimeout(() => {
              btn.textContent = origText;
              updateDom();
            }, 300);
          }
        }
      });
    }

    // Refresh all fragments
    const refreshAllBtn = findInShadow('ws-btn-refresh-all-frags');
    if (refreshAllBtn) {
      refreshAllBtn.addEventListener('click', async () => {
        if (!runtime.fragments) return;
        const origText = refreshAllBtn.textContent;
        refreshAllBtn.textContent = '⏳ Refreshing...';
        try {
          const frags = runtime.fragments.getInstances();
          for (const f of frags) {
            await runtime.fragments.refresh(f.name);
          }
        } finally {
          setTimeout(() => {
            refreshAllBtn.textContent = origText;
            updateDom();
          }, 300);
        }
      });
    }

    // Clear Webspresso storage
    const clearStorageBtn = findInShadow('ws-btn-clear-storage');
    if (clearStorageBtn) {
      clearStorageBtn.addEventListener('click', () => {
        defaultStorage.local.clear();
        defaultStorage.session.clear();
        clearStorageBtn.textContent = '✅ Cleared!';
        setTimeout(() => {
          updateDom();
        }, 800);
      });
    }

    // Force page reload
    const forceReloadBtn = findInShadow('ws-btn-force-reload');
    if (forceReloadBtn) {
      forceReloadBtn.addEventListener('click', () => {
        if (typeof window !== 'undefined' && window.location) {
          window.location.reload();
        }
      });
    }
  }

  // Hotkey listener: Alt+W toggles the DevTool dock
  function onKeyDown(e) {
    if (e.altKey && (e.key === 'w' || e.key === 'W' || e.code === 'KeyW')) {
      e.preventDefault();
      isOpen = !isOpen;
      updateDom();
    }
  }

  document.addEventListener('keydown', onKeyDown);

  // Periodic polling to keep snapshots live
  const pollIntervalMs = isNumber(options.pollInterval) ? options.pollInterval : 2000;
  let pollTimer = null;
  if (pollIntervalMs > 0) {
    pollTimer = setInterval(() => {
      // If open, re-render to reflect live state changes
      if (isOpen) {
        updateDom();
      }
    }, pollIntervalMs);
  }

  // Mount into DOM
  const targetBody = document.body || document.documentElement;
  targetBody.appendChild(host);
  updateDom();

  // Public handle & window console export
  const devtoolApi = {
    open() {
      isOpen = true;
      updateDom();
    },
    close() {
      isOpen = false;
      updateDom();
    },
    toggle() {
      isOpen = !isOpen;
      updateDom();
    },
    isOpen() {
      return isOpen;
    },
    setMeta(nextMeta = {}) {
      if (nextMeta && typeof nextMeta === 'object') {
        metaOverrides = { ...metaOverrides, ...nextMeta };
        updateDom();
      }
    },
    getSnapshot() {
      return {
        controllers: getControllersSnapshot(),
        fragments: getFragmentsSnapshot(),
        network: getNetworkSnapshot(),
        storage: getStorageSnapshot(),
      };
    },
    getState(controllerName) {
      const controllers = getControllersSnapshot();
      const match = controllers.find((c) => c.name === controllerName || c.instanceId === controllerName);
      return match ? match.state : null;
    },
    refresh(fragmentName) {
      return runtime.fragments ? runtime.fragments.refresh(fragmentName) : Promise.resolve();
    },
    highlight(controllerOrFragmentName) {
      const controllers = getControllersSnapshot();
      const ctrl = controllers.find((c) => c.name === controllerOrFragmentName || c.instanceId === controllerOrFragmentName);
      if (ctrl && ctrl.el) {
        return highlightElement(ctrl.el);
      }
      const fragments = getFragmentsSnapshot();
      const frag = fragments.find((f) => f.name === controllerOrFragmentName || f.instanceId === controllerOrFragmentName);
      if (frag && frag.el) {
        return highlightElement(frag.el);
      }
      return false;
    },
    destroy() {
      document.removeEventListener('keydown', onKeyDown);
      if (pollTimer) clearInterval(pollTimer);
      try {
        host.remove();
      } catch (_) {}
      if (typeof window !== 'undefined' && window.__WEBSPRESSO_DEVTOOLS__ === devtoolApi) {
        delete window.__WEBSPRESSO_DEVTOOLS__;
      }
    },
  };

  host.__webspressoDevtoolInstance = devtoolApi;

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_DEVTOOLS__ = devtoolApi;
  }

  return devtoolApi;
}

module.exports = {
  mountDevtool,
  highlightElement,
  setupReduxDevToolsBridge,
  formatJsonHtml,
};

},
    "./controller": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Controller Runtime
 *
 * Implements a Stimulus-inspired, Datastar-powered controller architecture:
 * - Deterministic controller naming & duplicate registration collision detection
 * - Isolated per-instance state scope backed by Datastar signals
 * - Scoped target resolution (`target(name)`, `targets(name)`) that never crosses into
 *   nested controllers and never caches stale DOM element references across patches
 * - DOM CustomEvent `emit` / `on` communication without requiring a global event bus
 * - Automatic cleanup of listeners (`on`), reactive `effect`s, `interval`s, `timeout`s,
 *   and in-flight `api` requests on disconnect
 * - Protection against late async results mutating state after instance removal
 * - Preservation of active controller instances and local state when DOM roots survive a fragment morph
 */

const { createFormHandle } = require('./forms');
const { createApiClient } = require('./api');
const { defaultStorage, createClientStorage } = require('./storage');
const { createClientServiceRegistry } = require('./services');
const {
  isArray,
  isNumber,
  decorateElement,
  parseDurationMs,
  parseRefetchMode,
  setElementBusyState,
} = require('./utils');

let instanceSeq = 0;
let activeControllerContext = null;

function getActiveControllerContext() {
  return activeControllerContext;
}

function resolveStatePath(root, pathStr) {
  if (!root || !pathStr) return undefined;
  const parts = String(pathStr).split('.');
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function deepTouch(val, visited = new Set()) {
  if (val === null || typeof val !== 'object' || visited.has(val)) {
    return;
  }
  visited.add(val);
  if (isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      deepTouch(val[i], visited);
    }
  } else {
    const keys = Object.keys(val);
    for (let i = 0; i < keys.length; i++) {
      deepTouch(val[keys[i]], visited);
    }
  }
}

function deepCloneOrSnapshot(val) {
  if (val === null || typeof val !== 'object') return val;
  try {
    return JSON.parse(JSON.stringify(val));
  } catch {
    return isArray(val) ? [...val] : { ...val };
  }
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') return false;
  if (isArray(a) !== isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) {
      return false;
    }
  }
  return true;
}

function hasArrayChanged(newArr, oldArr) {
  if (!isArray(newArr) || !isArray(oldArr)) return !Object.is(newArr, oldArr);
  if (newArr.length !== oldArr.length) return true;
  for (let i = 0; i < newArr.length; i++) {
    if (!Object.is(newArr[i], oldArr[i])) return true;
  }
  return false;
}

function runUntracked(engine, fn) {
  if (engine && typeof engine.untracked === 'function') {
    return engine.untracked(fn);
  }
  return fn();
}

function createStandaloneWatch(engine, source, callback, options = {}) {
  if (typeof callback !== 'function') {
    throw new TypeError('watch(source, callback) requires callback to be a function.');
  }

  const immediate = Boolean(options.immediate);
  const deep = Boolean(options.deep);
  const once = Boolean(options.once);

  let getter;
  if (typeof source === 'function') {
    getter = source;
  } else if (isArray(source)) {
    getter = () => source.map((s) => (typeof s === 'function' ? s() : s));
  } else {
    getter = () => source;
  }

  let oldValue = undefined;
  let isFirstRun = true;
  let stopped = false;
  let userCleanup = null;

  function runCleanup() {
    if (typeof userCleanup === 'function') {
      try {
        userCleanup();
      } catch (_e) {}
      userCleanup = null;
    }
  }

  function onCleanup(fn) {
    if (typeof fn === 'function') {
      userCleanup = fn;
    }
  }

  function stopWatch() {
    if (stopped) return;
    stopped = true;
    runCleanup();
    stopEffect();
  }

  const stopEffect = engine.effect(() => {
    if (stopped) return;

    let newValue;
    try {
      newValue = getter();
      if ((deep || (source && typeof source === 'object' && typeof source !== 'function' && !isArray(source))) && newValue && typeof newValue === 'object') {
        deepTouch(newValue);
      }
    } catch (_err) {
      return;
    }

    const isArr = isArray(source);

    if (isFirstRun) {
      isFirstRun = false;
      oldValue = deep ? deepCloneOrSnapshot(newValue) : isArr ? [...newValue] : newValue;
      if (immediate) {
        runCleanup();
        runUntracked(engine, () => {
          callback(newValue, undefined, onCleanup);
        });
        if (once) stopWatch();
      }
      return;
    }

    const hasChanged = deep
      ? !deepEqual(newValue, oldValue)
      : isArr
        ? hasArrayChanged(newValue, oldValue)
        : !Object.is(newValue, oldValue);

    if (!hasChanged) return;

    const prev = oldValue;
    oldValue = deep ? deepCloneOrSnapshot(newValue) : isArr ? [...newValue] : newValue;

    runCleanup();
    runUntracked(engine, () => {
      callback(newValue, prev, onCleanup);
    });

    if (once) stopWatch();
  });

  return stopWatch;
}

/**
 * Vue-style reactive watcher.
 *
 * @template T
 * @param {(() => T) | string | Array<any>} source - Reactive getter function, state dot-path, or array of sources
 * @param {(newValue: T, oldValue: T | undefined, onCleanup: (fn: () => void) => void) => void} callback - Handler invoked when value changes
 * @param {object} [options]
 * @param {boolean} [options.immediate=false] - Trigger callback immediately on registration
 * @param {boolean} [options.deep=false] - Deep watch nested object/array mutations
 * @param {boolean} [options.once=false] - Stop watching automatically after first trigger
 * @returns {() => void} Unwatch function
 */
function watch(source, callback, options = {}) {
  if (activeControllerContext && typeof activeControllerContext.watch === 'function') {
    return activeControllerContext.watch(source, callback, options);
  }
  const { createDatastarAdapter } = require('./adapter/datastar');
  const engine = createDatastarAdapter().engine;
  if (!engine || typeof engine.effect !== 'function') {
    return () => {};
  }
  return createStandaloneWatch(engine, source, callback, options);
}

/**
 * Derive a deterministic controller name from a `.client.{js,ts}` file path.
 *
 * Examples:
 * - `pages/notes.client.ts` -> `notes`
 * - `pages/index.client.js` -> `index`
 * - `pages/settings/profile.client.ts` -> `settings--profile` (alias `settings/profile`)
 * - `views/components/dropdown.client.ts` -> `dropdown`
 * - `views/modals/confirm-dialog.client.js` -> `confirm-dialog`
 *
 * @param {string} filePath
 * @returns {string}
 */
function stripBrackets(str) {
  return str.replace(/[\[\]]/g, '');
}

function extractAfterMarker(path, marker) {
  const candidates = ['/src/' + marker, 'src/' + marker, '/' + marker, marker];
  for (const cand of candidates) {
    const idx = path.lastIndexOf(cand);
    if (idx !== -1) {
      if (cand.startsWith('/') || idx === 0) {
        return path.slice(idx + cand.length);
      }
    }
  }
  return null;
}

function stripClientExtension(path) {
  const exts = ['.client.ts', '.client.tsx', '.client.js', '.client.jsx', '.client.mjs', '.client.cjs'];
  const lower = path.toLowerCase();
  for (const ext of exts) {
    if (lower.endsWith(ext)) {
      return path.slice(0, -ext.length);
    }
  }
  return path;
}

function deriveControllerNameFromPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const normalized = filePath.replace(/\\/g, '/');
  const withoutExt = stripClientExtension(normalized);

  // Check if under views/components/
  const compRel = extractAfterMarker(withoutExt, 'views/components/');
  if (compRel) {
    return stripBrackets(compRel.split('/').join('--'));
  }

  // Check if under views/
  const viewsRel = extractAfterMarker(withoutExt, 'views/');
  if (viewsRel) {
    const base = viewsRel.split('/').pop() || viewsRel;
    return stripBrackets(base);
  }

  // Check if under pages/
  const pagesRel = extractAfterMarker(withoutExt, 'pages/');
  if (pagesRel) {
    let rel = pagesRel;
    if (rel.endsWith('/index')) {
      rel = rel.slice(0, -6);
    }
    if (!rel || rel === 'index') {
      rel = 'index';
    }
    return stripBrackets(rel.split('/').join('--'));
  }

  const base = withoutExt.split('/').pop() || withoutExt;
  return stripBrackets(base);
}

/**
 * Define a client behavior controller.
 *
 * @template TState
 * @param {object} definition
 * @param {string} [definition.name] - Optional explicit controller name
 * @param {(ctx: { el: Element }) => TState} [definition.state] - Factory returning initial local state per instance
 * @param {(ctx: object) => (() => void)|void} [definition.connect] - Lifecycle setup hook; may return a cleanup function
 * @param {(ctx: object) => void} [definition.disconnect] - Optional teardown hook
 * @param {Record<string, (ctx: object, event?: Event, actionEl?: Element) => unknown>} [definition.actions] - Named action handlers
 */
function defineController(definition = {}) {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('defineController() requires a configuration object.');
  }
  if (definition.state !== undefined && typeof definition.state !== 'function') {
    throw new TypeError(
      'defineController({ state }) must be a factory function `() => ({ ... })` so each instance receives isolated state.'
    );
  }
  if (definition.computed !== undefined && (typeof definition.computed !== 'object' || definition.computed === null)) {
    throw new TypeError('defineController({ computed }) must be an object of computed property functions.');
  }
  if (definition.tasks !== undefined && (typeof definition.tasks !== 'object' || definition.tasks === null)) {
    throw new TypeError('defineController({ tasks }) must be an object of task factory functions.');
  }
  if (definition.watch !== undefined && (typeof definition.watch !== 'object' || definition.watch === null)) {
    throw new TypeError('defineController({ watch }) must be an object of watcher functions or descriptors.');
  }
  if (definition.onError !== undefined && typeof definition.onError !== 'function') {
    throw new TypeError('defineController({ onError }) must be an error handler function `(err, ctx, meta) => void`.');
  }
  if (definition.persist !== undefined && definition.persist !== null) {
    const p = definition.persist;
    const isArr = isArray(p);
    const isStr = typeof p === 'string';
    const isObj = typeof p === 'object' && p !== null && !isArr;
    if (!isArr && !isStr && !isObj) {
      throw new TypeError(
        'defineController({ persist }) must be an array of keys, storage type string ("local" | "session"), or a config object { keys?, storage?, key?, debounce? }.'
      );
    }
  }

  // Pre-validate collision between state and computed properties
  if (definition.computed && typeof definition.computed === 'object') {
    let dummyState = {};
    if (typeof definition.state === 'function') {
      try {
        dummyState = definition.state({ el: null }) || {};
      } catch (_e) {}
    } else if (definition.state && typeof definition.state === 'object') {
      dummyState = definition.state;
    }
    for (const key of Object.keys(definition.computed)) {
      if (dummyState && Object.prototype.hasOwnProperty.call(dummyState, key)) {
        throw new TypeError(`Cannot define "${key}" as both a state and computed property.`);
      }
    }
  }
  return Object.freeze({
    __isWebspressoController: true,
    name: definition.name ? String(definition.name).trim() : null,
    state: definition.state || (() => ({})),
    computed: definition.computed && typeof definition.computed === 'object' ? definition.computed : {},
    tasks: definition.tasks && typeof definition.tasks === 'object' ? definition.tasks : {},
    connect: typeof definition.connect === 'function' ? definition.connect : null,
    disconnect: typeof definition.disconnect === 'function' ? definition.disconnect : null,
    beforePatch: typeof definition.beforePatch === 'function' ? definition.beforePatch : null,
    afterPatch: typeof definition.afterPatch === 'function' ? definition.afterPatch : null,
    onError: typeof definition.onError === 'function' ? definition.onError : null,
    persist: definition.persist || null,
    watch: definition.watch && typeof definition.watch === 'object' ? definition.watch : null,
    actions: definition.actions && typeof definition.actions === 'object' ? definition.actions : {},
  });
}

/**
 * Normalize controller persist configuration.
 *
 * @param {any} persistOpt
 * @param {string|null} controllerName
 * @returns {{ keys: string[]|null, storageType: 'local'|'session'|'memory', storageKey: string, debounce: number }|null}
 */
function normalizePersistConfig(persistOpt, controllerName) {
  if (!persistOpt) return null;
  let keys = null;
  let storageType = 'local';
  let storageKey = 'state';
  let isGlobal = false;
  let debounce = 50;

  if (isArray(persistOpt)) {
    keys = persistOpt.map(String);
  } else if (typeof persistOpt === 'string') {
    const s = persistOpt.trim().toLowerCase();
    storageType = s === 'session' ? 'session' : 'local';
  } else if (typeof persistOpt === 'object' && persistOpt !== null) {
    if (isArray(persistOpt.keys)) {
      keys = persistOpt.keys.map(String);
    }
    if (persistOpt.storage === 'session' || persistOpt.storage === 'memory') {
      storageType = persistOpt.storage;
    }
    if (typeof persistOpt.key === 'string' && persistOpt.key.trim()) {
      storageKey = persistOpt.key.trim();
    }
    if (Boolean(persistOpt.global)) {
      isGlobal = true;
    }
    if (isNumber(persistOpt.debounce)) {
      debounce = Math.max(0, persistOpt.debounce);
    }
  }
  return { keys, storageType, storageKey, isGlobal, debounce };
}

/**
 * Check if `candidateEl` belongs to `rootEl`'s controller scope for `controllerName`,
 * and is NOT inside a nested `[data-w-controller]` element.
 */
function isTargetInControllerScope(rootEl, candidateEl) {
  if (!rootEl || !candidateEl) return false;
  if (candidateEl === rootEl) return true;
  let cur = candidateEl.parentElement;
  while (cur && cur !== rootEl) {
    if (cur.hasAttribute && cur.hasAttribute('data-w-controller')) {
      return false;
    }
    cur = cur.parentElement;
  }
  return cur === rootEl;
}

/**
 * Dynamically resolve `[data-w-target]` elements inside `rootEl` strictly within the
 * controller's scope. Never caches DOM references so DOM patches never leave stale pointers.
 *
 * Supports:
 * - `data-w-target="input"`
 * - `data-w-target="notes.input"` (controller-prefixed target syntax)
 */
function queryScopedTargets(rootEl, controllerName, targetName) {
  if (!rootEl || typeof rootEl.querySelectorAll !== 'function' || !targetName) {
    return [];
  }
  const cleanTarget = String(targetName).trim();
  const prefixedTarget = `${controllerName}.${cleanTarget}`;

  const allTargets = rootEl.querySelectorAll('[data-w-target]');
  const matched = [];

  for (let i = 0; i < allTargets.length; i++) {
    const el = allTargets[i];
    if (!isTargetInControllerScope(rootEl, el)) continue;
    const rawAttr = (el.getAttribute('data-w-target') || '').trim();
    const tokens = rawAttr.split(/\s+/);
    if (tokens.includes(cleanTarget) || tokens.includes(prefixedTarget)) {
      matched.push(decorateElement(el));
    }
  }

  return matched;
}

/**
 * Create a Controller Runtime manager.
 *
 * @param {object} options
 * @param {object} options.datastar - Datastar adapter instance
 * @param {object} options.api - Base API client configuration or instance
 * @param {object} [options.fragments] - Fragment coordinator instance
 * @param {object} [options.debug] - Client debugger instance
 * @param {(name: string) => Promise<object>} [options.lazyLoader] - Optional dynamic loader for lazy controllers
 */
function createControllerRuntime(options = {}) {
  const datastar = options.datastar;
  const fragments = options.fragments || null;
  const debug = options.debug || null;
  const baseApiConfig = options.apiConfig || {};
  const lazyLoader = typeof options.lazyLoader === 'function' ? options.lazyLoader : null;
  const services =
    options.services && typeof options.services.get === 'function'
      ? options.services
      : createClientServiceRegistry({
          root: options.root || null,
          debug,
          services: options.services || undefined,
        });

  // Registered controller definitions: name -> { name, definition, sourcePath }
  const definitions = new Map();
  // Active mounted controller instances per element: WeakMap<Element, Map<controllerName, InstanceRecord>>
  const elementInstances = new WeakMap();
  // All active instances by instanceId: Map<instanceId, InstanceRecord>
  const activeInstances = new Map();
  // Standalone forms (forms without a controller wrapper)
  const standaloneForms = new WeakMap();
  const activeStandaloneForms = new Set();

  /**
   * Register a controller definition with collision checking.
   *
   * @param {string} name
   * @param {object} rawDef
   * @param {object} [meta]
   * @param {string} [meta.sourcePath]
   * @param {string[]} [meta.aliases]
   */
  function register(nameOrDef, rawDef, meta = {}) {
    let name = nameOrDef;
    let actualDef = rawDef;
    if (typeof nameOrDef === 'object' && nameOrDef !== null && !rawDef) {
      actualDef = nameOrDef;
      name = actualDef.name || (actualDef.default && actualDef.default.name) || null;
    }

    const def =
      actualDef && actualDef.__isWebspressoController
        ? actualDef
        : defineController(actualDef && actualDef.default ? actualDef.default : actualDef);

    const canonicalName = String(name || def.name || '').trim();
    if (!canonicalName) {
      throw new Error('Controller registration requires a non-empty controller name.');
    }

    const sourcePath = meta.sourcePath || null;
    const existing = definitions.get(canonicalName);

    if (existing) {
      const sameDef = existing.definition === def;
      const sameSource = Boolean(sourcePath && existing.sourcePath === sourcePath);
      if (!sameDef && !sameSource) {
        const err = new Error(
          `Controller name collision detected for "${canonicalName}"` +
            (existing.sourcePath && sourcePath
              ? ` between "${existing.sourcePath}" and "${sourcePath}".`
              : '.')
        );
        err.code = 'CONTROLLER_NAME_COLLISION';
        err.controllerName = canonicalName;
        throw err;
      }
      return def;
    }

    const entry = {
      name: canonicalName,
      definition: def,
      sourcePath,
    };
    definitions.set(canonicalName, entry);

    if (isArray(meta.aliases)) {
      for (const alias of meta.aliases) {
        if (alias && !definitions.has(alias)) {
          definitions.set(alias, entry);
        }
      }
    }

    return def;
  }

  /**
   * Mount a single controller instance on `rootEl` if not already mounted.
   */
  function mountControllerOnElement(rootEl, controllerName) {
    if (!rootEl || rootEl.nodeType !== 1) return null;
    const reg = definitions.get(controllerName);
    if (!reg) return null;

    let elMap = elementInstances.get(rootEl);
    if (!elMap) {
      elMap = new Map();
      elementInstances.set(rootEl, elMap);
    }

    // Prevent double-binding on the same DOM root!
    if (elMap.has(controllerName)) {
      const existingInstance = elMap.get(controllerName);
      // Re-run DOM attribute binding for any newly morphed child nodes that aren't bound yet
      existingInstance.rebindDom();
      return existingInstance;
    }

    const instanceId = `ctrl_${controllerName}_${++instanceSeq}`;
    let connected = true;
    const lifecycleAbort = new AbortController();

    const isConnected = () => connected && rootEl.isConnected !== false;

    // 1. Controller-scoped API client (aborts on disconnect, routes invalidations to fragments)
    const scopedApi = createApiClient({
      ...baseApiConfig,
      lifecycleSignal: lifecycleAbort.signal,
      isConnected,
      debug,
      onInvalidate: fragments ? (tags, meta) => fragments.invalidate(tags, meta) : baseApiConfig.onInvalidate,
    });

    // 2. Lifecycle resource trackers
    const cleanupCallbacks = [];
    const scopedForms = new Map();
    const scopedTasks = {};
    const scopedTasksList = [];
    const busyActionCounts = new Map();
    let totalBusyActions = 0;
    const busySignalPrefix = `__w_inst_${instanceId}.__busy`;
    datastar.engine.signals.setValue(`${busySignalPrefix}.any`, false);

    function syncAnyBusySignal() {
      let busy = totalBusyActions > 0;
      if (!busy) {
        for (let i = 0; i < scopedTasksList.length; i++) {
          if (scopedTasksList[i].pending) {
            busy = true;
            break;
          }
        }
      }
      datastar.engine.signals.setValue(`${busySignalPrefix}.any`, busy);
    }

    function setActionBusy(actionName, delta) {
      const prevCount = busyActionCounts.get(actionName) || 0;
      const nextCount = Math.max(0, prevCount + delta);
      if (nextCount === 0) {
        busyActionCounts.delete(actionName);
      } else {
        busyActionCounts.set(actionName, nextCount);
      }
      totalBusyActions = Math.max(0, totalBusyActions + delta);
      datastar.engine.signals.setValue(`${busySignalPrefix}.action_${actionName}`, nextCount > 0);
      syncAnyBusySignal();
    }

    function isActionBusy(actionName) {
      if (!actionName) return false;
      datastar.engine.signals.value(`${busySignalPrefix}.action_${actionName}`);
      return (busyActionCounts.get(actionName) || 0) > 0;
    }

    function checkIsBusy() {
      datastar.engine.signals.value(`${busySignalPrefix}.any`);
      if (totalBusyActions > 0) return true;
      for (let i = 0; i < scopedTasksList.length; i++) {
        if (scopedTasksList[i].pending) return true;
      }
      return false;
    }

    function isLoadingTargetActive(rawSpec) {
      const spec = typeof rawSpec === 'string' ? rawSpec.trim() : '';
      if (!spec || spec === 'true') {
        return checkIsBusy();
      }
      const parts = spec.split(',').map((s) => s.trim()).filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const token = parts[i];
        if (reg.definition.actions && Object.prototype.hasOwnProperty.call(reg.definition.actions, token)) {
          if (isActionBusy(token)) return true;
          continue;
        }
        if (
          Object.prototype.hasOwnProperty.call(scopedTasks, token) ||
          (reg.definition.tasks && Object.prototype.hasOwnProperty.call(reg.definition.tasks, token))
        ) {
          const t = getTask(token);
          if (t && t.pending) return true;
          continue;
        }
        if (Boolean(datastar.evaluateStateExpression(state, token))) {
          return true;
        }
      }
      return false;
    }

    let currentActionEl = null;
    let lastError = null;
    const dynamicErrorListeners = new Set();

    function handleControllerError(err, meta = {}) {
      if (!err || err.isCanceled) {
        return;
      }

      lastError = err;

      // 1. Controller definition onError hook
      if (typeof reg.definition.onError === 'function') {
        try {
          reg.definition.onError(err, ctx, meta);
        } catch (hookErr) {
          if (debug) {
            debug.trackCleanupError(instanceId, controllerName, 'onError', hookErr);
          }
        }
      }

      // 2. Dynamic ctx.onError listeners
      for (const listener of Array.from(dynamicErrorListeners)) {
        try {
          listener(err, meta);
        } catch (_listenerErr) {
          // Ignore
        }
      }

      // 3. Dispatch bubbling CustomEvent 'w-controller:error' on rootEl
      emitEvent(
        'w-controller:error',
        {
          error: err,
          instanceId,
          controllerName,
          ...meta,
        },
        { bubbles: true, cancelable: true }
      );
    }

    let taskSeq = 0;
    function createTaskInstance(runFnOrConfig, options = {}) {
      let runFn = runFnOrConfig;
      let taskOpts = { ...options };
      if (typeof runFnOrConfig === 'object' && runFnOrConfig !== null && typeof runFnOrConfig.run === 'function') {
        runFn = runFnOrConfig.run;
        taskOpts = { ...runFnOrConfig, ...options };
      }
      if (typeof runFn !== 'function') {
        throw new TypeError('task(fn) requires an async executor function or { run: async () => ... } config.');
      }

      const policy = taskOpts.concurrency || taskOpts.policy || 'latest';
      const taskKey = taskOpts.key || `task_${++taskSeq}`;
      const signalPrefix = `__w_inst_${instanceId}.task_${taskKey}`;

      // React Query-style automatic revalidation options for tasks
      const isMutationTask = taskOpts.mutation === true || taskOpts.kind === 'mutation';
      const staleTimeMs = parseDurationMs(taskOpts.staleTime, 0);
      const refetchOnMountMode = isMutationTask
        ? false
        : parseRefetchMode(
            taskOpts.refetchOnMount !== undefined ? taskOpts.refetchOnMount : taskOpts.refetchOnVisit,
            false
          );
      const refetchOnFocusMode = isMutationTask
        ? false
        : parseRefetchMode(
            taskOpts.refetchOnWindowFocus !== undefined ? taskOpts.refetchOnWindowFocus : taskOpts.refetchOnFocus,
            false
          );
      const refetchOnReconnectMode = isMutationTask
        ? false
        : parseRefetchMode(taskOpts.refetchOnReconnect, false);
      const refetchIntervalMs = isMutationTask ? 0 : parseDurationMs(taskOpts.refetchInterval, 0);
      const refetchIntervalInBg =
        !isMutationTask && parseRefetchMode(taskOpts.refetchIntervalInBackground, false) === true;

      let currentRunVersion = 0;
      let activeRuns = 0;
      let inFlightAbort = null;
      let queuedPromise = Promise.resolve();
      let _lastUpdatedAt = 0;
      let taskIntervalTimer = null;
      let focusDebounceTimer = null;
      const taskCleanupListeners = [];

      datastar.engine.signals.setValue(`${signalPrefix}.pending`, false);
      datastar.engine.signals.setValue(`${signalPrefix}.data`, null);
      datastar.engine.signals.setValue(`${signalPrefix}.error`, null);
      datastar.engine.signals.setValue(`${signalPrefix}.stale`, false);

      let _pending = false;
      let _data = null;
      let _error = null;
      let _stale = false;
      let _lastArgs = [];

      function isTaskStale(mode = true) {
        if (!mode) return false;
        if (mode === 'always') return true;
        if (_lastUpdatedAt === 0) return true;
        if (staleTimeMs <= 0) return true;
        return Date.now() - _lastUpdatedAt >= staleTimeMs;
      }

      function updateSignal(name, val) {
        datastar.engine.signals.setValue(`${signalPrefix}.${name}`, val);
        if (name === 'pending') {
          syncAnyBusySignal();
        }
      }

      async function run(...args) {
        if (!isConnected()) return undefined;
        if (args.length > 0) {
          _lastArgs = [...args];
        }
        const effectiveArgs = args.length > 0 ? args : _lastArgs;

        if (policy === 'drop' && activeRuns > 0) {
          if (debug && typeof debug.trackDiscardedResponse === 'function') {
            debug.trackDiscardedResponse({
              source: 'task',
              instanceId,
              key: taskKey,
              reason: 'dropped-by-policy',
            });
          }
          return undefined;
        }

        if (policy === 'queue') {
          const wait = queuedPromise;
          const nextRun = wait.then(() => executeRun(...effectiveArgs)).catch(() => {});
          queuedPromise = nextRun;
          return nextRun;
        }

        return executeRun(...effectiveArgs);
      }

      async function executeRun(...args) {
        if (!isConnected()) return undefined;

        const runVersion = ++currentRunVersion;
        activeRuns += 1;

        if (policy === 'latest' && inFlightAbort) {
          try {
            inFlightAbort.abort();
          } catch (_e) {}
        }
        const abortCtrl = new AbortController();
        inFlightAbort = abortCtrl;

        _pending = true;
        updateSignal('pending', true);
        if (_data !== null) {
          _stale = true;
          updateSignal('stale', true);
        }

        try {
          const result = await runFn(...args);

          if (!isConnected() || (policy !== 'parallel' && runVersion !== currentRunVersion)) {
            return undefined;
          }

          _data = result;
          _error = null;
          _stale = false;
          _lastUpdatedAt = Date.now();
          updateSignal('data', result);
          updateSignal('error', null);
          updateSignal('stale', false);
          return result;
        } catch (err) {
          if (!isConnected() || (policy !== 'parallel' && runVersion !== currentRunVersion)) {
            return undefined;
          }
          if (err && (err.isCanceled || err.name === 'AbortError')) {
            return undefined;
          }
          _error = err;
          updateSignal('error', err);
          handleControllerError(err, {
            task: taskKey,
            phase: 'task',
          });
          throw err;
        } finally {
          if (inFlightAbort === abortCtrl) {
            inFlightAbort = null;
          }
          activeRuns = Math.max(0, activeRuns - 1);
          const shouldClearPending =
            policy === 'parallel'
              ? activeRuns === 0
              : runVersion === currentRunVersion || activeRuns === 0;
          if (shouldClearPending) {
            _pending = false;
            _stale = false;
            if (isConnected()) {
              updateSignal('pending', false);
              updateSignal('stale', false);
            }
          }
        }
      }

      function cancel() {
        if (inFlightAbort) {
          try {
            inFlightAbort.abort();
          } catch (_e) {}
          inFlightAbort = null;
        }
        _pending = false;
        _stale = false;
        if (isConnected()) {
          updateSignal('pending', false);
          updateSignal('stale', false);
        }
      }

      const taskObj = {
        __isWebspressoTask: true,
        get pending() {
          datastar.engine.signals.value(`${signalPrefix}.pending`);
          return _pending;
        },
        get data() {
          datastar.engine.signals.value(`${signalPrefix}.data`);
          return _data;
        },
        get error() {
          datastar.engine.signals.value(`${signalPrefix}.error`);
          return _error;
        },
        get stale() {
          datastar.engine.signals.value(`${signalPrefix}.stale`);
          return _stale || (_lastUpdatedAt > 0 && staleTimeMs > 0 && Date.now() - _lastUpdatedAt >= staleTimeMs);
        },
        get lastUpdatedAt() {
          return _lastUpdatedAt;
        },
        get lastArgs() {
          return [..._lastArgs];
        },
        isStale: () => isTaskStale(true),
        run,
        cancel,
        dispose() {
          if (taskIntervalTimer) {
            clearInterval(taskIntervalTimer);
            taskIntervalTimer = null;
          }
          if (focusDebounceTimer) {
            clearTimeout(focusDebounceTimer);
            focusDebounceTimer = null;
          }
          while (taskCleanupListeners.length > 0) {
            const removeFn = taskCleanupListeners.pop();
            try {
              removeFn();
            } catch (_e) {}
          }
          cancel();
          datastar.engine.signals.remove(signalPrefix);
        },
      };

      // Set up automatic background revalidation (mount / focus / reconnect / interval)
      const doc = (rootEl && rootEl.ownerDocument) || (typeof document !== 'undefined' ? document : null);
      const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

      function isDocHidden() {
        return Boolean(doc && doc.visibilityState === 'hidden');
      }

      if (refetchOnMountMode) {
        Promise.resolve().then(() => {
          if (isConnected() && isTaskStale(refetchOnMountMode)) {
            run().catch(() => {});
          }
        });
      }

      if (refetchOnFocusMode) {
        const onTaskFocus = () => {
          if (!isConnected() || isDocHidden()) return;
          if (focusDebounceTimer) clearTimeout(focusDebounceTimer);
          focusDebounceTimer = setTimeout(() => {
            focusDebounceTimer = null;
            if (isConnected() && !isDocHidden() && activeRuns === 0 && isTaskStale(refetchOnFocusMode)) {
              run().catch(() => {});
            }
          }, 20);
        };
        const onVisChange = () => {
          if (!isDocHidden()) onTaskFocus();
        };
        if (doc && typeof doc.addEventListener === 'function') {
          doc.addEventListener('visibilitychange', onVisChange);
          taskCleanupListeners.push(() => doc.removeEventListener('visibilitychange', onVisChange));
        }
        if (win && typeof win.addEventListener === 'function') {
          win.addEventListener('focus', onTaskFocus);
          taskCleanupListeners.push(() => win.removeEventListener('focus', onTaskFocus));
        }
      }

      if (refetchOnReconnectMode && win && typeof win.addEventListener === 'function') {
        const onTaskOnline = () => {
          if (isConnected() && activeRuns === 0 && isTaskStale(refetchOnReconnectMode)) {
            run().catch(() => {});
          }
        };
        win.addEventListener('online', onTaskOnline);
        taskCleanupListeners.push(() => win.removeEventListener('online', onTaskOnline));
      }

      if (refetchIntervalMs > 0) {
        taskIntervalTimer = setInterval(() => {
          if (!isConnected()) {
            if (taskIntervalTimer) {
              clearInterval(taskIntervalTimer);
              taskIntervalTimer = null;
            }
            return;
          }
          if (!refetchIntervalInBg && isDocHidden()) return;
          if (activeRuns === 0) {
            run().catch(() => {});
          }
        }, refetchIntervalMs);
        if (taskIntervalTimer && typeof taskIntervalTimer.unref === 'function') {
          taskIntervalTimer.unref();
        }
      }

      scopedTasksList.push(taskObj);
      return taskObj;
    }

    function registerEffect(fn) {
      if (!isConnected()) return () => {};
      const stop = datastar.engine.effect(() => {
        if (!isConnected()) return;
        fn();
      });
      cleanupCallbacks.push(stop);
      return stop;
    }

    function registerWatch(source, callback, options = {}) {
      if (!isConnected()) return () => {};
      if (typeof callback !== 'function') {
        throw new TypeError('watch(source, callback) requires callback to be a function.');
      }

      const immediate = Boolean(options.immediate);
      const deep = Boolean(options.deep);
      const once = Boolean(options.once);

      let getter;
      if (typeof source === 'function') {
        getter = () => source(ctx);
      } else if (typeof source === 'string') {
        getter = () => resolveStatePath(state, source);
      } else if (isArray(source)) {
        getter = () =>
          source.map((s) =>
            typeof s === 'function'
              ? s(ctx)
              : typeof s === 'string'
                ? resolveStatePath(state, s)
                : s
          );
      } else if (source && typeof source === 'object') {
        getter = () => source;
      } else {
        getter = () => source;
      }

      let oldValue = undefined;
      let isFirstRun = true;
      let stopped = false;
      let userCleanup = null;

      function runCleanup() {
        if (typeof userCleanup === 'function') {
          try {
            userCleanup();
          } catch (e) {
            handleError(e, 'watch:cleanup');
          }
          userCleanup = null;
        }
      }

      function onCleanup(fn) {
        if (typeof fn === 'function') {
          userCleanup = fn;
        }
      }

      function stopWatch() {
        if (stopped) return;
        stopped = true;
        runCleanup();
        stopEffect();
      }

      const stopEffect = datastar.engine.effect(() => {
        if (stopped || !isConnected()) return;

        let newValue;
        try {
          newValue = getter();
          if ((deep || (source && typeof source === 'object' && typeof source !== 'function' && !isArray(source))) && newValue && typeof newValue === 'object') {
            deepTouch(newValue);
          }
        } catch (err) {
          handleError(err, 'watch:getter');
          return;
        }

        const isArr = isArray(source);

        if (isFirstRun) {
          isFirstRun = false;
          oldValue = deep ? deepCloneOrSnapshot(newValue) : isArr ? [...newValue] : newValue;
          if (immediate) {
            try {
              runCleanup();
              runUntracked(datastar.engine, () => {
                callback(newValue, undefined, onCleanup);
              });
            } catch (err) {
              handleError(err, 'watch:callback');
            }
            if (once) {
              stopWatch();
            }
          }
          return;
        }

        const hasChanged = deep
          ? !deepEqual(newValue, oldValue)
          : isArr
            ? hasArrayChanged(newValue, oldValue)
            : !Object.is(newValue, oldValue);

        if (!hasChanged) return;

        const prev = oldValue;
        oldValue = deep ? deepCloneOrSnapshot(newValue) : isArr ? [...newValue] : newValue;

        try {
          runCleanup();
          runUntracked(datastar.engine, () => {
            callback(newValue, prev, onCleanup);
          });
        } catch (err) {
          handleError(err, 'watch:callback');
        }

        if (once) {
          stopWatch();
        }
      });

      cleanupCallbacks.push(stopWatch);
      return stopWatch;
    }

    function registerListener(targetOrEventName, eventNameOrHandler, handlerOrOptions, maybeOptions) {
      if (!isConnected()) return () => {};
      let targetEl = rootEl;
      let eventName;
      let handler;
      let listenerOptions;

      if (typeof targetOrEventName === 'string') {
        eventName = targetOrEventName;
        handler = eventNameOrHandler;
        listenerOptions = handlerOrOptions;
      } else {
        targetEl = targetOrEventName;
        eventName = eventNameOrHandler;
        handler = handlerOrOptions;
        listenerOptions = maybeOptions;
      }

      if (!targetEl || typeof targetEl.addEventListener !== 'function' || typeof handler !== 'function') {
        return () => {};
      }

      const wrappedHandler = (evt) => {
        if (!isConnected()) return;
        handler(evt);
      };

      targetEl.addEventListener(eventName, wrappedHandler, listenerOptions);
      const remove = () => {
        try {
          targetEl.removeEventListener(eventName, wrappedHandler, listenerOptions);
        } catch (_e) {
          // Ignore
        }
      };
      cleanupCallbacks.push(remove);
      return remove;
    }

    function registerInterval(fn, ms) {
      if (!isConnected()) return () => {};
      const timerId = setInterval(() => {
        if (!isConnected()) {
          clearInterval(timerId);
          return;
        }
        fn();
      }, ms);
      const clear = () => clearInterval(timerId);
      cleanupCallbacks.push(clear);
      return clear;
    }

    function registerTimeout(fn, ms) {
      if (!isConnected()) return () => {};
      const timerId = setTimeout(() => {
        if (!isConnected()) return;
        fn();
      }, ms);
      const clear = () => clearTimeout(timerId);
      cleanupCallbacks.push(clear);
      return clear;
    }

    function emitEvent(eventName, detail = undefined, eventOptions = {}) {
      if (!rootEl || typeof rootEl.dispatchEvent !== 'function') return false;
      const CustomEventCtor =
        (rootEl.ownerDocument && rootEl.ownerDocument.defaultView && rootEl.ownerDocument.defaultView.CustomEvent) ||
        (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
      if (!CustomEventCtor) return false;
      const evt = new CustomEventCtor(eventName, {
        bubbles: eventOptions.bubbles !== undefined ? eventOptions.bubbles : true,
        cancelable: eventOptions.cancelable !== undefined ? eventOptions.cancelable : true,
        composed: eventOptions.composed !== undefined ? eventOptions.composed : true,
        detail,
      });
      return rootEl.dispatchEvent(evt);
    }

    // 4. Scoped target & targets accessors (never cache stale DOM nodes)
    function getTarget(targetName) {
      const list = queryScopedTargets(rootEl, controllerName, targetName);
      return list[0] || null;
    }

    function getTargets(targetName) {
      return queryScopedTargets(rootEl, controllerName, targetName);
    }

    const targetsAccessor = new Proxy(getTargets, {
      get(_target, prop) {
        if (typeof prop === 'string' && prop !== 'name' && prop !== 'length' && prop !== 'prototype') {
          return queryScopedTargets(rootEl, controllerName, prop);
        }
        return Reflect.get(_target, prop);
      },
    });

    const targetAccessor = new Proxy(getTarget, {
      get(_target, prop) {
        if (typeof prop === 'string' && prop !== 'name' && prop !== 'length' && prop !== 'prototype') {
          return getTarget(prop);
        }
        return Reflect.get(_target, prop);
      },
    });

    // 5. Scoped forms accessor (`forms.get('create-note')` or `forms('create-note')`)
    function resolveFormHandle(formName, formOptions = {}) {
      let formEl = null;
      if (rootEl.tagName === 'FORM') {
        if (!formName || rootEl.getAttribute('data-w-form') === formName || rootEl.getAttribute('name') === formName) {
          formEl = rootEl;
        }
      }
      if (!formEl && typeof rootEl.querySelectorAll === 'function') {
        const candidates = rootEl.querySelectorAll('form[data-w-form], form');
        for (let i = 0; i < candidates.length; i++) {
          const cand = candidates[i];
          if (!isTargetInControllerScope(rootEl, cand)) continue;
          if (
            !formName ||
            cand.getAttribute('data-w-form') === formName ||
            cand.getAttribute('name') === formName
          ) {
            formEl = cand;
            break;
          }
        }
      }
      if (!formEl) return null;
      const handle = createFormHandle(formEl, {
        api: scopedApi,
        datastar,
        debug,
        services,
        ...formOptions,
      });
      scopedForms.set(handle.name, handle);
      return handle;
    }

    const formsAccessor = Object.assign(
      (name, opts) => resolveFormHandle(name, opts),
      {
        get: (name, opts) => resolveFormHandle(name, opts),
      }
    );

    function getTask(name) {
      if (scopedTasks[name]) return scopedTasks[name];
      if (reg.definition.tasks && typeof reg.definition.tasks === 'object' && reg.definition.tasks[name]) {
        const tDef = reg.definition.tasks[name];
        let taskInst = null;
        if (typeof tDef === 'function') {
          const res = tDef(ctx);
          if (res && res.__isWebspressoTask) {
            taskInst = res;
          } else if (res && typeof res === 'object' && typeof res.run === 'function') {
            taskInst = createTaskInstance(res.run, { key: name, ...res });
          } else if (typeof res === 'function') {
            taskInst = createTaskInstance(res, { key: name });
          }
        } else if (tDef && typeof tDef === 'object' && typeof tDef.run === 'function') {
          taskInst = createTaskInstance(tDef.run, { key: name, ...tDef });
        }
        if (taskInst) {
          scopedTasks[name] = taskInst;
          return taskInst;
        }
      }
      return undefined;
    }

    const tasksProxy = new Proxy(scopedTasks, {
      get(target, prop) {
        if (typeof prop === 'string') {
          if (target[prop]) return target[prop];
          return getTask(prop);
        }
        return Reflect.get(target, prop);
      },
      has(target, prop) {
        if (target[prop]) return true;
        if (reg.definition.tasks && typeof reg.definition.tasks === 'object' && prop in reg.definition.tasks) {
          return true;
        }
        return Reflect.has(target, prop);
      },
      ownKeys(target) {
        const defKeys =
          reg.definition.tasks && typeof reg.definition.tasks === 'object'
            ? Object.keys(reg.definition.tasks)
            : [];
        return Array.from(new Set([...Reflect.ownKeys(target), ...defKeys]));
      },
      getOwnPropertyDescriptor(target, prop) {
        if (target[prop]) return Reflect.getOwnPropertyDescriptor(target, prop);
        if (reg.definition.tasks && typeof reg.definition.tasks === 'object' && prop in reg.definition.tasks) {
          return { configurable: true, enumerable: true, writable: true, value: getTask(prop) };
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    });

    let state = null;
    let ctx = null;

    const controllerStorage = defaultStorage.scoped(controllerName || 'anon');
    const storageCtx = Object.freeze({
      local: controllerStorage.local,
      session: controllerStorage.session,
      memory: controllerStorage.memory,
      scoped: (sub) => controllerStorage.scoped(sub),
      global: defaultStorage,
      root: defaultStorage,
    });
    const persistConfig = normalizePersistConfig(reg.definition.persist, controllerName);
    let persistTimer = null;
    let lastSavedJson = '';
    const persistenceConflicts = [];
    function resolvePersistDriver(pConfig) {
      if (!pConfig) return storageCtx.local;
      if (pConfig.isGlobal) {
        return defaultStorage[pConfig.storageType] || defaultStorage.local;
      }
      return storageCtx[pConfig.storageType] || storageCtx.local;
    }

    function checkFragmentPersistenceConflict(idOrName, input) {
      if (!persistConfig || !fragments || typeof fragments.getInstance !== 'function' || !input || typeof input !== 'object') {
        return;
      }
      const inst =
        fragments.getInstance(idOrName) ||
        (typeof fragments.getInstances === 'function'
          ? fragments.getInstances().find((i) => i.name === idOrName)
          : null);
      if (inst && inst.persistInput && inst.persistInput.key !== persistConfig.storageKey) {
        const conflict = {
          controller: controllerName,
          controllerStorageKey: persistConfig.storageKey,
          fragment: inst.instanceId,
          fragmentStorageKey: inst.persistInput.key,
          keys: Object.keys(input),
        };
        persistenceConflicts.push(conflict);
        if (debug && typeof debug.recordEvent === 'function') {
          debug.recordEvent('persist:conflict', conflict);
        }
      }
    }

    // 6. Context object passed to `connect(ctx)` and `actions[name](ctx, event, actionEl)`
    ctx = Object.freeze({
      instanceId,
      name: controllerName,
      el: rootEl,
      get state() {
        return state;
      },
      api: scopedApi,
      services,
      forms: formsAccessor,
      target: targetAccessor,
      targets: targetsAccessor,
      tasks: tasksProxy,
      task: createTaskInstance,
      storage: storageCtx,
      get persistenceConflicts() {
        return [...persistenceConflicts];
      },
      clearPersistedState: () => {
        if (persistTimer) {
          clearTimeout(persistTimer);
          persistTimer = null;
        }
        if (persistConfig) {
          const driver = resolvePersistDriver(persistConfig);
          driver.remove(persistConfig.storageKey);
          if (state && initialRawState) {
            const keysToTrack = persistConfig.keys || Object.keys(initialRawState);
            const currentPayload = {};
            for (const k of keysToTrack) {
              currentPayload[k] = state[k];
            }
            lastSavedJson = JSON.stringify(currentPayload);
          } else {
            lastSavedJson = '';
          }
        }
      },
      param: (name, maybeEl) => {
        if (!name) return null;
        const el = decorateElement(maybeEl || currentActionEl);
        if (!el) return null;
        if (typeof el.data === 'function') {
          return el.data(name);
        }
        const rawAttr = el.getAttribute ? el.getAttribute(`data-${name}`) : null;
        if (rawAttr !== null) return rawAttr;
        if (el.dataset && el.dataset[name] !== undefined) return el.dataset[name];
        return el.getAttribute ? el.getAttribute(name) : null;
      },
      on: registerListener,
      emit: emitEvent,
      effect: registerEffect,
      watch: registerWatch,
      interval: registerInterval,
      timeout: registerTimeout,
      signal: lifecycleAbort.signal,
      isConnected,
      isDisposed: () => !isConnected(),
      get isBusy() {
        return checkIsBusy();
      },
      isActionBusy,
      get lastError() {
        return lastError;
      },
      clearError() {
        lastError = null;
      },
      onError(listener) {
        if (typeof listener !== 'function') return () => {};
        dynamicErrorListeners.add(listener);
        const unregister = () => {
          dynamicErrorListeners.delete(listener);
        };
        cleanupCallbacks.push(unregister);
        return unregister;
      },
      invalidate: (tags) => (fragments ? fragments.invalidate(tags) : Promise.resolve({ ok: true, refreshed: [] })),
      retryFailedFragments: () =>
        fragments && typeof fragments.retryFailed === 'function'
          ? fragments.retryFailed()
          : Promise.resolve({ refreshed: [], skipped: true }),
      refresh: async (idOrName, input, opts) => {
        checkFragmentPersistenceConflict(idOrName, input);
        if (!fragments) {
          const empty = { ok: true, refreshed: [], skipped: true };
          if (opts && typeof opts.onSuccess === 'function') await opts.onSuccess(empty);
          if (opts && typeof opts.onSettled === 'function') await opts.onSettled(empty, null);
          else if (opts && typeof opts.onComplete === 'function') await opts.onComplete(empty, null);
          return empty;
        }
        return fragments.refresh(idOrName, input, opts);
      },
      fragment: (idOrName) => ({
        get input() {
          const inst = fragments && fragments.getInstance ? fragments.getInstance(idOrName) : null;
          return inst && inst.input ? { ...inst.input } : {};
        },
        get inputs() {
          if (!fragments || typeof fragments.getInstances !== 'function') return {};
          const list = fragments.getInstances(idOrName);
          const map = {};
          for (const inst of list) {
            map[inst.instanceId] = inst.input ? { ...inst.input } : {};
          }
          return map;
        },
        refresh: (input, opts) => {
          checkFragmentPersistenceConflict(idOrName, input);
          if (!fragments) {
            const empty = { ok: true, refreshed: [], skipped: true };
            if (opts && typeof opts.onSuccess === 'function') {
              return Promise.resolve(opts.onSuccess(empty)).then(() => empty);
            }
            return Promise.resolve(empty);
          }
          return fragments.refresh(idOrName, input, opts);
        },
      }),
    });

    // Instantiate declarative tasks from controller definition before state/computed setup
    if (reg.definition.tasks && typeof reg.definition.tasks === 'object') {
      for (const tName of Object.keys(reg.definition.tasks)) {
        getTask(tName);
      }
    }

    // 3. Isolated reactive state backed by Datastar signals + computed getters
    const computedDefs = reg.definition.computed || {};
    const initialRawState = reg.definition.state({ el: rootEl }) || {};
    const stateManager = datastar.createIsolatedControllerState(
      instanceId,
      initialRawState,
      isConnected,
      debug,
      computedDefs,
      () => ctx
    );
    state = stateManager.state;

    // Hydrate persisted state if defined (with schema-compatible type validation against corrupted storage)
    if (persistConfig) {
      const driver = resolvePersistDriver(persistConfig);
      const savedData = driver.get(persistConfig.storageKey, null);
      if (savedData && typeof savedData === 'object' && !isArray(savedData)) {
        for (const [k, v] of Object.entries(savedData)) {
          if (persistConfig.keys && !persistConfig.keys.includes(k)) continue;
          if (!Object.prototype.hasOwnProperty.call(initialRawState, k)) continue;
          const initVal = initialRawState[k];
          if (initVal !== null && typeof initVal === 'object' && !isArray(initVal)) {
            if (v !== null && typeof v === 'object' && !isArray(v)) {
              const merged = { ...initVal };
              for (const [subKey, subVal] of Object.entries(v)) {
                if (Object.prototype.hasOwnProperty.call(initVal, subKey)) {
                  if (initVal[subKey] === null || typeof subVal === typeof initVal[subKey]) {
                    merged[subKey] = subVal;
                  }
                } else {
                  merged[subKey] = subVal;
                }
              }
              state[k] = merged;
            }
          } else if (isArray(initVal)) {
            if (isArray(v)) {
              state[k] = v;
            }
          } else if (initVal === null || initVal === undefined || typeof v === typeof initVal) {
            state[k] = v;
          }
        }
      }
    }

    // Register declarative watchers from definition
    if (reg.definition.watch && typeof reg.definition.watch === 'object') {
      for (const [watchKey, watchDef] of Object.entries(reg.definition.watch)) {
        if (typeof watchDef === 'function') {
          registerWatch(watchKey, (newVal, oldVal, onCleanup) => {
            watchDef.call(ctx, newVal, oldVal, onCleanup, ctx);
          });
        } else if (watchDef && typeof watchDef === 'object' && typeof watchDef.handler === 'function') {
          registerWatch(
            watchKey,
            (newVal, oldVal, onCleanup) => {
              watchDef.handler.call(ctx, newVal, oldVal, onCleanup, ctx);
            },
            {
              immediate: watchDef.immediate,
              deep: watchDef.deep,
              once: watchDef.once,
            }
          );
        }
      }
    }

    function invokeAction(actionName, event, actionEl) {
      if (!isConnected()) return undefined;
      const fn = reg.definition.actions[actionName];
      if (typeof fn !== 'function') {
        return undefined;
      }

      // Guard against duplicate clicks while an async action on this exact element is already in-flight
      if (
        actionEl &&
        actionEl.__wActionBusy === true &&
        (!actionEl.hasAttribute || !actionEl.hasAttribute('data-w-allow-concurrent'))
      ) {
        if (event && typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        return undefined;
      }

      // Built-in `data-w-confirm` guard
      if (actionEl && typeof actionEl.getAttribute === 'function') {
        const confirmMsg = actionEl.getAttribute('data-w-confirm');
        if (confirmMsg !== null && confirmMsg !== '') {
          const confirmFn =
            typeof window !== 'undefined' && typeof window.confirm === 'function'
              ? window.confirm.bind(window)
              : null;
          if (confirmFn && !confirmFn(confirmMsg)) {
            if (event && typeof event.preventDefault === 'function') {
              event.preventDefault();
            }
            return undefined;
          }
        }
      }

      const decoratedEl = decorateElement(actionEl);
      currentActionEl = decoratedEl || null;
      const prevContext = activeControllerContext;
      activeControllerContext = ctx;
      try {
        const res = fn(ctx, event, decoratedEl);
        if (res && typeof res.then === 'function') {
          setActionBusy(actionName, 1);
          setElementBusyState(actionEl, true);
          return res.then(
            (val) => {
              setActionBusy(actionName, -1);
              setElementBusyState(actionEl, false);
              return val;
            },
            (err) => {
              setActionBusy(actionName, -1);
              setElementBusyState(actionEl, false);
              // Ignore canceled/superseded request errors on disconnected or superseded instances
              if (err && err.isCanceled) return undefined;
              handleControllerError(err, {
                action: actionName,
                event,
                actionEl: decoratedEl,
                phase: 'action',
              });
              throw err;
            }
          );
        }
        return res;
      } catch (err) {
        if (err && err.isCanceled) return undefined;
        handleControllerError(err, {
          action: actionName,
          event,
          actionEl: decoratedEl,
          phase: 'action',
        });
        throw err;
      } finally {
        currentActionEl = null;
        activeControllerContext = prevContext;
      }
    }

    // 7. Bind declarative DOM attributes within controller scope
    const domDisposers = [];
    function rebindDom() {
      if (!isConnected()) return;
      const unbind = datastar.bindControllerDom({
        instanceId,
        rootEl,
        state,
        invokeAction,
        isConnected,
        isLoadingTargetActive,
      });
      if (domDisposers.length === 0) {
        domDisposers.push(unbind);
      }

      // Prune disconnected forms from scopedForms
      for (const [fName, fh] of Array.from(scopedForms.entries())) {
        if (!fh.el || fh.el.isConnected === false || !rootEl.contains(fh.el)) {
          fh.destroy();
          scopedForms.delete(fName);
        }
      }

      // Also auto-initialize any `<form data-w-form>` inside this controller's scope
      if (rootEl.tagName === 'FORM' && rootEl.hasAttribute('data-w-form')) {
        resolveFormHandle(rootEl.getAttribute('data-w-form'));
      }
      if (typeof rootEl.querySelectorAll === 'function') {
        const formsInScope = rootEl.querySelectorAll('form[data-w-form]');
        for (let i = 0; i < formsInScope.length; i++) {
          if (isTargetInControllerScope(rootEl, formsInScope[i])) {
            const fh = createFormHandle(formsInScope[i], { api: scopedApi, datastar, debug, services });
            if (fh && fh.name) {
              scopedForms.set(fh.name, fh);
            }
          }
        }
      }
    }

    rebindDom();

    // Auto-sync persisted state changes back to storage
    if (persistConfig) {
      const driver = resolvePersistDriver(persistConfig);

      const stopPersistEffect = registerEffect(() => {
        if (!isConnected()) return;
        const keysToTrack = persistConfig.keys || Object.keys(initialRawState);
        const payload = {};
        for (const k of keysToTrack) {
          payload[k] = state[k];
        }

        const serialized = JSON.stringify(payload);
        if (serialized === lastSavedJson) return;

        const writeToStorage = () => {
          if (!isConnected()) return;
          driver.set(persistConfig.storageKey, payload);
          lastSavedJson = serialized;
        };

        if (persistConfig.debounce > 0) {
          if (persistTimer) clearTimeout(persistTimer);
          persistTimer = setTimeout(writeToStorage, persistConfig.debounce);
        } else {
          writeToStorage();
        }
      });

      cleanupCallbacks.push(() => {
        if (persistTimer) clearTimeout(persistTimer);
        if (typeof stopPersistEffect === 'function') stopPersistEffect();
      });
    }

    // 8. Run `connect(ctx)` lifecycle hook
    if (reg.definition.connect) {
      const prevContext = activeControllerContext;
      activeControllerContext = ctx;
      try {
        const userCleanup = reg.definition.connect(ctx);
        if (typeof userCleanup === 'function') {
          cleanupCallbacks.push(userCleanup);
        }
      } catch (err) {
        handleControllerError(err, { phase: 'connect' });
        if (debug) {
          debug.trackCleanupError(instanceId, controllerName, 'connect', err);
        }
      } finally {
        activeControllerContext = prevContext;
      }
    }

    const instanceRecord = {
      instanceId,
      name: controllerName,
      el: rootEl,
      state,
      tasks: tasksProxy,
      ctx,
      invokeAction,
      actions: new Proxy({}, {
        get(_target, prop) {
          if (typeof prop === 'string') {
            return (evt, el) => invokeAction(prop, evt, el);
          }
          return undefined;
        },
      }),
      rebindDom,
      get isConnected() {
        return isConnected();
      },
      invokeBeforePatch(meta = {}) {
        if (!isConnected() || !reg.definition.beforePatch) return;
        try {
          const result = reg.definition.beforePatch(ctx, meta);
          if (result && typeof result.then === 'function') {
            // beforePatch must be synchronous; warn in dev and do not block morph
            if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production' && typeof console !== 'undefined') {
              console.warn(`[webspresso] Controller "${controllerName}" beforePatch() returned a Promise; beforePatch hooks are synchronous and are not awaited.`);
            }
          }
        } catch (err) {
          handleControllerError(err, { phase: 'beforePatch' });
        }
      },
      invokeAfterPatch(meta = {}) {
        if (!isConnected() || !reg.definition.afterPatch) return;
        try {
          const res = reg.definition.afterPatch(ctx, meta);
          if (res && typeof res.then === 'function') {
            res.catch((err) => {
              handleControllerError(err, { phase: 'afterPatch' });
            });
          }
        } catch (err) {
          handleControllerError(err, { phase: 'afterPatch' });
        }
      },
      destroy() {
        if (!connected) return;
        connected = false;
        lifecycleAbort.abort();

        // Run user disconnect hook if provided
        if (reg.definition.disconnect) {
          try {
            reg.definition.disconnect(ctx);
          } catch (err) {
            handleControllerError(err, { phase: 'disconnect' });
            if (debug) {
              debug.trackCleanupError(instanceId, controllerName, 'disconnect', err);
            }
          }
        }

        // Run all registered cleanup callbacks (listeners, effects, intervals, timeouts, connect return)
        for (let i = cleanupCallbacks.length - 1; i >= 0; i--) {
          try {
            cleanupCallbacks[i]();
          } catch (err) {
            if (debug) {
              debug.trackCleanupError(instanceId, controllerName, 'cleanup', err);
            }
          }
        }
        cleanupCallbacks.length = 0;

        // Unbind declarative DOM bindings
        for (let i = 0; i < domDisposers.length; i++) {
          try {
            domDisposers[i]();
          } catch (_e) {
            // Ignore
          }
        }
        domDisposers.length = 0;

        // Destroy scoped forms if root was removed
        for (const fh of scopedForms.values()) {
          try {
            fh.destroy();
          } catch (_e) {
            // Ignore
          }
        }
        scopedForms.clear();

        // Dispose scoped tasks
        for (let i = 0; i < scopedTasksList.length; i++) {
          try {
            scopedTasksList[i].dispose();
          } catch (_e) {
            // Ignore
          }
        }
        scopedTasksList.length = 0;

        // Dispose isolated Datastar signals for this instance
        stateManager.dispose();
        dynamicErrorListeners.clear();
        lastError = null;

        const mapOnEl = elementInstances.get(rootEl);
        if (mapOnEl) {
          mapOnEl.delete(controllerName);
        }
        activeInstances.delete(instanceId);

        if (debug) {
          debug.trackControllerUnmount(instanceId, controllerName);
        }
      },
    };

    elMap.set(controllerName, instanceRecord);
    activeInstances.set(instanceId, instanceRecord);

    if (debug) {
      debug.trackControllerMount(instanceId, controllerName, rootEl);
    }

    return instanceRecord;
  }

  /**
   * Unmount and clean up any controller instances rooted on `el` or inside `el`'s subtree.
   */
  function unmountSubtree(el) {
    if (!el || el.nodeType !== 1) return;

    const elements = [el];
    if (typeof el.querySelectorAll === 'function') {
      const descendants = el.querySelectorAll('[data-w-controller], form[data-w-form]');
      for (let i = 0; i < descendants.length; i++) {
        elements.push(descendants[i]);
      }
    }

    // Destroy from deepest child to parent
    for (let i = elements.length - 1; i >= 0; i--) {
      const node = elements[i];
      const elMap = elementInstances.get(node);
      if (elMap) {
        for (const inst of Array.from(elMap.values())) {
          inst.destroy();
        }
      }
      const standaloneForm = standaloneForms.get(node);
      if (standaloneForm) {
        standaloneForm.destroy();
        standaloneForms.delete(node);
        activeStandaloneForms.delete(standaloneForm);
      } else if (node && node.__wFormHandle) {
        try {
          node.__wFormHandle.destroy();
        } catch (_e) {}
      }
    }
  }

  /**
   * Scan a DOM root or subtree, mounting controllers and standalone `[data-w-form]` elements.
   * Also supports lazy-loading controllers via `lazyLoader(controllerName)` when a controller
   * is not yet registered or has `data-w-lazy`.
   */
  async function mountSubtree(containerEl) {
    const root =
      containerEl || (typeof document !== 'undefined' ? document : null);
    if (!root) return [];

    // 1. Prune any previously active instances whose DOM elements were removed externally
    for (const inst of Array.from(activeInstances.values())) {
      if (inst.el && inst.el.isConnected === false) {
        inst.destroy();
      }
    }

    const controllerElements = [];
    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('data-w-controller')) {
      controllerElements.push(root);
    }
    if (typeof root.querySelectorAll === 'function') {
      const found = root.querySelectorAll('[data-w-controller]');
      for (let i = 0; i < found.length; i++) {
        controllerElements.push(found[i]);
      }
    }

    const mounted = [];

    for (const el of controllerElements) {
      const rawAttr = (el.getAttribute('data-w-controller') || '').trim();
      if (!rawAttr) continue;
      const names = rawAttr.split(/\s+/).filter(Boolean);

      for (const name of names) {
        if (!definitions.has(name) && lazyLoader) {
          try {
            const loadedMod = await lazyLoader(name, el);
            if (loadedMod && !definitions.has(name)) {
              register(name, loadedMod.default || loadedMod);
            }
          } catch (err) {
            if (debug) {
              debug.trackCleanupError(`lazy_${name}`, name, 'lazy-load', err);
            }
          }
        }
        const inst = mountControllerOnElement(el, name);
        if (inst) mounted.push(inst);
      }
    }

    // 2. Auto-mount standalone `<form data-w-form>` elements that do not need a client controller file
    const formElements = [];
    if (root.nodeType === 1 && root.tagName === 'FORM' && root.hasAttribute('data-w-form')) {
      formElements.push(root);
    }
    if (typeof root.querySelectorAll === 'function') {
      const foundForms = root.querySelectorAll('form[data-w-form]');
      for (let i = 0; i < foundForms.length; i++) {
        formElements.push(foundForms[i]);
      }
    }

    for (const formEl of formElements) {
      if (!formEl.__wFormHandle) {
        const defaultApi = createApiClient({
          ...baseApiConfig,
          debug,
          onInvalidate: fragments
            ? (tags, meta) => fragments.invalidate(tags, meta)
            : baseApiConfig.onInvalidate,
        });
        const handle = createFormHandle(formEl, {
          api: defaultApi,
          datastar,
          debug,
          services,
        });
        standaloneForms.set(formEl, handle);
        activeStandaloneForms.add(handle);
      }
    }

    // 3. Rebind any preserved ancestor controller if `containerEl` was patched inside it
    if (containerEl && containerEl.nodeType === 1) {
      let ancestor = containerEl;
      while (ancestor) {
        const elMap = elementInstances.get(ancestor);
        if (elMap) {
          for (const inst of elMap.values()) {
            inst.rebindDom();
          }
        }
        ancestor = ancestor.parentElement;
      }
    }

    return mounted;
  }

  let activeHookContext = null;

  function isInsideIgnoredSubtree(el, rootEl) {
    let cur = el && el.parentElement ? el.parentElement : null;
    while (cur) {
      if (typeof cur.hasAttribute === 'function' && cur.hasAttribute('data-w-ignore')) {
        const mode = (cur.getAttribute('data-w-ignore') || '').trim().toLowerCase();
        if (mode !== 'self') {
          return true;
        }
      }
      if (cur === rootEl) break;
      cur = cur.parentElement || null;
    }
    if (el === rootEl && el && typeof el.hasAttribute === 'function' && el.hasAttribute('data-w-ignore')) {
      const mode = (el.getAttribute('data-w-ignore') || '').trim().toLowerCase();
      if (mode === 'all' || mode === 'both') {
        return true;
      }
    }
    return false;
  }

  function collectAffectedInstances(fragmentEl) {
    if (!fragmentEl) return [];
    const affected = [];
    for (const inst of activeInstances.values()) {
      if (!inst || !inst.el || !inst.isConnected) continue;
      if (
        inst.el === fragmentEl ||
        (typeof fragmentEl.contains === 'function' && fragmentEl.contains(inst.el)) ||
        (typeof inst.el.contains === 'function' && inst.el.contains(fragmentEl))
      ) {
        if (isInsideIgnoredSubtree(inst.el, fragmentEl)) continue;
        affected.push(inst);
      }
    }
    // Sort deterministically: outer ancestors first, inner descendants second
    affected.sort((a, b) => {
      if (a.el === b.el) return 0;
      if (typeof a.el.contains === 'function' && a.el.contains(b.el)) return -1;
      if (typeof b.el.contains === 'function' && b.el.contains(a.el)) return 1;
      if (typeof a.el.compareDocumentPosition === 'function') {
        const pos = a.el.compareDocumentPosition(b.el);
        if (pos & 4) return -1; // DOCUMENT_POSITION_FOLLOWING
        if (pos & 2) return 1;  // DOCUMENT_POSITION_PRECEDING
      }
      return 0;
    });
    return affected;
  }

  function notifyBeforePatch(fragmentEl, meta = {}) {
    const affected = collectAffectedInstances(fragmentEl);
    const prevHookCtx = activeHookContext;
    activeHookContext = {
      fragmentEl,
      depth: meta && typeof meta.hookChainDepth === 'number' ? meta.hookChainDepth : 0,
    };
    try {
      for (let i = 0; i < affected.length; i++) {
        const inst = affected[i];
        inst.invokeBeforePatch({
          ...meta,
          isFragmentRoot: inst.el === fragmentEl,
          isDescendant: inst.el !== fragmentEl && typeof fragmentEl.contains === 'function' && fragmentEl.contains(inst.el),
        });
      }
    } finally {
      activeHookContext = prevHookCtx;
    }
  }

  function notifyAfterPatch(fragmentEl, meta = {}) {
    const chainDepth = meta && typeof meta.hookChainDepth === 'number' ? meta.hookChainDepth : 0;
    if (chainDepth > 3) {
      const msg = `Possible patch hook refresh loop detected on fragment "${meta.fragmentName || meta.fragmentId || 'unknown'}" (causal chain depth ${chainDepth}).`;
      if (debug && typeof debug.recordEvent === 'function') {
        debug.recordEvent('patch:loop-warning', {
          code: 'PATCH_HOOK_LOOP_DETECTED',
          fragmentId: meta.fragmentId || null,
          fragmentName: meta.fragmentName || null,
          count: chainDepth,
          message: msg,
        });
      } else if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production' && typeof console !== 'undefined') {
        console.warn(`[webspresso] ${msg}`);
      }
    }

    const affected = collectAffectedInstances(fragmentEl);
    const prevHookCtx = activeHookContext;
    activeHookContext = {
      fragmentEl,
      depth: chainDepth,
    };
    try {
      // Reverse order for afterPatch: inner descendants first, outer ancestors second
      for (let i = affected.length - 1; i >= 0; i--) {
        const inst = affected[i];
        inst.invokeAfterPatch({
          ...meta,
          isFragmentRoot: inst.el === fragmentEl,
          isDescendant: inst.el !== fragmentEl && typeof fragmentEl.contains === 'function' && fragmentEl.contains(inst.el),
        });
      }
    } finally {
      activeHookContext = prevHookCtx;
    }
  }

  return {
    register,
    services,
    hasController(name) {
      return definitions.has(name);
    },
    getDefinition(name) {
      const entry = definitions.get(name);
      return entry ? entry.definition : null;
    },
    mountSubtree,
    syncTree: mountSubtree,
    unmountSubtree,
    notifyBeforePatch,
    notifyAfterPatch,
    getActivePatchHookContext() {
      return activeHookContext;
    },
    mountControllerOnElement,
    getInstanceForElement(el, name) {
      const map = elementInstances.get(el);
      if (!map) return null;
      if (name) return map.get(name) || null;
      return map.values().next().value || null;
    },
    getActiveInstances() {
      return Array.from(activeInstances.values());
    },
    getStandaloneFormCount() {
      return activeStandaloneForms.size;
    },
    destroyAll() {
      for (const inst of Array.from(activeInstances.values())) {
        inst.destroy();
      }
      for (const fh of Array.from(activeStandaloneForms.values())) {
        try {
          fh.destroy();
        } catch (_e) {}
      }
      activeStandaloneForms.clear();
    },
  };
}

module.exports = {
  defineController,
  deriveControllerNameFromPath,
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,
};


},
    "./fragments": function(module, exports, require) {
'use strict';

const { defaultStorage } = require('./storage');
const { isArray, isNumber, parseDurationMs, parseRefetchMode, uid } = require('./utils');

/**
 * Webspresso Client-Side SSR Fragment Coordinator & Invalidation Engine
 *
 * Responsibilities:
 * - Discovers active `[data-w-fragment]` instances in the DOM
 * - Separates fragment definition name (`data-w-fragment`) from instance ID (`data-w-fragment-id`)
 * - Tracks `dependsOn` tags (`data-w-depends-on`) per fragment instance
 * - Skips network refresh completely if no active fragment on the page matches invalidated tags
 * - Deduplicates parent/child fragments when both are invalidated (parent refresh covers child)
 * - Coalesces simultaneous invalidations into a single batch request (`POST /__webspresso/fragments`)
 * - Queues follow-up refreshes when new invalidations arrive during an in-flight refresh so the
 *   latest mutation's invalidation is never lost
 * - Enforces monotonic per-instance `refreshVersion` so stale responses never overwrite newer DOM
 * - Supports retryable refresh (`retryFailed()` / `refresh()`) without re-sending mutations
 */

const DEFAULT_FRAGMENT_ENDPOINT = '/__webspresso/fragments';

/**
 * Parse `data-w-depends-on` attribute (comma-separated or JSON array).
 *
 * @param {string|null} raw
 * @returns {string[]}
 */
function parseDependsOnAttr(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isArray(parsed)) {
        return parsed.map((s) => String(s).trim()).filter(Boolean);
      }
    } catch (_e) {
      // Fallback to comma split
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse `data-w-fragment-input` JSON attribute safely.
 *
 * @param {string|null} raw
 * @returns {Record<string, unknown>}
 */
function parseFragmentInputAttr(raw) {
  if (!raw || typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !isArray(parsed) ? parsed : {};
  } catch (_e) {
    return {};
  }
}

function isStrictAncestor(parentEl, childEl) {
  return Boolean(
    parentEl &&
      childEl &&
      parentEl !== childEl &&
      typeof parentEl.contains === 'function' &&
      parentEl.contains(childEl)
  );
}

/**
 * Filter a list of fragment records so that if fragment B's DOM element is inside
 * fragment A's DOM subtree, B is omitted from the batch because refreshing A will
 * re-render B on the server.
 *
 * @param {Array<{ instanceId: string, el: Element }>} candidates
 * @returns {Array<{ instanceId: string, el: Element }>}
 */
function deduplicateParentChildFragments(candidates) {
  if (candidates.length <= 1) return candidates;
  return candidates.filter((candidate) => {
    if (!candidate.el) return true;
    for (const other of candidates) {
      if (other === candidate || !other.el) continue;
      if (isStrictAncestor(other.el, candidate.el)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Create a Fragment Coordinator instance.
 *
 * @param {object} [options]
 * @param {Document|Element} [options.root] - Root document or container element
 * @param {typeof fetch} [options.fetch] - Custom fetch function
 * @param {string} [options.endpoint='/__webspresso/fragments'] - Server fragment refresh endpoint
 * @param {object} [options.datastar] - Datastar adapter for DOM morphing
 * @param {(el: Element) => void} [options.onBeforeNodeRemove] - Hook called before a node is removed during morph
 * @param {(el: Element) => void} [options.onNodeAdded] - Hook called when a new node is added during morph
 * @param {(el: Element) => void} [options.onAfterPatch] - Hook called after a fragment is patched
 * @param {() => string|null} [options.getCsrfToken] - CSRF token getter
 * @param {object} [options.debug] - Client debugger instance
 */
function createFragmentCoordinator(options = {}) {
  const getRoot = () =>
    options.root || options.document || (typeof document !== 'undefined' ? document : null);
  const fetchImpl =
    options.fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const endpoint = options.endpoint || DEFAULT_FRAGMENT_ENDPOINT;
  const datastar = options.datastar || options.adapter;
  const debug = options.debug || null;
  const defaultTimeout = isNumber(options.timeout) ? options.timeout : 15000;

  // React Query-style automatic revalidation defaults
  const defaultStaleTime = parseDurationMs(options.staleTime, 0);
  const defaultRefetchOnWindowFocus = parseRefetchMode(
    options.refetchOnWindowFocus !== undefined ? options.refetchOnWindowFocus : options.refetchOnFocus,
    false
  );
  const defaultRefetchOnReconnect = parseRefetchMode(options.refetchOnReconnect, false);
  const defaultRefetchOnMount = parseRefetchMode(
    options.refetchOnMount !== undefined ? options.refetchOnMount : options.refetchOnVisit,
    false
  );
  const defaultRefetchInterval = parseDurationMs(options.refetchInterval, 0);
  const defaultRefetchIntervalInBackground =
    parseRefetchMode(options.refetchIntervalInBackground, false) === true;

  // Map<instanceId, { instanceId, name, pagePath, input, dependsOn: Set<string>, version: number, el: Element, abortController: AbortController|null, ... }>
  const instances = new Map();

  // Coalescing & in-flight state for tag invalidations
  const pendingTags = new Set();
  const pendingChains = [];
  let batchTimer = null;
  let inFlightBatchCount = 0;
  let followUpNeeded = false;
  let lastFailedBatch = null;
  const inflightBatchWaiters = [];

  // Automatic refetch (focus / reconnect / mount / interval) state
  const pendingAutoInstanceIds = new Set();
  const pendingAutoReasons = new Set();
  let autoBatchScheduled = false;
  let autoBatchTimer = null;
  let focusDebounceTimer = null;
  let isDisposed = false;
  let lifecycleListenersAttached = false;

  // Per-version patch options (mode, limit, target, removeKeys, onBeforePatch, onAfterPatch, hookChainDepth)
  const pendingPatchOptsByKey = new Map();
  let pendingInvalidateHookDepth = 0;

  // Lazy fragment IntersectionObserver state
  let lazyObserver = null;
  const observedLazyEls = new WeakSet();

  function getLazyObserver() {
    if (lazyObserver) return lazyObserver;
    const win =
      typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
          ? globalThis
          : null;
    const IOCtor = win && typeof win.IntersectionObserver === 'function' ? win.IntersectionObserver : null;
    if (!IOCtor) return null;
    lazyObserver = new IOCtor((entries) => {
      if (isDisposed) return;
      const visibleIds = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry || !entry.isIntersecting) continue;
        const targetEl = entry.target;
        try {
          lazyObserver.unobserve(targetEl);
        } catch (_e) {}
        const fragId = targetEl && targetEl.getAttribute ? targetEl.getAttribute('data-w-fragment-id') : null;
        const inst = fragId ? instances.get(fragId) : null;
        if (inst && inst.lazy && inst.lazyState === 'idle') {
          inst.lazyState = 'loading';
          visibleIds.push(inst.instanceId);
        }
      }
      if (visibleIds.length > 0) {
        scheduleAutoRefresh(visibleIds, 'lazy');
      }
    });
    return lazyObserver;
  }

  function observeLazyFragment(inst) {
    if (!inst || !inst.el || !inst.lazy || inst.lazyState !== 'idle') return;
    if (observedLazyEls.has(inst.el)) return;
    const obs = getLazyObserver();
    if (!obs) return;
    observedLazyEls.add(inst.el);
    try {
      obs.observe(inst.el);
    } catch (_e) {}
  }

  function unobserveLazyFragment(inst) {
    if (!inst || !inst.el || !lazyObserver) return;
    try {
      lazyObserver.unobserve(inst.el);
    } catch (_e) {}
  }

  function getListItemKey(node) {
    if (!node || node.nodeType !== 1 || typeof node.getAttribute !== 'function') return null;
    if (node.id) return `id:${node.id}`;
    const wKey = node.getAttribute('data-w-key');
    if (wKey) return `wkey:${wKey}`;
    return null;
  }

  function patchIncrementalList(fragEl, html, opts = {}) {
    const doc = fragEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const parsed = datastar && typeof datastar.parseHtmlFragment === 'function'
      ? datastar.parseHtmlFragment(html, doc)
      : null;
    if (!parsed) return false;

    const targetSel = opts.target || null;
    const container =
      (targetSel && fragEl.querySelector ? fragEl.querySelector(targetSel) : null) ||
      (fragEl.querySelector ? fragEl.querySelector('[data-w-list]') : null) ||
      fragEl;
    const incomingContainer =
      (targetSel && parsed.querySelector ? parsed.querySelector(targetSel) : null) ||
      (parsed.querySelector ? parsed.querySelector('[data-w-list]') : null) ||
      parsed;

    // 1. Remove explicitly requested keys if any
    if (isArray(opts.removeKeys) && opts.removeKeys.length > 0) {
      const removeSet = new Set(opts.removeKeys.map(String));
      const curChildren = Array.from(container.children || []);
      for (let i = 0; i < curChildren.length; i++) {
        const child = curChildren[i];
        const rawKey = child.getAttribute('data-w-key') || child.id || '';
        const fullKey = getListItemKey(child);
        if (removeSet.has(rawKey) || (fullKey && removeSet.has(fullKey))) {
          if (typeof opts.onBeforeNodeRemove === 'function') opts.onBeforeNodeRemove(child);
          container.removeChild(child);
        }
      }
    }

    // 2. Index existing keyed items in container
    const existingByKey = new Map();
    const existingChildren = Array.from(container.children || []);
    for (let i = 0; i < existingChildren.length; i++) {
      const k = getListItemKey(existingChildren[i]);
      if (k && !existingByKey.has(k)) {
        existingByKey.set(k, existingChildren[i]);
      }
    }

    const incomingItems = Array.from(incomingContainer.children || []);
    const mode = opts.mode === 'prepend' ? 'prepend' : 'append';
    const itemsToInsert = mode === 'prepend' ? incomingItems.slice().reverse() : incomingItems;

    for (let i = 0; i < itemsToInsert.length; i++) {
      const incoming = itemsToInsert[i];
      if (incoming.nodeType !== 1) continue;
      const key = getListItemKey(incoming);
      const existingMatch = key ? existingByKey.get(key) : null;

      if (existingMatch && existingMatch.tagName === incoming.tagName) {
        // Update existing keyed item in place without duplicating
        if (datastar && typeof datastar.morphDomTrees === 'function') {
          datastar.morphDomTrees(existingMatch, incoming, {
            onBeforeNodeRemove: opts.onBeforeNodeRemove,
            onNodeAdded: opts.onNodeAdded,
          });
        }
        continue;
      }

      const imported = container.ownerDocument
        ? container.ownerDocument.importNode(incoming, true)
        : incoming.cloneNode(true);

      if (mode === 'prepend') {
        const firstRef = (container.children && container.children[0]) || container.firstChild || null;
        container.insertBefore(imported, firstRef);
      } else {
        container.appendChild(imported);
      }

      if (key) {
        existingByKey.set(key, imported);
      }
      if (typeof opts.onNodeAdded === 'function') {
        opts.onNodeAdded(imported);
      }
    }

    // 3. Enforce optional retained item limit
    const limitAttr = container.getAttribute ? container.getAttribute('data-w-limit') : null;
    const rawLimit = opts.limit !== undefined ? opts.limit : limitAttr;
    const limit = rawLimit !== null && rawLimit !== undefined && rawLimit !== '' ? Number(rawLimit) : 0;
    if (Number.isFinite(limit) && limit > 0) {
      while (container.children && container.children.length > limit) {
        const ch = container.children;
        const victim = mode === 'prepend' ? ch[ch.length - 1] : ch[0];
        if (!victim) break;
        if (typeof opts.onBeforeNodeRemove === 'function') opts.onBeforeNodeRemove(victim);
        container.removeChild(victim);
      }
    }

    return true;
  }

  function isDocumentHidden() {
    const root = getRoot();
    const doc = root && root.nodeType === 9 ? root : root && root.ownerDocument ? root.ownerDocument : typeof document !== 'undefined' ? document : null;
    return Boolean(doc && doc.visibilityState === 'hidden');
  }

  function isInstanceStale(inst, mode) {
    if (!inst || !mode) return false;
    if (mode === 'always') return true;
    const staleMs = isNumber(inst.staleTime) ? inst.staleTime : 0;
    if (staleMs <= 0) return true;
    const elapsed = Date.now() - (inst.lastUpdatedAt || 0);
    return elapsed >= staleMs;
  }

  function clearInstanceInterval(inst) {
    if (inst && inst.intervalTimer) {
      clearInterval(inst.intervalTimer);
      inst.intervalTimer = null;
      inst.activeIntervalMs = 0;
    }
  }

  function syncInstanceInterval(inst) {
    if (!inst || isDisposed) return;
    const targetMs = isNumber(inst.refetchInterval) && inst.refetchInterval > 0 ? inst.refetchInterval : 0;
    if (targetMs <= 0) {
      clearInstanceInterval(inst);
      return;
    }
    if (inst.intervalTimer && inst.activeIntervalMs === targetMs) {
      return;
    }
    clearInstanceInterval(inst);
    inst.activeIntervalMs = targetMs;
    inst.intervalTimer = setInterval(() => {
      if (isDisposed || !inst.el || inst.el.isConnected === false) {
        clearInstanceInterval(inst);
        return;
      }
      if (!inst.refetchIntervalInBackground && isDocumentHidden()) {
        return;
      }
      scheduleAutoRefresh([inst.instanceId], 'interval');
    }, targetMs);
    if (inst.intervalTimer && typeof inst.intervalTimer.unref === 'function') {
      inst.intervalTimer.unref();
    }
  }

  async function flushAutoRefresh() {
    autoBatchScheduled = false;
    if (autoBatchTimer) {
      clearTimeout(autoBatchTimer);
      autoBatchTimer = null;
    }
    if (isDisposed || pendingAutoInstanceIds.size === 0) return;
    const idsToRefresh = Array.from(pendingAutoInstanceIds);
    const reasons = Array.from(pendingAutoReasons);
    pendingAutoInstanceIds.clear();
    pendingAutoReasons.clear();

    // Skip background auto-refresh if a mutation invalidation batch is currently in flight
    if (inFlightBatchCount > 0) return;

    const candidates = [];
    for (const id of idsToRefresh) {
      const inst = instances.get(id);
      if (
        inst &&
        inst.el &&
        inst.el.isConnected !== false &&
        !inst.abortController &&
        !(inst.inFlightCount > 0)
      ) {
        candidates.push(inst);
      }
    }
    if (candidates.length === 0) return;

    const deduped = deduplicateParentChildFragments(candidates);
    const targets = deduped.map((inst) => {
      inst.version += 1;
      return {
        instanceId: inst.instanceId,
        name: inst.name,
        pagePath: inst.pagePath,
        input: { ...inst.input },
        reqVersion: inst.version,
      };
    });

    if (debug && typeof debug.recordEvent === 'function') {
      debug.recordEvent('fragment:auto-refetch', {
        reason: reasons.length === 1 ? reasons[0] : reasons.join('+'),
        reasons,
        fragments: targets.map((t) => t.instanceId),
      });
    }

    try {
      await executeBatchRefresh(targets);
    } catch (_err) {
      // Background auto-refetch errors are non-fatal; reset lazyState if still unloaded so retry/re-observe works
      for (const inst of deduped) {
        if (inst.lazy && inst.lazyState === 'loading') {
          inst.lazyState = 'idle';
        }
      }
    }
  }

  function scheduleAutoRefresh(instanceIds, reason = 'auto') {
    if (isDisposed || !isArray(instanceIds) || instanceIds.length === 0) return;
    for (const id of instanceIds) {
      if (id) pendingAutoInstanceIds.add(id);
    }
    if (reason) pendingAutoReasons.add(reason);
    if (pendingAutoInstanceIds.size === 0) return;

    if (reason === 'mount' || reason === 'lazy') {
      if (!autoBatchScheduled) {
        autoBatchScheduled = true;
        Promise.resolve().then(flushAutoRefresh);
      }
      return;
    }

    if (autoBatchTimer || autoBatchScheduled) return;
    autoBatchTimer = setTimeout(flushAutoRefresh, 5);
  }

  function triggerFocusRefetch() {
    if (isDisposed || isDocumentHidden()) return;
    scanDomInstances();
    const matchedIds = [];
    for (const inst of instances.values()) {
      if (isInstanceStale(inst, inst.refetchOnWindowFocus)) {
        matchedIds.push(inst.instanceId);
      }
    }
    if (matchedIds.length > 0) {
      scheduleAutoRefresh(matchedIds, 'window-focus');
    }
  }

  function triggerReconnectRefetch() {
    if (isDisposed) return;
    scanDomInstances();
    const matchedIds = [];
    for (const inst of instances.values()) {
      if (isInstanceStale(inst, inst.refetchOnReconnect)) {
        matchedIds.push(inst.instanceId);
      }
    }
    if (matchedIds.length > 0) {
      scheduleAutoRefresh(matchedIds, 'reconnect');
    }
  }

  function onVisibilityChange() {
    if (!isDocumentHidden()) {
      triggerFocusRefetch();
    }
  }

  function onPageShow(event) {
    if (isDisposed) return;
    if (event && event.persisted) {
      scanDomInstances();
      const matchedIds = [];
      for (const inst of instances.values()) {
        const mode = inst.refetchOnMount || inst.refetchOnWindowFocus;
        if (isInstanceStale(inst, mode)) {
          matchedIds.push(inst.instanceId);
        }
      }
      if (matchedIds.length > 0) {
        scheduleAutoRefresh(matchedIds, 'pageshow');
      }
    }
  }

  function ensureLifecycleListeners() {
    if (lifecycleListenersAttached || isDisposed) return;
    const root = getRoot();
    const doc = root && root.nodeType === 9 ? root : root && root.ownerDocument ? root.ownerDocument : typeof document !== 'undefined' ? document : null;
    const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('focus', triggerFocusRefetch);
      win.addEventListener('online', triggerReconnectRefetch);
      win.addEventListener('pageshow', onPageShow);
    }
    lifecycleListenersAttached = true;
  }

  function removeLifecycleListeners() {
    if (!lifecycleListenersAttached) return;
    const root = getRoot();
    const doc = root && root.nodeType === 9 ? root : root && root.ownerDocument ? root.ownerDocument : typeof document !== 'undefined' ? document : null;
    const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

    if (doc && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('focus', triggerFocusRefetch);
      win.removeEventListener('online', triggerReconnectRefetch);
      win.removeEventListener('pageshow', onPageShow);
    }
    lifecycleListenersAttached = false;
  }

  function syncSingleElement(el, index, seenIds) {
    const name = (el.getAttribute('data-w-fragment') || '').trim();
    if (!name) return;

    let instanceId = (el.getAttribute('data-w-fragment-id') || '').trim();
    if (!instanceId) {
      instanceId = index === 0 ? `${name}:default` : `${name}:${index}`;
      el.setAttribute('data-w-fragment-id', instanceId);
    }

    if (seenIds) seenIds.add(instanceId);

    const existing = instances.get(instanceId);
    const rawInput = el.getAttribute('data-w-fragment-input');
    const rawDepends = el.getAttribute('data-w-depends-on');
    const rawStale = el.getAttribute('data-w-stale-time');
    const rawInterval = el.getAttribute('data-w-refetch-interval');

    // Fast-path: if the same DOM element is already registered and its reactive attributes are unchanged,
    // skip JSON.parse, Set allocation, storage lookup, and timer reconfiguration.
    if (
      existing &&
      existing.el === el &&
      existing.name === name &&
      existing._rawInput === rawInput &&
      existing._rawDepends === rawDepends &&
      existing._rawStale === rawStale &&
      existing._rawInterval === rawInterval
    ) {
      return;
    }

    const pagePath =
      (el.getAttribute('data-w-fragment-page') || '').trim() ||
      (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
    const input =
      existing && existing.el === el && existing._rawInput === rawInput
        ? existing.input
        : parseFragmentInputAttr(rawInput);
    const dependsOn =
      existing && existing.el === el && existing._rawDepends === rawDepends
        ? existing.dependsOn
        : new Set(parseDependsOnAttr(rawDepends));

    // Fragment input persistence setup
    const rawPersistInput =
      el.getAttribute('data-w-persist-input') ||
      (el.getAttribute('data-w-persist') === 'input' ? 'session' : null);
    const isInputPersistEnabled = Boolean(rawPersistInput && rawPersistInput !== 'false');
    const inputStorageType = rawPersistInput && rawPersistInput.toLowerCase() === 'local' ? 'local' : 'session';
    const inputStorageKey =
      el.getAttribute('data-w-persist-key') ||
      el.getAttribute('data-w-input-key') ||
      `frag_input:${name}`;

    let effectiveInput = input;
    let pendingRestoredInput = null;
    if (!existing && isInputPersistEnabled) {
      const store = inputStorageType === 'local' ? defaultStorage.local : defaultStorage.session;
      let stored = store.get(inputStorageKey, null);
      if (
        (!stored || typeof stored !== 'object' || isArray(stored)) &&
        inputStorageKey !== `frag_input:${instanceId}`
      ) {
        stored = store.get(`frag_input:${instanceId}`, null);
      }
      if (stored && typeof stored === 'object' && !isArray(stored)) {
        if (rawInput === null || Object.keys(effectiveInput).length === 0) {
          effectiveInput = { ...stored };
        } else if (JSON.stringify(stored) !== JSON.stringify(effectiveInput)) {
          pendingRestoredInput = { ...stored };
        }
      }
    }

    // Parse React Query-style automatic revalidation attributes
    const staleTime = parseDurationMs(rawStale, defaultStaleTime);
    const rawFocusAttr =
      el.getAttribute('data-w-refetch-on-focus') ??
      el.getAttribute('data-w-refetch-on-window-focus');
    const refetchOnWindowFocus = parseRefetchMode(rawFocusAttr, defaultRefetchOnWindowFocus);
    const refetchOnReconnect = parseRefetchMode(
      el.getAttribute('data-w-refetch-on-reconnect'),
      defaultRefetchOnReconnect
    );
    const rawMountAttr =
      el.getAttribute('data-w-refetch-on-mount') ??
      el.getAttribute('data-w-refetch-on-visit');
    const refetchOnMount = parseRefetchMode(rawMountAttr, defaultRefetchOnMount);
    const refetchInterval = parseDurationMs(rawInterval, defaultRefetchInterval);
    const refetchIntervalInBackground =
      parseRefetchMode(
        el.getAttribute('data-w-refetch-in-background'),
        defaultRefetchIntervalInBackground
      ) === true;

    if (refetchOnWindowFocus || refetchOnReconnect || refetchOnMount) {
      ensureLifecycleListeners();
    }

    const rawLazyAttr = el.getAttribute('data-w-lazy');
    const isLazyUnloaded = Boolean(rawLazyAttr && rawLazyAttr !== 'false' && rawLazyAttr !== 'loaded');

    if (existing) {
      existing.name = name;
      existing.pagePath = pagePath;
      existing.el = el;
      existing.dependsOn = dependsOn;
      if (rawInput !== null && rawInput !== existing._rawInput) {
        existing.input = input;
      }
      existing.persistInput = isInputPersistEnabled ? { type: inputStorageType, key: inputStorageKey } : null;
      existing.staleTime = staleTime;
      existing.refetchOnWindowFocus = refetchOnWindowFocus;
      existing.refetchOnReconnect = refetchOnReconnect;
      existing.refetchOnMount = refetchOnMount;
      existing.refetchInterval = refetchInterval;
      existing.refetchIntervalInBackground = refetchIntervalInBackground;
      existing._rawInput = rawInput;
      existing._rawDepends = rawDepends;
      existing._rawStale = rawStale;
      existing._rawInterval = rawInterval;
      syncInstanceInterval(existing);
      if (existing.lazy && existing.lazyState === 'idle') {
        observeLazyFragment(existing);
      }
    } else {
      const created = {
        instanceId,
        name,
        pagePath,
        input: effectiveInput,
        restoredInput: pendingRestoredInput,
        dependsOn,
        version: 0,
        el,
        abortController: null,
        inFlightCount: 0,
        persistInput: isInputPersistEnabled ? { type: inputStorageType, key: inputStorageKey } : null,
        lastUpdatedAt: Date.now(),
        staleTime,
        refetchOnWindowFocus,
        refetchOnReconnect,
        refetchOnMount,
        refetchInterval,
        refetchIntervalInBackground,
        intervalTimer: null,
        activeIntervalMs: 0,
        lazy: isLazyUnloaded,
        lazyState: isLazyUnloaded ? 'idle' : 'loaded',
        staleWhileUnloaded: false,
        _rawInput: rawInput,
        _rawDepends: rawDepends,
        _rawStale: rawStale,
        _rawInterval: rawInterval,
      };
      instances.set(instanceId, created);
      syncInstanceInterval(created);
      if (isLazyUnloaded) {
        observeLazyFragment(created);
      } else if (pendingRestoredInput) {
        Promise.resolve().then(() => {
          if (!isDisposed && created.version === 0 && instances.get(instanceId) === created) {
            refresh(instanceId, pendingRestoredInput).catch(() => {});
          }
        });
      } else if (refetchOnMount === 'always' || (refetchOnMount === true && staleTime <= 0)) {
        scheduleAutoRefresh([instanceId], 'mount');
      }
    }
  }

  /**
   * Internal DOM scan without allocating a return array.
   */
  function scanDomInstances(containerEl) {
    const defaultRoot = getRoot();
    const root = containerEl || defaultRoot;
    if (!root || typeof root.querySelectorAll !== 'function') return;

    const isFullScan = !containerEl || containerEl === defaultRoot;
    const seenIds = isFullScan ? new Set() : null;
    const nodeList = root.querySelectorAll('[data-w-fragment]');
    let idx = 0;

    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('data-w-fragment')) {
      syncSingleElement(root, idx++, seenIds);
    }

    for (let i = 0, len = nodeList.length; i < len; i++) {
      syncSingleElement(nodeList[i], idx++, seenIds);
    }

    // Prune disconnected instances if scanning full root
    if (isFullScan) {
      for (const [id, inst] of instances.entries()) {
        const disconnected =
          !seenIds.has(id) || (inst.el && inst.el.isConnected === false);
        if (disconnected) {
          clearInstanceInterval(inst);
          unobserveLazyFragment(inst);
          if (inst.abortController) {
            try {
              inst.abortController.abort();
            } catch (_e) {
              // Ignore
            }
          }
          instances.delete(id);
        }
      }
    }
  }

  /**
   * Scan DOM and synchronize tracked `[data-w-fragment]` instances.
   */
  function syncDomInstances(containerEl) {
    scanDomInstances(containerEl);
    return Array.from(instances.values());
  }

  /**
   * Apply a single server fragment result `{ instanceId, name, html, input, loadMs, renderMs }`
   * to the DOM if and only if `reqVersion >= inst.version`.
   */
  function applyFragmentPatch(inst, fragmentPayload, reqVersion, chainId = null, requestedInput = null) {
    if (!inst || !inst.el) return false;

    if (reqVersion < inst.version) {
      if (debug) {
        debug.trackDiscardedResponse({
          source: 'fragment',
          instanceId: inst.instanceId,
          key: inst.name,
          reason: 'stale-version',
          version: reqVersion,
          currentVersion: inst.version,
        });
      }
      return false;
    }

    const html = fragmentPayload && typeof fragmentPayload.html === 'string' ? fragmentPayload.html : '';
    if (!html) return false;

    const patchKey = `${inst.instanceId}:${reqVersion}`;
    const patchOpts = pendingPatchOptsByKey.get(patchKey) || null;
    if (patchOpts) {
      pendingPatchOptsByKey.delete(patchKey);
    }

    const patchMeta = {
      hookChainDepth: (patchOpts && patchOpts.hookChainDepth) || 0,
    };

    if (typeof options.onBeforePatch === 'function') {
      options.onBeforePatch(inst.el, inst, patchMeta);
    }
    if (patchOpts && typeof patchOpts.onBeforePatch === 'function') {
      try {
        patchOpts.onBeforePatch(inst.el, inst, patchMeta);
      } catch (_e) {}
    }

    const patchStart = Date.now();
    const patchMode = fragmentPayload.mode || (patchOpts && patchOpts.mode) || 'replace';

    const committedInput =
      fragmentPayload.input && typeof fragmentPayload.input === 'object' && !isArray(fragmentPayload.input)
        ? fragmentPayload.input
        : requestedInput && typeof requestedInput === 'object' && !isArray(requestedInput)
          ? requestedInput
          : null;

    if (
      patchMode !== 'append' &&
      patchMode !== 'prepend' &&
      committedInput &&
      !followUpNeeded &&
      pendingTags.size === 0
    ) {
      inst.input = { ...committedInput };
      const serializedInput = JSON.stringify(inst.input);
      if (inst.el && typeof inst.el.setAttribute === 'function') {
        inst.el.setAttribute('data-w-fragment-input', serializedInput);
      }
      inst._rawInput = serializedInput;
      if (inst.persistInput) {
        const store = inst.persistInput.type === 'local' ? defaultStorage.local : defaultStorage.session;
        store.set(inst.persistInput.key, inst.input);
      }
    }

    // Track existing strict descendant fragments before replace morph so removed children can be cleaned up
    const prevDescendants = [];
    if (patchMode !== 'append' && patchMode !== 'prepend') {
      for (const otherInst of instances.values()) {
        if (otherInst !== inst && otherInst.el && isStrictAncestor(inst.el, otherInst.el)) {
          prevDescendants.push(otherInst);
        }
      }
    }

    if (patchMode === 'append' || patchMode === 'prepend') {
      patchIncrementalList(inst.el, html, {
        mode: patchMode,
        limit: fragmentPayload.limit !== undefined ? fragmentPayload.limit : patchOpts && patchOpts.limit,
        target: fragmentPayload.target || (patchOpts && patchOpts.target),
        removeKeys: fragmentPayload.removeKeys || (patchOpts && patchOpts.removeKeys),
        onBeforeNodeRemove: options.onBeforeNodeRemove,
        onNodeAdded: options.onNodeAdded,
      });
    } else if (datastar && typeof datastar.patchFragmentElement === 'function') {
      datastar.patchFragmentElement(inst.el, html, {
        onBeforeNodeRemove: options.onBeforeNodeRemove,
        onNodeAdded: options.onNodeAdded,
      });
    } else {
      inst.el.innerHTML = html;
    }

    // Clear lazy unloaded markers once a real patch is applied
    if (inst.lazy || inst.lazyState !== 'loaded') {
      inst.lazy = false;
      inst.lazyState = 'loaded';
      inst.staleWhileUnloaded = false;
      unobserveLazyFragment(inst);
      if (inst.el && typeof inst.el.removeAttribute === 'function') {
        inst.el.removeAttribute('data-w-lazy');
      }
    }

    const patchMs = Math.max(0, Date.now() - patchStart);
    const now = Date.now();
    inst.lastUpdatedAt = now;

    // Clean up any nested child fragments removed during this parent patch
    for (let i = 0; i < prevDescendants.length; i++) {
      const prevChild = prevDescendants[i];
      if (!prevChild.el || prevChild.el.isConnected === false || !isStrictAncestor(inst.el, prevChild.el)) {
        clearInstanceInterval(prevChild);
        unobserveLazyFragment(prevChild);
        if (prevChild.abortController) {
          try {
            prevChild.abortController.abort();
          } catch (_e) {}
          prevChild.abortController = null;
        }
        instances.delete(prevChild.instanceId);
      }
    }

    // Re-sync nested fragment instances that may have been updated inside this parent fragment
    scanDomInstances(inst.el);
    for (const otherInst of instances.values()) {
      if (otherInst !== inst && otherInst.el && isStrictAncestor(inst.el, otherInst.el)) {
        if (otherInst.el.__wPreservedLazyChild) {
          delete otherInst.el.__wPreservedLazyChild;
        } else if (!(otherInst.lazy && otherInst.lazyState === 'idle')) {
          otherInst.lastUpdatedAt = now;
        }
      }
    }

    if (typeof options.onAfterPatch === 'function') {
      options.onAfterPatch(inst.el, inst, patchMeta);
    }
    if (patchOpts && typeof patchOpts.onAfterPatch === 'function') {
      try {
        patchOpts.onAfterPatch(inst.el, inst, patchMeta);
      } catch (_e) {}
    }

    if (debug) {
      debug.recordChainPatch(chainId, {
        instanceId: inst.instanceId,
        fragmentName: inst.name,
        patchMs,
        loadMs: fragmentPayload.loadMs !== undefined ? fragmentPayload.loadMs : null,
        renderMs: fragmentPayload.renderMs !== undefined ? fragmentPayload.renderMs : null,
      });
    }

    return true;
  }

  /**
   * Execute a network refresh for a list of target fragment descriptors:
   * `Array<{ instanceId, name, pagePath, input, reqVersion }>`
   */
  async function executeBatchRefresh(targets, chainIds = [], abortSignal = null, batchTimeout = defaultTimeout) {
    if (!targets || targets.length === 0) {
      return { refreshed: [], skipped: true };
    }
    if (!fetchImpl) {
      throw new Error('Global fetch is not available for fragment refresh.');
    }

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Webspresso-Fragment-Request': '1',
    };

    if (typeof options.getCsrfToken === 'function') {
      const token = options.getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
    }

    const pagePath =
      targets[0].pagePath ||
      (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');

    // Collect active inputs of any nested descendant fragments inside the requested parent targets
    // so server-side parent re-rendering preserves nested child filters & pagination.
    const childInputs = {};
    let hasChildInputs = false;
    for (const t of targets) {
      const parentInst = instances.get(t.instanceId);
      if (!parentInst || !parentInst.el) continue;
      for (const otherInst of instances.values()) {
        if (otherInst !== parentInst && otherInst.el && isStrictAncestor(parentInst.el, otherInst.el)) {
          // Supersede any older in-flight refresh on the nested child so a late child response
          // cannot overwrite the newer parent+child snapshot.
          otherInst.version += 1;
          if (otherInst.input && typeof otherInst.input === 'object') {
            childInputs[otherInst.instanceId] = { ...otherInst.input };
            if (!childInputs[otherInst.name]) {
              childInputs[otherInst.name] = { ...otherInst.input };
            }
            hasChildInputs = true;
          }
        }
      }
    }

    const requestPayload = {
      pagePath,
      fragments: targets.map((t) => ({
        instanceId: t.instanceId,
        name: t.name,
        input: t.input || {},
        version: t.reqVersion,
      })),
      ...(hasChildInputs ? { childInputs } : {}),
    };

    for (const t of targets) {
      const inst = instances.get(t.instanceId);
      if (inst) {
        inst.inFlightCount = (inst.inFlightCount || 0) + 1;
        if (inst.el && typeof inst.el.setAttribute === 'function') {
          inst.el.setAttribute('aria-busy', 'true');
        }
      }
    }

    const decrementTargetBusy = () => {
      for (const t of targets) {
        const inst = instances.get(t.instanceId);
        if (inst) {
          inst.inFlightCount = Math.max(0, (inst.inFlightCount || 1) - 1);
          if (inst.inFlightCount === 0 && inst.el && typeof inst.el.removeAttribute === 'function') {
            inst.el.removeAttribute('aria-busy');
          }
        }
      }
    };

    const reqId = uid('frag_req', 4);
    if (debug) {
      debug.trackRequestStart({
        requestId: reqId,
        key: `fragments:${targets.map((t) => t.instanceId).join(',')}`,
        method: 'POST',
        url: endpoint,
        policy: 'latest',
        payload: { count: targets.length },
      });
    }

    const batchAbortController = new AbortController();
    let timeoutTimer = null;
    let timedOut = false;
    const timeoutMs = isNumber(batchTimeout) ? batchTimeout : defaultTimeout;

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        batchAbortController.abort();
      }, timeoutMs);
    }

    const onCallerAbort = () => batchAbortController.abort();
    if (abortSignal) {
      if (abortSignal.aborted) {
        batchAbortController.abort();
      } else {
        abortSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        credentials: 'same-origin',
        signal: batchAbortController.signal,
      });
    } catch (err) {
      decrementTargetBusy();
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (abortSignal) {
        try {
          abortSignal.removeEventListener('abort', onCallerAbort);
        } catch (_e) {}
      }

      if (timedOut) {
        if (debug) {
          debug.trackRequestEnd(reqId, {
            status: 'failed',
            errorKind: 'timeout',
          });
        }
        const timeoutError = new Error(`Fragment refresh timed out after ${timeoutMs}ms.`);
        timeoutError.code = 'FRAGMENT_REFRESH_TIMEOUT';
        timeoutError.isTimedOut = true;
        lastFailedBatch = { targets, chainIds };
        for (const cid of chainIds) {
          if (debug) {
            debug.recordChainRefresh(cid, {
              fragmentIds: targets.map((t) => t.instanceId),
              status: 'failed',
              error: timeoutError,
            });
          }
        }
        throw timeoutError;
      }

      const isAbort =
        (abortSignal && abortSignal.aborted) ||
        batchAbortController.signal.aborted ||
        (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));

      if (debug) {
        debug.trackRequestEnd(reqId, {
          status: isAbort ? 'canceled' : 'failed',
          errorKind: isAbort ? 'canceled' : 'network',
        });
      }
      if (isAbort) {
        return { ok: false, refreshed: [], canceled: true };
      }
      lastFailedBatch = { targets, chainIds };
      for (const cid of chainIds) {
        if (debug) {
          debug.recordChainRefresh(cid, {
            fragmentIds: targets.map((t) => t.instanceId),
            status: 'failed',
            error: err,
          });
        }
      }
      throw err;
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (abortSignal) {
        try {
          abortSignal.removeEventListener('abort', onCallerAbort);
        } catch (_e) {}
      }
    }

    let body = null;
    try {
      if (typeof response.text === 'function') {
        const text = await response.text();
        body = text ? JSON.parse(text) : null;
      } else if (typeof response.json === 'function') {
        body = await response.json();
      }
    } catch (_e) {
      body = null;
    } finally {
      decrementTargetBusy();
    }

    if (!response.ok) {
      if (debug) {
        debug.trackRequestEnd(reqId, {
          status: 'failed',
          httpStatus: response.status,
          errorKind: 'http',
        });
      }
      const errMsg =
        (body && body.error && body.error.message) ||
        (body && body.message) ||
        `Fragment refresh failed with HTTP ${response.status}`;
      const refreshError = new Error(errMsg);
      refreshError.status = response.status;
      refreshError.data = body;
      lastFailedBatch = { targets, chainIds };
      for (const cid of chainIds) {
        if (debug) {
          debug.recordChainRefresh(cid, {
            fragmentIds: targets.map((t) => t.instanceId),
            status: 'failed',
            error: refreshError,
          });
        }
      }
      throw refreshError;
    }

    if (debug) {
      debug.trackRequestEnd(reqId, { status: 'completed', httpStatus: response.status });
    }

    const rawFragments = (body && body.fragments) || {};
    const rawErrors = (body && body.errors && typeof body.errors === 'object' ? body.errors : {}) || {};
    const resultsMap = {};
    if (isArray(rawFragments)) {
      for (const item of rawFragments) {
        if (item && typeof item === 'object') {
          if (item.instanceId) resultsMap[item.instanceId] = item;
          if (item.name && !resultsMap[item.name]) resultsMap[item.name] = item;
        }
      }
    } else if (rawFragments && typeof rawFragments === 'object') {
      Object.assign(resultsMap, rawFragments);
    }
    const refreshedIds = [];
    const batchErrors = [];
    const failedTargets = [];
    let staleDiscardCount = 0;
    let totalLoadMs = 0;
    let totalRenderMs = 0;

    for (const target of targets) {
      const inst = instances.get(target.instanceId);
      const fragError =
        rawErrors[target.instanceId] ||
        rawErrors[target.name] ||
        (resultsMap[target.instanceId] && resultsMap[target.instanceId].error) ||
        (resultsMap[target.name] && resultsMap[target.name].error) ||
        null;
      if (fragError) {
        const errObj =
          fragError instanceof Error
            ? fragError
            : Object.assign(
                new Error(
                  (fragError && typeof fragError === 'object' && fragError.message) ||
                    String(fragError) ||
                    `Fragment "${target.name}" failed to refresh`
                ),
                {
                  status: (fragError && fragError.status) || 500,
                  code: (fragError && fragError.code) || 'FRAGMENT_REFRESH_ERROR',
                  instanceId: target.instanceId,
                  fragmentName: target.name,
                }
              );
        batchErrors.push(errObj);
        failedTargets.push(target);
        continue;
      }

      const fragResult = resultsMap[target.instanceId] || resultsMap[target.name];
      if (!inst || !fragResult) continue;
      if (target.reqVersion < inst.version) {
        staleDiscardCount += 1;
      }
      if (isNumber(fragResult.loadMs)) totalLoadMs += fragResult.loadMs;
      if (isNumber(fragResult.renderMs)) totalRenderMs += fragResult.renderMs;

      const applied = applyFragmentPatch(
        inst,
        fragResult,
        target.reqVersion,
        chainIds[0] || null,
        target.input
      );
      if (applied) {
        refreshedIds.push(target.instanceId);
      }
    }

    const allSuperseded =
      refreshedIds.length === 0 &&
      batchErrors.length === 0 &&
      staleDiscardCount > 0 &&
      staleDiscardCount === targets.length;

    if (refreshedIds.length > 0 && lastFailedBatch && isArray(lastFailedBatch.targets)) {
      const refreshedSet = new Set(refreshedIds);
      const remainingFailed = lastFailedBatch.targets.filter((t) => !refreshedSet.has(t.instanceId));
      lastFailedBatch =
        remainingFailed.length > 0
          ? { targets: remainingFailed, chainIds: lastFailedBatch.chainIds }
          : null;
    }

    if (batchErrors.length > 0) {
      lastFailedBatch = {
        targets: failedTargets,
        chainIds,
      };
    }

    for (const cid of chainIds) {
      if (debug) {
        debug.recordChainRefresh(cid, {
          fragmentIds: refreshedIds,
          status: batchErrors.length > 0 ? (refreshedIds.length > 0 ? 'partial-error' : 'error') : allSuperseded ? 'superseded' : 'ok',
          error: batchErrors[0] || null,
          loadMs: totalLoadMs,
          renderMs: totalRenderMs,
          totalServerMs: body && isNumber(body.totalMs) ? body.totalMs : null,
        });
      }
    }

    if (allSuperseded) {
      return {
        ok: false,
        canceled: true,
        superseded: true,
        refreshed: [],
        errors: [],
        timings: {
          loadMs: totalLoadMs,
          renderMs: totalRenderMs,
        },
      };
    }

    if (batchErrors.length > 0) {
      return {
        ok: false,
        partial: refreshedIds.length > 0,
        refreshed: refreshedIds,
        errors: batchErrors,
        error: batchErrors[0],
        timings: {
          loadMs: totalLoadMs,
          renderMs: totalRenderMs,
        },
      };
    }

    return {
      ok: true,
      refreshed: refreshedIds,
      errors: [],
      timings: {
        loadMs: totalLoadMs,
        renderMs: totalRenderMs,
      },
    };
  }

  /**
   * Flush pending invalidated tags in a single coalesced request.
   * If a flush is currently in flight, sets `followUpNeeded = true` so that
   * newly invalidated tags are flushed immediately when the in-flight request finishes.
   */
  async function flushInvalidations() {
    if (inFlightBatchCount > 0) {
      followUpNeeded = true;
      return new Promise((resolve, reject) => {
        inflightBatchWaiters.push({ resolve, reject });
      });
    }

    if (pendingTags.size === 0) {
      return { ok: true, refreshed: [], skipped: true };
    }

    const tagsToFlush = new Set(pendingTags);
    const chainsToFlush = [...pendingChains];
    pendingTags.clear();
    pendingChains.length = 0;

    scanDomInstances();

    // Find all mounted fragment instances whose `dependsOn` intersects `tagsToFlush`
    const matchingInstances = [];
    for (const inst of instances.values()) {
      let matched = false;
      for (const tag of tagsToFlush) {
        if (inst.dependsOn.has(tag) || inst.name === tag || inst.instanceId === tag) {
          matched = true;
          break;
        }
      }
      if (matched) {
        if (inst.lazy && inst.lazyState === 'idle') {
          // Do not fetch off-screen unloaded lazy fragments on invalidation; mark stale for when visible
          inst.staleWhileUnloaded = true;
        } else {
          matchingInstances.push(inst);
        }
      }
    }

    // If no active fragment on the open page matches, send ZERO network requests!
    if (matchingInstances.length === 0) {
      for (const cid of chainsToFlush) {
        if (debug) {
          debug.recordChainRefresh(cid, {
            fragmentIds: [],
            status: 'skipped-no-matching-fragment',
          });
        }
      }
      return { ok: true, refreshed: [], skipped: true };
    }

    // Parent/Child deduplication: if parent & child are both invalidated, parent refresh covers child
    const dedupedInstances = deduplicateParentChildFragments(matchingInstances);

    const batchHookDepth = pendingInvalidateHookDepth;
    pendingInvalidateHookDepth = 0;

    const targets = dedupedInstances.map((inst) => {
      inst.version += 1;
      if (batchHookDepth > 0) {
        pendingPatchOptsByKey.set(`${inst.instanceId}:${inst.version}`, {
          hookChainDepth: batchHookDepth,
        });
      }
      return {
        instanceId: inst.instanceId,
        name: inst.name,
        pagePath: inst.pagePath,
        input: { ...inst.input },
        reqVersion: inst.version,
      };
    });

    inFlightBatchCount += 1;
    try {
      const result = await executeBatchRefresh(targets, chainsToFlush);
      // If new invalidations arrived while this batch was in flight, run follow-up immediately!
      if (followUpNeeded || pendingTags.size > 0) {
        followUpNeeded = false;
        inFlightBatchCount -= 1;
        const followUpResult = await flushInvalidations();
        const waiters = inflightBatchWaiters.splice(0, inflightBatchWaiters.length);
        for (const w of waiters) w.resolve(followUpResult);
        return followUpResult;
      }
      const waiters = inflightBatchWaiters.splice(0, inflightBatchWaiters.length);
      for (const w of waiters) w.resolve(result);
      return result;
    } catch (err) {
      const waiters = inflightBatchWaiters.splice(0, inflightBatchWaiters.length);
      for (const w of waiters) w.reject(err);
      throw err;
    } finally {
      if (inFlightBatchCount > 0) {
        inFlightBatchCount -= 1;
      }
    }
  }

  /**
   * Invalidate one or more dependency tags (e.g. `['notes']`).
   * Coalesces multiple invalidation calls within the same microtask into a single batch request.
   *
   * @param {string|string[]} tags
   * @param {object} [meta]
   * @returns {Promise<{ refreshed: string[], skipped?: boolean }>}
   */
  function invalidate(tags, meta = {}) {
    const activeHook = typeof options.getPatchHookContext === 'function' ? options.getPatchHookContext() : null;
    if (activeHook) {
      const nextDepth = (activeHook.depth || 0) + 1;
      if (nextDepth > pendingInvalidateHookDepth) {
        pendingInvalidateHookDepth = nextDepth;
      }
    }
    const tagList = isArray(tags) ? tags : [tags];
    for (const raw of tagList) {
      if (typeof raw === 'string' && raw.trim()) {
        pendingTags.add(raw.trim());
      }
    }
    if (meta && meta.chainId) {
      pendingChains.push(meta.chainId);
    }

    if (batchTimer) {
      return batchTimer.promise;
    }

    let resolveBatch;
    let rejectBatch;
    const promise = new Promise((resolve, reject) => {
      resolveBatch = resolve;
      rejectBatch = reject;
    });

    batchTimer = {
      promise,
    };

    // Coalesce synchronous/microtask invalidations before flushing
    Promise.resolve().then(async () => {
      batchTimer = null;
      try {
        const res = await flushInvalidations();
        resolveBatch(res);
      } catch (err) {
        rejectBatch(err);
      }
    });

    return promise;
  }

  /**
   * Explicitly refresh a specific fragment instance (or all instances of a fragment name)
   * with optional updated filter/pagination input.
   * Enforces `'latest'` semantics per instance so rapid filter changes discard stale responses.
   *
   * @param {string} idOrName - `instanceId` (e.g. `'list:default'`) or fragment `name` (e.g. `'list'`)
   * @param {Record<string, unknown>} [nextInput] - Partial or new input parameters
   * @param {object} [refreshOpts]
   */
  async function refresh(idOrName, nextInput, refreshOpts = {}) {
    scanDomInstances();

    const matched = [];
    if (instances.has(idOrName)) {
      matched.push(instances.get(idOrName));
    } else {
      for (const inst of instances.values()) {
        if (inst.name === idOrName) {
          matched.push(inst);
        }
      }
    }

    if (matched.length === 0) {
      const skippedRes = { ok: true, refreshed: [], skipped: true };
      if (typeof refreshOpts.onSuccess === 'function') {
        await refreshOpts.onSuccess(skippedRes);
      }
      if (typeof refreshOpts.onSettled === 'function') {
        await refreshOpts.onSettled(skippedRes, null);
      } else if (typeof refreshOpts.onComplete === 'function') {
        await refreshOpts.onComplete(skippedRes, null);
      }
      return skippedRes;
    }

    const deduped = deduplicateParentChildFragments(matched);
    const abortController = new AbortController();

    const targets = deduped.map((inst) => {
      // Abort previous direct refresh for this instance so rapid filter updates don't race
      if (inst.abortController) {
        try {
          inst.abortController.abort();
        } catch (_e) {
          // Ignore
        }
      }
      inst.abortController = abortController;
      inst.version += 1;

      if (inst.lazy && inst.lazyState === 'idle') {
        inst.lazyState = 'loading';
        unobserveLazyFragment(inst);
      }

      const activeHook = typeof options.getPatchHookContext === 'function' ? options.getPatchHookContext() : null;
      const hookChainDepth = activeHook ? (activeHook.depth || 0) + 1 : 0;

      if (
        refreshOpts.mode ||
        refreshOpts.limit !== undefined ||
        refreshOpts.target ||
        refreshOpts.removeKeys ||
        hookChainDepth > 0 ||
        typeof refreshOpts.onBeforePatch === 'function' ||
        typeof refreshOpts.onAfterPatch === 'function'
      ) {
        pendingPatchOptsByKey.set(`${inst.instanceId}:${inst.version}`, {
          mode: refreshOpts.mode || null,
          limit: refreshOpts.limit,
          target: refreshOpts.target,
          removeKeys: refreshOpts.removeKeys,
          hookChainDepth,
          onBeforePatch: refreshOpts.onBeforePatch,
          onAfterPatch: refreshOpts.onAfterPatch,
        });
      }

      const candidateInput =
        nextInput && typeof nextInput === 'object'
          ? refreshOpts.replaceInput
            ? { ...nextInput }
            : { ...inst.input, ...nextInput }
          : { ...inst.input };

      return {
        instanceId: inst.instanceId,
        name: inst.name,
        pagePath: inst.pagePath,
        input: candidateInput,
        reqVersion: inst.version,
      };
    });

    const clearOwnedAbortControllers = () => {
      for (const inst of deduped) {
        if (inst.abortController === abortController) {
          inst.abortController = null;
        }
      }
    };

    try {
      const result = await executeBatchRefresh(targets, [], abortController.signal, refreshOpts.timeout);
      clearOwnedAbortControllers();
      const enrichedResult = { ok: true, ...result };
      if (enrichedResult.ok === false && !enrichedResult.canceled && !enrichedResult.superseded && enrichedResult.error) {
        const failHandler = refreshOpts.onFailure || refreshOpts.onError;
        if (typeof failHandler === 'function') {
          await failHandler(enrichedResult.error);
        }
        if (typeof refreshOpts.onSettled === 'function') {
          await refreshOpts.onSettled(enrichedResult, enrichedResult.error);
        } else if (typeof refreshOpts.onComplete === 'function') {
          await refreshOpts.onComplete(enrichedResult, enrichedResult.error);
        }
        if (refreshOpts.throwOnError === true) {
          throw enrichedResult.error;
        }
        return enrichedResult;
      }
      if (!enrichedResult.canceled && !enrichedResult.superseded && enrichedResult.ok !== false) {
        if (typeof refreshOpts.onSuccess === 'function') {
          await refreshOpts.onSuccess(enrichedResult);
        }
      }
      if (typeof refreshOpts.onSettled === 'function') {
        await refreshOpts.onSettled(enrichedResult, null);
      } else if (typeof refreshOpts.onComplete === 'function') {
        await refreshOpts.onComplete(enrichedResult, null);
      }
      return enrichedResult;
    } catch (err) {
      clearOwnedAbortControllers();
      const failHandler = refreshOpts.onFailure || refreshOpts.onError;
      if (typeof failHandler === 'function') {
        try {
          await failHandler(err);
        } catch (callbackErr) {
          throw callbackErr;
        }
      }
      if (typeof refreshOpts.onSettled === 'function') {
        await refreshOpts.onSettled(null, err);
      } else if (typeof refreshOpts.onComplete === 'function') {
        await refreshOpts.onComplete(null, err);
      }

      if (refreshOpts.throwOnError !== true && (typeof failHandler === 'function' || refreshOpts.throwOnError === false)) {
        return {
          ok: false,
          error: err,
          refreshed: [],
          timings: { loadMs: 0, renderMs: 0 },
        };
      }
      throw err;
    }
  }

  /**
   * Retry the last failed fragment refresh without re-running any mutation.
   */
  async function retryFailed() {
    if (!lastFailedBatch || !lastFailedBatch.targets || lastFailedBatch.targets.length === 0) {
      return { refreshed: [], skipped: true };
    }
    const { targets, chainIds } = lastFailedBatch;
    lastFailedBatch = null;

    // Bump versions to current + 1 for retry
    const retryTargets = [];
    for (const t of targets) {
      const inst = instances.get(t.instanceId);
      if (inst) {
        inst.version += 1;
        retryTargets.push({
          ...t,
          input: t.input ? { ...t.input } : { ...inst.input },
          reqVersion: inst.version,
        });
      }
    }

    if (retryTargets.length === 0) {
      return { refreshed: [], skipped: true };
    }

    return executeBatchRefresh(retryTargets, chainIds);
  }

  function resolveInstanceByIdOrName(idOrName) {
    if (!idOrName) return null;
    const direct = instances.get(idOrName);
    if (direct && (!direct.el || direct.el.isConnected !== false)) {
      return direct;
    }
    const defaultInst = instances.get(`${idOrName}:default`);
    if (defaultInst && (!defaultInst.el || defaultInst.el.isConnected !== false)) {
      return defaultInst;
    }
    for (const inst of instances.values()) {
      if (inst.name === idOrName && (!inst.el || inst.el.isConnected !== false)) {
        return inst;
      }
    }
    return null;
  }

  return {
    syncDomInstances,
    invalidate,
    refresh,
    refreshFragments(items = []) {
      if (!isArray(items) || items.length === 0) {
        return Promise.resolve({ refreshed: [], skipped: true });
      }
      scanDomInstances();
      for (const item of items) {
        const key = item.instanceId || item.name;
        const matchedList = [];
        if (item.instanceId && instances.has(item.instanceId)) {
          matchedList.push(instances.get(item.instanceId));
        } else {
          for (const inst of instances.values()) {
            if (inst.instanceId === key || inst.name === key) {
              matchedList.push(inst);
            }
          }
        }
        if (matchedList.length > 0) {
          for (const inst of matchedList) {
            if (item.input && typeof item.input === 'object') {
              inst.input = { ...item.input };
              if (inst.el && typeof inst.el.setAttribute === 'function') {
                const serializedInput = JSON.stringify(inst.input);
                inst.el.setAttribute('data-w-fragment-input', serializedInput);
                inst._rawInput = serializedInput;
              }
            }
            pendingTags.add(item.instanceId ? inst.instanceId : inst.name);
          }
        } else if (key) {
          pendingTags.add(String(key).trim());
        }
      }
      return flushInvalidations();
    },
    findFragmentsByTags(tags = []) {
      scanDomInstances();
      const tagSet = new Set((isArray(tags) ? tags : [tags]).map((t) => String(t || '').trim()).filter(Boolean));
      const matching = [];
      for (const inst of instances.values()) {
        for (const t of tagSet) {
          if (inst.dependsOn.has(t) || inst.name === t || inst.instanceId === t) {
            matching.push(inst);
            break;
          }
        }
      }
      return deduplicateParentChildFragments(matching);
    },
    retryFailed,
    retryLastFailed: retryFailed,
    getInstance(instanceIdOrName) {
      const hit = resolveInstanceByIdOrName(instanceIdOrName);
      if (hit) {
        return hit;
      }
      scanDomInstances();
      return resolveInstanceByIdOrName(instanceIdOrName);
    },
    getInstances(nameOrId) {
      scanDomInstances();
      const all = Array.from(instances.values());
      if (!nameOrId) return all;
      return all.filter((inst) => inst.instanceId === nameOrId || inst.name === nameOrId);
    },
    getStoredInput(instanceIdOrName, storageType = 'session') {
      const store = storageType === 'local' ? defaultStorage.local : defaultStorage.session;
      const direct = store.get(`frag_input:${instanceIdOrName}`, null);
      if (direct !== null) return direct;
      const inst = instances.get(instanceIdOrName) || Array.from(instances.values()).find((i) => i.name === instanceIdOrName);
      if (inst && inst.persistInput) {
        const instStore = inst.persistInput.type === 'local' ? defaultStorage.local : defaultStorage.session;
        return instStore.get(inst.persistInput.key, null);
      }
      return null;
    },
    clearStoredInput(instanceIdOrName, storageType = 'session') {
      const store = storageType === 'local' ? defaultStorage.local : defaultStorage.session;
      const inst = instances.get(instanceIdOrName) || Array.from(instances.values()).find((i) => i.name === instanceIdOrName);
      if (inst && inst.persistInput) {
        const instStore = inst.persistInput.type === 'local' ? defaultStorage.local : defaultStorage.session;
        instStore.remove(inst.persistInput.key);
      }
      return store.remove(`frag_input:${instanceIdOrName}`);
    },
    get hasFailedRefresh() {
      return Boolean(lastFailedBatch);
    },
    dispose() {
      isDisposed = true;
      if (focusDebounceTimer) {
        clearTimeout(focusDebounceTimer);
        focusDebounceTimer = null;
      }
      if (autoBatchTimer) {
        clearTimeout(autoBatchTimer);
        autoBatchTimer = null;
      }
      pendingAutoInstanceIds.clear();
      pendingAutoReasons.clear();
      pendingPatchOptsByKey.clear();
      if (lazyObserver && typeof lazyObserver.disconnect === 'function') {
        try {
          lazyObserver.disconnect();
        } catch (_e) {}
        lazyObserver = null;
      }
      removeLifecycleListeners();
      for (const inst of instances.values()) {
        clearInstanceInterval(inst);
        if (inst.abortController) {
          try {
            inst.abortController.abort();
          } catch (_e) {}
          inst.abortController = null;
        }
      }
    },
  };
}

module.exports = {
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
};


},
    "./debug": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Debug & Telemetry Inspector
 * Tracks active controllers, active requests/concurrency states,
 * mutation -> invalidation -> refresh -> patch causal chains,
 * fragment timings (loadMs, renderMs, patchMs), discarded stale responses,
 * and lifecycle cleanup errors without logging raw form values or sensitive payloads.
 */

const { isArray, isNumber, NOOP_DEBUGGER, uid } = require('./utils');

const SENSITIVE_KEY_PATTERN = /password|passwd|secret|token|authorization|cookie|credit|card|cvv|ssn|api[-_]?key/i;

/**
 * Redact keys/structures without exposing raw values by default.
 * Returns only structural metadata (keys list or redacted summary).
 *
 * @param {unknown} payload
 * @param {boolean} [includeSafePrimitives=false]
 * @returns {unknown}
 */
function summarizePayloadSafely(payload, includeSafePrimitives = false) {
  if (payload === null || payload === undefined) return payload;
  if (typeof FormData !== 'undefined' && payload instanceof FormData) {
    const keys = [];
    for (const key of payload.keys()) {
      keys.push(key);
    }
    return { type: 'FormData', fields: Array.from(new Set(keys)) };
  }
  if (typeof Blob !== 'undefined' && payload instanceof Blob) {
    return { type: 'Blob', size: payload.size, mimeType: payload.type || 'application/octet-stream' };
  }
  if (isArray(payload)) {
    return { type: 'Array', length: payload.length };
  }
  if (typeof payload === 'object') {
    const keys = Object.keys(payload);
    if (!includeSafePrimitives) {
      return { type: 'Object', keys };
    }
    const safe = {};
    for (const k of keys) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        safe[k] = '[REDACTED]';
      } else {
        safe[k] = '[OMITTED_VALUE]';
      }
    }
    return safe;
  }
  return `[${typeof payload}]`;
}

/**
 * Internal active debugger implementation that allocates tracking ring buffers.
 */
function createActiveDebugger(options = {}) {
  let enabled = Boolean(options.enabled);
  const maxEvents = isNumber(options.maxEvents) && options.maxEvents > 0 ? options.maxEvents : 200;
  const customLogger = typeof options.logger === 'function' ? options.logger : null;

  const events = [];
  const activeControllers = new Map(); // instanceId -> { name, instanceId, el, mountedAt }
  const activeRequests = new Map(); // requestId -> { requestId, key, method, url, policy, status, startedAt }
  const causalChains = new Map(); // chainId -> { chainId, mutation, invalidation, refresh, patch, timings }
  const discardedResponses = [];
  const cleanupErrors = [];
  const fragmentTimings = [];

  let chainSeq = 0;

  function pushEvent(type, detail = {}) {
    const entry = {
      id: uid('evt'),
      type,
      timestamp: Date.now(),
      ...detail,
    };
    events.push(entry);
    if (events.length > maxEvents) {
      events.shift();
    }
    if (enabled && customLogger) {
      try {
        customLogger(entry);
      } catch (_err) {
        // Never break application flow on logger failure
      }
    }
    return entry;
  }

  const api = {
    get enabled() {
      return enabled;
    },
    setEnabled(val) {
      enabled = Boolean(val);
    },

    // --- Controller tracking ---
    trackControllerMount(instanceId, name, el) {
      activeControllers.set(instanceId, {
        instanceId,
        name,
        el: el || null,
        tagName: el && el.tagName ? String(el.tagName).toLowerCase() : null,
        mountedAt: Date.now(),
      });
      pushEvent('controller:mount', { instanceId, name });
    },

    trackControllerUnmount(instanceId, name) {
      activeControllers.delete(instanceId);
      pushEvent('controller:unmount', { instanceId, name });
    },

    trackCleanupError(instanceId, name, phase, error) {
      const record = {
        instanceId,
        name,
        phase,
        message: error && error.message ? error.message : String(error),
        timestamp: Date.now(),
      };
      cleanupErrors.push(record);
      if (cleanupErrors.length > maxEvents) cleanupErrors.shift();
      pushEvent('controller:cleanup-error', record);
    },

    // --- Request & Concurrency tracking ---
    trackRequestStart({ requestId, key, method, url, policy, payload }) {
      const record = {
        requestId,
        key,
        method: String(method || 'GET').toUpperCase(),
        url,
        policy: policy || 'parallel',
        status: 'in-flight',
        payloadMeta: summarizePayloadSafely(payload, false),
        startedAt: Date.now(),
      };
      activeRequests.set(requestId, record);
      pushEvent('request:start', record);
      return record;
    },

    trackRequestEnd(requestId, outcome = {}) {
      const existing = activeRequests.get(requestId);
      activeRequests.delete(requestId);
      const durationMs = existing ? Math.max(0, Date.now() - existing.startedAt) : 0;
      const record = {
        ...(existing || { requestId }),
        status: outcome.status || 'completed',
        httpStatus: outcome.httpStatus || null,
        errorKind: outcome.errorKind || null,
        durationMs,
      };
      pushEvent('request:end', record);
      return record;
    },

    trackDiscardedResponse({ source, key, instanceId, reason, version, currentVersion, url }) {
      const record = {
        source: source || 'api',
        key: key || null,
        instanceId: instanceId || null,
        url: url || null,
        reason: reason || 'stale',
        version: version !== undefined ? version : null,
        currentVersion: currentVersion !== undefined ? currentVersion : null,
        timestamp: Date.now(),
      };
      discardedResponses.push(record);
      if (discardedResponses.length > maxEvents) discardedResponses.shift();
      pushEvent(`${source || 'api'}:discarded`, record);
      return record;
    },

    // --- Causal chain: mutation -> invalidation -> refresh -> patch ---
    startCausalChain({ method, url, requestId, tags }) {
      const chainId = `chain_${++chainSeq}_${Date.now()}`;
      const chain = {
        chainId,
        startedAt: Date.now(),
        mutation: {
          requestId: requestId || null,
          method: String(method || 'POST').toUpperCase(),
          url: url || null,
          completedAt: Date.now(),
        },
        invalidation: {
          tags: isArray(tags) ? [...tags] : [],
          triggeredAt: Date.now(),
        },
        refresh: null,
        patch: null,
      };
      causalChains.set(chainId, chain);
      if (causalChains.size > maxEvents) {
        const oldestKey = causalChains.keys().next().value;
        if (oldestKey) causalChains.delete(oldestKey);
      }
      pushEvent('chain:mutation-invalidated', {
        chainId,
        method: chain.mutation.method,
        url: chain.mutation.url,
        tags: chain.invalidation.tags,
      });
      return chainId;
    },

    recordChainRefresh(chainId, { fragmentIds, status, loadMs, renderMs, totalServerMs, error }) {
      const chain = chainId ? causalChains.get(chainId) : null;
      const refreshData = {
        fragmentIds: isArray(fragmentIds) ? [...fragmentIds] : [],
        status: status || 'ok',
        loadMs: isNumber(loadMs) ? loadMs : null,
        renderMs: isNumber(renderMs) ? renderMs : null,
        totalServerMs: isNumber(totalServerMs) ? totalServerMs : null,
        error: error ? String(error.message || error) : null,
        completedAt: Date.now(),
      };
      if (chain) {
        chain.refresh = refreshData;
      }
      pushEvent('chain:refresh', { chainId: chainId || null, ...refreshData });
    },

    recordChainPatch(chainId, { instanceId, fragmentName, patchMs, loadMs, renderMs }) {
      const chain = chainId ? causalChains.get(chainId) : null;
      const patchData = {
        instanceId,
        fragmentName: fragmentName || null,
        patchMs: isNumber(patchMs) ? patchMs : 0,
        loadMs: isNumber(loadMs) ? loadMs : null,
        renderMs: isNumber(renderMs) ? renderMs : null,
        completedAt: Date.now(),
      };
      if (chain) {
        if (!chain.patch) chain.patch = [];
        chain.patch.push(patchData);
      }
      fragmentTimings.push(patchData);
      if (fragmentTimings.length > maxEvents) fragmentTimings.shift();
      pushEvent('chain:patch', { chainId: chainId || null, ...patchData });
    },

    recordEvent(type, detail = {}) {
      return pushEvent(type, detail);
    },

    // --- Inspection Snapshot ---
    getSnapshot() {
      return {
        enabled,
        activeControllers: Array.from(activeControllers.values()).map((c) => ({
          instanceId: c.instanceId,
          name: c.name,
          tagName: c.tagName,
          mountedAt: c.mountedAt,
          isConnected: Boolean(c.el && c.el.isConnected !== false),
        })),
        activeRequests: Array.from(activeRequests.values()),
        causalChains: Array.from(causalChains.values()),
        fragmentTimings: [...fragmentTimings],
        discardedResponses: [...discardedResponses],
        cleanupErrors: [...cleanupErrors],
        events: [...events],
      };
    },

    clear() {
      events.length = 0;
      activeControllers.clear();
      activeRequests.clear();
      causalChains.clear();
      discardedResponses.length = 0;
      cleanupErrors.length = 0;
      fragmentTimings.length = 0;
    },
  };

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_DEBUG__ = api;
  }

  return api;
}

/**
 * Create a client debug collector instance.
 * Returns a zero-allocation stub if debugging is disabled.
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled=false]
 * @param {number} [options.maxEvents=200]
 * @param {(entry: object) => void} [options.logger]
 */
function createClientDebugger(options = {}) {
  if (!options.enabled && process.env.NODE_ENV === 'production') {
    return NOOP_DEBUGGER;
  }
  if (!options.enabled && !options.logger && !options.maxEvents) {
    let activeInstance = null;
    return {
      get enabled() {
        return activeInstance ? activeInstance.enabled : false;
      },
      setEnabled(val) {
        if (val && !activeInstance) {
          activeInstance = createActiveDebugger({ ...options, enabled: true });
        } else if (activeInstance) {
          activeInstance.setEnabled(val);
        }
      },
      trackControllerMount(id, name, el) {
        if (activeInstance) activeInstance.trackControllerMount(id, name, el);
      },
      trackControllerUnmount(id, name) {
        if (activeInstance) activeInstance.trackControllerUnmount(id, name);
      },
      trackCleanupError(id, name, p, err) {
        if (activeInstance) activeInstance.trackCleanupError(id, name, p, err);
      },
      trackRequestStart(args) {
        return activeInstance
          ? activeInstance.trackRequestStart(args)
          : { requestId: args.requestId, status: 'in-flight' };
      },
      trackRequestEnd(id, out) {
        return activeInstance ? activeInstance.trackRequestEnd(id, out) : { status: 'completed' };
      },
      trackDiscardedResponse(args) {
        return activeInstance ? activeInstance.trackDiscardedResponse(args) : { reason: args.reason };
      },
      startCausalChain(args) {
        return activeInstance ? activeInstance.startCausalChain(args) : '';
      },
      recordChainRefresh(id, args) {
        if (activeInstance) activeInstance.recordChainRefresh(id, args);
      },
      recordChainPatch(id, args) {
        if (activeInstance) activeInstance.recordChainPatch(id, args);
      },
      recordEvent(t, d) {
        return activeInstance ? activeInstance.recordEvent(t, d) : null;
      },
      getSnapshot() {
        return activeInstance ? activeInstance.getSnapshot() : NOOP_DEBUGGER.getSnapshot();
      },
      clear() {
        if (activeInstance) activeInstance.clear();
      },
    };
  }

  return createActiveDebugger(options);
}

module.exports = {
  createClientDebugger,
  summarizePayloadSafely,
};


},
    "../../core/client": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Behavior Layer (`core/client`)
 *
 * Datastar-powered, SSR-integrated, strongly-typed client behavior runtime.
 * Supports two clean data flows:
 *   1. Server-managed view: SSR HTML + fragment refresh (`fragments` + `invalidate`)
 *   2. Client-managed data: Explicit typed API calls (`api.get`, `api.post`, ...) into controller-local state
 */

const {
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,
} = require('./adapter/datastar');

const {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
} = require('./api');

const {
  defineController,
  deriveControllerNameFromPath,
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,
} = require('./controller');

const {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
} = require('./forms');

const {
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
} = require('./fragments');

const {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
} = require('./storage');

const {
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
} = require('./services');

const {
  createClientHostManager,
} = require('./host');

const { isArray, isNumber, NOOP_DEBUGGER, randomId, uid } = require('./utils');

const NOOP_DEVTOOL_HANDLE = Object.freeze({
  open() {},
  close() {},
  toggle() {},
  refresh() {},
  destroy() {},
});

let _debugMod = null;
function getDebugModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_debugMod) {
      _debugMod = require('./debug');
    }
    return _debugMod;
  }
  return {
    createClientDebugger: () => NOOP_DEBUGGER,
    summarizePayloadSafely: () => null,
  };
}

let _devtoolMod = null;
function getDevtoolModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_devtoolMod) {
      _devtoolMod = require('./devtool');
    }
    return _devtoolMod;
  }
  return {
    mountDevtool: () => NOOP_DEVTOOL_HANDLE,
    highlightElement: () => {},
    setupReduxDevToolsBridge: () => null,
  };
}

let _liteMod = null;
function getLiteModule() {
  if (!_liteMod) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _liteMod = reqFn('./lite');
  }
  return _liteMod;
}

let _serverFragments = null;
function getServerFragments() {
  if (!_serverFragments) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _serverFragments = reqFn('./server-fragments');
  }
  return _serverFragments;
}

/**
 * Create a complete Webspresso Client Runtime instance wiring Datastar, Controllers,
 * Typed API Client, Native Forms, Fragment Coordinator, and Debug Telemetry.
 *
 * @param {object} [options]
 * @param {Document|Element} [options.root] - Root document or container
 * @param {typeof fetch} [options.fetch] - Custom fetch implementation
 * @param {string} [options.baseUrl=''] - Optional API base URL
 * @param {string} [options.fragmentEndpoint='/__webspresso/fragments'] - Fragment refresh URL
 * @param {object} [options.datastar] - Optional `@starfederation/datastar` module
 * @param {boolean} [options.debug=false] - Enable client debug telemetry
 * @param {boolean} [options.observe=false] - Enable MutationObserver for external DOM changes
 * @param {(name: string, el: Element) => Promise<object>} [options.lazyLoader] - Lazy controller loader
 * @param {Record<string, object>} [options.controllers] - Initial controller definitions map
 */
function createClientRuntime(options = {}) {
  const rootOption = options.root || options.document;
  const debug =
    options.debugger ||
    (options.debug && typeof options.debug === 'object' && typeof options.debug.getSnapshot === 'function'
      ? options.debug
      : options.debug
        ? getDebugModule().createClientDebugger({
            enabled: true,
            logger: options.debugLogger,
          })
        : NOOP_DEBUGGER);

  const datastar = createDatastarAdapter({
    datastar: options.datastar,
    debug,
  });

  let controllers = null;

  const fragments = createFragmentCoordinator({
    root: rootOption,
    fetch: options.fetch,
    endpoint: options.fragmentEndpoint || DEFAULT_FRAGMENT_ENDPOINT,
    datastar,
    debug,
    staleTime: options.staleTime,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    refetchOnFocus: options.refetchOnFocus,
    refetchOnReconnect: options.refetchOnReconnect,
    refetchOnMount: options.refetchOnMount,
    refetchOnVisit: options.refetchOnVisit,
    refetchInterval: options.refetchInterval,
    refetchIntervalInBackground: options.refetchIntervalInBackground,
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onBeforeNodeRemove(removedEl) {
      if (controllers) {
        controllers.unmountSubtree(removedEl);
      }
    },
    onNodeAdded(addedEl) {
      if (controllers) {
        controllers.mountSubtree(addedEl);
      }
    },
    getPatchHookContext() {
      return controllers ? controllers.getActivePatchHookContext() : null;
    },
    onBeforePatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.notifyBeforePatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
    onAfterPatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
        controllers.notifyAfterPatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
  });

  const apiConfig = {
    fetch: options.fetch,
    baseUrl: options.baseUrl || '',
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onInvalidate: (tags, meta) => fragments.invalidate(tags, meta),
    onRefreshError: options.onRefreshError,
    debug,
  };

  const api = createApiClient(apiConfig);

  let runtime = null;

  const services =
    options.services && typeof options.services.get === 'function' && typeof options.services.register === 'function'
      ? options.services
      : createClientServiceRegistry({
          root: rootOption,
          api,
          debug,
          getRuntime: () => runtime,
          services: options.services,
        });

  controllers = createControllerRuntime({
    root: rootOption,
    datastar,
    fragments,
    debug,
    apiConfig,
    services,
    lazyLoader: options.lazyLoader,
  });

  // Register any initial controllers passed in options
  if (options.controllers && typeof options.controllers === 'object') {
    for (const [name, def] of Object.entries(options.controllers)) {
      controllers.register(name, def);
    }
  }

  let observer = null;

  async function mount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    fragments.syncDomInstances(root);
    const mounted = await controllers.mountSubtree(root);

    if (options.observe && !observer && typeof MutationObserver !== 'undefined' && root) {
      const observeTarget = root.body || root.documentElement || root;
      if (observeTarget && observeTarget.nodeType === 1) {
        observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (let i = 0; i < m.removedNodes.length; i++) {
              const node = m.removedNodes[i];
              if (node.nodeType === 1) {
                controllers.unmountSubtree(node);
              }
            }
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node.nodeType === 1) {
                fragments.syncDomInstances(node);
                controllers.mountSubtree(node);
              }
            }
          }
        });
        observer.observe(observeTarget, { childList: true, subtree: true });
      }
    }

    return mounted;
  }

  function unmount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    if (root) {
      const targetEl = root.documentElement || root;
      controllers.unmountSubtree(targetEl);
    }
  }

  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    controllers.destroyAll();
    if (fragments && typeof fragments.dispose === 'function') {
      fragments.dispose();
    }
    services.dispose();
    if (runtime && runtime.devtool && typeof runtime.devtool.destroy === 'function') {
      try {
        runtime.devtool.destroy();
      } catch (_e) {}
      runtime.devtool = null;
    }
  }

  runtime = {
    api,
    services,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    registerService: (name, def) => services.register(name, def),
    mount,
    unmount,
    destroy,
    dispose: destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    mountDevtool: (opts) => getDevtoolModule().mountDevtool(runtime, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
          services,
          ...formOpts,
        }),
    },
  };

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_CLIENT__ = runtime;
  }

  return runtime;
}

/**
 * Boot the client runtime on DOMContentLoaded (or immediately if ready).
 */
function bootClient(options = {}) {
  const bootRoot = options.root || options.document || (typeof document !== 'undefined' ? document : null);
  if (
    options.hmr !== false &&
    bootRoot &&
    bootRoot.__wBootedClientRuntime &&
    typeof bootRoot.__wBootedClientRuntime.destroy === 'function'
  ) {
    try {
      bootRoot.__wBootedClientRuntime.destroy();
    } catch (_e) {}
  }

  const runtime = createClientRuntime(options);
  if (bootRoot && (typeof bootRoot === 'object' || typeof bootRoot === 'function')) {
    try {
      Object.defineProperty(bootRoot, '__wBootedClientRuntime', {
        value: runtime,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch (_e) {
      bootRoot.__wBootedClientRuntime = runtime;
    }
  }

  const shouldMountDevtools =
    options.devtools === true ||
    (options.devtools !== false &&
      (options.debug ||
        options.dev ||
        (typeof window !== 'undefined' &&
          (window.__WEBSPRESSO_DEVTOOLS_ENABLED__ || window.__WEBSPRESSO_DEV__)) ||
        (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production')));

  if (typeof document !== 'undefined') {
    const onReady = () => {
      runtime.mount();
      if (shouldMountDevtools) {
        runtime.devtool = getDevtoolModule().mountDevtool(runtime, options.devtoolsOptions || {});
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  }
  return runtime;
}

module.exports = {
  // Primary Runtime & Controller API
  defineController,
  deriveControllerNameFromPath,
  createClientRuntime,
  bootClient,
  get createLiteClientRuntime() {
    return getLiteModule().createLiteClientRuntime;
  },
  get bootLiteClient() {
    return getLiteModule().bootLiteClient;
  },
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,

  // Typed API Client & Request Management
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,

  // Native Forms & Payload Coercion
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,

  // Client & Server SSR Fragments + Invalidation
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
  get defineFragment() {
    return getServerFragments().defineFragment;
  },
  get apiResult() {
    return getServerFragments().apiResult;
  },
  get isApiResultEnvelope() {
    return getServerFragments().isApiResultEnvelope;
  },
  get sendApiResult() {
    return getServerFragments().sendApiResult;
  },
  get ensureRequestMemo() {
    return getServerFragments().ensureRequestMemo;
  },
  get validateFragmentInput() {
    return getServerFragments().validateFragmentInput;
  },
  get enforceFragmentAuth() {
    return getServerFragments().enforceFragmentAuth;
  },
  get wrapFragmentRootHtml() {
    return getServerFragments().wrapFragmentRootHtml;
  },
  get executeAndRenderFragment() {
    return getServerFragments().executeAndRenderFragment;
  },
  get attachSsrFragmentHelper() {
    return getServerFragments().attachSsrFragmentHelper;
  },
  get resolvePendingSsrFragments() {
    return getServerFragments().resolvePendingSsrFragments;
  },
  get matchPageEntryByPath() {
    return getServerFragments().matchPageEntryByPath;
  },
  get createFragmentRefreshHandler() {
    return getServerFragments().createFragmentRefreshHandler;
  },

  // Datastar Adapter
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  isArray,
  isNumber,
  randomId,
  uid,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry & DevTools
  get createClientDebugger() {
    return getDebugModule().createClientDebugger;
  },
  get summarizePayloadSafely() {
    return getDebugModule().summarizePayloadSafely;
  },
  get mountDevtool() {
    return getDevtoolModule().mountDevtool;
  },
  get highlightElement() {
    return getDevtoolModule().highlightElement;
  },
  get setupReduxDevToolsBridge() {
    return getDevtoolModule().setupReduxDevToolsBridge;
  },

  // Client Storage & Persistence
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,

  // Client Services & Optional Lazy UI Hosts
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
  createClientHostManager,
};


},
    "../../../core/client": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Behavior Layer (`core/client`)
 *
 * Datastar-powered, SSR-integrated, strongly-typed client behavior runtime.
 * Supports two clean data flows:
 *   1. Server-managed view: SSR HTML + fragment refresh (`fragments` + `invalidate`)
 *   2. Client-managed data: Explicit typed API calls (`api.get`, `api.post`, ...) into controller-local state
 */

const {
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,
} = require('./adapter/datastar');

const {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
} = require('./api');

const {
  defineController,
  deriveControllerNameFromPath,
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,
} = require('./controller');

const {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
} = require('./forms');

const {
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
} = require('./fragments');

const {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
} = require('./storage');

const {
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
} = require('./services');

const {
  createClientHostManager,
} = require('./host');

const { isArray, isNumber, NOOP_DEBUGGER, randomId, uid } = require('./utils');

const NOOP_DEVTOOL_HANDLE = Object.freeze({
  open() {},
  close() {},
  toggle() {},
  refresh() {},
  destroy() {},
});

let _debugMod = null;
function getDebugModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_debugMod) {
      _debugMod = require('./debug');
    }
    return _debugMod;
  }
  return {
    createClientDebugger: () => NOOP_DEBUGGER,
    summarizePayloadSafely: () => null,
  };
}

let _devtoolMod = null;
function getDevtoolModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_devtoolMod) {
      _devtoolMod = require('./devtool');
    }
    return _devtoolMod;
  }
  return {
    mountDevtool: () => NOOP_DEVTOOL_HANDLE,
    highlightElement: () => {},
    setupReduxDevToolsBridge: () => null,
  };
}

let _liteMod = null;
function getLiteModule() {
  if (!_liteMod) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _liteMod = reqFn('./lite');
  }
  return _liteMod;
}

let _serverFragments = null;
function getServerFragments() {
  if (!_serverFragments) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _serverFragments = reqFn('./server-fragments');
  }
  return _serverFragments;
}

/**
 * Create a complete Webspresso Client Runtime instance wiring Datastar, Controllers,
 * Typed API Client, Native Forms, Fragment Coordinator, and Debug Telemetry.
 *
 * @param {object} [options]
 * @param {Document|Element} [options.root] - Root document or container
 * @param {typeof fetch} [options.fetch] - Custom fetch implementation
 * @param {string} [options.baseUrl=''] - Optional API base URL
 * @param {string} [options.fragmentEndpoint='/__webspresso/fragments'] - Fragment refresh URL
 * @param {object} [options.datastar] - Optional `@starfederation/datastar` module
 * @param {boolean} [options.debug=false] - Enable client debug telemetry
 * @param {boolean} [options.observe=false] - Enable MutationObserver for external DOM changes
 * @param {(name: string, el: Element) => Promise<object>} [options.lazyLoader] - Lazy controller loader
 * @param {Record<string, object>} [options.controllers] - Initial controller definitions map
 */
function createClientRuntime(options = {}) {
  const rootOption = options.root || options.document;
  const debug =
    options.debugger ||
    (options.debug && typeof options.debug === 'object' && typeof options.debug.getSnapshot === 'function'
      ? options.debug
      : options.debug
        ? getDebugModule().createClientDebugger({
            enabled: true,
            logger: options.debugLogger,
          })
        : NOOP_DEBUGGER);

  const datastar = createDatastarAdapter({
    datastar: options.datastar,
    debug,
  });

  let controllers = null;

  const fragments = createFragmentCoordinator({
    root: rootOption,
    fetch: options.fetch,
    endpoint: options.fragmentEndpoint || DEFAULT_FRAGMENT_ENDPOINT,
    datastar,
    debug,
    staleTime: options.staleTime,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    refetchOnFocus: options.refetchOnFocus,
    refetchOnReconnect: options.refetchOnReconnect,
    refetchOnMount: options.refetchOnMount,
    refetchOnVisit: options.refetchOnVisit,
    refetchInterval: options.refetchInterval,
    refetchIntervalInBackground: options.refetchIntervalInBackground,
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onBeforeNodeRemove(removedEl) {
      if (controllers) {
        controllers.unmountSubtree(removedEl);
      }
    },
    onNodeAdded(addedEl) {
      if (controllers) {
        controllers.mountSubtree(addedEl);
      }
    },
    getPatchHookContext() {
      return controllers ? controllers.getActivePatchHookContext() : null;
    },
    onBeforePatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.notifyBeforePatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
    onAfterPatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
        controllers.notifyAfterPatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
  });

  const apiConfig = {
    fetch: options.fetch,
    baseUrl: options.baseUrl || '',
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onInvalidate: (tags, meta) => fragments.invalidate(tags, meta),
    onRefreshError: options.onRefreshError,
    debug,
  };

  const api = createApiClient(apiConfig);

  let runtime = null;

  const services =
    options.services && typeof options.services.get === 'function' && typeof options.services.register === 'function'
      ? options.services
      : createClientServiceRegistry({
          root: rootOption,
          api,
          debug,
          getRuntime: () => runtime,
          services: options.services,
        });

  controllers = createControllerRuntime({
    root: rootOption,
    datastar,
    fragments,
    debug,
    apiConfig,
    services,
    lazyLoader: options.lazyLoader,
  });

  // Register any initial controllers passed in options
  if (options.controllers && typeof options.controllers === 'object') {
    for (const [name, def] of Object.entries(options.controllers)) {
      controllers.register(name, def);
    }
  }

  let observer = null;

  async function mount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    fragments.syncDomInstances(root);
    const mounted = await controllers.mountSubtree(root);

    if (options.observe && !observer && typeof MutationObserver !== 'undefined' && root) {
      const observeTarget = root.body || root.documentElement || root;
      if (observeTarget && observeTarget.nodeType === 1) {
        observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (let i = 0; i < m.removedNodes.length; i++) {
              const node = m.removedNodes[i];
              if (node.nodeType === 1) {
                controllers.unmountSubtree(node);
              }
            }
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node.nodeType === 1) {
                fragments.syncDomInstances(node);
                controllers.mountSubtree(node);
              }
            }
          }
        });
        observer.observe(observeTarget, { childList: true, subtree: true });
      }
    }

    return mounted;
  }

  function unmount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    if (root) {
      const targetEl = root.documentElement || root;
      controllers.unmountSubtree(targetEl);
    }
  }

  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    controllers.destroyAll();
    if (fragments && typeof fragments.dispose === 'function') {
      fragments.dispose();
    }
    services.dispose();
    if (runtime && runtime.devtool && typeof runtime.devtool.destroy === 'function') {
      try {
        runtime.devtool.destroy();
      } catch (_e) {}
      runtime.devtool = null;
    }
  }

  runtime = {
    api,
    services,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    registerService: (name, def) => services.register(name, def),
    mount,
    unmount,
    destroy,
    dispose: destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    mountDevtool: (opts) => getDevtoolModule().mountDevtool(runtime, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
          services,
          ...formOpts,
        }),
    },
  };

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_CLIENT__ = runtime;
  }

  return runtime;
}

/**
 * Boot the client runtime on DOMContentLoaded (or immediately if ready).
 */
function bootClient(options = {}) {
  const bootRoot = options.root || options.document || (typeof document !== 'undefined' ? document : null);
  if (
    options.hmr !== false &&
    bootRoot &&
    bootRoot.__wBootedClientRuntime &&
    typeof bootRoot.__wBootedClientRuntime.destroy === 'function'
  ) {
    try {
      bootRoot.__wBootedClientRuntime.destroy();
    } catch (_e) {}
  }

  const runtime = createClientRuntime(options);
  if (bootRoot && (typeof bootRoot === 'object' || typeof bootRoot === 'function')) {
    try {
      Object.defineProperty(bootRoot, '__wBootedClientRuntime', {
        value: runtime,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch (_e) {
      bootRoot.__wBootedClientRuntime = runtime;
    }
  }

  const shouldMountDevtools =
    options.devtools === true ||
    (options.devtools !== false &&
      (options.debug ||
        options.dev ||
        (typeof window !== 'undefined' &&
          (window.__WEBSPRESSO_DEVTOOLS_ENABLED__ || window.__WEBSPRESSO_DEV__)) ||
        (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production')));

  if (typeof document !== 'undefined') {
    const onReady = () => {
      runtime.mount();
      if (shouldMountDevtools) {
        runtime.devtool = getDevtoolModule().mountDevtool(runtime, options.devtoolsOptions || {});
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  }
  return runtime;
}

module.exports = {
  // Primary Runtime & Controller API
  defineController,
  deriveControllerNameFromPath,
  createClientRuntime,
  bootClient,
  get createLiteClientRuntime() {
    return getLiteModule().createLiteClientRuntime;
  },
  get bootLiteClient() {
    return getLiteModule().bootLiteClient;
  },
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,

  // Typed API Client & Request Management
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,

  // Native Forms & Payload Coercion
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,

  // Client & Server SSR Fragments + Invalidation
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
  get defineFragment() {
    return getServerFragments().defineFragment;
  },
  get apiResult() {
    return getServerFragments().apiResult;
  },
  get isApiResultEnvelope() {
    return getServerFragments().isApiResultEnvelope;
  },
  get sendApiResult() {
    return getServerFragments().sendApiResult;
  },
  get ensureRequestMemo() {
    return getServerFragments().ensureRequestMemo;
  },
  get validateFragmentInput() {
    return getServerFragments().validateFragmentInput;
  },
  get enforceFragmentAuth() {
    return getServerFragments().enforceFragmentAuth;
  },
  get wrapFragmentRootHtml() {
    return getServerFragments().wrapFragmentRootHtml;
  },
  get executeAndRenderFragment() {
    return getServerFragments().executeAndRenderFragment;
  },
  get attachSsrFragmentHelper() {
    return getServerFragments().attachSsrFragmentHelper;
  },
  get resolvePendingSsrFragments() {
    return getServerFragments().resolvePendingSsrFragments;
  },
  get matchPageEntryByPath() {
    return getServerFragments().matchPageEntryByPath;
  },
  get createFragmentRefreshHandler() {
    return getServerFragments().createFragmentRefreshHandler;
  },

  // Datastar Adapter
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  isArray,
  isNumber,
  randomId,
  uid,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry & DevTools
  get createClientDebugger() {
    return getDebugModule().createClientDebugger;
  },
  get summarizePayloadSafely() {
    return getDebugModule().summarizePayloadSafely;
  },
  get mountDevtool() {
    return getDevtoolModule().mountDevtool;
  },
  get highlightElement() {
    return getDevtoolModule().highlightElement;
  },
  get setupReduxDevToolsBridge() {
    return getDevtoolModule().setupReduxDevToolsBridge;
  },

  // Client Storage & Persistence
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,

  // Client Services & Optional Lazy UI Hosts
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
  createClientHostManager,
};


},
    "../../index": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Behavior Layer (`core/client`)
 *
 * Datastar-powered, SSR-integrated, strongly-typed client behavior runtime.
 * Supports two clean data flows:
 *   1. Server-managed view: SSR HTML + fragment refresh (`fragments` + `invalidate`)
 *   2. Client-managed data: Explicit typed API calls (`api.get`, `api.post`, ...) into controller-local state
 */

const {
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,
} = require('./adapter/datastar');

const {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
} = require('./api');

const {
  defineController,
  deriveControllerNameFromPath,
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,
} = require('./controller');

const {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
} = require('./forms');

const {
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
} = require('./fragments');

const {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
} = require('./storage');

const {
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
} = require('./services');

const {
  createClientHostManager,
} = require('./host');

const { isArray, isNumber, NOOP_DEBUGGER, randomId, uid } = require('./utils');

const NOOP_DEVTOOL_HANDLE = Object.freeze({
  open() {},
  close() {},
  toggle() {},
  refresh() {},
  destroy() {},
});

let _debugMod = null;
function getDebugModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_debugMod) {
      _debugMod = require('./debug');
    }
    return _debugMod;
  }
  return {
    createClientDebugger: () => NOOP_DEBUGGER,
    summarizePayloadSafely: () => null,
  };
}

let _devtoolMod = null;
function getDevtoolModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_devtoolMod) {
      _devtoolMod = require('./devtool');
    }
    return _devtoolMod;
  }
  return {
    mountDevtool: () => NOOP_DEVTOOL_HANDLE,
    highlightElement: () => {},
    setupReduxDevToolsBridge: () => null,
  };
}

let _liteMod = null;
function getLiteModule() {
  if (!_liteMod) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _liteMod = reqFn('./lite');
  }
  return _liteMod;
}

let _serverFragments = null;
function getServerFragments() {
  if (!_serverFragments) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _serverFragments = reqFn('./server-fragments');
  }
  return _serverFragments;
}

/**
 * Create a complete Webspresso Client Runtime instance wiring Datastar, Controllers,
 * Typed API Client, Native Forms, Fragment Coordinator, and Debug Telemetry.
 *
 * @param {object} [options]
 * @param {Document|Element} [options.root] - Root document or container
 * @param {typeof fetch} [options.fetch] - Custom fetch implementation
 * @param {string} [options.baseUrl=''] - Optional API base URL
 * @param {string} [options.fragmentEndpoint='/__webspresso/fragments'] - Fragment refresh URL
 * @param {object} [options.datastar] - Optional `@starfederation/datastar` module
 * @param {boolean} [options.debug=false] - Enable client debug telemetry
 * @param {boolean} [options.observe=false] - Enable MutationObserver for external DOM changes
 * @param {(name: string, el: Element) => Promise<object>} [options.lazyLoader] - Lazy controller loader
 * @param {Record<string, object>} [options.controllers] - Initial controller definitions map
 */
function createClientRuntime(options = {}) {
  const rootOption = options.root || options.document;
  const debug =
    options.debugger ||
    (options.debug && typeof options.debug === 'object' && typeof options.debug.getSnapshot === 'function'
      ? options.debug
      : options.debug
        ? getDebugModule().createClientDebugger({
            enabled: true,
            logger: options.debugLogger,
          })
        : NOOP_DEBUGGER);

  const datastar = createDatastarAdapter({
    datastar: options.datastar,
    debug,
  });

  let controllers = null;

  const fragments = createFragmentCoordinator({
    root: rootOption,
    fetch: options.fetch,
    endpoint: options.fragmentEndpoint || DEFAULT_FRAGMENT_ENDPOINT,
    datastar,
    debug,
    staleTime: options.staleTime,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    refetchOnFocus: options.refetchOnFocus,
    refetchOnReconnect: options.refetchOnReconnect,
    refetchOnMount: options.refetchOnMount,
    refetchOnVisit: options.refetchOnVisit,
    refetchInterval: options.refetchInterval,
    refetchIntervalInBackground: options.refetchIntervalInBackground,
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onBeforeNodeRemove(removedEl) {
      if (controllers) {
        controllers.unmountSubtree(removedEl);
      }
    },
    onNodeAdded(addedEl) {
      if (controllers) {
        controllers.mountSubtree(addedEl);
      }
    },
    getPatchHookContext() {
      return controllers ? controllers.getActivePatchHookContext() : null;
    },
    onBeforePatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.notifyBeforePatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
    onAfterPatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
        controllers.notifyAfterPatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
  });

  const apiConfig = {
    fetch: options.fetch,
    baseUrl: options.baseUrl || '',
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onInvalidate: (tags, meta) => fragments.invalidate(tags, meta),
    onRefreshError: options.onRefreshError,
    debug,
  };

  const api = createApiClient(apiConfig);

  let runtime = null;

  const services =
    options.services && typeof options.services.get === 'function' && typeof options.services.register === 'function'
      ? options.services
      : createClientServiceRegistry({
          root: rootOption,
          api,
          debug,
          getRuntime: () => runtime,
          services: options.services,
        });

  controllers = createControllerRuntime({
    root: rootOption,
    datastar,
    fragments,
    debug,
    apiConfig,
    services,
    lazyLoader: options.lazyLoader,
  });

  // Register any initial controllers passed in options
  if (options.controllers && typeof options.controllers === 'object') {
    for (const [name, def] of Object.entries(options.controllers)) {
      controllers.register(name, def);
    }
  }

  let observer = null;

  async function mount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    fragments.syncDomInstances(root);
    const mounted = await controllers.mountSubtree(root);

    if (options.observe && !observer && typeof MutationObserver !== 'undefined' && root) {
      const observeTarget = root.body || root.documentElement || root;
      if (observeTarget && observeTarget.nodeType === 1) {
        observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (let i = 0; i < m.removedNodes.length; i++) {
              const node = m.removedNodes[i];
              if (node.nodeType === 1) {
                controllers.unmountSubtree(node);
              }
            }
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node.nodeType === 1) {
                fragments.syncDomInstances(node);
                controllers.mountSubtree(node);
              }
            }
          }
        });
        observer.observe(observeTarget, { childList: true, subtree: true });
      }
    }

    return mounted;
  }

  function unmount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    if (root) {
      const targetEl = root.documentElement || root;
      controllers.unmountSubtree(targetEl);
    }
  }

  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    controllers.destroyAll();
    if (fragments && typeof fragments.dispose === 'function') {
      fragments.dispose();
    }
    services.dispose();
    if (runtime && runtime.devtool && typeof runtime.devtool.destroy === 'function') {
      try {
        runtime.devtool.destroy();
      } catch (_e) {}
      runtime.devtool = null;
    }
  }

  runtime = {
    api,
    services,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    registerService: (name, def) => services.register(name, def),
    mount,
    unmount,
    destroy,
    dispose: destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    mountDevtool: (opts) => getDevtoolModule().mountDevtool(runtime, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
          services,
          ...formOpts,
        }),
    },
  };

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_CLIENT__ = runtime;
  }

  return runtime;
}

/**
 * Boot the client runtime on DOMContentLoaded (or immediately if ready).
 */
function bootClient(options = {}) {
  const bootRoot = options.root || options.document || (typeof document !== 'undefined' ? document : null);
  if (
    options.hmr !== false &&
    bootRoot &&
    bootRoot.__wBootedClientRuntime &&
    typeof bootRoot.__wBootedClientRuntime.destroy === 'function'
  ) {
    try {
      bootRoot.__wBootedClientRuntime.destroy();
    } catch (_e) {}
  }

  const runtime = createClientRuntime(options);
  if (bootRoot && (typeof bootRoot === 'object' || typeof bootRoot === 'function')) {
    try {
      Object.defineProperty(bootRoot, '__wBootedClientRuntime', {
        value: runtime,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch (_e) {
      bootRoot.__wBootedClientRuntime = runtime;
    }
  }

  const shouldMountDevtools =
    options.devtools === true ||
    (options.devtools !== false &&
      (options.debug ||
        options.dev ||
        (typeof window !== 'undefined' &&
          (window.__WEBSPRESSO_DEVTOOLS_ENABLED__ || window.__WEBSPRESSO_DEV__)) ||
        (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production')));

  if (typeof document !== 'undefined') {
    const onReady = () => {
      runtime.mount();
      if (shouldMountDevtools) {
        runtime.devtool = getDevtoolModule().mountDevtool(runtime, options.devtoolsOptions || {});
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  }
  return runtime;
}

module.exports = {
  // Primary Runtime & Controller API
  defineController,
  deriveControllerNameFromPath,
  createClientRuntime,
  bootClient,
  get createLiteClientRuntime() {
    return getLiteModule().createLiteClientRuntime;
  },
  get bootLiteClient() {
    return getLiteModule().bootLiteClient;
  },
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,

  // Typed API Client & Request Management
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,

  // Native Forms & Payload Coercion
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,

  // Client & Server SSR Fragments + Invalidation
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
  get defineFragment() {
    return getServerFragments().defineFragment;
  },
  get apiResult() {
    return getServerFragments().apiResult;
  },
  get isApiResultEnvelope() {
    return getServerFragments().isApiResultEnvelope;
  },
  get sendApiResult() {
    return getServerFragments().sendApiResult;
  },
  get ensureRequestMemo() {
    return getServerFragments().ensureRequestMemo;
  },
  get validateFragmentInput() {
    return getServerFragments().validateFragmentInput;
  },
  get enforceFragmentAuth() {
    return getServerFragments().enforceFragmentAuth;
  },
  get wrapFragmentRootHtml() {
    return getServerFragments().wrapFragmentRootHtml;
  },
  get executeAndRenderFragment() {
    return getServerFragments().executeAndRenderFragment;
  },
  get attachSsrFragmentHelper() {
    return getServerFragments().attachSsrFragmentHelper;
  },
  get resolvePendingSsrFragments() {
    return getServerFragments().resolvePendingSsrFragments;
  },
  get matchPageEntryByPath() {
    return getServerFragments().matchPageEntryByPath;
  },
  get createFragmentRefreshHandler() {
    return getServerFragments().createFragmentRefreshHandler;
  },

  // Datastar Adapter
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  isArray,
  isNumber,
  randomId,
  uid,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry & DevTools
  get createClientDebugger() {
    return getDebugModule().createClientDebugger;
  },
  get summarizePayloadSafely() {
    return getDebugModule().summarizePayloadSafely;
  },
  get mountDevtool() {
    return getDevtoolModule().mountDevtool;
  },
  get highlightElement() {
    return getDevtoolModule().highlightElement;
  },
  get setupReduxDevToolsBridge() {
    return getDevtoolModule().setupReduxDevToolsBridge;
  },

  // Client Storage & Persistence
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,

  // Client Services & Optional Lazy UI Hosts
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
  createClientHostManager,
};


},
    "../../../index": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Behavior Layer (`core/client`)
 *
 * Datastar-powered, SSR-integrated, strongly-typed client behavior runtime.
 * Supports two clean data flows:
 *   1. Server-managed view: SSR HTML + fragment refresh (`fragments` + `invalidate`)
 *   2. Client-managed data: Explicit typed API calls (`api.get`, `api.post`, ...) into controller-local state
 */

const {
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,
} = require('./adapter/datastar');

const {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
} = require('./api');

const {
  defineController,
  deriveControllerNameFromPath,
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,
} = require('./controller');

const {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
} = require('./forms');

const {
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
} = require('./fragments');

const {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
} = require('./storage');

const {
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
} = require('./services');

const {
  createClientHostManager,
} = require('./host');

const { isArray, isNumber, NOOP_DEBUGGER, randomId, uid } = require('./utils');

const NOOP_DEVTOOL_HANDLE = Object.freeze({
  open() {},
  close() {},
  toggle() {},
  refresh() {},
  destroy() {},
});

let _debugMod = null;
function getDebugModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_debugMod) {
      _debugMod = require('./debug');
    }
    return _debugMod;
  }
  return {
    createClientDebugger: () => NOOP_DEBUGGER,
    summarizePayloadSafely: () => null,
  };
}

let _devtoolMod = null;
function getDevtoolModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_devtoolMod) {
      _devtoolMod = require('./devtool');
    }
    return _devtoolMod;
  }
  return {
    mountDevtool: () => NOOP_DEVTOOL_HANDLE,
    highlightElement: () => {},
    setupReduxDevToolsBridge: () => null,
  };
}

let _liteMod = null;
function getLiteModule() {
  if (!_liteMod) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _liteMod = reqFn('./lite');
  }
  return _liteMod;
}

let _serverFragments = null;
function getServerFragments() {
  if (!_serverFragments) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _serverFragments = reqFn('./server-fragments');
  }
  return _serverFragments;
}

/**
 * Create a complete Webspresso Client Runtime instance wiring Datastar, Controllers,
 * Typed API Client, Native Forms, Fragment Coordinator, and Debug Telemetry.
 *
 * @param {object} [options]
 * @param {Document|Element} [options.root] - Root document or container
 * @param {typeof fetch} [options.fetch] - Custom fetch implementation
 * @param {string} [options.baseUrl=''] - Optional API base URL
 * @param {string} [options.fragmentEndpoint='/__webspresso/fragments'] - Fragment refresh URL
 * @param {object} [options.datastar] - Optional `@starfederation/datastar` module
 * @param {boolean} [options.debug=false] - Enable client debug telemetry
 * @param {boolean} [options.observe=false] - Enable MutationObserver for external DOM changes
 * @param {(name: string, el: Element) => Promise<object>} [options.lazyLoader] - Lazy controller loader
 * @param {Record<string, object>} [options.controllers] - Initial controller definitions map
 */
function createClientRuntime(options = {}) {
  const rootOption = options.root || options.document;
  const debug =
    options.debugger ||
    (options.debug && typeof options.debug === 'object' && typeof options.debug.getSnapshot === 'function'
      ? options.debug
      : options.debug
        ? getDebugModule().createClientDebugger({
            enabled: true,
            logger: options.debugLogger,
          })
        : NOOP_DEBUGGER);

  const datastar = createDatastarAdapter({
    datastar: options.datastar,
    debug,
  });

  let controllers = null;

  const fragments = createFragmentCoordinator({
    root: rootOption,
    fetch: options.fetch,
    endpoint: options.fragmentEndpoint || DEFAULT_FRAGMENT_ENDPOINT,
    datastar,
    debug,
    staleTime: options.staleTime,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    refetchOnFocus: options.refetchOnFocus,
    refetchOnReconnect: options.refetchOnReconnect,
    refetchOnMount: options.refetchOnMount,
    refetchOnVisit: options.refetchOnVisit,
    refetchInterval: options.refetchInterval,
    refetchIntervalInBackground: options.refetchIntervalInBackground,
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onBeforeNodeRemove(removedEl) {
      if (controllers) {
        controllers.unmountSubtree(removedEl);
      }
    },
    onNodeAdded(addedEl) {
      if (controllers) {
        controllers.mountSubtree(addedEl);
      }
    },
    getPatchHookContext() {
      return controllers ? controllers.getActivePatchHookContext() : null;
    },
    onBeforePatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.notifyBeforePatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
    onAfterPatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
        controllers.notifyAfterPatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
  });

  const apiConfig = {
    fetch: options.fetch,
    baseUrl: options.baseUrl || '',
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onInvalidate: (tags, meta) => fragments.invalidate(tags, meta),
    onRefreshError: options.onRefreshError,
    debug,
  };

  const api = createApiClient(apiConfig);

  let runtime = null;

  const services =
    options.services && typeof options.services.get === 'function' && typeof options.services.register === 'function'
      ? options.services
      : createClientServiceRegistry({
          root: rootOption,
          api,
          debug,
          getRuntime: () => runtime,
          services: options.services,
        });

  controllers = createControllerRuntime({
    root: rootOption,
    datastar,
    fragments,
    debug,
    apiConfig,
    services,
    lazyLoader: options.lazyLoader,
  });

  // Register any initial controllers passed in options
  if (options.controllers && typeof options.controllers === 'object') {
    for (const [name, def] of Object.entries(options.controllers)) {
      controllers.register(name, def);
    }
  }

  let observer = null;

  async function mount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    fragments.syncDomInstances(root);
    const mounted = await controllers.mountSubtree(root);

    if (options.observe && !observer && typeof MutationObserver !== 'undefined' && root) {
      const observeTarget = root.body || root.documentElement || root;
      if (observeTarget && observeTarget.nodeType === 1) {
        observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (let i = 0; i < m.removedNodes.length; i++) {
              const node = m.removedNodes[i];
              if (node.nodeType === 1) {
                controllers.unmountSubtree(node);
              }
            }
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node.nodeType === 1) {
                fragments.syncDomInstances(node);
                controllers.mountSubtree(node);
              }
            }
          }
        });
        observer.observe(observeTarget, { childList: true, subtree: true });
      }
    }

    return mounted;
  }

  function unmount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    if (root) {
      const targetEl = root.documentElement || root;
      controllers.unmountSubtree(targetEl);
    }
  }

  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    controllers.destroyAll();
    if (fragments && typeof fragments.dispose === 'function') {
      fragments.dispose();
    }
    services.dispose();
    if (runtime && runtime.devtool && typeof runtime.devtool.destroy === 'function') {
      try {
        runtime.devtool.destroy();
      } catch (_e) {}
      runtime.devtool = null;
    }
  }

  runtime = {
    api,
    services,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    registerService: (name, def) => services.register(name, def),
    mount,
    unmount,
    destroy,
    dispose: destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    mountDevtool: (opts) => getDevtoolModule().mountDevtool(runtime, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
          services,
          ...formOpts,
        }),
    },
  };

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_CLIENT__ = runtime;
  }

  return runtime;
}

/**
 * Boot the client runtime on DOMContentLoaded (or immediately if ready).
 */
function bootClient(options = {}) {
  const bootRoot = options.root || options.document || (typeof document !== 'undefined' ? document : null);
  if (
    options.hmr !== false &&
    bootRoot &&
    bootRoot.__wBootedClientRuntime &&
    typeof bootRoot.__wBootedClientRuntime.destroy === 'function'
  ) {
    try {
      bootRoot.__wBootedClientRuntime.destroy();
    } catch (_e) {}
  }

  const runtime = createClientRuntime(options);
  if (bootRoot && (typeof bootRoot === 'object' || typeof bootRoot === 'function')) {
    try {
      Object.defineProperty(bootRoot, '__wBootedClientRuntime', {
        value: runtime,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch (_e) {
      bootRoot.__wBootedClientRuntime = runtime;
    }
  }

  const shouldMountDevtools =
    options.devtools === true ||
    (options.devtools !== false &&
      (options.debug ||
        options.dev ||
        (typeof window !== 'undefined' &&
          (window.__WEBSPRESSO_DEVTOOLS_ENABLED__ || window.__WEBSPRESSO_DEV__)) ||
        (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production')));

  if (typeof document !== 'undefined') {
    const onReady = () => {
      runtime.mount();
      if (shouldMountDevtools) {
        runtime.devtool = getDevtoolModule().mountDevtool(runtime, options.devtoolsOptions || {});
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  }
  return runtime;
}

module.exports = {
  // Primary Runtime & Controller API
  defineController,
  deriveControllerNameFromPath,
  createClientRuntime,
  bootClient,
  get createLiteClientRuntime() {
    return getLiteModule().createLiteClientRuntime;
  },
  get bootLiteClient() {
    return getLiteModule().bootLiteClient;
  },
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,

  // Typed API Client & Request Management
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,

  // Native Forms & Payload Coercion
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,

  // Client & Server SSR Fragments + Invalidation
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
  get defineFragment() {
    return getServerFragments().defineFragment;
  },
  get apiResult() {
    return getServerFragments().apiResult;
  },
  get isApiResultEnvelope() {
    return getServerFragments().isApiResultEnvelope;
  },
  get sendApiResult() {
    return getServerFragments().sendApiResult;
  },
  get ensureRequestMemo() {
    return getServerFragments().ensureRequestMemo;
  },
  get validateFragmentInput() {
    return getServerFragments().validateFragmentInput;
  },
  get enforceFragmentAuth() {
    return getServerFragments().enforceFragmentAuth;
  },
  get wrapFragmentRootHtml() {
    return getServerFragments().wrapFragmentRootHtml;
  },
  get executeAndRenderFragment() {
    return getServerFragments().executeAndRenderFragment;
  },
  get attachSsrFragmentHelper() {
    return getServerFragments().attachSsrFragmentHelper;
  },
  get resolvePendingSsrFragments() {
    return getServerFragments().resolvePendingSsrFragments;
  },
  get matchPageEntryByPath() {
    return getServerFragments().matchPageEntryByPath;
  },
  get createFragmentRefreshHandler() {
    return getServerFragments().createFragmentRefreshHandler;
  },

  // Datastar Adapter
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  isArray,
  isNumber,
  randomId,
  uid,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry & DevTools
  get createClientDebugger() {
    return getDebugModule().createClientDebugger;
  },
  get summarizePayloadSafely() {
    return getDebugModule().summarizePayloadSafely;
  },
  get mountDevtool() {
    return getDevtoolModule().mountDevtool;
  },
  get highlightElement() {
    return getDevtoolModule().highlightElement;
  },
  get setupReduxDevToolsBridge() {
    return getDevtoolModule().setupReduxDevToolsBridge;
  },

  // Client Storage & Persistence
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,

  // Client Services & Optional Lazy UI Hosts
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
  createClientHostManager,
};


},
    "webspresso/core/client": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Behavior Layer (`core/client`)
 *
 * Datastar-powered, SSR-integrated, strongly-typed client behavior runtime.
 * Supports two clean data flows:
 *   1. Server-managed view: SSR HTML + fragment refresh (`fragments` + `invalidate`)
 *   2. Client-managed data: Explicit typed API calls (`api.get`, `api.post`, ...) into controller-local state
 */

const {
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,
} = require('./adapter/datastar');

const {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
} = require('./api');

const {
  defineController,
  deriveControllerNameFromPath,
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,
} = require('./controller');

const {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
} = require('./forms');

const {
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
} = require('./fragments');

const {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
} = require('./storage');

const {
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
} = require('./services');

const {
  createClientHostManager,
} = require('./host');

const { isArray, isNumber, NOOP_DEBUGGER, randomId, uid } = require('./utils');

const NOOP_DEVTOOL_HANDLE = Object.freeze({
  open() {},
  close() {},
  toggle() {},
  refresh() {},
  destroy() {},
});

let _debugMod = null;
function getDebugModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_debugMod) {
      _debugMod = require('./debug');
    }
    return _debugMod;
  }
  return {
    createClientDebugger: () => NOOP_DEBUGGER,
    summarizePayloadSafely: () => null,
  };
}

let _devtoolMod = null;
function getDevtoolModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_devtoolMod) {
      _devtoolMod = require('./devtool');
    }
    return _devtoolMod;
  }
  return {
    mountDevtool: () => NOOP_DEVTOOL_HANDLE,
    highlightElement: () => {},
    setupReduxDevToolsBridge: () => null,
  };
}

let _liteMod = null;
function getLiteModule() {
  if (!_liteMod) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _liteMod = reqFn('./lite');
  }
  return _liteMod;
}

let _serverFragments = null;
function getServerFragments() {
  if (!_serverFragments) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _serverFragments = reqFn('./server-fragments');
  }
  return _serverFragments;
}

/**
 * Create a complete Webspresso Client Runtime instance wiring Datastar, Controllers,
 * Typed API Client, Native Forms, Fragment Coordinator, and Debug Telemetry.
 *
 * @param {object} [options]
 * @param {Document|Element} [options.root] - Root document or container
 * @param {typeof fetch} [options.fetch] - Custom fetch implementation
 * @param {string} [options.baseUrl=''] - Optional API base URL
 * @param {string} [options.fragmentEndpoint='/__webspresso/fragments'] - Fragment refresh URL
 * @param {object} [options.datastar] - Optional `@starfederation/datastar` module
 * @param {boolean} [options.debug=false] - Enable client debug telemetry
 * @param {boolean} [options.observe=false] - Enable MutationObserver for external DOM changes
 * @param {(name: string, el: Element) => Promise<object>} [options.lazyLoader] - Lazy controller loader
 * @param {Record<string, object>} [options.controllers] - Initial controller definitions map
 */
function createClientRuntime(options = {}) {
  const rootOption = options.root || options.document;
  const debug =
    options.debugger ||
    (options.debug && typeof options.debug === 'object' && typeof options.debug.getSnapshot === 'function'
      ? options.debug
      : options.debug
        ? getDebugModule().createClientDebugger({
            enabled: true,
            logger: options.debugLogger,
          })
        : NOOP_DEBUGGER);

  const datastar = createDatastarAdapter({
    datastar: options.datastar,
    debug,
  });

  let controllers = null;

  const fragments = createFragmentCoordinator({
    root: rootOption,
    fetch: options.fetch,
    endpoint: options.fragmentEndpoint || DEFAULT_FRAGMENT_ENDPOINT,
    datastar,
    debug,
    staleTime: options.staleTime,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    refetchOnFocus: options.refetchOnFocus,
    refetchOnReconnect: options.refetchOnReconnect,
    refetchOnMount: options.refetchOnMount,
    refetchOnVisit: options.refetchOnVisit,
    refetchInterval: options.refetchInterval,
    refetchIntervalInBackground: options.refetchIntervalInBackground,
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onBeforeNodeRemove(removedEl) {
      if (controllers) {
        controllers.unmountSubtree(removedEl);
      }
    },
    onNodeAdded(addedEl) {
      if (controllers) {
        controllers.mountSubtree(addedEl);
      }
    },
    getPatchHookContext() {
      return controllers ? controllers.getActivePatchHookContext() : null;
    },
    onBeforePatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.notifyBeforePatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
    onAfterPatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
        controllers.notifyAfterPatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
  });

  const apiConfig = {
    fetch: options.fetch,
    baseUrl: options.baseUrl || '',
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onInvalidate: (tags, meta) => fragments.invalidate(tags, meta),
    onRefreshError: options.onRefreshError,
    debug,
  };

  const api = createApiClient(apiConfig);

  let runtime = null;

  const services =
    options.services && typeof options.services.get === 'function' && typeof options.services.register === 'function'
      ? options.services
      : createClientServiceRegistry({
          root: rootOption,
          api,
          debug,
          getRuntime: () => runtime,
          services: options.services,
        });

  controllers = createControllerRuntime({
    root: rootOption,
    datastar,
    fragments,
    debug,
    apiConfig,
    services,
    lazyLoader: options.lazyLoader,
  });

  // Register any initial controllers passed in options
  if (options.controllers && typeof options.controllers === 'object') {
    for (const [name, def] of Object.entries(options.controllers)) {
      controllers.register(name, def);
    }
  }

  let observer = null;

  async function mount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    fragments.syncDomInstances(root);
    const mounted = await controllers.mountSubtree(root);

    if (options.observe && !observer && typeof MutationObserver !== 'undefined' && root) {
      const observeTarget = root.body || root.documentElement || root;
      if (observeTarget && observeTarget.nodeType === 1) {
        observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (let i = 0; i < m.removedNodes.length; i++) {
              const node = m.removedNodes[i];
              if (node.nodeType === 1) {
                controllers.unmountSubtree(node);
              }
            }
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node.nodeType === 1) {
                fragments.syncDomInstances(node);
                controllers.mountSubtree(node);
              }
            }
          }
        });
        observer.observe(observeTarget, { childList: true, subtree: true });
      }
    }

    return mounted;
  }

  function unmount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    if (root) {
      const targetEl = root.documentElement || root;
      controllers.unmountSubtree(targetEl);
    }
  }

  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    controllers.destroyAll();
    if (fragments && typeof fragments.dispose === 'function') {
      fragments.dispose();
    }
    services.dispose();
    if (runtime && runtime.devtool && typeof runtime.devtool.destroy === 'function') {
      try {
        runtime.devtool.destroy();
      } catch (_e) {}
      runtime.devtool = null;
    }
  }

  runtime = {
    api,
    services,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    registerService: (name, def) => services.register(name, def),
    mount,
    unmount,
    destroy,
    dispose: destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    mountDevtool: (opts) => getDevtoolModule().mountDevtool(runtime, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
          services,
          ...formOpts,
        }),
    },
  };

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_CLIENT__ = runtime;
  }

  return runtime;
}

/**
 * Boot the client runtime on DOMContentLoaded (or immediately if ready).
 */
function bootClient(options = {}) {
  const bootRoot = options.root || options.document || (typeof document !== 'undefined' ? document : null);
  if (
    options.hmr !== false &&
    bootRoot &&
    bootRoot.__wBootedClientRuntime &&
    typeof bootRoot.__wBootedClientRuntime.destroy === 'function'
  ) {
    try {
      bootRoot.__wBootedClientRuntime.destroy();
    } catch (_e) {}
  }

  const runtime = createClientRuntime(options);
  if (bootRoot && (typeof bootRoot === 'object' || typeof bootRoot === 'function')) {
    try {
      Object.defineProperty(bootRoot, '__wBootedClientRuntime', {
        value: runtime,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch (_e) {
      bootRoot.__wBootedClientRuntime = runtime;
    }
  }

  const shouldMountDevtools =
    options.devtools === true ||
    (options.devtools !== false &&
      (options.debug ||
        options.dev ||
        (typeof window !== 'undefined' &&
          (window.__WEBSPRESSO_DEVTOOLS_ENABLED__ || window.__WEBSPRESSO_DEV__)) ||
        (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production')));

  if (typeof document !== 'undefined') {
    const onReady = () => {
      runtime.mount();
      if (shouldMountDevtools) {
        runtime.devtool = getDevtoolModule().mountDevtool(runtime, options.devtoolsOptions || {});
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  }
  return runtime;
}

module.exports = {
  // Primary Runtime & Controller API
  defineController,
  deriveControllerNameFromPath,
  createClientRuntime,
  bootClient,
  get createLiteClientRuntime() {
    return getLiteModule().createLiteClientRuntime;
  },
  get bootLiteClient() {
    return getLiteModule().bootLiteClient;
  },
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,

  // Typed API Client & Request Management
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,

  // Native Forms & Payload Coercion
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,

  // Client & Server SSR Fragments + Invalidation
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
  get defineFragment() {
    return getServerFragments().defineFragment;
  },
  get apiResult() {
    return getServerFragments().apiResult;
  },
  get isApiResultEnvelope() {
    return getServerFragments().isApiResultEnvelope;
  },
  get sendApiResult() {
    return getServerFragments().sendApiResult;
  },
  get ensureRequestMemo() {
    return getServerFragments().ensureRequestMemo;
  },
  get validateFragmentInput() {
    return getServerFragments().validateFragmentInput;
  },
  get enforceFragmentAuth() {
    return getServerFragments().enforceFragmentAuth;
  },
  get wrapFragmentRootHtml() {
    return getServerFragments().wrapFragmentRootHtml;
  },
  get executeAndRenderFragment() {
    return getServerFragments().executeAndRenderFragment;
  },
  get attachSsrFragmentHelper() {
    return getServerFragments().attachSsrFragmentHelper;
  },
  get resolvePendingSsrFragments() {
    return getServerFragments().resolvePendingSsrFragments;
  },
  get matchPageEntryByPath() {
    return getServerFragments().matchPageEntryByPath;
  },
  get createFragmentRefreshHandler() {
    return getServerFragments().createFragmentRefreshHandler;
  },

  // Datastar Adapter
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  isArray,
  isNumber,
  randomId,
  uid,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry & DevTools
  get createClientDebugger() {
    return getDebugModule().createClientDebugger;
  },
  get summarizePayloadSafely() {
    return getDebugModule().summarizePayloadSafely;
  },
  get mountDevtool() {
    return getDevtoolModule().mountDevtool;
  },
  get highlightElement() {
    return getDevtoolModule().highlightElement;
  },
  get setupReduxDevToolsBridge() {
    return getDevtoolModule().setupReduxDevToolsBridge;
  },

  // Client Storage & Persistence
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,

  // Client Services & Optional Lazy UI Hosts
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
  createClientHostManager,
};


},
    "webspresso/client": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Behavior Layer (`core/client`)
 *
 * Datastar-powered, SSR-integrated, strongly-typed client behavior runtime.
 * Supports two clean data flows:
 *   1. Server-managed view: SSR HTML + fragment refresh (`fragments` + `invalidate`)
 *   2. Client-managed data: Explicit typed API calls (`api.get`, `api.post`, ...) into controller-local state
 */

const {
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,
} = require('./adapter/datastar');

const {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
} = require('./api');

const {
  defineController,
  deriveControllerNameFromPath,
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,
} = require('./controller');

const {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
} = require('./forms');

const {
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
} = require('./fragments');

const {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
} = require('./storage');

const {
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
} = require('./services');

const {
  createClientHostManager,
} = require('./host');

const { isArray, isNumber, NOOP_DEBUGGER, randomId, uid } = require('./utils');

const NOOP_DEVTOOL_HANDLE = Object.freeze({
  open() {},
  close() {},
  toggle() {},
  refresh() {},
  destroy() {},
});

let _debugMod = null;
function getDebugModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_debugMod) {
      _debugMod = require('./debug');
    }
    return _debugMod;
  }
  return {
    createClientDebugger: () => NOOP_DEBUGGER,
    summarizePayloadSafely: () => null,
  };
}

let _devtoolMod = null;
function getDevtoolModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_devtoolMod) {
      _devtoolMod = require('./devtool');
    }
    return _devtoolMod;
  }
  return {
    mountDevtool: () => NOOP_DEVTOOL_HANDLE,
    highlightElement: () => {},
    setupReduxDevToolsBridge: () => null,
  };
}

let _liteMod = null;
function getLiteModule() {
  if (!_liteMod) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _liteMod = reqFn('./lite');
  }
  return _liteMod;
}

let _serverFragments = null;
function getServerFragments() {
  if (!_serverFragments) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _serverFragments = reqFn('./server-fragments');
  }
  return _serverFragments;
}

/**
 * Create a complete Webspresso Client Runtime instance wiring Datastar, Controllers,
 * Typed API Client, Native Forms, Fragment Coordinator, and Debug Telemetry.
 *
 * @param {object} [options]
 * @param {Document|Element} [options.root] - Root document or container
 * @param {typeof fetch} [options.fetch] - Custom fetch implementation
 * @param {string} [options.baseUrl=''] - Optional API base URL
 * @param {string} [options.fragmentEndpoint='/__webspresso/fragments'] - Fragment refresh URL
 * @param {object} [options.datastar] - Optional `@starfederation/datastar` module
 * @param {boolean} [options.debug=false] - Enable client debug telemetry
 * @param {boolean} [options.observe=false] - Enable MutationObserver for external DOM changes
 * @param {(name: string, el: Element) => Promise<object>} [options.lazyLoader] - Lazy controller loader
 * @param {Record<string, object>} [options.controllers] - Initial controller definitions map
 */
function createClientRuntime(options = {}) {
  const rootOption = options.root || options.document;
  const debug =
    options.debugger ||
    (options.debug && typeof options.debug === 'object' && typeof options.debug.getSnapshot === 'function'
      ? options.debug
      : options.debug
        ? getDebugModule().createClientDebugger({
            enabled: true,
            logger: options.debugLogger,
          })
        : NOOP_DEBUGGER);

  const datastar = createDatastarAdapter({
    datastar: options.datastar,
    debug,
  });

  let controllers = null;

  const fragments = createFragmentCoordinator({
    root: rootOption,
    fetch: options.fetch,
    endpoint: options.fragmentEndpoint || DEFAULT_FRAGMENT_ENDPOINT,
    datastar,
    debug,
    staleTime: options.staleTime,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    refetchOnFocus: options.refetchOnFocus,
    refetchOnReconnect: options.refetchOnReconnect,
    refetchOnMount: options.refetchOnMount,
    refetchOnVisit: options.refetchOnVisit,
    refetchInterval: options.refetchInterval,
    refetchIntervalInBackground: options.refetchIntervalInBackground,
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onBeforeNodeRemove(removedEl) {
      if (controllers) {
        controllers.unmountSubtree(removedEl);
      }
    },
    onNodeAdded(addedEl) {
      if (controllers) {
        controllers.mountSubtree(addedEl);
      }
    },
    getPatchHookContext() {
      return controllers ? controllers.getActivePatchHookContext() : null;
    },
    onBeforePatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.notifyBeforePatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
    onAfterPatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
        controllers.notifyAfterPatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
  });

  const apiConfig = {
    fetch: options.fetch,
    baseUrl: options.baseUrl || '',
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onInvalidate: (tags, meta) => fragments.invalidate(tags, meta),
    onRefreshError: options.onRefreshError,
    debug,
  };

  const api = createApiClient(apiConfig);

  let runtime = null;

  const services =
    options.services && typeof options.services.get === 'function' && typeof options.services.register === 'function'
      ? options.services
      : createClientServiceRegistry({
          root: rootOption,
          api,
          debug,
          getRuntime: () => runtime,
          services: options.services,
        });

  controllers = createControllerRuntime({
    root: rootOption,
    datastar,
    fragments,
    debug,
    apiConfig,
    services,
    lazyLoader: options.lazyLoader,
  });

  // Register any initial controllers passed in options
  if (options.controllers && typeof options.controllers === 'object') {
    for (const [name, def] of Object.entries(options.controllers)) {
      controllers.register(name, def);
    }
  }

  let observer = null;

  async function mount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    fragments.syncDomInstances(root);
    const mounted = await controllers.mountSubtree(root);

    if (options.observe && !observer && typeof MutationObserver !== 'undefined' && root) {
      const observeTarget = root.body || root.documentElement || root;
      if (observeTarget && observeTarget.nodeType === 1) {
        observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (let i = 0; i < m.removedNodes.length; i++) {
              const node = m.removedNodes[i];
              if (node.nodeType === 1) {
                controllers.unmountSubtree(node);
              }
            }
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node.nodeType === 1) {
                fragments.syncDomInstances(node);
                controllers.mountSubtree(node);
              }
            }
          }
        });
        observer.observe(observeTarget, { childList: true, subtree: true });
      }
    }

    return mounted;
  }

  function unmount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    if (root) {
      const targetEl = root.documentElement || root;
      controllers.unmountSubtree(targetEl);
    }
  }

  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    controllers.destroyAll();
    if (fragments && typeof fragments.dispose === 'function') {
      fragments.dispose();
    }
    services.dispose();
    if (runtime && runtime.devtool && typeof runtime.devtool.destroy === 'function') {
      try {
        runtime.devtool.destroy();
      } catch (_e) {}
      runtime.devtool = null;
    }
  }

  runtime = {
    api,
    services,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    registerService: (name, def) => services.register(name, def),
    mount,
    unmount,
    destroy,
    dispose: destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    mountDevtool: (opts) => getDevtoolModule().mountDevtool(runtime, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
          services,
          ...formOpts,
        }),
    },
  };

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_CLIENT__ = runtime;
  }

  return runtime;
}

/**
 * Boot the client runtime on DOMContentLoaded (or immediately if ready).
 */
function bootClient(options = {}) {
  const bootRoot = options.root || options.document || (typeof document !== 'undefined' ? document : null);
  if (
    options.hmr !== false &&
    bootRoot &&
    bootRoot.__wBootedClientRuntime &&
    typeof bootRoot.__wBootedClientRuntime.destroy === 'function'
  ) {
    try {
      bootRoot.__wBootedClientRuntime.destroy();
    } catch (_e) {}
  }

  const runtime = createClientRuntime(options);
  if (bootRoot && (typeof bootRoot === 'object' || typeof bootRoot === 'function')) {
    try {
      Object.defineProperty(bootRoot, '__wBootedClientRuntime', {
        value: runtime,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch (_e) {
      bootRoot.__wBootedClientRuntime = runtime;
    }
  }

  const shouldMountDevtools =
    options.devtools === true ||
    (options.devtools !== false &&
      (options.debug ||
        options.dev ||
        (typeof window !== 'undefined' &&
          (window.__WEBSPRESSO_DEVTOOLS_ENABLED__ || window.__WEBSPRESSO_DEV__)) ||
        (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production')));

  if (typeof document !== 'undefined') {
    const onReady = () => {
      runtime.mount();
      if (shouldMountDevtools) {
        runtime.devtool = getDevtoolModule().mountDevtool(runtime, options.devtoolsOptions || {});
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  }
  return runtime;
}

module.exports = {
  // Primary Runtime & Controller API
  defineController,
  deriveControllerNameFromPath,
  createClientRuntime,
  bootClient,
  get createLiteClientRuntime() {
    return getLiteModule().createLiteClientRuntime;
  },
  get bootLiteClient() {
    return getLiteModule().bootLiteClient;
  },
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,

  // Typed API Client & Request Management
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,

  // Native Forms & Payload Coercion
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,

  // Client & Server SSR Fragments + Invalidation
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
  get defineFragment() {
    return getServerFragments().defineFragment;
  },
  get apiResult() {
    return getServerFragments().apiResult;
  },
  get isApiResultEnvelope() {
    return getServerFragments().isApiResultEnvelope;
  },
  get sendApiResult() {
    return getServerFragments().sendApiResult;
  },
  get ensureRequestMemo() {
    return getServerFragments().ensureRequestMemo;
  },
  get validateFragmentInput() {
    return getServerFragments().validateFragmentInput;
  },
  get enforceFragmentAuth() {
    return getServerFragments().enforceFragmentAuth;
  },
  get wrapFragmentRootHtml() {
    return getServerFragments().wrapFragmentRootHtml;
  },
  get executeAndRenderFragment() {
    return getServerFragments().executeAndRenderFragment;
  },
  get attachSsrFragmentHelper() {
    return getServerFragments().attachSsrFragmentHelper;
  },
  get resolvePendingSsrFragments() {
    return getServerFragments().resolvePendingSsrFragments;
  },
  get matchPageEntryByPath() {
    return getServerFragments().matchPageEntryByPath;
  },
  get createFragmentRefreshHandler() {
    return getServerFragments().createFragmentRefreshHandler;
  },

  // Datastar Adapter
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  isArray,
  isNumber,
  randomId,
  uid,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry & DevTools
  get createClientDebugger() {
    return getDebugModule().createClientDebugger;
  },
  get summarizePayloadSafely() {
    return getDebugModule().summarizePayloadSafely;
  },
  get mountDevtool() {
    return getDevtoolModule().mountDevtool;
  },
  get highlightElement() {
    return getDevtoolModule().highlightElement;
  },
  get setupReduxDevToolsBridge() {
    return getDevtoolModule().setupReduxDevToolsBridge;
  },

  // Client Storage & Persistence
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,

  // Client Services & Optional Lazy UI Hosts
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
  createClientHostManager,
};


},
    "webspresso": function(module, exports, require) {
'use strict';

/**
 * Webspresso Client Behavior Layer (`core/client`)
 *
 * Datastar-powered, SSR-integrated, strongly-typed client behavior runtime.
 * Supports two clean data flows:
 *   1. Server-managed view: SSR HTML + fragment refresh (`fragments` + `invalidate`)
 *   2. Client-managed data: Explicit typed API calls (`api.get`, `api.post`, ...) into controller-local state
 */

const {
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,
} = require('./adapter/datastar');

const {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
} = require('./api');

const {
  defineController,
  deriveControllerNameFromPath,
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,
} = require('./controller');

const {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
} = require('./forms');

const {
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
} = require('./fragments');

const {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
} = require('./storage');

const {
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
} = require('./services');

const {
  createClientHostManager,
} = require('./host');

const { isArray, isNumber, NOOP_DEBUGGER, randomId, uid } = require('./utils');

const NOOP_DEVTOOL_HANDLE = Object.freeze({
  open() {},
  close() {},
  toggle() {},
  refresh() {},
  destroy() {},
});

let _debugMod = null;
function getDebugModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_debugMod) {
      _debugMod = require('./debug');
    }
    return _debugMod;
  }
  return {
    createClientDebugger: () => NOOP_DEBUGGER,
    summarizePayloadSafely: () => null,
  };
}

let _devtoolMod = null;
function getDevtoolModule() {
  if (process.env.NODE_ENV !== 'production') {
    if (!_devtoolMod) {
      _devtoolMod = require('./devtool');
    }
    return _devtoolMod;
  }
  return {
    mountDevtool: () => NOOP_DEVTOOL_HANDLE,
    highlightElement: () => {},
    setupReduxDevToolsBridge: () => null,
  };
}

let _liteMod = null;
function getLiteModule() {
  if (!_liteMod) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _liteMod = reqFn('./lite');
  }
  return _liteMod;
}

let _serverFragments = null;
function getServerFragments() {
  if (!_serverFragments) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _serverFragments = reqFn('./server-fragments');
  }
  return _serverFragments;
}

/**
 * Create a complete Webspresso Client Runtime instance wiring Datastar, Controllers,
 * Typed API Client, Native Forms, Fragment Coordinator, and Debug Telemetry.
 *
 * @param {object} [options]
 * @param {Document|Element} [options.root] - Root document or container
 * @param {typeof fetch} [options.fetch] - Custom fetch implementation
 * @param {string} [options.baseUrl=''] - Optional API base URL
 * @param {string} [options.fragmentEndpoint='/__webspresso/fragments'] - Fragment refresh URL
 * @param {object} [options.datastar] - Optional `@starfederation/datastar` module
 * @param {boolean} [options.debug=false] - Enable client debug telemetry
 * @param {boolean} [options.observe=false] - Enable MutationObserver for external DOM changes
 * @param {(name: string, el: Element) => Promise<object>} [options.lazyLoader] - Lazy controller loader
 * @param {Record<string, object>} [options.controllers] - Initial controller definitions map
 */
function createClientRuntime(options = {}) {
  const rootOption = options.root || options.document;
  const debug =
    options.debugger ||
    (options.debug && typeof options.debug === 'object' && typeof options.debug.getSnapshot === 'function'
      ? options.debug
      : options.debug
        ? getDebugModule().createClientDebugger({
            enabled: true,
            logger: options.debugLogger,
          })
        : NOOP_DEBUGGER);

  const datastar = createDatastarAdapter({
    datastar: options.datastar,
    debug,
  });

  let controllers = null;

  const fragments = createFragmentCoordinator({
    root: rootOption,
    fetch: options.fetch,
    endpoint: options.fragmentEndpoint || DEFAULT_FRAGMENT_ENDPOINT,
    datastar,
    debug,
    staleTime: options.staleTime,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    refetchOnFocus: options.refetchOnFocus,
    refetchOnReconnect: options.refetchOnReconnect,
    refetchOnMount: options.refetchOnMount,
    refetchOnVisit: options.refetchOnVisit,
    refetchInterval: options.refetchInterval,
    refetchIntervalInBackground: options.refetchIntervalInBackground,
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onBeforeNodeRemove(removedEl) {
      if (controllers) {
        controllers.unmountSubtree(removedEl);
      }
    },
    onNodeAdded(addedEl) {
      if (controllers) {
        controllers.mountSubtree(addedEl);
      }
    },
    getPatchHookContext() {
      return controllers ? controllers.getActivePatchHookContext() : null;
    },
    onBeforePatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.notifyBeforePatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
    onAfterPatch(patchedEl, inst, meta) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
        controllers.notifyAfterPatch(patchedEl, {
          fragmentId: inst && inst.instanceId ? inst.instanceId : null,
          fragmentName: inst && inst.name ? inst.name : null,
          hookChainDepth: meta && meta.hookChainDepth ? meta.hookChainDepth : 0,
        });
      }
    },
  });

  const apiConfig = {
    fetch: options.fetch,
    baseUrl: options.baseUrl || '',
    getCsrfToken: options.getCsrfToken || (() => discoverCsrfToken(rootOption)),
    onInvalidate: (tags, meta) => fragments.invalidate(tags, meta),
    onRefreshError: options.onRefreshError,
    debug,
  };

  const api = createApiClient(apiConfig);

  let runtime = null;

  const services =
    options.services && typeof options.services.get === 'function' && typeof options.services.register === 'function'
      ? options.services
      : createClientServiceRegistry({
          root: rootOption,
          api,
          debug,
          getRuntime: () => runtime,
          services: options.services,
        });

  controllers = createControllerRuntime({
    root: rootOption,
    datastar,
    fragments,
    debug,
    apiConfig,
    services,
    lazyLoader: options.lazyLoader,
  });

  // Register any initial controllers passed in options
  if (options.controllers && typeof options.controllers === 'object') {
    for (const [name, def] of Object.entries(options.controllers)) {
      controllers.register(name, def);
    }
  }

  let observer = null;

  async function mount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    fragments.syncDomInstances(root);
    const mounted = await controllers.mountSubtree(root);

    if (options.observe && !observer && typeof MutationObserver !== 'undefined' && root) {
      const observeTarget = root.body || root.documentElement || root;
      if (observeTarget && observeTarget.nodeType === 1) {
        observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (let i = 0; i < m.removedNodes.length; i++) {
              const node = m.removedNodes[i];
              if (node.nodeType === 1) {
                controllers.unmountSubtree(node);
              }
            }
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node.nodeType === 1) {
                fragments.syncDomInstances(node);
                controllers.mountSubtree(node);
              }
            }
          }
        });
        observer.observe(observeTarget, { childList: true, subtree: true });
      }
    }

    return mounted;
  }

  function unmount(targetRoot) {
    const root = targetRoot || rootOption || (typeof document !== 'undefined' ? document : null);
    if (root) {
      const targetEl = root.documentElement || root;
      controllers.unmountSubtree(targetEl);
    }
  }

  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    controllers.destroyAll();
    if (fragments && typeof fragments.dispose === 'function') {
      fragments.dispose();
    }
    services.dispose();
    if (runtime && runtime.devtool && typeof runtime.devtool.destroy === 'function') {
      try {
        runtime.devtool.destroy();
      } catch (_e) {}
      runtime.devtool = null;
    }
  }

  runtime = {
    api,
    services,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    registerService: (name, def) => services.register(name, def),
    mount,
    unmount,
    destroy,
    dispose: destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    mountDevtool: (opts) => getDevtoolModule().mountDevtool(runtime, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
          services,
          ...formOpts,
        }),
    },
  };

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_CLIENT__ = runtime;
  }

  return runtime;
}

/**
 * Boot the client runtime on DOMContentLoaded (or immediately if ready).
 */
function bootClient(options = {}) {
  const bootRoot = options.root || options.document || (typeof document !== 'undefined' ? document : null);
  if (
    options.hmr !== false &&
    bootRoot &&
    bootRoot.__wBootedClientRuntime &&
    typeof bootRoot.__wBootedClientRuntime.destroy === 'function'
  ) {
    try {
      bootRoot.__wBootedClientRuntime.destroy();
    } catch (_e) {}
  }

  const runtime = createClientRuntime(options);
  if (bootRoot && (typeof bootRoot === 'object' || typeof bootRoot === 'function')) {
    try {
      Object.defineProperty(bootRoot, '__wBootedClientRuntime', {
        value: runtime,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch (_e) {
      bootRoot.__wBootedClientRuntime = runtime;
    }
  }

  const shouldMountDevtools =
    options.devtools === true ||
    (options.devtools !== false &&
      (options.debug ||
        options.dev ||
        (typeof window !== 'undefined' &&
          (window.__WEBSPRESSO_DEVTOOLS_ENABLED__ || window.__WEBSPRESSO_DEV__)) ||
        (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production')));

  if (typeof document !== 'undefined') {
    const onReady = () => {
      runtime.mount();
      if (shouldMountDevtools) {
        runtime.devtool = getDevtoolModule().mountDevtool(runtime, options.devtoolsOptions || {});
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  }
  return runtime;
}

module.exports = {
  // Primary Runtime & Controller API
  defineController,
  deriveControllerNameFromPath,
  createClientRuntime,
  bootClient,
  get createLiteClientRuntime() {
    return getLiteModule().createLiteClientRuntime;
  },
  get bootLiteClient() {
    return getLiteModule().bootLiteClient;
  },
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
  watch,
  getActiveControllerContext,

  // Typed API Client & Request Management
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,

  // Native Forms & Payload Coercion
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,

  // Client & Server SSR Fragments + Invalidation
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
  get defineFragment() {
    return getServerFragments().defineFragment;
  },
  get apiResult() {
    return getServerFragments().apiResult;
  },
  get isApiResultEnvelope() {
    return getServerFragments().isApiResultEnvelope;
  },
  get sendApiResult() {
    return getServerFragments().sendApiResult;
  },
  get ensureRequestMemo() {
    return getServerFragments().ensureRequestMemo;
  },
  get validateFragmentInput() {
    return getServerFragments().validateFragmentInput;
  },
  get enforceFragmentAuth() {
    return getServerFragments().enforceFragmentAuth;
  },
  get wrapFragmentRootHtml() {
    return getServerFragments().wrapFragmentRootHtml;
  },
  get executeAndRenderFragment() {
    return getServerFragments().executeAndRenderFragment;
  },
  get attachSsrFragmentHelper() {
    return getServerFragments().attachSsrFragmentHelper;
  },
  get resolvePendingSsrFragments() {
    return getServerFragments().resolvePendingSsrFragments;
  },
  get matchPageEntryByPath() {
    return getServerFragments().matchPageEntryByPath;
  },
  get createFragmentRefreshHandler() {
    return getServerFragments().createFragmentRefreshHandler;
  },

  // Datastar Adapter
  PluginType,
  Requirement,
  DATASTAR_SIGNAL_EVENT,
  DATASTAR_SSE_EVENT,
  createDatastarAdapter,
  createSignalsEngine,
  evaluateStateExpression,
  isArray,
  isNumber,
  randomId,
  uid,
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry & DevTools
  get createClientDebugger() {
    return getDebugModule().createClientDebugger;
  },
  get summarizePayloadSafely() {
    return getDebugModule().summarizePayloadSafely;
  },
  get mountDevtool() {
    return getDevtoolModule().mountDevtool;
  },
  get highlightElement() {
    return getDevtoolModule().highlightElement;
  },
  get setupReduxDevToolsBridge() {
    return getDevtoolModule().setupReduxDevToolsBridge;
  },

  // Client Storage & Persistence
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,

  // Client Services & Optional Lazy UI Hosts
  defineClientService,
  createClientServiceRegistry,
  createServiceError,
  createClientHostManager,
};


},
    "./services/toast": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../../../core/client");
let toastSeq = 0;
exports.default = (0, client_1.defineClientService)({
    create({ mountHost, onCleanup }) {
        const host = mountHost('toast', {
            className: 'demo-toast-host',
            attributes: {
                role: 'status',
                'aria-live': 'polite',
            },
        });
        const items = new Map();
        function dismiss(id) {
            if (!id) {
                for (const el of items.values()) {
                    if (el.parentNode)
                        el.parentNode.removeChild(el);
                }
                items.clear();
                return;
            }
            const target = items.get(id);
            if (target) {
                if (target.parentNode)
                    target.parentNode.removeChild(target);
                items.delete(id);
            }
        }
        function success(message) {
            const id = `toast_${++toastSeq}`;
            const doc = host.el.ownerDocument || document;
            const itemEl = doc.createElement('div');
            itemEl.className = 'demo-toast-item';
            itemEl.setAttribute('data-toast-id', id);
            itemEl.textContent = String(message || '');
            if (typeof itemEl.addEventListener === 'function') {
                itemEl.addEventListener('click', () => dismiss(id));
            }
            host.el.appendChild(itemEl);
            items.set(id, itemEl);
            return id;
        }
        onCleanup(() => {
            items.clear();
        });
        return {
            success,
            dismiss,
            count: () => items.size,
        };
    },
});

},
    "./services/clipboard": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../../../core/client");
exports.default = (0, client_1.defineClientService)({
    create({ onCleanup }) {
        let lastValue = null;
        async function copy(text) {
            const value = String(text ?? '');
            lastValue = value;
            if (typeof navigator !== 'undefined' &&
                navigator.clipboard &&
                typeof navigator.clipboard.writeText === 'function') {
                try {
                    await navigator.clipboard.writeText(value);
                }
                catch (_e) {
                    // Fallback retains in-memory lastValue in headless/non-HTTPS environments
                }
            }
            return true;
        }
        onCleanup(() => {
            lastValue = null;
        });
        return {
            copy,
            lastCopied: () => lastValue,
        };
    },
});

},
    "./components/quick-share.client": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../../../core/client");
exports.default = (0, client_1.defineController)({
    name: 'quick-share',
    state: () => ({
        copiedCount: 0,
    }),
    actions: {
        async sharePage({ state, services }, _event, actionEl) {
            const label = actionEl?.data('share-text') || 'Task & Engineering Backlog';
            const clipboard = await services.get('clipboard');
            await clipboard.copy(label);
            state.copiedCount += 1;
            const toast = await services.get('toast');
            toast.success(`Copied: ${label}`);
        },
    },
});

},
    "./pages/todos.client": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../../../core/client");
exports.default = (0, client_1.defineController)({
    state: () => ({
        draft: {
            search: '',
            status: 'all',
            priority: 'all',
        },
        applied: {
            search: '',
            status: 'all',
            priority: 'all',
        },
        page: 1,
        selectedTodoId: 3,
        loadingTodoId: null,
        manualDraftMode: false,
        labActiveControllers: '',
        labActiveFragments: '',
        labHostCount: 0,
        labRequestOrder: '',
        labPatchOrder: '',
        labAssertions: 'READY',
    }),
    computed: {
        draftSummaryText: ({ state }) => {
            const { search, status, priority } = state.draft;
            return `Draft: ${status}/${priority}${search ? ` • "${search}"` : ''}`;
        },
        filterSummaryText: ({ state }) => {
            const { search, status, priority } = state.applied;
            return `Filter: ${status}/${priority}${search ? ` • "${search}"` : ''} • Page ${state.page}`;
        },
        editingBadge: ({ state }) => {
            return state.selectedTodoId ? `Task #${state.selectedTodoId}` : 'No Task Selected';
        },
        isLoadingRecord: ({ state }) => state.loadingTodoId !== null,
        hasInsights: ({ tasks }) => Boolean(tasks.insights?.data),
        insightsHeadline: ({ tasks }) => tasks.insights?.data?.recommendation || '',
        insightsDetail: ({ tasks }) => {
            const data = tasks.insights?.data;
            if (!data)
                return '';
            return `Completion: ${data.percentCompleted}% (${data.completed}/${data.total}) • Top Category: ${data.topCategory}`;
        },
        insightsErrorText: ({ tasks }) => {
            const err = tasks.insights?.error;
            return err && err.message ? err.message : '';
        },
    },
    tasks: {
        insights: ({ api }) => ({
            run: (category) => api.get('/api/todos/insights', category ? { query: { category } } : undefined),
            concurrency: 'latest',
            staleTime: '10s',
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
        }),
    },
    connect({ forms, state, el }) {
        const createForm = forms.get('create-todo', {
            resetOnSuccess: true,
        });
        if (createForm) {
            createForm.onSuccess(async (_data, { services }) => {
                if (!services.has('toast'))
                    return;
                const toast = await services.get('toast');
                toast.success('Task added.');
            });
        }
        const editForm = forms.get('edit-todo');
        if (editForm) {
            editForm.beforeSubmit(() => {
                // Prevent submitting to wrong record while a new record selection is in-flight
                if (state.loadingTodoId !== null) {
                    return false;
                }
                return true;
            });
            editForm.onSuccess(async (_data, { services }) => {
                if (!services.has('toast'))
                    return;
                const toast = await services.get('toast');
                toast.success('Draft saved.');
            });
        }
        // Sync initial telemetry if lab panel is present
        const doc = el?.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (doc) {
            const ctrlNodes = doc.querySelectorAll('[data-w-controller]');
            const fragNodes = doc.querySelectorAll('[data-w-fragment]');
            const hostNodes = doc.querySelectorAll('[data-w-host]');
            state.labActiveControllers = Array.from(ctrlNodes)
                .map((n) => n.getAttribute('data-w-controller'))
                .filter(Boolean)
                .join(', ');
            state.labActiveFragments = Array.from(fragNodes)
                .map((n) => n.getAttribute('data-w-fragment-id') || n.getAttribute('data-w-fragment'))
                .filter(Boolean)
                .join(', ');
            state.labHostCount = hostNodes.length;
        }
        // Vue-style reactive watcher: monitors selected task id and supports onCleanup
        (0, client_1.watch)(() => state.selectedTodoId, (newId, _oldId, onCleanup) => {
            let active = true;
            onCleanup(() => {
                active = false;
            });
            if (newId !== null && active) {
                // Track or highlight selected task selection
            }
        }, { immediate: true });
        return () => {
            if (createForm)
                createForm.clearErrors();
        };
    },
    actions: {
        async onSearchInput({ state, refresh }) {
            if (state.manualDraftMode)
                return;
            const next = { ...state.draft };
            await refresh('todos-list', {
                search: next.search,
                status: next.status,
                priority: next.priority,
                page: 1,
                limit: 4,
            }, {
                throwOnError: false,
                onSuccess() {
                    state.applied = { ...next };
                    state.page = 1;
                },
            });
        },
        async applyFilters({ state, refresh }) {
            const next = { ...state.draft };
            await refresh('todos-list', {
                search: next.search,
                status: next.status,
                priority: next.priority,
                page: 1,
                limit: 4,
            }, {
                throwOnError: false,
                onSuccess() {
                    state.applied = { ...next };
                    state.page = 1;
                },
            });
        },
        async setQuickStatus({ state, refresh }, _event, actionEl) {
            if (!actionEl)
                return;
            const nextStatus = actionEl.data('status') || 'all';
            state.draft.status = nextStatus;
            const next = { ...state.draft };
            await refresh('todos-list', {
                search: next.search,
                status: next.status,
                priority: next.priority,
                page: 1,
                limit: 4,
            }, {
                throwOnError: false,
                onSuccess() {
                    state.applied = { ...next };
                    state.page = 1;
                },
            });
        },
        async setQuickPriority({ state, refresh }, _event, actionEl) {
            if (!actionEl)
                return;
            const clicked = actionEl.data('priority') || 'all';
            const nextPriority = state.draft.priority === clicked ? 'all' : clicked;
            state.draft.priority = nextPriority;
            const next = { ...state.draft };
            await refresh('todos-list', {
                search: next.search,
                status: next.status,
                priority: next.priority,
                page: 1,
                limit: 4,
            }, {
                throwOnError: false,
                onSuccess() {
                    state.applied = { ...next };
                    state.page = 1;
                },
            });
        },
        async resetFilters({ state, refresh }) {
            const initial = { search: '', status: 'all', priority: 'all' };
            await refresh('todos-list', {
                search: '',
                status: 'all',
                priority: 'all',
                page: 1,
                limit: 4,
            }, {
                throwOnError: false,
                onSuccess() {
                    state.draft = { ...initial };
                    state.applied = { ...initial };
                    state.page = 1;
                },
            });
        },
        async nextPage({ state, refresh }) {
            const nextPageNum = Number(state.page || 1) + 1;
            await refresh('todos-list', {
                search: state.applied.search,
                status: state.applied.status,
                priority: state.applied.priority,
                page: nextPageNum,
                limit: 4,
            }, {
                throwOnError: false,
                onSuccess() {
                    state.page = nextPageNum;
                },
            });
        },
        async prevPage({ state, refresh }) {
            const prevPageNum = Math.max(1, Number(state.page || 1) - 1);
            await refresh('todos-list', {
                search: state.applied.search,
                status: state.applied.status,
                priority: state.applied.priority,
                page: prevPageNum,
                limit: 4,
            }, {
                throwOnError: false,
                onSuccess() {
                    state.page = prevPageNum;
                },
            });
        },
        async selectTodoForEdit({ state, forms, api }, _event, actionEl) {
            if (!actionEl)
                return;
            const id = actionEl.data('todo-id');
            if (!id)
                return;
            const targetId = Number(id);
            const editForm = forms.get('edit-todo');
            if (!editForm)
                return;
            // Protect user's dirty draft if form currently has unsaved edits
            if (editForm.dirty) {
                if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
                    const discard = window.confirm('Discard unsaved draft in Draft Inspector?');
                    if (!discard)
                        return;
                }
            }
            const prevSelectedId = state.selectedTodoId;
            const revAtStart = editForm.inputRevision;
            state.selectedTodoId = targetId;
            state.loadingTodoId = targetId;
            try {
                // Client requests the record via typed GET with latest concurrency
                const todo = await api.get(`/api/todos/${targetId}`, {
                    key: 'todos:edit-fetch',
                    concurrency: 'latest',
                });
                if (!todo || typeof todo !== 'object')
                    return;
                if (state.selectedTodoId !== targetId)
                    return;
                // If user typed NEW changes into the form while the fetch was in flight, do not overwrite their in-flight edits
                if (editForm.inputRevision !== revAtStart) {
                    return;
                }
                editForm.setDraftKey(`form_draft:edit-todo:todo-${todo.id}`, { restore: false });
                editForm.setAction(`/api/todos/${todo.id}`);
                editForm.fill(todo, { baseline: true });
            }
            catch (err) {
                const isCanceled = Boolean(err &&
                    typeof err === 'object' &&
                    (err.isCanceled === true ||
                        err.name === 'AbortError'));
                if (!isCanceled && state.selectedTodoId === targetId) {
                    state.selectedTodoId = prevSelectedId;
                }
                if (!isCanceled) {
                    throw err;
                }
            }
            finally {
                if (state.loadingTodoId === targetId) {
                    state.loadingTodoId = null;
                }
            }
        },
        resetDraftForm({ forms }) {
            const editForm = forms.get('edit-todo');
            if (editForm) {
                editForm.reset();
            }
        },
        async loadInsights({ tasks, services }, _event, actionEl) {
            const category = actionEl?.data('category') || undefined;
            await tasks.insights.run(category);
            if (services.has('toast')) {
                const toast = await services.get('toast');
                toast.success('Insights updated.');
            }
        },
        async copyFilterSummary({ state, services }) {
            const { search, status, priority } = state.applied;
            const summary = `Filter: ${status}/${priority}${search ? ` • "${search}"` : ''} • Page ${state.page}`;
            const clipboard = await services.get('clipboard');
            await clipboard.copy(summary);
            if (services.has('toast')) {
                const toast = await services.get('toast');
                toast.success('Filter summary copied.');
            }
        },
        syncLabTelemetry({ state, el }) {
            const doc = el?.ownerDocument || (typeof document !== 'undefined' ? document : null);
            if (!doc)
                return;
            const ctrlNodes = doc.querySelectorAll('[data-w-controller]');
            const fragNodes = doc.querySelectorAll('[data-w-fragment]');
            const hostNodes = doc.querySelectorAll('[data-w-host]');
            state.labActiveControllers = Array.from(ctrlNodes)
                .map((n) => n.getAttribute('data-w-controller'))
                .filter(Boolean)
                .join(', ');
            state.labActiveFragments = Array.from(fragNodes)
                .map((n) => n.getAttribute('data-w-fragment-id') || n.getAttribute('data-w-fragment'))
                .filter(Boolean)
                .join(', ');
            state.labHostCount = hostNodes.length;
        },
        async retryFailedFragments(ctx) {
            const maybeRetry = ctx.retryFailedFragments;
            if (typeof maybeRetry === 'function') {
                await maybeRetry();
                return;
            }
            if (typeof window !== 'undefined' && window.__WEBSPRESSO_CLIENT__?.fragments?.retryFailed) {
                await window.__WEBSPRESSO_CLIENT__.fragments.retryFailed();
            }
        },
    },
});

},
    "./client-entry": function(module, exports, require) {
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.services = void 0;
exports.startExampleClient = startExampleClient;
const client_1 = require("../../core/client");
const todos_client_1 = __importDefault(require("./pages/todos.client"));
const quick_share_client_1 = __importDefault(require("./components/quick-share.client"));
exports.services = {
    toast: (0, client_1.defineClientService)({
        load: () => Promise.resolve().then(() => __importStar(require('./services/toast'))),
    }),
    clipboard: (0, client_1.defineClientService)({
        load: () => Promise.resolve().then(() => __importStar(require('./services/clipboard'))),
    }),
};
function startExampleClient(options = {}) {
    return (0, client_1.bootClient)({
        debug: process.env.NODE_ENV !== 'production',
        services: exports.services,
        controllers: {
            todos: todos_client_1.default,
            'quick-share': quick_share_client_1.default,
        },
        ...options,
    });
}
if (typeof document !== 'undefined') {
    startExampleClient();
}

}
  };
  var cache = {};
  function require(id) {
    if (cache[id]) return cache[id].exports;
    var fn = modules[id];
    if (!fn) throw new Error('Module not found in browser bundle: ' + id);
    var module = { exports: {} };
    cache[id] = module;
    fn(module, module.exports, require);
    return module.exports;
  }
  require('./client-entry');
})();
