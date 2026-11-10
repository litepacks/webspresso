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
  createClientDebugger,
  summarizePayloadSafely,
} = require('./debug');

const {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
} = require('./storage');

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
  get createLiteClientRuntime() {
    return require('./lite').createLiteClientRuntime;
  },
  get bootLiteClient() {
    return require('./lite').bootLiteClient;
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
  getByPath,
  setByPath,
  morphDomTrees,
  parseHtmlFragment,

  // Debug & Telemetry
  createClientDebugger,
  summarizePayloadSafely,

  // Client Storage & Persistence
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
};

