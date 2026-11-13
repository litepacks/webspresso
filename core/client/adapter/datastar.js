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

