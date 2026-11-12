'use strict';

/**
 * Webspresso Client UI Host Lifecycle Helper (`core/client/host.js`)
 *
 * Manages optional, lazy DOM host containers for client services that need
 * to render shared UI outside normal SSR fragment patch regions.
 *
 * Principles:
 * - Zero DOM creation until a service explicitly requests a host (`mountHost`).
 * - Idempotent per host key within a runtime: repeated calls return the same host handle
 *   and never create duplicate DOM containers.
 * - Supports attaching to an existing layout element (`target` / `selector` / `[data-w-host]`)
 *   or lazily creating a container appended outside fragment areas (default: `document.body`).
 * - Clean unmount and resource disposal contract when the owning service or runtime is destroyed.
 * - Agnostic to UI rendering: does not impose any template language, virtual DOM, or widget type.
 */

const { decorateElement } = require('./utils');

/**
 * Resolve the owning Document from a root Document or Element.
 *
 * @param {Document|Element|null} [root]
 * @returns {Document|null}
 */
function resolveDocument(root) {
  if (root) {
    if (root.nodeType === 9) return root;
    if (root.ownerDocument) return root.ownerDocument;
  }
  return typeof document !== 'undefined' ? document : null;
}

/**
 * Resolve the default mount container outside `[data-w-fragment]` areas.
 *
 * @param {Document|Element|null} [root]
 * @param {Document|null} [doc]
 * @returns {Element|null}
 */
function resolveDefaultContainer(root, doc) {
  if (root && root.nodeType === 1 && root.tagName !== 'HTML') {
    if (doc && doc.body && (root === doc.body || root === doc.documentElement)) {
      return doc.body;
    }
    const insideFragment =
      typeof root.closest === 'function' ? Boolean(root.closest('[data-w-fragment]')) : false;
    if (!insideFragment) {
      return root;
    }
    if (!doc || !doc.body) {
      return root;
    }
  }
  if (doc) {
    return doc.body || doc.documentElement || null;
  }
  return root && root.nodeType === 1 ? root : null;
}

/**
 * Create a runtime-scoped UI Host Manager.
 *
 * @param {object} [options]
 * @param {Document|Element|null} [options.root]
 * @param {object} [options.debug]
 * @returns {object}
 */
