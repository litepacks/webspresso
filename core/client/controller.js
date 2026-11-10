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
const { decorateElement } = require('./utils');

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
  if (Array.isArray(val)) {
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
    return Array.isArray(val) ? [...val] : { ...val };
  }
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
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
  if (!Array.isArray(newArr) || !Array.isArray(oldArr)) return !Object.is(newArr, oldArr);
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
  } else if (Array.isArray(source)) {
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
      if ((deep || (source && typeof source === 'object' && typeof source !== 'function' && !Array.isArray(source))) && newValue && typeof newValue === 'object') {
        deepTouch(newValue);
      }
    } catch (_err) {
      return;
    }

    const isArr = Array.isArray(source);

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
    const isArr = Array.isArray(p);
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

  if (Array.isArray(persistOpt)) {
    keys = persistOpt.map(String);
  } else if (typeof persistOpt === 'string') {
    const s = persistOpt.trim().toLowerCase();
    storageType = s === 'session' ? 'session' : 'local';
  } else if (typeof persistOpt === 'object' && persistOpt !== null) {
    if (Array.isArray(persistOpt.keys)) {
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
    if (typeof persistOpt.debounce === 'number') {
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
      } else if (Array.isArray(source)) {
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
          if ((deep || (source && typeof source === 'object' && typeof source !== 'function' && !Array.isArray(source))) && newValue && typeof newValue === 'object') {
            deepTouch(newValue);
          }
        } catch (err) {
          handleError(err, 'watch:getter');
          return;
        }

        const isArr = Array.isArray(source);

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
    function resolvePersistDriver(pConfig) {
      if (!pConfig) return storageCtx.local;
      if (pConfig.isGlobal) {
        return defaultStorage[pConfig.storageType] || defaultStorage.local;
      }
      return storageCtx[pConfig.storageType] || storageCtx.local;
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
      forms: formsAccessor,
      target: targetAccessor,
      targets: targetsAccessor,
      tasks: tasksProxy,
      task: createTaskInstance,
      storage: storageCtx,
      clearPersistedState: () => {
        if (persistConfig) {
          const driver = resolvePersistDriver(persistConfig);
          driver.remove(persistConfig.storageKey);
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
      refresh: async (idOrName, input, opts) => {
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
        refresh: (input, opts) => {
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

    // Hydrate persisted state if defined
    if (persistConfig) {
      const driver = resolvePersistDriver(persistConfig);
      const savedData = driver.get(persistConfig.storageKey, null);
      if (savedData && typeof savedData === 'object' && !Array.isArray(savedData)) {
        for (const [k, v] of Object.entries(savedData)) {
          if (persistConfig.keys && !persistConfig.keys.includes(k)) continue;
          if (Object.prototype.hasOwnProperty.call(initialRawState, k)) {
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
      const decoratedEl = decorateElement(actionEl);
      currentActionEl = decoratedEl || null;
      const prevContext = activeControllerContext;
      activeControllerContext = ctx;
      try {
        const res = fn(ctx, event, decoratedEl);
        if (res && typeof res.then === 'function') {
          return res.catch((err) => {
            // Ignore canceled/superseded request errors on disconnected or superseded instances
            if (err && err.isCanceled) return undefined;
            handleControllerError(err, {
              action: actionName,
              event,
              actionEl: decoratedEl,
              phase: 'action',
            });
            throw err;
          });
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

    // Auto-sync persisted state changes back to storage
    if (persistConfig) {
      const driver = resolvePersistDriver(persistConfig);
      let persistTimer = null;
      let lastSavedJson = '';

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
  watch,
  getActiveControllerContext,
};

