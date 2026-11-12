'use strict';

/**
 * Webspresso Lightweight Client Runtime (`core/client/lite.js`)
 *
 * Micro-footprint (~16.9 KB Brotli) client runtime for server-driven applications.
 * Includes:
 *   - SSR Fragment coordinator (batch refresh, invalidation, auto-revalidation, DOM morphing, focus preservation)
 *   - Native HTML Form enhancement (`<form data-w-form>`, validation errors, lifecycle hooks, draft persistence)
 *   - Shared Client Services & optional lazy UI hosts (`defineClientService`, `services.get`)
 *   - Typed API client with auto-invalidation
 * Excludes:
 *   - Reactive signals engine, controller proxies, and complex task coordinators.
 */

const {
  ClientRequestError,
  createApiClient,
  discoverCsrfToken,
  buildRequestUrl,
  extractValidationErrors,
  unwrapApiResultAndInvalidate,
} = require('./api');

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
  createClientStorage,
  defaultStorage,
  StorageAdapter,
  MemoryStorage,
} = require('./storage');

const { NOOP_DEBUGGER } = require('./utils');

const NOOP_SERVICES = Object.freeze({
  get(name) {
    const err = new Error(`Unknown client service "${name}".`);
    err.code = 'CLIENT_SERVICE_NOT_FOUND';
    return Promise.reject(err);
  },
  has() {
    return false;
  },
  isInitialized() {
    return false;
  },
  peek() {
    return undefined;
  },
  register() {},
  registerMany() {},
  dispose() {},
  destroy() {},
  isDisposed: false,
});

let _servicesMod = null;
function getServicesModule() {
  if (!_servicesMod) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _servicesMod = reqFn('./services');
  }
  return _servicesMod;
}

let _hostMod = null;
function getHostModule() {
  if (!_hostMod) {
    const reqFn = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
    _hostMod = reqFn('./host');
  }
  return _hostMod;
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
 * Create a lightweight client runtime instance without reactive signals engine.
 */
function createLiteClientRuntime(options = {}) {
  const rootOption = options.root || options.document;
  const debug = NOOP_DEBUGGER;

  const fragments = createFragmentCoordinator({
    root: rootOption,
    fetch: options.fetch,
    endpoint: options.fragmentEndpoint || DEFAULT_FRAGMENT_ENDPOINT,
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
      : options.services && typeof options.services === 'object'
        ? getServicesModule().createClientServiceRegistry({
            root: rootOption,
            api,
            debug,
            getRuntime: () => runtime,
            services: options.services,
          })
        : NOOP_SERVICES;

  const formsRegistry = new Map();
  function getFormHandle(nameOrEl) {
    if (!nameOrEl) return null;
    if (typeof nameOrEl === 'string') {
      const el = rootOption
        ? (rootOption.querySelector ? rootOption.querySelector(`form[data-w-form="${nameOrEl}"]`) : null)
        : (typeof document !== 'undefined' ? document.querySelector(`form[data-w-form="${nameOrEl}"]`) : null);
      if (!el) return null;
      if (!formsRegistry.has(el)) {
        formsRegistry.set(
          el,
          createFormHandle(el, {
            api,
            services,
            onInvalidate: (tags) => fragments.invalidate(tags),
          })
        );
      }
      return formsRegistry.get(el);
    }
    if (nameOrEl && typeof nameOrEl.tagName === 'string' && nameOrEl.tagName.toLowerCase() === 'form') {
      if (!formsRegistry.has(nameOrEl)) {
        formsRegistry.set(
          nameOrEl,
          createFormHandle(nameOrEl, {
            api,
            services,
            onInvalidate: (tags) => fragments.invalidate(tags),
          })
        );
      }
      return formsRegistry.get(nameOrEl);
    }
    return null;
  }

  function boot(container) {
    const docRoot = container || (typeof document !== 'undefined' ? document : null);
    if (!docRoot) return;
    fragments.syncDomInstances();

    // Auto-bind data-w-form elements
    const formEls = docRoot.querySelectorAll ? docRoot.querySelectorAll('form[data-w-form]') : [];
    for (const formEl of formEls) {
      getFormHandle(formEl);
    }
  }

  function destroy() {
    for (const handle of formsRegistry.values()) {
      try {
        handle.destroy();
      } catch (_e) {}
    }
    formsRegistry.clear();
    if (fragments && typeof fragments.dispose === 'function') {
      fragments.dispose();
    }
    services.dispose();
  }

  runtime = {
    fragments,
    api,
    services,
    registerService: (name, def) => services.register(name, def),
    forms: {
      get: getFormHandle,
    },
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    boot,
    destroy,
    dispose: destroy,
  };

  return runtime;
}

/**
 * Convenience entrypoint: Boot Webspresso Lite on DOM ready.
 */
function bootLiteClient(options = {}) {
  const runtime = createLiteClientRuntime(options);

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => runtime.boot(document), { once: true });
    } else {
      runtime.boot(document);
    }
  }

  return runtime;
}

module.exports = {
  createLiteClientRuntime,
  bootLiteClient,
  createFragmentCoordinator,
  createFormHandle,
  parseFormElement,
  createApiClient,
  ClientRequestError,
  DEFAULT_FRAGMENT_ENDPOINT,
  apiResult: (data, meta) => getServerFragments().apiResult(data, meta),
  isApiResultEnvelope: (val) => getServerFragments().isApiResultEnvelope(val),
  defineFragment: (def) => getServerFragments().defineFragment(def),
  createClientStorage,
  defaultStorage,
  StorageAdapter,
  MemoryStorage,
  get defineClientService() {
    return getServicesModule().defineClientService;
  },
  get createClientServiceRegistry() {
    return getServicesModule().createClientServiceRegistry;
  },
  get createServiceError() {
    return getServicesModule().createServiceError;
  },
  get createClientHostManager() {
    return getHostModule().createClientHostManager;
  },
};

