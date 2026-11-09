(function() {
  var modules = {
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
  }

  return {
    signals: new CompatibleSignalsRoot(),
    effect,
  };
}

// ---------------------------------------------------------------------------
// Safe Expression Evaluator (NO Regex Rewriting, NO eval / new Function)
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-separated property path on an object (e.g. "user.profile.name" or "items.length").
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
 * Safely evaluate a declarative binding expression against controller state without
 * naive regex transformations or `eval`/`new Function`.
 *
 * Supported declarative syntax:
 *   - Property path: `count`, `user.name`, `items.length`
 *   - Negation: `!pending`, `!!error`
 *   - Simple comparisons: `status === 'active'`, `count > 0`, `step !== 1`
 *
 * @param {object} state
 * @param {string} rawExpr
 * @returns {unknown}
 */
function evaluateStateExpression(state, rawExpr) {
  if (typeof rawExpr !== 'string') return undefined;
  const expr = rawExpr.trim();
  if (!expr) return undefined;

  // Check simple comparison operators in precedence order
  const operators = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'];
  for (const op of operators) {
    const idx = expr.indexOf(op);
    if (idx > 0) {
      const leftRaw = expr.slice(0, idx).trim();
      const rightRaw = expr.slice(idx + op.length).trim();
      if (leftRaw && rightRaw) {
        const left = resolveOperand(state, leftRaw);
        const right = resolveOperand(state, rightRaw);
        switch (op) {
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
    }
  }

  if (expr.startsWith('!!')) {
    return Boolean(evaluateStateExpression(state, expr.slice(2)));
  }
  if (expr.startsWith('!')) {
    return !Boolean(evaluateStateExpression(state, expr.slice(1)));
  }

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

        // Allow accessing tasks on root state
        if (!basePath && prop === 'tasks') {
          const ctx = getContext();
          return ctx && ctx.tasks ? ctx.tasks : undefined;
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
        if (Array.isArray(obj) && basePath) {
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

        if (Object.is(prevValue, rawNext) && !Array.isArray(obj)) {
          return true;
        }

        Reflect.set(obj, prop, rawNext, receiver);

        // Seed nested keys if setting an object
        if (rawNext !== null && typeof rawNext === 'object' && !Array.isArray(rawNext)) {
          for (const [k, v] of Object.entries(rawNext)) {
            engine.signals.setValue(signalKeyFor(`${path}.${k}`), v);
          }
        }
        engine.signals.setValue(signalKeyFor(path), rawNext);
        if (basePath) {
          engine.signals.setValue(signalKeyFor(basePath), Array.isArray(obj) ? [...obj] : { ...obj });
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
          ? Array.isArray(val)
            ? [...val]
            : { ...val }
          : val;
      rawStore[key] = cloned;
      engine.signals.setValue(signalKeyFor(key), cloned);
      if (cloned !== null && typeof cloned === 'object' && !Array.isArray(cloned)) {
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

/**
 * Determine whether a node has client bindings owning specific DOM properties.
 */
function getClientOwnership(el) {
  if (!el || typeof el.hasAttribute !== 'function') {
    return { text: false, show: false, disabled: false, model: false };
  }
  return {
    text: el.hasAttribute(CLIENT_OWNED_TEXT_ATTR),
    show: el.hasAttribute(CLIENT_OWNED_SHOW_ATTR),
    disabled: el.hasAttribute(CLIENT_OWNED_DISABLED_ATTR),
    model: el.hasAttribute(CLIENT_OWNED_MODEL_ATTR),
  };
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
 */
function syncElementAttributes(toEl, fromEl, ownership) {
  const fromAttrs = fromEl.attributes;
  const toAttrs = Array.from(toEl.attributes);

  // Remove attributes no longer present on server HTML, except client-managed runtime state
  for (let i = 0; i < toAttrs.length; i++) {
    const attrName = toAttrs[i].name;
    if (ownership.disabled && attrName === 'disabled') continue;
    if (ownership.show && attrName === 'hidden') continue;
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

  // Set updated attributes from server HTML
  for (let i = 0; i < fromAttrs.length; i++) {
    const attr = fromAttrs[i];
    if (ownership.disabled && attr.name === 'disabled') continue;
    if (ownership.show && attr.name === 'hidden') continue;
    if (toEl.getAttribute(attr.name) !== attr.value) {
      toEl.setAttribute(attr.name, attr.value);
    }
  }
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

  const ownership = getClientOwnership(toEl);
  const isForm = toEl.tagName === 'FORM';
  const insideDirtyForm = Boolean(ctx.insideDirtyForm || (isForm && isFormDirtyOrPreserved(toEl)));

  syncElementAttributes(toEl, fromEl, ownership);

  if (toEl.tagName === 'INPUT' || toEl.tagName === 'TEXTAREA' || toEl.tagName === 'SELECT') {
    syncFormControlValue(toEl, fromEl, ownership, insideDirtyForm);
    if (toEl.tagName !== 'SELECT') {
      return toEl;
    }
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

      if (!match) {
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

  // Remove leftover existing children that were not matched
  for (let i = 0; i < existingChildren.length; i++) {
    const oldChild = existingChildren[i];
    if (!usedExisting.has(oldChild) && oldChild.parentNode === toEl) {
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
  const boundElementsByInstance = new Map(); // instanceId -> WeakSet<Element>

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

  /**
   * Bind V1 declarative attributes inside `rootEl` for a controller instance.
   */
  function bindControllerDom({ instanceId, rootEl, state, invokeAction, isConnected }) {
    if (!boundElementsByInstance.has(instanceId)) {
      boundElementsByInstance.set(instanceId, new WeakSet());
    }
    const boundSet = boundElementsByInstance.get(instanceId);
    const disposers = [];

    const elements = collectScopedElements(rootEl);

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (boundSet.has(el)) continue;
      boundSet.add(el);

      // 1. data-w-text
      if (el.hasAttribute('data-w-text')) {
        const expr = el.getAttribute('data-w-text');
        const stop = engine.effect(() => {
          if (!isConnected()) return;
          const val = evaluateStateExpression(state, expr);
          const text = val === null || val === undefined ? '' : String(val);
          if (el.textContent !== text) {
            el.textContent = text;
          }
        });
        disposers.push(stop);
      }

      // 2. data-w-show
      if (el.hasAttribute('data-w-show')) {
        const expr = el.getAttribute('data-w-show');
        const initialDisplay = el.style && el.style.display && el.style.display !== 'none' ? el.style.display : '';
        const stop = engine.effect(() => {
          if (!isConnected()) return;
          const visible = Boolean(evaluateStateExpression(state, expr));
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
        });
        disposers.push(stop);
      }

      // 3. data-w-disabled
      if (el.hasAttribute('data-w-disabled')) {
        const expr = el.getAttribute('data-w-disabled');
        const stop = engine.effect(() => {
          if (!isConnected()) return;
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
        disposers.push(stop);
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
          disposers.push(() => {
            try {
              el.removeEventListener('compositionstart', onCompositionStart);
              el.removeEventListener('compositionend', onCompositionEnd);
            } catch (_e) {}
          });

          // State -> DOM effect (synchronizes changes in state to the DOM control)
          const stopModelEffect = engine.effect(() => {
            if (!isConnected() || isComposing) return;
            const currentVal = getByPath(state, modelPath);

            if (type === 'checkbox') {
              if (Array.isArray(currentVal)) {
                el.checked = currentVal.map(String).includes(String(el.value));
              } else {
                el.checked = Boolean(currentVal);
              }
            } else if (type === 'radio') {
              el.checked = String(currentVal) === String(el.value);
            } else if (el.tagName === 'SELECT' && el.multiple) {
              const arr = Array.isArray(currentVal) ? currentVal.map(String) : [];
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
          disposers.push(stopModelEffect);

          // DOM -> State listener (synchronizes user interactions to state)
          const evtType =
            type === 'checkbox' || type === 'radio' || el.tagName === 'SELECT'
              ? 'change'
              : 'input';

          const onModelInput = () => {
            if (!isConnected() || isComposing) return;

            if (type === 'checkbox') {
              const cur = getByPath(state, modelPath);
              if (Array.isArray(cur)) {
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
          disposers.push(() => el.removeEventListener(evtType, onModelInput));
        }
      }

      // 5. Event bindings (data-w-on:<event>, data-w-on, data-w-click)
      const eventBindings = extractEventBindings(el);
      for (const binding of eventBindings) {
        const listener = (event) => {
          if (!isConnected()) return;
          if (binding.modifiers.has('prevent')) event.preventDefault();
          if (binding.modifiers.has('stop')) event.stopPropagation();
          invokeAction(binding.actionName, event, el);
        };
        el.addEventListener(binding.eventName, listener);
        disposers.push(() => el.removeEventListener(binding.eventName, listener));
      }
    }

    return function unbindInstanceDom() {
      for (let i = 0; i < disposers.length; i++) {
        try {
          disposers[i]();
        } catch (_err) {
          // Ignore individual unbind errors
        }
      }
    };
  }

  /**
   * Morph a fragment element in place using the Datastar-compatible morph engine.
   */
  function patchFragmentElement(targetEl, htmlString, lifecycleCallbacks = {}) {
    if (!targetEl || typeof htmlString !== 'string') return targetEl;
    const parsed = parseHtmlFragment(htmlString, targetEl.ownerDocument);
    if (!parsed) return targetEl;

    const morphed = morphDomTrees(targetEl, parsed, {
      onBeforeNodeRemove: lifecycleCallbacks.onBeforeNodeRemove,
      onNodeAdded: lifecycleCallbacks.onNodeAdded,
    });

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
]);

/**
 * Structured Client Request Error
 * Distinguishes 'http', 'network', 'validation', and 'canceled' failure modes.
 */
class ClientRequestError extends Error {
  /**
   * @param {string} message
   * @param {object} details
   * @param {'http'|'network'|'validation'|'canceled'} details.kind
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
    this.issues = Array.isArray(details.issues) ? details.issues : [];
    this.formError = details.formError || null;
    this.data = details.data !== undefined ? details.data : null;
    this.isCanceled = this.kind === 'canceled';
    this.isValidation = this.kind === 'validation';
    this.isNetwork = this.kind === 'network';
    this.isHttp = this.kind === 'http';
    this.isDropped = Boolean(details.isDropped);
    this.isSuperseded = Boolean(details.isSuperseded);
    this.serverRollbackGuaranteed = false;
    if (this.isCanceled) {
      this.note = 'Client request cancellation/abort does not roll back server-side execution.';
    }
    if (details.cause) {
      this.cause = details.cause;
    }
  }
}

function defaultCodeForKind(kind, status) {
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
    if (Array.isArray(rawVal)) {
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
  if (Array.isArray(value)) {
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
    if (Array.isArray(val)) {
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
  if (rawFieldErrors && typeof rawFieldErrors === 'object' && !Array.isArray(rawFieldErrors)) {
    for (const [field, msgOrArr] of Object.entries(rawFieldErrors)) {
      const list = Array.isArray(msgOrArr) ? msgOrArr.map(String) : [String(msgOrArr)];
      if (list.length > 0) {
        fieldErrors[field] = list[0];
        fieldErrorList[field] = list;
        issues.push({ path: field, message: list[0] });
      }
    }
  }

  // 2. Zod / Webspresso `issues` or `details` array
  const rawIssues =
    (Array.isArray(errObj.issues) && errObj.issues) ||
    (Array.isArray(payload.issues) && payload.issues) ||
    (Array.isArray(errObj.details) && errObj.details) ||
    (Array.isArray(payload.details) && payload.details) ||
    (Array.isArray(errObj.errors) && errObj.errors) ||
    [];

  for (const issue of rawIssues) {
    if (!issue || typeof issue !== 'object') continue;
    let rawPath = '';
    if (Array.isArray(issue.path)) {
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
    !Array.isArray(parsedBody) &&
    Array.isArray(parsedBody.invalidate) &&
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
    'key' in inputOrOptions ||
    'signal' in inputOrOptions ||
    'headers' in inputOrOptions;

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
function createApiClient(config = {}) {
  const fetchImpl =
    config.fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const baseUrl = config.baseUrl ? String(config.baseUrl).replace(/\/+$/, '') : '';
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
    if (policy === 'queue') {
      const prevTail = queueMap.get(requestKey) || Promise.resolve();
      const nextTask = prevTail
        .catch(() => {})
        .then(() => runSingleRequest(upperMethod, requestUrl, body, options, requestKey, requestId, 'queue'));
      queueMap.set(
        requestKey,
        nextTask.catch(() => {})
      );
      return nextTask;
    }

    return runSingleRequest(upperMethod, requestUrl, body, options, requestKey, requestId, policy);
  }

  async function runSingleRequest(upperMethod, requestUrl, body, options, requestKey, requestId, policy) {
    const abortController = new AbortController();
    let superseded = false;
    let currentSeq = 1;

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
        response = await fetchImpl(requestUrl, {
          method: upperMethod,
          headers,
          body: serializedBody,
          credentials: options.credentials || 'same-origin',
          signal: abortController.signal,
        });
      } catch (fetchErr) {
        const latestEntry = policy === 'latest' ? latestMap.get(requestKey) : null;
        if (latestEntry && (latestEntry.seq !== currentSeq || latestEntry.superseded)) {
          superseded = true;
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
        const rawText = await response.text();
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
        parsedBody = await response.json();
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
};


},
    "./forms": function(module, exports, require) {
'use strict';

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
      if (!Array.isArray(data[normName])) {
        data[normName] = [];
      }
      data[normName].push(val);
    } else if (normName in data) {
      if (!Array.isArray(data[normName])) {
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
      if (Array.isArray(val)) {
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
    return formEl.__wFormHandle;
  }

  const api = options.api;
  const debug = options.debug || null;
  const formName =
    (formEl && formEl.getAttribute && formEl.getAttribute('data-w-form')) ||
    (formEl && formEl.getAttribute && formEl.getAttribute('name')) ||
    'form';

  let initialSnapshot = captureInitialFormSnapshot(formEl);
  let pending = false;
  let dirty = false;
  let fieldErrors = {};
  let formError = null;
  let lastData = null;

  const successListeners = new Set();
  const errorListeners = new Set();
  const stateListeners = new Set();

  function notifyStateChange() {
    for (const fn of stateListeners) {
      try {
        fn(handle);
      } catch (_e) {
        // Ignore
      }
    }
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
      const msg = fieldName && fieldErrors[fieldName] ? String(fieldErrors[fieldName]) : '';
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
      const errMsg = fieldErrors[normName] || fieldErrors[rawName];

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
    pending = Boolean(nextPending);
    if (!formEl) return;

    if (pending) {
      formEl.setAttribute('aria-busy', 'true');
      formEl.setAttribute('data-w-pending', 'true');
    } else {
      formEl.removeAttribute('aria-busy');
      formEl.removeAttribute('data-w-pending');
    }

    const submitButtons = formEl.querySelectorAll
      ? formEl.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]')
      : [];
    for (let i = 0; i < submitButtons.length; i++) {
      const btn = submitButtons[i];
      if (btn.hasAttribute('data-w-disabled')) continue; // Managed by controller binding
      if (pending) {
        btn.__wWasDisabled = Boolean(btn.disabled);
        btn.disabled = true;
      } else if (!btn.__wWasDisabled) {
        btn.disabled = false;
      }
    }
    if (activeSubmitter && !activeSubmitter.hasAttribute('data-w-disabled')) {
      activeSubmitter.disabled = pending;
    }
    notifyStateChange();
  }

  /**
   * Reset form controls back to their initial default values (NOT emptying non-empty defaults).
   */
  function reset() {
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
    fieldErrors = {};
    formError = null;
    syncErrorsToDom(false);
    notifyStateChange();
  }

  /**
   * Completely clear all user-editable controls to empty values (distinct from `reset()`).
   */
  function clear() {
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
    if (!formEl || typeof formEl.querySelectorAll !== 'function' || !values || typeof values !== 'object') {
      return handle;
    }

    const isBaseline = Boolean(options.baseline);

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
          if (Array.isArray(val)) {
            ctrl.checked = val.map(String).includes(String(ctrl.value));
          } else {
            ctrl.checked = Boolean(val);
          }
        } else if (type === 'radio') {
          ctrl.checked = String(val) === String(ctrl.value);
        } else if (ctrl.tagName === 'SELECT') {
          if (ctrl.multiple) {
            const arr = Array.isArray(val) ? val.map(String) : [String(val)];
            const opts = ctrl.options || [];
            for (let j = 0; j < opts.length; j++) {
              opts[j].selected = arr.includes(String(opts[j].value));
            }
          } else {
            ctrl.value = val === null || val === undefined ? '' : String(val);
          }
        } else {
          ctrl.value = val === null || val === undefined ? '' : String(val);
        }

        // Clear error for this field
        delete fieldErrors[normKey];
        delete fieldErrors[key];
      }
    }

    if (isBaseline) {
      initialSnapshot = captureInitialFormSnapshot(formEl);
      dirty = false;
      fieldErrors = {};
      formError = null;
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
      formEl.setAttribute('action', String(url));
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

    // Clear previous errors before request starts
    fieldErrors = {};
    formError = null;
    syncErrorsToDom(false);
    setPendingState(true, submitter);

    try {
      let responseData;
      const reqKey = `form:${formName}:${method}:${actionUrl}`;
      if (method === 'GET') {
        responseData = await api.get(actionUrl, payloadData, {
          key: reqKey,
          policy: 'latest',
        });
      } else {
        const bodyToSend = isMultipart && formData ? formData : payloadData;
        responseData = await api.request(method, actionUrl, bodyToSend, {
          key: reqKey,
          policy: 'drop',
        });
      }

      lastData = responseData;
      dirty = false;
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

      if (shouldClear) {
        clear();
      } else if (shouldReset) {
        reset();
      } else {
        // Current state becomes the new clean baseline after successful save
        initialSnapshot = captureInitialFormSnapshot(formEl);
      }

      // Invoke registered success hooks. Note: Any background fragment refresh failure
      // is handled by the fragment coordinator and NEVER puts this form into validation error state!
      for (const listener of successListeners) {
        await listener(responseData, { values: payloadData, form: handle });
      }

      // Explicit redirect behavior
      const redirectTarget =
        submitOptions.redirectOnSuccess ||
        (formEl && formEl.getAttribute('data-w-redirect')) ||
        null;
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

      return { ok: true, submitted: true, data: responseData, refreshOk, refreshError };
    } catch (err) {
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
          await listener(err, { values: payloadData, form: handle });
        } catch (_e) {
          // Ignore
        }
      }

      if (submitOptions.throwOnError) {
        throw err;
      }
      return { ok: false, submitted: false, error: err };
    } finally {
      setPendingState(false, submitter);
    }
  }

  // Listen to native submit and input/change events on `formEl`
  const onDomInput = (evt) => {
    dirty = computeFormDirty(formEl, initialSnapshot);
    const target = evt && evt.target;
    if (target && target.getAttribute) {
      const rawName = target.getAttribute('name');
      if (rawName) {
        const norm = rawName.endsWith('[]') ? rawName.slice(0, -2) : rawName;
        if (fieldErrors[norm] || fieldErrors[rawName]) {
          delete fieldErrors[norm];
          delete fieldErrors[rawName];
          syncErrorsToDom(false);
        }
      }
    }
    notifyStateChange();
  };

  const onDomSubmit = (evt) => {
    submit(evt);
  };

  const onDomReset = () => {
    setTimeout(() => {
      dirty = false;
      fieldErrors = {};
      formError = null;
      syncErrorsToDom(false);
      notifyStateChange();
    }, 0);
  };

  if (formEl && typeof formEl.addEventListener === 'function') {
    formEl.addEventListener('input', onDomInput);
    formEl.addEventListener('change', onDomInput);
    formEl.addEventListener('submit', onDomSubmit);
    formEl.addEventListener('reset', onDomReset);
  }

  // Initialize hidden state on empty error placeholders
  syncErrorsToDom(false);

  const handle = {
    name: formName,
    el: formEl,
    get pending() {
      return pending;
    },
    get dirty() {
      dirty = computeFormDirty(formEl, initialSnapshot);
      return dirty;
    },
    get values() {
      return parseFormElement(formEl).data;
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
      syncErrorsToDom(false);
      notifyStateChange();
    },
    reset,
    clear,
    submit,
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
      if (formEl && typeof formEl.removeEventListener === 'function') {
        formEl.removeEventListener('input', onDomInput);
        formEl.removeEventListener('change', onDomInput);
        formEl.removeEventListener('submit', onDomSubmit);
        formEl.removeEventListener('reset', onDomReset);
      }
      if (formEl) {
        delete formEl.__wFormHandle;
      }
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

  return handle;
}

module.exports = {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
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

let instanceSeq = 0;

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
function deriveControllerNameFromPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const normalized = filePath.replace(/\\/g, '/');

  // Strip extension (.client.ts, .client.js, .client.mjs, etc.)
  const withoutExt = normalized.replace(/\.client\.(?:ts|tsx|js|jsx|mjs|cjs)$/i, '');

  // Check if under views/components/ or views/
  const compMatch = withoutExt.match(/(?:^|\/)(?:src\/)?views\/components\/(.+)$/);
  if (compMatch) {
    return compMatch[1].replace(/\//g, '--').replace(/\[([^\]]+)\]/g, '$1');
  }

  const viewsMatch = withoutExt.match(/(?:^|\/)(?:src\/)?views\/(.+)$/);
  if (viewsMatch) {
    const rel = viewsMatch[1];
    const base = rel.split('/').pop();
    return (base || rel).replace(/\[([^\]]+)\]/g, '$1');
  }

  const pagesMatch = withoutExt.match(/(?:^|\/)(?:src\/)?pages\/(.+)$/);
  if (pagesMatch) {
    const rel = pagesMatch[1].replace(/\/index$/, '') || 'index';
    return rel.replace(/\//g, '--').replace(/\[([^\]]+)\]/g, '$1');
  }

  const base = withoutExt.split('/').pop() || withoutExt;
  return base.replace(/\[([^\]]+)\]/g, '$1');
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
    actions: definition.actions && typeof definition.actions === 'object' ? definition.actions : {},
  });
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
      matched.push(el);
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

  // Registered controller definitions: name -> { name, definition, sourcePath }
  const definitions = new Map();
  // Active mounted controller instances per element: WeakMap<Element, Map<controllerName, InstanceRecord>>
  const elementInstances = new WeakMap();
  // All active instances by instanceId: Map<instanceId, InstanceRecord>
  const activeInstances = new Map();
  // Standalone forms (forms without a controller wrapper)
  const standaloneForms = new WeakMap();

  /**
   * Register a controller definition with collision checking.
   *
   * @param {string} name
   * @param {object} rawDef
   * @param {object} [meta]
   * @param {string} [meta.sourcePath]
   * @param {string[]} [meta.aliases]
   */
  function register(name, rawDef, meta = {}) {
    const def =
      rawDef && rawDef.__isWebspressoController
        ? rawDef
        : defineController(rawDef && rawDef.default ? rawDef.default : rawDef);

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

    if (Array.isArray(meta.aliases)) {
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
    let currentActionEl = null;

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

      let currentRunVersion = 0;
      let activeRuns = 0;
      let inFlightAbort = null;
      let queuedPromise = Promise.resolve();

      datastar.engine.signals.setValue(`${signalPrefix}.pending`, false);
      datastar.engine.signals.setValue(`${signalPrefix}.data`, null);
      datastar.engine.signals.setValue(`${signalPrefix}.error`, null);
      datastar.engine.signals.setValue(`${signalPrefix}.stale`, false);

      let _pending = false;
      let _data = null;
      let _error = null;
      let _stale = false;

      function updateSignal(name, val) {
        datastar.engine.signals.setValue(`${signalPrefix}.${name}`, val);
      }

      async function run(...args) {
        if (!isConnected()) return undefined;

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
          const nextRun = wait.then(() => executeRun(...args)).catch(() => {});
          queuedPromise = nextRun;
          return nextRun;
        }

        return executeRun(...args);
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

          if (!isConnected() || runVersion !== currentRunVersion) {
            return undefined;
          }

          _data = result;
          _error = null;
          _stale = false;
          updateSignal('data', result);
          updateSignal('error', null);
          updateSignal('stale', false);
          return result;
        } catch (err) {
          if (!isConnected() || runVersion !== currentRunVersion) {
            return undefined;
          }
          if (err && (err.isCanceled || err.name === 'AbortError')) {
            return undefined;
          }
          _error = err;
          updateSignal('error', err);
          throw err;
        } finally {
          if (inFlightAbort === abortCtrl) {
            inFlightAbort = null;
          }
          activeRuns = Math.max(0, activeRuns - 1);
          if (runVersion === currentRunVersion || activeRuns === 0) {
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
          return _stale;
        },
        run,
        cancel,
        dispose() {
          cancel();
          datastar.engine.signals.remove(signalPrefix);
        },
      };

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

    // 6. Context object passed to `connect(ctx)` and `actions[name](ctx, event, actionEl)`
    ctx = Object.freeze({
      instanceId,
      name: controllerName,
      el: rootEl,
      get state() {
        return state;
      },
      api: scopedApi,
      forms: formsAccessor,
      target: targetAccessor,
      targets: targetsAccessor,
      tasks: tasksProxy,
      task: createTaskInstance,
      param: (name, maybeEl) => {
        if (!name) return null;
        const el = maybeEl || currentActionEl;
        if (!el) return null;
        const rawAttr = el.getAttribute ? el.getAttribute(`data-${name}`) : null;
        if (rawAttr !== null) return rawAttr;
        if (el.dataset && el.dataset[name] !== undefined) return el.dataset[name];
        return el.getAttribute ? el.getAttribute(name) : null;
      },
      on: registerListener,
      emit: emitEvent,
      effect: registerEffect,
      interval: registerInterval,
      timeout: registerTimeout,
      signal: lifecycleAbort.signal,
      isConnected,
      isDisposed: () => !isConnected(),
      invalidate: (tags) => (fragments ? fragments.invalidate(tags) : Promise.resolve({ refreshed: [] })),
      refresh: (idOrName, input, opts) =>
        fragments ? fragments.refresh(idOrName, input, opts) : Promise.resolve({ refreshed: [] }),
      fragment: (idOrName) => ({
        get input() {
          const inst = fragments && fragments.getInstance ? fragments.getInstance(idOrName) : null;
          return inst && inst.input ? { ...inst.input } : {};
        },
        refresh: (input, opts) =>
          fragments ? fragments.refresh(idOrName, input, opts) : Promise.resolve({ refreshed: [] }),
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

    function invokeAction(actionName, event, actionEl) {
      if (!isConnected()) return undefined;
      const fn = reg.definition.actions[actionName];
      if (typeof fn !== 'function') {
        return undefined;
      }
      currentActionEl = actionEl || null;
      try {
        const res = fn(ctx, event, actionEl);
        if (res && typeof res.then === 'function') {
          return res.catch((err) => {
            // Ignore canceled/superseded request errors on disconnected or superseded instances
            if (err && err.isCanceled) return undefined;
            throw err;
          });
        }
        return res;
      } catch (err) {
        if (err && err.isCanceled) return undefined;
        throw err;
      } finally {
        currentActionEl = null;
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
      });
      domDisposers.push(unbind);

      // Also auto-initialize any `<form data-w-form>` inside this controller's scope
      if (rootEl.tagName === 'FORM' && rootEl.hasAttribute('data-w-form')) {
        resolveFormHandle(rootEl.getAttribute('data-w-form'));
      }
      if (typeof rootEl.querySelectorAll === 'function') {
        const formsInScope = rootEl.querySelectorAll('form[data-w-form]');
        for (let i = 0; i < formsInScope.length; i++) {
          if (isTargetInControllerScope(rootEl, formsInScope[i])) {
            createFormHandle(formsInScope[i], { api: scopedApi, datastar, debug });
          }
        }
      }
    }

    rebindDom();

    // 8. Run `connect(ctx)` lifecycle hook
    if (reg.definition.connect) {
      try {
        const userCleanup = reg.definition.connect(ctx);
        if (typeof userCleanup === 'function') {
          cleanupCallbacks.push(userCleanup);
        }
      } catch (err) {
        if (debug) {
          debug.trackCleanupError(instanceId, controllerName, 'connect', err);
        }
      }
    }

    const instanceRecord = {
      instanceId,
      name: controllerName,
      el: rootEl,
      state,
      ctx,
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
      destroy() {
        if (!connected) return;
        connected = false;
        lifecycleAbort.abort();

        // Run user disconnect hook if provided
        if (reg.definition.disconnect) {
          try {
            reg.definition.disconnect(ctx);
          } catch (err) {
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
        });
        standaloneForms.set(formEl, handle);
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

  return {
    register,
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
    destroyAll() {
      for (const inst of Array.from(activeInstances.values())) {
        inst.destroy();
      }
    },
  };
}

module.exports = {
  defineController,
  deriveControllerNameFromPath,
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,
};


},
    "./fragments": function(module, exports, require) {
'use strict';

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
      if (Array.isArray(parsed)) {
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
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_e) {
    return {};
  }
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
      if (other.el !== candidate.el && typeof other.el.contains === 'function' && other.el.contains(candidate.el)) {
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

  // Map<instanceId, { instanceId, name, pagePath, input, dependsOn: Set<string>, version: number, el: Element, abortController: AbortController|null }>
  const instances = new Map();

  // Coalescing & in-flight state for tag invalidations
  const pendingTags = new Set();
  const pendingChains = [];
  let batchTimer = null;
  let inFlightBatchCount = 0;
  let followUpNeeded = false;
  let lastFailedBatch = null;
  const inflightBatchWaiters = [];

  /**
   * Scan DOM and synchronize tracked `[data-w-fragment]` instances.
   */
  function syncDomInstances(containerEl) {
    const root = containerEl || getRoot();
    if (!root || typeof root.querySelectorAll !== 'function') return [];

    const elements = Array.from(root.querySelectorAll('[data-w-fragment]'));
    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('data-w-fragment')) {
      elements.unshift(root);
    }

    const seenIds = new Set();

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const name = (el.getAttribute('data-w-fragment') || '').trim();
      if (!name) continue;

      let instanceId = (el.getAttribute('data-w-fragment-id') || '').trim();
      if (!instanceId) {
        instanceId = i === 0 ? `${name}:default` : `${name}:${i}`;
        el.setAttribute('data-w-fragment-id', instanceId);
      }

      seenIds.add(instanceId);
      const pagePath =
        (el.getAttribute('data-w-fragment-page') || '').trim() ||
        (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
      const input = parseFragmentInputAttr(el.getAttribute('data-w-fragment-input'));
      const dependsOn = new Set(parseDependsOnAttr(el.getAttribute('data-w-depends-on')));

      const existing = instances.get(instanceId);
      if (existing) {
        existing.name = name;
        existing.pagePath = pagePath;
        existing.el = el;
        existing.dependsOn = dependsOn;
        if (el.hasAttribute('data-w-fragment-input')) {
          existing.input = input;
        }
      } else {
        instances.set(instanceId, {
          instanceId,
          name,
          pagePath,
          input,
          dependsOn,
          version: 0,
          el,
          abortController: null,
        });
      }
    }

    // Prune disconnected instances if scanning full root
    if (!containerEl || containerEl === getRoot()) {
      for (const [id, inst] of instances.entries()) {
        const disconnected =
          !seenIds.has(id) || (inst.el && inst.el.isConnected === false);
        if (disconnected) {
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

    return Array.from(instances.values());
  }

  /**
   * Apply a single server fragment result `{ instanceId, name, html, input, loadMs, renderMs }`
   * to the DOM if and only if `reqVersion >= inst.version`.
   */
  function applyFragmentPatch(inst, fragmentPayload, reqVersion, chainId = null) {
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

    const patchStart = Date.now();

    if (
      fragmentPayload.input &&
      typeof fragmentPayload.input === 'object' &&
      !followUpNeeded &&
      pendingTags.size === 0
    ) {
      inst.input = fragmentPayload.input;
      inst.el.setAttribute('data-w-fragment-input', JSON.stringify(fragmentPayload.input));
    }

    if (datastar && typeof datastar.patchFragmentElement === 'function') {
      datastar.patchFragmentElement(inst.el, html, {
        onBeforeNodeRemove: options.onBeforeNodeRemove,
        onNodeAdded: options.onNodeAdded,
      });
    } else {
      inst.el.innerHTML = html;
    }

    const patchMs = Math.max(0, Date.now() - patchStart);

    // Re-sync nested fragment instances that may have been updated inside this parent fragment
    syncDomInstances(inst.el);

    if (typeof options.onAfterPatch === 'function') {
      options.onAfterPatch(inst.el, inst);
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
  async function executeBatchRefresh(targets, chainIds = [], abortSignal = null) {
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

    const requestPayload = {
      pagePath,
      fragments: targets.map((t) => ({
        instanceId: t.instanceId,
        name: t.name,
        input: t.input || {},
        version: t.reqVersion,
      })),
    };

    const reqId = `frag_req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        credentials: 'same-origin',
        signal: abortSignal || undefined,
      });
    } catch (err) {
      const isAbort =
        (abortSignal && abortSignal.aborted) ||
        (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));

      if (debug) {
        debug.trackRequestEnd(reqId, {
          status: isAbort ? 'canceled' : 'failed',
          errorKind: isAbort ? 'canceled' : 'network',
        });
      }
      if (isAbort) {
        return { refreshed: [], canceled: true };
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

    lastFailedBatch = null;
    const resultsMap = (body && body.fragments) || {};
    const refreshedIds = [];
    let totalLoadMs = 0;
    let totalRenderMs = 0;

    for (const target of targets) {
      const inst = instances.get(target.instanceId);
      const fragResult = resultsMap[target.instanceId] || resultsMap[target.name];
      if (!inst || !fragResult) continue;
      if (typeof fragResult.loadMs === 'number') totalLoadMs += fragResult.loadMs;
      if (typeof fragResult.renderMs === 'number') totalRenderMs += fragResult.renderMs;

      const applied = applyFragmentPatch(
        inst,
        fragResult,
        target.reqVersion,
        chainIds[0] || null
      );
      if (applied) {
        refreshedIds.push(target.instanceId);
      }
    }

    for (const cid of chainIds) {
      if (debug) {
        debug.recordChainRefresh(cid, {
          fragmentIds: refreshedIds,
          status: 'ok',
          loadMs: totalLoadMs,
          renderMs: totalRenderMs,
          totalServerMs: body && typeof body.totalMs === 'number' ? body.totalMs : null,
        });
      }
    }

    return {
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
      return { refreshed: [], skipped: true };
    }

    const tagsToFlush = new Set(pendingTags);
    const chainsToFlush = [...pendingChains];
    pendingTags.clear();
    pendingChains.length = 0;

    syncDomInstances();

    // Find all mounted fragment instances whose `dependsOn` intersects `tagsToFlush`
    const matchingInstances = [];
    for (const inst of instances.values()) {
      let matched = false;
      for (const tag of tagsToFlush) {
        if (inst.dependsOn.has(tag) || inst.name === tag) {
          matched = true;
          break;
        }
      }
      if (matched) {
        matchingInstances.push(inst);
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
      return { refreshed: [], skipped: true };
    }

    // Parent/Child deduplication: if parent & child are both invalidated, parent refresh covers child
    const dedupedInstances = deduplicateParentChildFragments(matchingInstances);

    const targets = dedupedInstances.map((inst) => {
      inst.version += 1;
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
    const tagList = Array.isArray(tags) ? tags : [tags];
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
    syncDomInstances();

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
      return { refreshed: [], skipped: true };
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

      if (nextInput && typeof nextInput === 'object') {
        inst.input = refreshOpts.replaceInput
          ? { ...nextInput }
          : { ...inst.input, ...nextInput };
        if (inst.el && typeof inst.el.setAttribute === 'function') {
          inst.el.setAttribute('data-w-fragment-input', JSON.stringify(inst.input));
        }
      }

      return {
        instanceId: inst.instanceId,
        name: inst.name,
        pagePath: inst.pagePath,
        input: { ...inst.input },
        reqVersion: inst.version,
      };
    });

    return executeBatchRefresh(targets, [], abortController.signal);
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
          input: { ...inst.input },
          reqVersion: inst.version,
        });
      }
    }

    if (retryTargets.length === 0) {
      return { refreshed: [], skipped: true };
    }

    return executeBatchRefresh(retryTargets, chainIds);
  }

  return {
    syncDomInstances,
    invalidate,
    refresh,
    refreshFragments(items = []) {
      if (!Array.isArray(items) || items.length === 0) {
        return Promise.resolve({ refreshed: [], skipped: true });
      }
      syncDomInstances();
      for (const item of items) {
        const key = item.instanceId || item.name;
        const inst = instances.get(key) || Array.from(instances.values()).find((i) => i.name === key);
        if (inst) {
          if (item.input && typeof item.input === 'object') {
            inst.input = { ...item.input };
            if (inst.el && typeof inst.el.setAttribute === 'function') {
              inst.el.setAttribute('data-w-fragment-input', JSON.stringify(inst.input));
            }
          }
          pendingTags.add(inst.name);
        } else if (key) {
          pendingTags.add(String(key).trim());
        }
      }
      return flushInvalidations();
    },
    findFragmentsByTags(tags = []) {
      syncDomInstances();
      const tagSet = new Set((Array.isArray(tags) ? tags : [tags]).map((t) => String(t || '').trim()).filter(Boolean));
      const matching = [];
      for (const inst of instances.values()) {
        for (const t of tagSet) {
          if (inst.dependsOn.has(t) || inst.name === t) {
            matching.push(inst);
            break;
          }
        }
      }
      return deduplicateParentChildFragments(matching);
    },
    retryFailed,
    retryLastFailed: retryFailed,
    getInstance(instanceId) {
      syncDomInstances();
      return instances.get(instanceId) || null;
    },
    getInstances() {
      syncDomInstances();
      return Array.from(instances.values());
    },
    get hasFailedRefresh() {
      return Boolean(lastFailedBatch);
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
  if (Array.isArray(payload)) {
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
 * Create a client debug collector instance.
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled=false]
 * @param {number} [options.maxEvents=200]
 * @param {(entry: object) => void} [options.logger]
 */
function createClientDebugger(options = {}) {
  let enabled = Boolean(options.enabled);
  const maxEvents = typeof options.maxEvents === 'number' && options.maxEvents > 0 ? options.maxEvents : 200;
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
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
          tags: Array.isArray(tags) ? [...tags] : [],
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
        fragmentIds: Array.isArray(fragmentIds) ? [...fragmentIds] : [],
        status: status || 'ok',
        loadMs: typeof loadMs === 'number' ? loadMs : null,
        renderMs: typeof renderMs === 'number' ? renderMs : null,
        totalServerMs: typeof totalServerMs === 'number' ? totalServerMs : null,
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
        patchMs: typeof patchMs === 'number' ? patchMs : 0,
        loadMs: typeof loadMs === 'number' ? loadMs : null,
        renderMs: typeof renderMs === 'number' ? renderMs : null,
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
  createClientDebugger,
  summarizePayloadSafely,
} = require('./debug');

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
      : createClientDebugger({
          enabled: Boolean(options.debug),
          logger: options.debugLogger,
        }));

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
    onAfterPatch(patchedEl) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
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

  controllers = createControllerRuntime({
    datastar,
    fragments,
    debug,
    apiConfig,
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
  }

  const runtime = {
    api,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    mount,
    unmount,
    destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
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
  const runtime = createClientRuntime(options);
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => runtime.mount(), { once: true });
    } else {
      runtime.mount();
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
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,

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
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry
  createClientDebugger,
  summarizePayloadSafely,
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
  createClientDebugger,
  summarizePayloadSafely,
} = require('./debug');

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
      : createClientDebugger({
          enabled: Boolean(options.debug),
          logger: options.debugLogger,
        }));

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
    onAfterPatch(patchedEl) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
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

  controllers = createControllerRuntime({
    datastar,
    fragments,
    debug,
    apiConfig,
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
  }

  const runtime = {
    api,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    mount,
    unmount,
    destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
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
  const runtime = createClientRuntime(options);
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => runtime.mount(), { once: true });
    } else {
      runtime.mount();
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
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,

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
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry
  createClientDebugger,
  summarizePayloadSafely,
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
  createClientDebugger,
  summarizePayloadSafely,
} = require('./debug');

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
      : createClientDebugger({
          enabled: Boolean(options.debug),
          logger: options.debugLogger,
        }));

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
    onAfterPatch(patchedEl) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
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

  controllers = createControllerRuntime({
    datastar,
    fragments,
    debug,
    apiConfig,
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
  }

  const runtime = {
    api,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    mount,
    unmount,
    destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
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
  const runtime = createClientRuntime(options);
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => runtime.mount(), { once: true });
    } else {
      runtime.mount();
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
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,

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
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry
  createClientDebugger,
  summarizePayloadSafely,
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
  createClientDebugger,
  summarizePayloadSafely,
} = require('./debug');

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
      : createClientDebugger({
          enabled: Boolean(options.debug),
          logger: options.debugLogger,
        }));

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
    onAfterPatch(patchedEl) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
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

  controllers = createControllerRuntime({
    datastar,
    fragments,
    debug,
    apiConfig,
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
  }

  const runtime = {
    api,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    mount,
    unmount,
    destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
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
  const runtime = createClientRuntime(options);
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => runtime.mount(), { once: true });
    } else {
      runtime.mount();
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
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,

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
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry
  createClientDebugger,
  summarizePayloadSafely,
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
  createClientDebugger,
  summarizePayloadSafely,
} = require('./debug');

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
      : createClientDebugger({
          enabled: Boolean(options.debug),
          logger: options.debugLogger,
        }));

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
    onAfterPatch(patchedEl) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
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

  controllers = createControllerRuntime({
    datastar,
    fragments,
    debug,
    apiConfig,
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
  }

  const runtime = {
    api,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    mount,
    unmount,
    destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
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
  const runtime = createClientRuntime(options);
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => runtime.mount(), { once: true });
    } else {
      runtime.mount();
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
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,

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
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry
  createClientDebugger,
  summarizePayloadSafely,
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
  createClientDebugger,
  summarizePayloadSafely,
} = require('./debug');

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
      : createClientDebugger({
          enabled: Boolean(options.debug),
          logger: options.debugLogger,
        }));

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
    onAfterPatch(patchedEl) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
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

  controllers = createControllerRuntime({
    datastar,
    fragments,
    debug,
    apiConfig,
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
  }

  const runtime = {
    api,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    mount,
    unmount,
    destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
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
  const runtime = createClientRuntime(options);
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => runtime.mount(), { once: true });
    } else {
      runtime.mount();
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
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,

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
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry
  createClientDebugger,
  summarizePayloadSafely,
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
  createClientDebugger,
  summarizePayloadSafely,
} = require('./debug');

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
      : createClientDebugger({
          enabled: Boolean(options.debug),
          logger: options.debugLogger,
        }));

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
    onAfterPatch(patchedEl) {
      if (controllers) {
        controllers.mountSubtree(patchedEl);
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

  controllers = createControllerRuntime({
    datastar,
    fragments,
    debug,
    apiConfig,
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
  }

  const runtime = {
    api,
    fragments,
    controllers,
    datastar,
    adapter: datastar,
    debug,
    register: (name, def, meta) => controllers.register(name, def, meta),
    mount,
    unmount,
    destroy,
    getControllerInstance: (el, name) => controllers.getInstanceForElement(el, name),
    getController: (el, name) => controllers.getInstanceForElement(el, name),
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    forms: {
      parse: parseFormElement,
      create: (formEl, formOpts = {}) =>
        createFormHandle(formEl, {
          api,
          datastar,
          debug,
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
  const runtime = createClientRuntime(options);
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => runtime.mount(), { once: true });
    } else {
      runtime.mount();
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
  createControllerRuntime,
  queryScopedTargets,
  isTargetInControllerScope,

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
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry
  createClientDebugger,
  summarizePayloadSafely,
};


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
    }),
    computed: {
        filterSummaryText: ({ state }) => {
            const { search, status, priority } = state.applied;
            return `Filter: ${status}/${priority}${search ? ` • "${search}"` : ''} • Page ${state.page}`;
        },
        editingBadge: ({ state }) => {
            return state.selectedTodoId ? `Task #${state.selectedTodoId}` : 'No Task Selected';
        },
        hasInsights: ({ tasks }) => Boolean(tasks.insights?.data),
        insightsHeadline: ({ tasks }) => tasks.insights?.data?.recommendation || '',
        insightsDetail: ({ tasks }) => {
            const data = tasks.insights?.data;
            if (!data)
                return '';
            return `Completion: ${data.percentCompleted}% (${data.completed}/${data.total}) • Top Category: ${data.topCategory}`;
        },
    },
    tasks: {
        insights: ({ api }) => ({
            run: () => api.get('/api/todos/insights'),
            concurrency: 'latest',
        }),
    },
    connect({ forms }) {
        const createForm = forms.get('create-todo', {
            resetOnSuccess: true,
        });
        return () => {
            if (createForm)
                createForm.clearErrors();
        };
    },
    actions: {
        async applyFilters({ state, refresh }) {
            const next = { ...state.draft };
            const res = await refresh('todos-list', {
                search: next.search,
                status: next.status,
                priority: next.priority,
                page: 1,
                limit: 4,
            });
            if (res && res.ok !== false) {
                state.applied = next;
                state.page = 1;
            }
        },
        async setQuickStatus({ state, refresh }, _event, actionEl) {
            if (!actionEl)
                return;
            const nextStatus = actionEl.getAttribute('data-status') || 'all';
            state.draft.status = nextStatus;
            const next = { ...state.draft };
            const res = await refresh('todos-list', {
                search: next.search,
                status: next.status,
                priority: next.priority,
                page: 1,
                limit: 4,
            });
            if (res && res.ok !== false) {
                state.applied = next;
                state.page = 1;
            }
        },
        async setQuickPriority({ state, refresh }, _event, actionEl) {
            if (!actionEl)
                return;
            const clicked = actionEl.getAttribute('data-priority') || 'all';
            const nextPriority = state.draft.priority === clicked ? 'all' : clicked;
            state.draft.priority = nextPriority;
            const next = { ...state.draft };
            const res = await refresh('todos-list', {
                search: next.search,
                status: next.status,
                priority: next.priority,
                page: 1,
                limit: 4,
            });
            if (res && res.ok !== false) {
                state.applied = next;
                state.page = 1;
            }
        },
        async resetFilters({ state, refresh }) {
            const initial = { search: '', status: 'all', priority: 'all' };
            const res = await refresh('todos-list', {
                search: '',
                status: 'all',
                priority: 'all',
                page: 1,
                limit: 4,
            });
            if (res && res.ok !== false) {
                state.draft = { ...initial };
                state.applied = { ...initial };
                state.page = 1;
            }
        },
        async nextPage({ state, refresh }) {
            const nextPageNum = Number(state.page || 1) + 1;
            const res = await refresh('todos-list', {
                search: state.applied.search,
                status: state.applied.status,
                priority: state.applied.priority,
                page: nextPageNum,
                limit: 4,
            });
            if (res && res.ok !== false) {
                state.page = nextPageNum;
            }
        },
        async prevPage({ state, refresh }) {
            const prevPageNum = Math.max(1, Number(state.page || 1) - 1);
            const res = await refresh('todos-list', {
                search: state.applied.search,
                status: state.applied.status,
                priority: state.applied.priority,
                page: prevPageNum,
                limit: 4,
            });
            if (res && res.ok !== false) {
                state.page = prevPageNum;
            }
        },
        async selectTodoForEdit({ state, forms, api }, _event, actionEl) {
            if (!actionEl)
                return;
            const id = actionEl.getAttribute('data-todo-id');
            if (!id || !id.trim())
                return;
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
            state.selectedTodoId = Number(id);
            // Client requests the record via typed GET with latest concurrency
            const todo = await api.get(`/api/todos/${id}`, {
                key: 'todos:edit-fetch',
                concurrency: 'latest',
            });
            if (!todo || typeof todo !== 'object')
                return;
            // If user typed into the form while the fetch was in flight, do not overwrite dirty draft
            if (editForm.dirty)
                return;
            editForm.setAction(`/api/todos/${todo.id}`);
            editForm.fill(todo, { baseline: true });
        },
        resetDraftForm({ forms }) {
            const editForm = forms.get('edit-todo');
            if (editForm) {
                editForm.reset();
            }
        },
        async loadInsights({ tasks }) {
            await tasks.insights.run();
        },
    },
});

},
    "./client-entry": function(module, exports, require) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../../core/client");
const todos_client_1 = __importDefault(require("./pages/todos.client"));
(0, client_1.bootClient)({
    debug: true,
    controllers: {
        todos: todos_client_1.default,
    },
});

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
