'use strict';

/**
 * Webspresso Client-Side SSR Fragment Coordinator & Invalidation Engine
 *
 * Responsibilities:
 * - Discovers active `[data-w-fragment]` instances in the DOM
 * - Separates fragment definition name (`data-w-fragment`) from instance ID (`data-w-fragment-id`)
 * - Tracks `dependsOn` tags (`data-w-depends-on`) per fragment instance
 * - Skips network refresh completely if no active fragment on the page matches invalidated tags
 * - Deduplicates parent/child fragments when both are invalidated (parent refresh covers child)
 * - Coalesces simultaneous invalidations into a single batch request (`POST /__webspresso/fragments`)
 * - Queues follow-up refreshes when new invalidations arrive during an in-flight refresh so the
 *   latest mutation's invalidation is never lost
 * - Enforces monotonic per-instance `refreshVersion` so stale responses never overwrite newer DOM
 * - Supports retryable refresh (`retryFailed()` / `refresh()`) without re-sending mutations
 */

const DEFAULT_FRAGMENT_ENDPOINT = '/__webspresso/fragments';

/**
 * Parse `data-w-depends-on` attribute (comma-separated or JSON array).
 *
 * @param {string|null} raw
 * @returns {string[]}
 */
function parseDependsOnAttr(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((s) => String(s).trim()).filter(Boolean);
      }
    } catch (_e) {
      // Fallback to comma split
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse `data-w-fragment-input` JSON attribute safely.
 *
 * @param {string|null} raw
 * @returns {Record<string, unknown>}
 */
function parseFragmentInputAttr(raw) {
  if (!raw || typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_e) {
    return {};
  }
}

/**
 * Filter a list of fragment records so that if fragment B's DOM element is inside
 * fragment A's DOM subtree, B is omitted from the batch because refreshing A will
 * re-render B on the server.
 *
 * @param {Array<{ instanceId: string, el: Element }>} candidates
 * @returns {Array<{ instanceId: string, el: Element }>}
 */
function deduplicateParentChildFragments(candidates) {
  if (candidates.length <= 1) return candidates;
  return candidates.filter((candidate) => {
    if (!candidate.el) return true;
    for (const other of candidates) {
      if (other === candidate || !other.el) continue;
      if (other.el !== candidate.el && typeof other.el.contains === 'function' && other.el.contains(candidate.el)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Create a Fragment Coordinator instance.
 *
 * @param {object} [options]
 * @param {Document|Element} [options.root] - Root document or container element
 * @param {typeof fetch} [options.fetch] - Custom fetch function
 * @param {string} [options.endpoint='/__webspresso/fragments'] - Server fragment refresh endpoint
 * @param {object} [options.datastar] - Datastar adapter for DOM morphing
 * @param {(el: Element) => void} [options.onBeforeNodeRemove] - Hook called before a node is removed during morph
 * @param {(el: Element) => void} [options.onNodeAdded] - Hook called when a new node is added during morph
 * @param {(el: Element) => void} [options.onAfterPatch] - Hook called after a fragment is patched
 * @param {() => string|null} [options.getCsrfToken] - CSRF token getter
 * @param {object} [options.debug] - Client debugger instance
 */
function createFragmentCoordinator(options = {}) {
  const getRoot = () =>
    options.root || options.document || (typeof document !== 'undefined' ? document : null);
  const fetchImpl =
    options.fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const endpoint = options.endpoint || DEFAULT_FRAGMENT_ENDPOINT;
  const datastar = options.datastar || options.adapter;
  const debug = options.debug || null;

  // Map<instanceId, { instanceId, name, pagePath, input, dependsOn: Set<string>, version: number, el: Element, abortController: AbortController|null }>
  const instances = new Map();

  // Coalescing & in-flight state for tag invalidations
  const pendingTags = new Set();
  const pendingChains = [];
  let batchTimer = null;
  let inFlightBatchCount = 0;
  let followUpNeeded = false;
  let lastFailedBatch = null;
  const inflightBatchWaiters = [];

  /**
   * Scan DOM and synchronize tracked `[data-w-fragment]` instances.
   */
  function syncDomInstances(containerEl) {
    const root = containerEl || getRoot();
    if (!root || typeof root.querySelectorAll !== 'function') return [];

    const elements = Array.from(root.querySelectorAll('[data-w-fragment]'));
    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('data-w-fragment')) {
      elements.unshift(root);
    }

    const seenIds = new Set();

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const name = (el.getAttribute('data-w-fragment') || '').trim();
      if (!name) continue;

      let instanceId = (el.getAttribute('data-w-fragment-id') || '').trim();
      if (!instanceId) {
        instanceId = i === 0 ? `${name}:default` : `${name}:${i}`;
        el.setAttribute('data-w-fragment-id', instanceId);
      }

      seenIds.add(instanceId);
      const pagePath =
        (el.getAttribute('data-w-fragment-page') || '').trim() ||
        (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
      const input = parseFragmentInputAttr(el.getAttribute('data-w-fragment-input'));
      const dependsOn = new Set(parseDependsOnAttr(el.getAttribute('data-w-depends-on')));

      const existing = instances.get(instanceId);
      if (existing) {
        existing.name = name;
        existing.pagePath = pagePath;
        existing.el = el;
        existing.dependsOn = dependsOn;
        if (el.hasAttribute('data-w-fragment-input')) {
          existing.input = input;
        }
      } else {
        instances.set(instanceId, {
          instanceId,
          name,
          pagePath,
          input,
          dependsOn,
          version: 0,
          el,
          abortController: null,
        });
      }
    }

    // Prune disconnected instances if scanning full root
    if (!containerEl || containerEl === getRoot()) {
      for (const [id, inst] of instances.entries()) {
        const disconnected =
          !seenIds.has(id) || (inst.el && inst.el.isConnected === false);
        if (disconnected) {
          if (inst.abortController) {
            try {
              inst.abortController.abort();
            } catch (_e) {
              // Ignore
            }
          }
          instances.delete(id);
        }
      }
    }

    return Array.from(instances.values());
  }

  /**
   * Apply a single server fragment result `{ instanceId, name, html, input, loadMs, renderMs }`
   * to the DOM if and only if `reqVersion >= inst.version`.
   */
  function applyFragmentPatch(inst, fragmentPayload, reqVersion, chainId = null) {
    if (!inst || !inst.el) return false;

    if (reqVersion < inst.version) {
      if (debug) {
        debug.trackDiscardedResponse({
          source: 'fragment',
          instanceId: inst.instanceId,
          key: inst.name,
          reason: 'stale-version',
          version: reqVersion,
          currentVersion: inst.version,
        });
      }
      return false;
    }

    const html = fragmentPayload && typeof fragmentPayload.html === 'string' ? fragmentPayload.html : '';
    if (!html) return false;

    const patchStart = Date.now();

    if (
      fragmentPayload.input &&
      typeof fragmentPayload.input === 'object' &&
      !followUpNeeded &&
      pendingTags.size === 0
    ) {
      inst.input = fragmentPayload.input;
      inst.el.setAttribute('data-w-fragment-input', JSON.stringify(fragmentPayload.input));
    }

    if (datastar && typeof datastar.patchFragmentElement === 'function') {
      datastar.patchFragmentElement(inst.el, html, {
        onBeforeNodeRemove: options.onBeforeNodeRemove,
        onNodeAdded: options.onNodeAdded,
      });
    } else {
      inst.el.innerHTML = html;
    }

    const patchMs = Math.max(0, Date.now() - patchStart);

    // Re-sync nested fragment instances that may have been updated inside this parent fragment
    syncDomInstances(inst.el);

    if (typeof options.onAfterPatch === 'function') {
      options.onAfterPatch(inst.el, inst);
    }

    if (debug) {
      debug.recordChainPatch(chainId, {
        instanceId: inst.instanceId,
        fragmentName: inst.name,
        patchMs,
        loadMs: fragmentPayload.loadMs !== undefined ? fragmentPayload.loadMs : null,
        renderMs: fragmentPayload.renderMs !== undefined ? fragmentPayload.renderMs : null,
      });
    }

    return true;
  }

  /**
   * Execute a network refresh for a list of target fragment descriptors:
   * `Array<{ instanceId, name, pagePath, input, reqVersion }>`
   */
  async function executeBatchRefresh(targets, chainIds = [], abortSignal = null) {
    if (!targets || targets.length === 0) {
      return { refreshed: [], skipped: true };
    }
    if (!fetchImpl) {
      throw new Error('Global fetch is not available for fragment refresh.');
    }

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Webspresso-Fragment-Request': '1',
    };

    if (typeof options.getCsrfToken === 'function') {
      const token = options.getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
    }

    const pagePath =
      targets[0].pagePath ||
      (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');

    const requestPayload = {
      pagePath,
      fragments: targets.map((t) => ({
        instanceId: t.instanceId,
        name: t.name,
        input: t.input || {},
        version: t.reqVersion,
      })),
    };

    const reqId = `frag_req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (debug) {
      debug.trackRequestStart({
        requestId: reqId,
        key: `fragments:${targets.map((t) => t.instanceId).join(',')}`,
        method: 'POST',
        url: endpoint,
        policy: 'latest',
        payload: { count: targets.length },
      });
    }

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        credentials: 'same-origin',
        signal: abortSignal || undefined,
      });
    } catch (err) {
      const isAbort =
        (abortSignal && abortSignal.aborted) ||
        (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));

      if (debug) {
        debug.trackRequestEnd(reqId, {
          status: isAbort ? 'canceled' : 'failed',
          errorKind: isAbort ? 'canceled' : 'network',
        });
      }
      if (isAbort) {
        return { refreshed: [], canceled: true };
      }
      lastFailedBatch = { targets, chainIds };
      for (const cid of chainIds) {
        if (debug) {
          debug.recordChainRefresh(cid, {
            fragmentIds: targets.map((t) => t.instanceId),
            status: 'failed',
            error: err,
          });
        }
      }
      throw err;
    }

    let body = null;
    try {
      if (typeof response.text === 'function') {
        const text = await response.text();
        body = text ? JSON.parse(text) : null;
      } else if (typeof response.json === 'function') {
        body = await response.json();
      }
    } catch (_e) {
      body = null;
    }

    if (!response.ok) {
      if (debug) {
        debug.trackRequestEnd(reqId, {
          status: 'failed',
          httpStatus: response.status,
          errorKind: 'http',
        });
      }
      const errMsg =
        (body && body.error && body.error.message) ||
        (body && body.message) ||
        `Fragment refresh failed with HTTP ${response.status}`;
      const refreshError = new Error(errMsg);
      refreshError.status = response.status;
      refreshError.data = body;
      lastFailedBatch = { targets, chainIds };
      for (const cid of chainIds) {
        if (debug) {
          debug.recordChainRefresh(cid, {
            fragmentIds: targets.map((t) => t.instanceId),
            status: 'failed',
            error: refreshError,
          });
        }
      }
      throw refreshError;
    }

    if (debug) {
      debug.trackRequestEnd(reqId, { status: 'completed', httpStatus: response.status });
    }

    lastFailedBatch = null;
    const resultsMap = (body && body.fragments) || {};
    const refreshedIds = [];
    let totalLoadMs = 0;
    let totalRenderMs = 0;

    for (const target of targets) {
      const inst = instances.get(target.instanceId);
      const fragResult = resultsMap[target.instanceId] || resultsMap[target.name];
      if (!inst || !fragResult) continue;
      if (typeof fragResult.loadMs === 'number') totalLoadMs += fragResult.loadMs;
      if (typeof fragResult.renderMs === 'number') totalRenderMs += fragResult.renderMs;

      const applied = applyFragmentPatch(
        inst,
        fragResult,
        target.reqVersion,
        chainIds[0] || null
      );
      if (applied) {
        refreshedIds.push(target.instanceId);
      }
    }

    for (const cid of chainIds) {
      if (debug) {
        debug.recordChainRefresh(cid, {
          fragmentIds: refreshedIds,
          status: 'ok',
          loadMs: totalLoadMs,
          renderMs: totalRenderMs,
          totalServerMs: body && typeof body.totalMs === 'number' ? body.totalMs : null,
        });
      }
    }

    return {
      refreshed: refreshedIds,
      errors: [],
      timings: {
        loadMs: totalLoadMs,
        renderMs: totalRenderMs,
      },
    };
  }

  /**
   * Flush pending invalidated tags in a single coalesced request.
   * If a flush is currently in flight, sets `followUpNeeded = true` so that
   * newly invalidated tags are flushed immediately when the in-flight request finishes.
   */
  async function flushInvalidations() {
    if (inFlightBatchCount > 0) {
      followUpNeeded = true;
      return new Promise((resolve, reject) => {
        inflightBatchWaiters.push({ resolve, reject });
      });
    }

    if (pendingTags.size === 0) {
      return { refreshed: [], skipped: true };
    }

    const tagsToFlush = new Set(pendingTags);
    const chainsToFlush = [...pendingChains];
    pendingTags.clear();
    pendingChains.length = 0;

    syncDomInstances();

    // Find all mounted fragment instances whose `dependsOn` intersects `tagsToFlush`
    const matchingInstances = [];
    for (const inst of instances.values()) {
      let matched = false;
      for (const tag of tagsToFlush) {
        if (inst.dependsOn.has(tag) || inst.name === tag) {
          matched = true;
          break;
        }
      }
      if (matched) {
        matchingInstances.push(inst);
      }
    }

    // If no active fragment on the open page matches, send ZERO network requests!
    if (matchingInstances.length === 0) {
      for (const cid of chainsToFlush) {
        if (debug) {
          debug.recordChainRefresh(cid, {
            fragmentIds: [],
            status: 'skipped-no-matching-fragment',
          });
        }
      }
      return { refreshed: [], skipped: true };
    }

    // Parent/Child deduplication: if parent & child are both invalidated, parent refresh covers child
    const dedupedInstances = deduplicateParentChildFragments(matchingInstances);

    const targets = dedupedInstances.map((inst) => {
      inst.version += 1;
      return {
        instanceId: inst.instanceId,
        name: inst.name,
        pagePath: inst.pagePath,
        input: { ...inst.input },
        reqVersion: inst.version,
      };
    });

    inFlightBatchCount += 1;
    try {
      const result = await executeBatchRefresh(targets, chainsToFlush);
      // If new invalidations arrived while this batch was in flight, run follow-up immediately!
      if (followUpNeeded || pendingTags.size > 0) {
        followUpNeeded = false;
        inFlightBatchCount -= 1;
        const followUpResult = await flushInvalidations();
        const waiters = inflightBatchWaiters.splice(0, inflightBatchWaiters.length);
        for (const w of waiters) w.resolve(followUpResult);
        return followUpResult;
      }
      const waiters = inflightBatchWaiters.splice(0, inflightBatchWaiters.length);
      for (const w of waiters) w.resolve(result);
      return result;
    } catch (err) {
      const waiters = inflightBatchWaiters.splice(0, inflightBatchWaiters.length);
      for (const w of waiters) w.reject(err);
      throw err;
    } finally {
      if (inFlightBatchCount > 0) {
        inFlightBatchCount -= 1;
      }
    }
  }

  /**
   * Invalidate one or more dependency tags (e.g. `['notes']`).
   * Coalesces multiple invalidation calls within the same microtask into a single batch request.
   *
   * @param {string|string[]} tags
   * @param {object} [meta]
   * @returns {Promise<{ refreshed: string[], skipped?: boolean }>}
   */
  function invalidate(tags, meta = {}) {
    const tagList = Array.isArray(tags) ? tags : [tags];
    for (const raw of tagList) {
      if (typeof raw === 'string' && raw.trim()) {
        pendingTags.add(raw.trim());
      }
    }
    if (meta && meta.chainId) {
      pendingChains.push(meta.chainId);
    }

    if (batchTimer) {
      return batchTimer.promise;
    }

    let resolveBatch;
    let rejectBatch;
    const promise = new Promise((resolve, reject) => {
      resolveBatch = resolve;
      rejectBatch = reject;
    });

    batchTimer = {
      promise,
    };

    // Coalesce synchronous/microtask invalidations before flushing
    Promise.resolve().then(async () => {
      batchTimer = null;
      try {
        const res = await flushInvalidations();
        resolveBatch(res);
      } catch (err) {
        rejectBatch(err);
      }
    });

    return promise;
  }

  /**
   * Explicitly refresh a specific fragment instance (or all instances of a fragment name)
   * with optional updated filter/pagination input.
   * Enforces `'latest'` semantics per instance so rapid filter changes discard stale responses.
   *
   * @param {string} idOrName - `instanceId` (e.g. `'list:default'`) or fragment `name` (e.g. `'list'`)
   * @param {Record<string, unknown>} [nextInput] - Partial or new input parameters
   * @param {object} [refreshOpts]
   */
  async function refresh(idOrName, nextInput, refreshOpts = {}) {
    syncDomInstances();

    const matched = [];
    if (instances.has(idOrName)) {
      matched.push(instances.get(idOrName));
    } else {
      for (const inst of instances.values()) {
        if (inst.name === idOrName) {
          matched.push(inst);
        }
      }
    }

    if (matched.length === 0) {
      return { refreshed: [], skipped: true };
    }

    const deduped = deduplicateParentChildFragments(matched);
    const abortController = new AbortController();

    const targets = deduped.map((inst) => {
      // Abort previous direct refresh for this instance so rapid filter updates don't race
      if (inst.abortController) {
        try {
          inst.abortController.abort();
        } catch (_e) {
          // Ignore
        }
      }
      inst.abortController = abortController;
      inst.version += 1;

      if (nextInput && typeof nextInput === 'object') {
        inst.input = refreshOpts.replaceInput
          ? { ...nextInput }
          : { ...inst.input, ...nextInput };
        if (inst.el && typeof inst.el.setAttribute === 'function') {
          inst.el.setAttribute('data-w-fragment-input', JSON.stringify(inst.input));
        }
      }

      return {
        instanceId: inst.instanceId,
        name: inst.name,
        pagePath: inst.pagePath,
        input: { ...inst.input },
        reqVersion: inst.version,
      };
    });

    return executeBatchRefresh(targets, [], abortController.signal);
  }

  /**
   * Retry the last failed fragment refresh without re-running any mutation.
   */
  async function retryFailed() {
    if (!lastFailedBatch || !lastFailedBatch.targets || lastFailedBatch.targets.length === 0) {
      return { refreshed: [], skipped: true };
    }
    const { targets, chainIds } = lastFailedBatch;
    lastFailedBatch = null;

    // Bump versions to current + 1 for retry
    const retryTargets = [];
    for (const t of targets) {
      const inst = instances.get(t.instanceId);
      if (inst) {
        inst.version += 1;
        retryTargets.push({
          ...t,
          input: { ...inst.input },
          reqVersion: inst.version,
        });
      }
    }

    if (retryTargets.length === 0) {
      return { refreshed: [], skipped: true };
    }

    return executeBatchRefresh(retryTargets, chainIds);
  }

  return {
    syncDomInstances,
    invalidate,
    refresh,
    refreshFragments(items = []) {
      if (!Array.isArray(items) || items.length === 0) {
        return Promise.resolve({ refreshed: [], skipped: true });
      }
      syncDomInstances();
      for (const item of items) {
        const key = item.instanceId || item.name;
        const inst = instances.get(key) || Array.from(instances.values()).find((i) => i.name === key);
        if (inst) {
          if (item.input && typeof item.input === 'object') {
            inst.input = { ...item.input };
            if (inst.el && typeof inst.el.setAttribute === 'function') {
              inst.el.setAttribute('data-w-fragment-input', JSON.stringify(inst.input));
            }
          }
          pendingTags.add(inst.name);
        } else if (key) {
          pendingTags.add(String(key).trim());
        }
      }
      return flushInvalidations();
    },
    findFragmentsByTags(tags = []) {
      syncDomInstances();
      const tagSet = new Set((Array.isArray(tags) ? tags : [tags]).map((t) => String(t || '').trim()).filter(Boolean));
      const matching = [];
      for (const inst of instances.values()) {
        for (const t of tagSet) {
          if (inst.dependsOn.has(t) || inst.name === t) {
            matching.push(inst);
            break;
          }
        }
      }
      return deduplicateParentChildFragments(matching);
    },
    retryFailed,
    retryLastFailed: retryFailed,
    getInstance(instanceId) {
      syncDomInstances();
      return instances.get(instanceId) || null;
    },
    getInstances() {
      syncDomInstances();
      return Array.from(instances.values());
    },
    get hasFailedRefresh() {
      return Boolean(lastFailedBatch);
    },
  };
}

module.exports = {
  DEFAULT_FRAGMENT_ENDPOINT,
  createFragmentCoordinator,
  parseDependsOnAttr,
  parseFragmentInputAttr,
  deduplicateParentChildFragments,
};

