'use strict';

/**
 * Cross-Tab Synchronization Bus (`core/client/sync.js`).
 *
 * Uses native `BroadcastChannel` when available, falling back to `window.storage`
 * events. Guarantees:
 * - Echo-loop prevention via unique per-runtime `tabId`.
 * - Clean `close()` / `removeEventListener()` teardown on `destroy()`.
 * - Safe JSON serialization and prototype-pollution key filtering.
 */

const { isFn, uid } = require('./utils');

const DEFAULT_CHANNEL_NAME = 'webspresso:sync';
const STORAGE_BRIDGE_KEY = '__ws_tab_sync__';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizePayload(val, depth = 0) {
  if (depth > 8 || val === null || val === undefined) return val;
  const t = typeof val;
  if (t === 'string' || t === 'number' || t === 'boolean') return val;
  if (t !== 'object') return undefined;
  if (Array.isArray(val)) return val.map((item) => sanitizePayload(item, depth + 1));
  const out = {};
  for (const k of Object.keys(val)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    const clean = sanitizePayload(val[k], depth + 1);
    if (clean !== undefined) out[k] = clean;
  }
  return out;
}

/**
 * Create a cross-tab synchronization bus instance.
 * @param {object} [options={}]
 * @param {string} [options.channelName='webspresso:sync']
 * @param {object} [options.root]
 * @param {Function} [options.BroadcastChannel] - Optional constructor override (useful in tests)
 */
function createCrossTabSync(options = {}) {
  const channelName = options.channelName || DEFAULT_CHANNEL_NAME;
  const tabId = uid('tab');
  const listeners = new Set();
  let destroyed = false;

  const doc =
    options.root && options.root.nodeType === 9
      ? options.root
      : (options.root && options.root.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

  const BCCtor =
    options.BroadcastChannel ||
    (win && isFn(win.BroadcastChannel) ? win.BroadcastChannel : null) ||
    (typeof BroadcastChannel === 'function' ? BroadcastChannel : null);

  let bc = null;

  function dispatchIncoming(raw) {
    if (destroyed || !raw || typeof raw !== 'object') return;
    if (raw.v !== 1 || !raw.senderId || raw.senderId === tabId) return;
    const msg = {
      kind: raw.kind,
      topic: raw.topic,
      payload: sanitizePayload(raw.payload),
      senderId: raw.senderId,
    };
    for (const fn of Array.from(listeners)) {
      try {
        fn(msg);
      } catch (_e) {
        // Isolate subscriber errors
      }
    }
  }

  const onBcMessage = (event) => {
    dispatchIncoming(event && event.data);
  };

  const storageKey = `${STORAGE_BRIDGE_KEY}:${channelName}`;
  const onStorage = (event) => {
    if (!event || event.key !== storageKey || !event.newValue) return;
    try {
      dispatchIncoming(JSON.parse(event.newValue));
    } catch (_e) {}
  };

  if (BCCtor) {
    try {
      bc = new BCCtor(channelName);
      if (bc && isFn(bc.addEventListener)) {
        bc.addEventListener('message', onBcMessage);
      } else if (bc) {
        bc.onmessage = onBcMessage;
      }
    } catch (_e) {
      bc = null;
    }
  }

  if (!bc && win && isFn(win.addEventListener)) {
    win.addEventListener('storage', onStorage);
  }

  function publish(kind, topic, payload) {
    if (destroyed) return false;
    const envelope = {
      v: 1,
      senderId: tabId,
      kind: String(kind || 'event'),
      topic: String(topic || ''),
      payload: sanitizePayload(payload),
      ts: Date.now(),
    };

    if (bc && isFn(bc.postMessage)) {
      try {
        bc.postMessage(envelope);
        return true;
      } catch (_e) {}
    }

    if (win && win.localStorage && isFn(win.localStorage.setItem)) {
      try {
        win.localStorage.setItem(storageKey, JSON.stringify(envelope));
        return true;
      } catch (_e) {}
    }

    return false;
  }

  function subscribe(handler) {
    if (!isFn(handler) || destroyed) return () => {};
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    listeners.clear();
    if (bc) {
      try {
        if (isFn(bc.removeEventListener)) {
          bc.removeEventListener('message', onBcMessage);
        }
        if (isFn(bc.close)) {
          bc.close();
        }
      } catch (_e) {}
      bc = null;
    }
    if (win && isFn(win.removeEventListener)) {
      try {
        win.removeEventListener('storage', onStorage);
      } catch (_e) {}
    }
  }

  return {
    tabId,
    channelName,
    publish,
    subscribe,
    destroy,
  };
}

module.exports = {
  createCrossTabSync,
  DEFAULT_CHANNEL_NAME,
};

