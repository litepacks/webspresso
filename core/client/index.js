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

