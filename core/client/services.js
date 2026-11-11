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
