'use strict';

/**
 * Safe, CSP-compliant Client Context & Route Provider (`core/client/context.js`).
 *
 * Security invariants:
 * - Explicit opt-in only: nothing from server/process state is serialized automatically.
 * - Optional positive `allow` list and/or `schema` (Zod-compatible `.parse`) for strict filtering.
 * - Parses JSON only from `<script type="application/json" id="__webspresso_context__">` (no eval / inline JS).
 * - Uses null-prototype maps and strips `__proto__` / `constructor` / `prototype` keys.
 * - Deep-freezes exposed `route` and `context` objects so controllers cannot mutate shared values.
 */

const CONTEXT_ELEMENT_ID = '__webspresso_context__';
const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(val) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function sanitizeValue(value, seen = new WeakSet(), depth = 0) {
  if (depth > 12) return undefined;
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return value;
  }
  if (t === 'function' || t === 'symbol' || t === 'bigint') {
    return undefined;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return undefined;
    seen.add(value);

    if (Array.isArray(value)) {
      const out = [];
      for (let i = 0; i < value.length; i++) {
        const clean = sanitizeValue(value[i], seen, depth + 1);
        if (clean !== undefined) out.push(clean);
      }
      return out;
    }

    if (!isPlainObject(value)) {
      return undefined;
    }

    const out = Object.create(null);
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (PROTO_POLLUTION_KEYS.has(k)) continue;
      const clean = sanitizeValue(value[k], seen, depth + 1);
      if (clean !== undefined) {
        out[k] = clean;
      }
    }
    return out;
  }

  return undefined;
}

function applyAllowAndSchema(obj, options = {}) {
  if (!obj || typeof obj !== 'object') return Object.create(null);

  let source = obj;
  if (Array.isArray(options.allow)) {
    const allowed = new Set(options.allow);
    const picked = Object.create(null);
    for (const k of Object.keys(source)) {
      if (allowed.has(k)) {
        picked[k] = source[k];
      }
    }
    source = picked;
  }

  if (options.schema && typeof options.schema.parse === 'function') {
    source = options.schema.parse(source);
  }

  return sanitizeValue(source) || Object.create(null);
}

function deepFreeze(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return obj;
  seen.add(obj);
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    deepFreeze(obj[keys[i]], seen);
  }
  return Object.freeze(obj);
}

function parseQueryString(search) {
  const out = Object.create(null);
  if (!search || typeof search !== 'string') return out;
  const clean = search.startsWith('?') ? search.slice(1) : search;
  if (!clean) return out;
  const pairs = clean.split('&');
  for (let i = 0; i < pairs.length; i++) {
    const part = pairs[i];
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? '' : part.slice(eq + 1);
    try {
      const k = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      if (PROTO_POLLUTION_KEYS.has(k)) continue;
      out[k] = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch (_e) {
      // Ignore malformed URI components
    }
  }
  return out;
}

function readDomClientContext(root) {
  const doc =
    root && root.nodeType === 9
      ? root
      : (root && root.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.getElementById !== 'function') return null;

  const el = doc.getElementById(CONTEXT_ELEMENT_ID);
  if (!el || !el.textContent) return null;

  try {
    const parsed = JSON.parse(el.textContent);
    return isPlainObject(parsed) ? sanitizeValue(parsed) : null;
  } catch (_e) {
    return null;
  }
}

function resolveBrowserRoute(root, domRoute) {
  const doc =
    root && root.nodeType === 9
      ? root
      : (root && root.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  const loc = win && win.location ? win.location : null;

  const basePath = (domRoute && typeof domRoute.path === 'string' && domRoute.path) || (loc && loc.pathname) || '/';
  const pattern = (domRoute && typeof domRoute.pattern === 'string' && domRoute.pattern) || basePath;
  const params = (domRoute && isPlainObject(domRoute.params) && domRoute.params) || Object.create(null);
  const query =
    (domRoute && isPlainObject(domRoute.query) && domRoute.query) ||
    parseQueryString(loc ? loc.search : '');

  return {
    path: basePath,
    pattern,
    params,
    query,
  };
}

function getByDotPath(obj, key, fallback = undefined) {
  if (!obj || typeof key !== 'string' || !key) return fallback;
  if (PROTO_POLLUTION_KEYS.has(key)) return fallback;
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    return obj[key];
  }
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (PROTO_POLLUTION_KEYS.has(part) || !cur || typeof cur !== 'object' || !(part in cur)) {
      return fallback;
    }
    cur = cur[part];
  }
  return cur === undefined ? fallback : cur;
}

/**
 * Create a mutable-builder -> frozen-snapshot client context store.
 */
function createClientContextStore(options = {}) {
  const domPayload = readDomClientContext(options.root);
  const domRoute = domPayload && isPlainObject(domPayload.route) ? domPayload.route : null;
  const initialRoute = resolveBrowserRoute(
    options.root,
    isPlainObject(options.route) ? { ...domRoute, ...options.route } : domRoute
  );

  const data = Object.create(null);
  const mergeIntoData = (src, filterOpts = {}) => {
    const clean = applyAllowAndSchema(src, filterOpts);
    for (const k of Object.keys(clean)) {
      if (k === 'route' && domPayload && src === domPayload) continue;
      data[k] = clean[k];
    }
  };

  const filterOpts = { allow: options.allow, schema: options.schema };
  if (domPayload) mergeIntoData(domPayload, filterOpts);
  if (isPlainObject(options.context)) mergeIntoData(options.context, filterOpts);
  if (isPlainObject(options.provide)) mergeIntoData(options.provide, filterOpts);

  let frozenContext = deepFreeze({ ...data });
  const frozenRoute = deepFreeze(initialRoute);

  return {
    get route() {
      return frozenRoute;
    },
    get context() {
      return frozenContext;
    },
    inject(key, fallback = undefined) {
      if (key === 'route') return frozenRoute;
      return getByDotPath(frozenContext, key, fallback);
    },
    provide(keyOrMap, value) {
      if (typeof keyOrMap === 'string') {
        if (!keyOrMap || PROTO_POLLUTION_KEYS.has(keyOrMap)) {
          return frozenContext;
        }
        const clean = sanitizeValue(value);
        if (clean !== undefined) {
          data[keyOrMap] = clean;
          frozenContext = deepFreeze({ ...data });
        }
      } else if (isPlainObject(keyOrMap)) {
        mergeIntoData(keyOrMap, filterOpts);
        frozenContext = deepFreeze({ ...data });
      }
      return frozenContext;
    },
  };
}

/**
 * Escape JSON safely for embedding inside `<script type="application/json">`.
 */
function escapeJsonForHtml(payload) {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Build an HTML `<script type="application/json" id="__webspresso_context__">` tag for SSR templates.
 */
function renderClientContextTag(payload = {}, options = {}) {
  const clean = applyAllowAndSchema(payload, options);
  return `<script type="application/json" id="${CONTEXT_ELEMENT_ID}">${escapeJsonForHtml(clean)}</script>`;
}

module.exports = {
  CONTEXT_ELEMENT_ID,
  createClientContextStore,
  readDomClientContext,
  renderClientContextTag,
  sanitizeValue,
  deepFreeze,
};
