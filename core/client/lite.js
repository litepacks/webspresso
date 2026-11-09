'use strict';

/**
 * Webspresso Lightweight Client Runtime (`core/client/lite.js`)
 *
 * Micro-footprint (~8 KB Brotli) client runtime for server-driven applications.
 * Includes:
 *   - SSR Fragment coordinator (batch refresh, invalidation, DOM morphing, focus preservation)
 *   - Native HTML Form enhancement (`<form data-w-form>`, validation errors, double-submit protection)
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

const { NOOP_DEBUGGER } = require('./utils');

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

  return {
    fragments,
    api,
    forms: {
      get: getFormHandle,
    },
    invalidate: (tags, meta) => fragments.invalidate(tags, meta),
    refresh: (idOrName, input, opts) => fragments.refresh(idOrName, input, opts),
    boot,
  };
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
};