function createClientHostManager(options = {}) {
  const root = options.root || null;
  const debug = options.debug || null;
  const activeHosts = new Map(); // key -> hostRecord
  let disposed = false;

  /**
   * Mount or retrieve a shared UI host by key.
   *
   * @param {string|object} [keyOrOptions]
   * @param {object} [maybeOptions]
   * @param {string} [defaultKey]
   */
  function mount(keyOrOptions = {}, maybeOptions = {}, defaultKey = 'default') {
    if (disposed) {
      const err = new Error('Cannot mount UI host on a disposed client runtime.');
      err.code = 'CLIENT_RUNTIME_DISPOSED';
      throw err;
    }

    let opts = {};
    let key = defaultKey;

    if (typeof keyOrOptions === 'string') {
      key = keyOrOptions.trim() || defaultKey;
      opts = maybeOptions && typeof maybeOptions === 'object' ? maybeOptions : {};
    } else if (keyOrOptions && typeof keyOrOptions === 'object') {
      opts = keyOrOptions;
      if (typeof opts.key === 'string' && opts.key.trim()) {
        key = opts.key.trim();
      } else if (typeof opts.name === 'string' && opts.name.trim()) {
        key = opts.name.trim();
      }
    }

    if (!key) {
      throw new TypeError('mountHost() requires a non-empty host key.');
    }

    const existing = activeHosts.get(key);
    if (existing && existing.mounted) {
      // If the element is still connected (or in a headless/custom tree), reuse it
      if (!existing.el || existing.el.isConnected !== false || !existing.created) {
        return existing.handle;
      }
      // If a created host element was externally removed from DOM, clean up before re-creating
      existing.handle.unmount();
    }

    const doc = resolveDocument(opts.root || root);
    let el = null;
    let created = false;
    const prevAttributes = new Map();

    // 1. Explicit target Element
    if (opts.target && opts.target.nodeType === 1) {
      el = opts.target;
    }

    // 2. Explicit CSS selector
    if (!el && typeof opts.selector === 'string' && opts.selector.trim()) {
      const searchRoot = opts.root || root || doc;
      if (searchRoot && typeof searchRoot.querySelector === 'function') {
        el = searchRoot.querySelector(opts.selector.trim());
      }
      if (!el && doc && searchRoot !== doc && typeof doc.querySelector === 'function') {
        el = doc.querySelector(opts.selector.trim());
      }
    }

    // 3. Existing layout placeholder `[data-w-host="<key>"]` not owned by another active host manager
    if (!el && opts.createOnly !== true) {
      const searchRoot = opts.root || root || doc;
      if (searchRoot && typeof searchRoot.querySelectorAll === 'function') {
        const candidates = searchRoot.querySelectorAll(`[data-w-host="${key}"]`);
        for (let i = 0; i < candidates.length; i++) {
          const cand = candidates[i];
          if (!cand.__wHostManager || cand.__wHostManager === api) {
            el = cand;
            break;
          }
        }
      }
    }

    // 4. Create a new host container outside fragment regions
    if (!el) {
      if (!doc || typeof doc.createElement !== 'function') {
        const err = new Error(`Cannot create UI host "${key}": no Document is available in the current environment.`);
        err.code = 'CLIENT_HOST_NO_DOCUMENT';
        throw err;
      }
      const tagName = typeof opts.tagName === 'string' && opts.tagName.trim() ? opts.tagName.trim() : 'div';
      el = doc.createElement(tagName);
      created = true;

      const container =
        (opts.container && opts.container.nodeType === 1 ? opts.container : null) ||
        resolveDefaultContainer(opts.root || root, doc);

      if (container && typeof container.appendChild === 'function') {
        container.appendChild(el);
      }
    }

    function recordAndSetAttr(attrName, attrVal) {
      if (!el || typeof el.setAttribute !== 'function') return;
      if (!created && !prevAttributes.has(attrName)) {
        prevAttributes.set(attrName, el.hasAttribute(attrName) ? el.getAttribute(attrName) : null);
      }
      el.setAttribute(attrName, String(attrVal));
    }

    recordAndSetAttr('data-w-host', key);

    if (typeof opts.id === 'string' && opts.id.trim()) {
      recordAndSetAttr('id', opts.id.trim());
    }

    if (typeof opts.className === 'string' && opts.className.trim()) {
      if (created) {
        el.className = opts.className.trim();
      } else {
        recordAndSetAttr('class', opts.className.trim());
      }
    }

    if (opts.attributes && typeof opts.attributes === 'object') {
      for (const [attrName, attrVal] of Object.entries(opts.attributes)) {
        if (attrVal === undefined || attrVal === null || attrVal === false) continue;
        recordAndSetAttr(attrName, attrVal === true ? '' : String(attrVal));
      }
    }

    try {
      Object.defineProperty(el, '__wHostManager', {
        value: api,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    } catch (_e) {
      el.__wHostManager = api;
    }

    const decoratedEl = decorateElement(el);
    const unmountCallbacks = [];
    let isMounted = true;

    function onUnmount(fn) {
      if (typeof fn !== 'function') return () => {};
      if (!isMounted) {
        try {
          fn();
        } catch (_e) {}
        return () => {};
      }
      unmountCallbacks.push(fn);
      return () => {
        const idx = unmountCallbacks.indexOf(fn);
        if (idx !== -1) unmountCallbacks.splice(idx, 1);
      };
    }

    function clear() {
      if (el) {
        el.innerHTML = '';
      }
    }

    function unmount() {
      if (!isMounted) return;
      isMounted = false;
      activeHosts.delete(key);

      for (let i = unmountCallbacks.length - 1; i >= 0; i--) {
        try {
          unmountCallbacks[i](decoratedEl);
        } catch (err) {
          if (debug && typeof debug.trackCleanupError === 'function') {
            debug.trackCleanupError(`host_${key}`, key, 'host:unmount', err);
          }
        }
      }
      unmountCallbacks.length = 0;

      if (el) {
        if (el.__wHostManager === api) {
          delete el.__wHostManager;
        }
        if (created) {
          if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
            el.parentNode.removeChild(el);
          } else if (typeof el.remove === 'function') {
            el.remove();
          }
        } else {
          if (opts.clearOnUnmount !== false) {
            el.innerHTML = '';
          }
          for (const [attrName, prevVal] of prevAttributes.entries()) {
            if (prevVal === null) {
              el.removeAttribute(attrName);
            } else {
              el.setAttribute(attrName, prevVal);
            }
          }
        }
      }

      if (debug && typeof debug.recordEvent === 'function') {
        debug.recordEvent('host:unmount', { key, created });
      }
    }

    const handle = Object.freeze({
      key,
      el: decoratedEl,
      created,
      get mounted() {
        return isMounted;
      },
      clear,
      onUnmount,
      unmount,
      destroy: unmount,
    });

    activeHosts.set(key, {
      key,
      el: decoratedEl,
      created,
      get mounted() {
        return isMounted;
      },
      handle,
    });

    if (debug && typeof debug.recordEvent === 'function') {
      debug.recordEvent('host:mount', { key, created });
    }

    return handle;
  }

  function get(key) {
    const record = activeHosts.get(String(key || '').trim());
    return record && record.mounted ? record.handle : null;
  }

  function has(key) {
    const record = activeHosts.get(String(key || '').trim());
    return Boolean(record && record.mounted);
  }

  function unmount(key) {
    const record = activeHosts.get(String(key || '').trim());
    if (record && record.mounted) {
      record.handle.unmount();
      return true;
    }
    return false;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const records = Array.from(activeHosts.values());
    activeHosts.clear();
    for (let i = records.length - 1; i >= 0; i--) {
      try {
        records[i].handle.unmount();
      } catch (err) {
        if (debug && typeof debug.trackCleanupError === 'function') {
          debug.trackCleanupError(`host_${records[i].key}`, records[i].key, 'host:dispose', err);
        }
      }
    }
  }

  const api = {
    mount,
    get,
    has,
    unmount,
    dispose,
    get isDisposed() {
      return disposed;
    },
  };

  return api;
}

module.exports = {
  createClientHostManager,
  resolveDocument,
  resolveDefaultContainer,
};

