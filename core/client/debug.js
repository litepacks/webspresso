'use strict';

/**
 * Webspresso Client Debug & Telemetry Inspector
 * Tracks active controllers, active requests/concurrency states,
 * mutation -> invalidation -> refresh -> patch causal chains,
 * fragment timings (loadMs, renderMs, patchMs), discarded stale responses,
 * and lifecycle cleanup errors without logging raw form values or sensitive payloads.
 */

const { NOOP_DEBUGGER } = require('./utils');

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
 * Internal active debugger implementation that allocates tracking ring buffers.
 */
function createActiveDebugger(options = {}) {
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

/**
 * Create a client debug collector instance.
 * Returns a zero-allocation stub if debugging is disabled.
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled=false]
 * @param {number} [options.maxEvents=200]
 * @param {(entry: object) => void} [options.logger]
 */
function createClientDebugger(options = {}) {
  if (!options.enabled && process.env.NODE_ENV === 'production') {
    return NOOP_DEBUGGER;
  }
  if (!options.enabled && !options.logger && !options.maxEvents) {
    let activeInstance = null;
    return {
      get enabled() {
        return activeInstance ? activeInstance.enabled : false;
      },
      setEnabled(val) {
        if (val && !activeInstance) {
          activeInstance = createActiveDebugger({ ...options, enabled: true });
        } else if (activeInstance) {
          activeInstance.setEnabled(val);
        }
      },
      trackControllerMount(id, name, el) {
        if (activeInstance) activeInstance.trackControllerMount(id, name, el);
      },
      trackControllerUnmount(id, name) {
        if (activeInstance) activeInstance.trackControllerUnmount(id, name);
      },
      trackCleanupError(id, name, p, err) {
        if (activeInstance) activeInstance.trackCleanupError(id, name, p, err);
      },
      trackRequestStart(args) {
        return activeInstance
          ? activeInstance.trackRequestStart(args)
          : { requestId: args.requestId, status: 'in-flight' };
      },
      trackRequestEnd(id, out) {
        return activeInstance ? activeInstance.trackRequestEnd(id, out) : { status: 'completed' };
      },
      trackDiscardedResponse(args) {
        return activeInstance ? activeInstance.trackDiscardedResponse(args) : { reason: args.reason };
      },
      startCausalChain(args) {
        return activeInstance ? activeInstance.startCausalChain(args) : '';
      },
      recordChainRefresh(id, args) {
        if (activeInstance) activeInstance.recordChainRefresh(id, args);
      },
      recordChainPatch(id, args) {
        if (activeInstance) activeInstance.recordChainPatch(id, args);
      },
      recordEvent(t, d) {
        return activeInstance ? activeInstance.recordEvent(t, d) : null;
      },
      getSnapshot() {
        return activeInstance ? activeInstance.getSnapshot() : NOOP_DEBUGGER.getSnapshot();
      },
      clear() {
        if (activeInstance) activeInstance.clear();
      },
    };
  }

  return createActiveDebugger(options);
}

module.exports = {
  createClientDebugger,
  summarizePayloadSafely,
};

