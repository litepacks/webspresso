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

const { getByPath, setByPath } = require('../utils');

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

