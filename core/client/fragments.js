'use strict';

const { defaultStorage } = require('./storage');
const { isArray, isNumber, parseDurationMs, parseRefetchMode, uid } = require('./utils');

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
      if (isArray(parsed)) {
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
    return parsed && typeof parsed === 'object' && !isArray(parsed) ? parsed : {};
  } catch (_e) {
    return {};
  }
}

function isStrictAncestor(parentEl, childEl) {
  return Boolean(
    parentEl &&
      childEl &&
      parentEl !== childEl &&
      typeof parentEl.contains === 'function' &&
      parentEl.contains(childEl)
  );
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
      if (isStrictAncestor(other.el, candidate.el)) {
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
  const defaultTimeout = isNumber(options.timeout) ? options.timeout : 15000;

  // React Query-style automatic revalidation defaults
  const defaultStaleTime = parseDurationMs(options.staleTime, 0);
  const defaultRefetchOnWindowFocus = parseRefetchMode(
    options.refetchOnWindowFocus !== undefined ? options.refetchOnWindowFocus : options.refetchOnFocus,
    false
  );
  const defaultRefetchOnReconnect = parseRefetchMode(options.refetchOnReconnect, false);
  const defaultRefetchOnMount = parseRefetchMode(
    options.refetchOnMount !== undefined ? options.refetchOnMount : options.refetchOnVisit,
    false
  );
  const defaultRefetchInterval = parseDurationMs(options.refetchInterval, 0);
  const defaultRefetchIntervalInBackground =
    parseRefetchMode(options.refetchIntervalInBackground, false) === true;

  // Map<instanceId, { instanceId, name, pagePath, input, dependsOn: Set<string>, version: number, el: Element, abortController: AbortController|null, ... }>
  const instances = new Map();

  // Coalescing & in-flight state for tag invalidations
  const pendingTags = new Set();
  const pendingChains = [];
  let batchTimer = null;
  let inFlightBatchCount = 0;
  let followUpNeeded = false;
  let lastFailedBatch = null;
  const inflightBatchWaiters = [];

  // Automatic refetch (focus / reconnect / mount / interval) state
  const pendingAutoInstanceIds = new Set();
  const pendingAutoReasons = new Set();
  let autoBatchScheduled = false;
  let autoBatchTimer = null;
  let focusDebounceTimer = null;
  let isDisposed = false;
  let lifecycleListenersAttached = false;

  function isDocumentHidden() {
    const root = getRoot();
    const doc = root && root.nodeType === 9 ? root : root && root.ownerDocument ? root.ownerDocument : typeof document !== 'undefined' ? document : null;
    return Boolean(doc && doc.visibilityState === 'hidden');
  }

  function isInstanceStale(inst, mode) {
    if (!inst || !mode) return false;
    if (mode === 'always') return true;
    const staleMs = isNumber(inst.staleTime) ? inst.staleTime : 0;
    if (staleMs <= 0) return true;
    const elapsed = Date.now() - (inst.lastUpdatedAt || 0);
    return elapsed >= staleMs;
  }

  function clearInstanceInterval(inst) {
    if (inst && inst.intervalTimer) {
      clearInterval(inst.intervalTimer);
      inst.intervalTimer = null;
      inst.activeIntervalMs = 0;
    }
  }

  function syncInstanceInterval(inst) {
    if (!inst || isDisposed) return;
    const targetMs = isNumber(inst.refetchInterval) && inst.refetchInterval > 0 ? inst.refetchInterval : 0;
    if (targetMs <= 0) {
      clearInstanceInterval(inst);
      return;
    }
    if (inst.intervalTimer && inst.activeIntervalMs === targetMs) {
      return;
    }
    clearInstanceInterval(inst);
    inst.activeIntervalMs = targetMs;
    inst.intervalTimer = setInterval(() => {
      if (isDisposed || !inst.el || inst.el.isConnected === false) {
        clearInstanceInterval(inst);
        return;
      }
      if (!inst.refetchIntervalInBackground && isDocumentHidden()) {
        return;
      }
      scheduleAutoRefresh([inst.instanceId], 'interval');
    }, targetMs);
    if (inst.intervalTimer && typeof inst.intervalTimer.unref === 'function') {
      inst.intervalTimer.unref();
    }
  }

  async function flushAutoRefresh() {
    autoBatchScheduled = false;
    if (autoBatchTimer) {
      clearTimeout(autoBatchTimer);
      autoBatchTimer = null;
    }
    if (isDisposed || pendingAutoInstanceIds.size === 0) return;
    const idsToRefresh = Array.from(pendingAutoInstanceIds);
    const reasons = Array.from(pendingAutoReasons);
    pendingAutoInstanceIds.clear();
    pendingAutoReasons.clear();

    // Skip background auto-refresh if a mutation invalidation batch is currently in flight
    if (inFlightBatchCount > 0) return;

    const candidates = [];
    for (const id of idsToRefresh) {
      const inst = instances.get(id);
      if (
        inst &&
        inst.el &&
        inst.el.isConnected !== false &&
        !inst.abortController &&
        !(inst.inFlightCount > 0)
      ) {
        candidates.push(inst);
      }
    }
    if (candidates.length === 0) return;

    const deduped = deduplicateParentChildFragments(candidates);
    const targets = deduped.map((inst) => {
      inst.version += 1;
      return {
        instanceId: inst.instanceId,
        name: inst.name,
        pagePath: inst.pagePath,
        input: { ...inst.input },
        reqVersion: inst.version,
      };
    });

    if (debug && typeof debug.recordEvent === 'function') {
      debug.recordEvent('fragment:auto-refetch', {
        reason: reasons.length === 1 ? reasons[0] : reasons.join('+'),
        reasons,
        fragments: targets.map((t) => t.instanceId),
      });
    }

    try {
      await executeBatchRefresh(targets);
    } catch (_err) {
      // Background auto-refetch errors are non-fatal
    }
  }

  function scheduleAutoRefresh(instanceIds, reason = 'auto') {
    if (isDisposed || !isArray(instanceIds) || instanceIds.length === 0) return;
    for (const id of instanceIds) {
      if (id) pendingAutoInstanceIds.add(id);
    }
    if (reason) pendingAutoReasons.add(reason);
    if (pendingAutoInstanceIds.size === 0) return;

    if (reason === 'mount') {
      if (!autoBatchScheduled) {
        autoBatchScheduled = true;
        Promise.resolve().then(flushAutoRefresh);
      }
      return;
    }

    if (autoBatchTimer || autoBatchScheduled) return;
    autoBatchTimer = setTimeout(flushAutoRefresh, 5);
  }

  function triggerFocusRefetch() {
    if (isDisposed || isDocumentHidden()) return;
    scanDomInstances();
    const matchedIds = [];
    for (const inst of instances.values()) {
      if (isInstanceStale(inst, inst.refetchOnWindowFocus)) {
        matchedIds.push(inst.instanceId);
      }
    }
    if (matchedIds.length > 0) {
      scheduleAutoRefresh(matchedIds, 'window-focus');
    }
  }

  function triggerReconnectRefetch() {
    if (isDisposed) return;
    scanDomInstances();
    const matchedIds = [];
    for (const inst of instances.values()) {
      if (isInstanceStale(inst, inst.refetchOnReconnect)) {
        matchedIds.push(inst.instanceId);
      }
    }
    if (matchedIds.length > 0) {
      scheduleAutoRefresh(matchedIds, 'reconnect');
    }
  }

  function onVisibilityChange() {
    if (!isDocumentHidden()) {
      triggerFocusRefetch();
    }
  }

  function onPageShow(event) {
    if (isDisposed) return;
    if (event && event.persisted) {
      scanDomInstances();
      const matchedIds = [];
      for (const inst of instances.values()) {
        const mode = inst.refetchOnMount || inst.refetchOnWindowFocus;
        if (isInstanceStale(inst, mode)) {
          matchedIds.push(inst.instanceId);
        }
      }
      if (matchedIds.length > 0) {
        scheduleAutoRefresh(matchedIds, 'pageshow');
      }
    }
  }

  function ensureLifecycleListeners() {
    if (lifecycleListenersAttached || isDisposed) return;
    const root = getRoot();
    const doc = root && root.nodeType === 9 ? root : root && root.ownerDocument ? root.ownerDocument : typeof document !== 'undefined' ? document : null;
    const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('focus', triggerFocusRefetch);
      win.addEventListener('online', triggerReconnectRefetch);
      win.addEventListener('pageshow', onPageShow);
    }
    lifecycleListenersAttached = true;
  }

  function removeLifecycleListeners() {
    if (!lifecycleListenersAttached) return;
    const root = getRoot();
    const doc = root && root.nodeType === 9 ? root : root && root.ownerDocument ? root.ownerDocument : typeof document !== 'undefined' ? document : null;
    const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

    if (doc && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('focus', triggerFocusRefetch);
      win.removeEventListener('online', triggerReconnectRefetch);
      win.removeEventListener('pageshow', onPageShow);
    }
    lifecycleListenersAttached = false;
  }

  function syncSingleElement(el, index, seenIds) {
    const name = (el.getAttribute('data-w-fragment') || '').trim();
    if (!name) return;

    let instanceId = (el.getAttribute('data-w-fragment-id') || '').trim();
    if (!instanceId) {
      instanceId = index === 0 ? `${name}:default` : `${name}:${index}`;
      el.setAttribute('data-w-fragment-id', instanceId);
    }

    if (seenIds) seenIds.add(instanceId);

    const existing = instances.get(instanceId);
    const rawInput = el.getAttribute('data-w-fragment-input');
    const rawDepends = el.getAttribute('data-w-depends-on');
    const rawStale = el.getAttribute('data-w-stale-time');
    const rawInterval = el.getAttribute('data-w-refetch-interval');

    // Fast-path: if the same DOM element is already registered and its reactive attributes are unchanged,
    // skip JSON.parse, Set allocation, storage lookup, and timer reconfiguration.
    if (
      existing &&
      existing.el === el &&
      existing.name === name &&
      existing._rawInput === rawInput &&
      existing._rawDepends === rawDepends &&
      existing._rawStale === rawStale &&
      existing._rawInterval === rawInterval
    ) {
      return;
    }

    const pagePath =
      (el.getAttribute('data-w-fragment-page') || '').trim() ||
      (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
    const input =
      existing && existing.el === el && existing._rawInput === rawInput
        ? existing.input
        : parseFragmentInputAttr(rawInput);
    const dependsOn =
      existing && existing.el === el && existing._rawDepends === rawDepends
        ? existing.dependsOn
        : new Set(parseDependsOnAttr(rawDepends));

    // Fragment input persistence setup
    const rawPersistInput =
      el.getAttribute('data-w-persist-input') ||
      (el.getAttribute('data-w-persist') === 'input' ? 'session' : null);
    const isInputPersistEnabled = Boolean(rawPersistInput && rawPersistInput !== 'false');
    const inputStorageType = rawPersistInput && rawPersistInput.toLowerCase() === 'local' ? 'local' : 'session';
    const inputStorageKey =
      el.getAttribute('data-w-persist-key') ||
      el.getAttribute('data-w-input-key') ||
      `frag_input:${name}`;

    let effectiveInput = input;
    let pendingRestoredInput = null;
    if (!existing && isInputPersistEnabled) {
      const store = inputStorageType === 'local' ? defaultStorage.local : defaultStorage.session;
      let stored = store.get(inputStorageKey, null);
      if (
        (!stored || typeof stored !== 'object' || isArray(stored)) &&
        inputStorageKey !== `frag_input:${instanceId}`
      ) {
        stored = store.get(`frag_input:${instanceId}`, null);
      }
      if (stored && typeof stored === 'object' && !isArray(stored)) {
        if (rawInput === null || Object.keys(effectiveInput).length === 0) {
          effectiveInput = { ...stored };
        } else if (JSON.stringify(stored) !== JSON.stringify(effectiveInput)) {
          pendingRestoredInput = { ...stored };
        }
      }
    }

    // Parse React Query-style automatic revalidation attributes
    const staleTime = parseDurationMs(rawStale, defaultStaleTime);
    const rawFocusAttr =
      el.getAttribute('data-w-refetch-on-focus') ??
      el.getAttribute('data-w-refetch-on-window-focus');
    const refetchOnWindowFocus = parseRefetchMode(rawFocusAttr, defaultRefetchOnWindowFocus);
    const refetchOnReconnect = parseRefetchMode(
      el.getAttribute('data-w-refetch-on-reconnect'),
      defaultRefetchOnReconnect
    );
    const rawMountAttr =
      el.getAttribute('data-w-refetch-on-mount') ??
      el.getAttribute('data-w-refetch-on-visit');
    const refetchOnMount = parseRefetchMode(rawMountAttr, defaultRefetchOnMount);
    const refetchInterval = parseDurationMs(rawInterval, defaultRefetchInterval);
    const refetchIntervalInBackground =
      parseRefetchMode(
        el.getAttribute('data-w-refetch-in-background'),
        defaultRefetchIntervalInBackground
      ) === true;

    if (refetchOnWindowFocus || refetchOnReconnect || refetchOnMount) {
      ensureLifecycleListeners();
    }

    if (existing) {
      existing.name = name;
      existing.pagePath = pagePath;
      existing.el = el;
      existing.dependsOn = dependsOn;
      if (rawInput !== null && rawInput !== existing._rawInput) {
        existing.input = input;
      }
      existing.persistInput = isInputPersistEnabled ? { type: inputStorageType, key: inputStorageKey } : null;
      existing.staleTime = staleTime;
      existing.refetchOnWindowFocus = refetchOnWindowFocus;
      existing.refetchOnReconnect = refetchOnReconnect;
      existing.refetchOnMount = refetchOnMount;
      existing.refetchInterval = refetchInterval;
      existing.refetchIntervalInBackground = refetchIntervalInBackground;
      existing._rawInput = rawInput;
      existing._rawDepends = rawDepends;
      existing._rawStale = rawStale;
      existing._rawInterval = rawInterval;
      syncInstanceInterval(existing);
    } else {
      const created = {
        instanceId,
        name,
        pagePath,
        input: effectiveInput,
        restoredInput: pendingRestoredInput,
        dependsOn,
        version: 0,
        el,
        abortController: null,
        inFlightCount: 0,
        persistInput: isInputPersistEnabled ? { type: inputStorageType, key: inputStorageKey } : null,
        lastUpdatedAt: Date.now(),
        staleTime,
        refetchOnWindowFocus,
        refetchOnReconnect,
        refetchOnMount,
        refetchInterval,
        refetchIntervalInBackground,
        intervalTimer: null,
        activeIntervalMs: 0,
        _rawInput: rawInput,
        _rawDepends: rawDepends,
        _rawStale: rawStale,
        _rawInterval: rawInterval,
      };
      instances.set(instanceId, created);
      syncInstanceInterval(created);
      if (pendingRestoredInput) {
        Promise.resolve().then(() => {
          if (!isDisposed && created.version === 0 && instances.get(instanceId) === created) {
            refresh(instanceId, pendingRestoredInput).catch(() => {});
          }
        });
      } else if (refetchOnMount === 'always' || (refetchOnMount === true && staleTime <= 0)) {
        scheduleAutoRefresh([instanceId], 'mount');
      }
    }
  }

  /**
   * Internal DOM scan without allocating a return array.
   */
  function scanDomInstances(containerEl) {
    const defaultRoot = getRoot();
    const root = containerEl || defaultRoot;
    if (!root || typeof root.querySelectorAll !== 'function') return;

    const isFullScan = !containerEl || containerEl === defaultRoot;
    const seenIds = isFullScan ? new Set() : null;
    const nodeList = root.querySelectorAll('[data-w-fragment]');
    let idx = 0;

    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('data-w-fragment')) {
      syncSingleElement(root, idx++, seenIds);
    }

    for (let i = 0, len = nodeList.length; i < len; i++) {
      syncSingleElement(nodeList[i], idx++, seenIds);
    }

    // Prune disconnected instances if scanning full root
    if (isFullScan) {
      for (const [id, inst] of instances.entries()) {
        const disconnected =
          !seenIds.has(id) || (inst.el && inst.el.isConnected === false);
        if (disconnected) {
          clearInstanceInterval(inst);
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
  }

  /**
   * Scan DOM and synchronize tracked `[data-w-fragment]` instances.
   */
  function syncDomInstances(containerEl) {
    scanDomInstances(containerEl);
    return Array.from(instances.values());
  }

  /**
   * Apply a single server fragment result `{ instanceId, name, html, input, loadMs, renderMs }`
   * to the DOM if and only if `reqVersion >= inst.version`.
   */
  function applyFragmentPatch(inst, fragmentPayload, reqVersion, chainId = null, requestedInput = null) {
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

    const committedInput =
      fragmentPayload.input && typeof fragmentPayload.input === 'object' && !isArray(fragmentPayload.input)
        ? fragmentPayload.input
        : requestedInput && typeof requestedInput === 'object' && !isArray(requestedInput)
          ? requestedInput
          : null;

    if (
      committedInput &&
      !followUpNeeded &&
      pendingTags.size === 0
    ) {
      inst.input = { ...committedInput };
      const serializedInput = JSON.stringify(inst.input);
      if (inst.el && typeof inst.el.setAttribute === 'function') {
        inst.el.setAttribute('data-w-fragment-input', serializedInput);
      }
      inst._rawInput = serializedInput;
      if (inst.persistInput) {
        const store = inst.persistInput.type === 'local' ? defaultStorage.local : defaultStorage.session;
        store.set(inst.persistInput.key, inst.input);
      }
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
    const now = Date.now();
    inst.lastUpdatedAt = now;

    // Re-sync nested fragment instances that may have been updated inside this parent fragment
    scanDomInstances(inst.el);
    for (const otherInst of instances.values()) {
      if (otherInst !== inst && otherInst.el && isStrictAncestor(inst.el, otherInst.el)) {
        otherInst.lastUpdatedAt = now;
      }
    }

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
  async function executeBatchRefresh(targets, chainIds = [], abortSignal = null, batchTimeout = defaultTimeout) {
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

    // Collect active inputs of any nested descendant fragments inside the requested parent targets
    // so server-side parent re-rendering preserves nested child filters & pagination.
    const childInputs = {};
    let hasChildInputs = false;
    for (const t of targets) {
      const parentInst = instances.get(t.instanceId);
      if (!parentInst || !parentInst.el) continue;
      for (const otherInst of instances.values()) {
        if (otherInst !== parentInst && otherInst.el && isStrictAncestor(parentInst.el, otherInst.el)) {
          // Supersede any older in-flight refresh on the nested child so a late child response
          // cannot overwrite the newer parent+child snapshot.
          otherInst.version += 1;
          if (otherInst.input && typeof otherInst.input === 'object') {
            childInputs[otherInst.instanceId] = { ...otherInst.input };
            if (!childInputs[otherInst.name]) {
              childInputs[otherInst.name] = { ...otherInst.input };
            }
            hasChildInputs = true;
          }
        }
      }
    }

    const requestPayload = {
      pagePath,
      fragments: targets.map((t) => ({
        instanceId: t.instanceId,
        name: t.name,
        input: t.input || {},
        version: t.reqVersion,
      })),
      ...(hasChildInputs ? { childInputs } : {}),
    };

    for (const t of targets) {
      const inst = instances.get(t.instanceId);
      if (inst) {
        inst.inFlightCount = (inst.inFlightCount || 0) + 1;
        if (inst.el && typeof inst.el.setAttribute === 'function') {
          inst.el.setAttribute('aria-busy', 'true');
        }
      }
    }

    const decrementTargetBusy = () => {
      for (const t of targets) {
        const inst = instances.get(t.instanceId);
        if (inst) {
          inst.inFlightCount = Math.max(0, (inst.inFlightCount || 1) - 1);
          if (inst.inFlightCount === 0 && inst.el && typeof inst.el.removeAttribute === 'function') {
            inst.el.removeAttribute('aria-busy');
          }
        }
      }
    };

    const reqId = uid('frag_req', 4);
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

    const batchAbortController = new AbortController();
    let timeoutTimer = null;
    let timedOut = false;
    const timeoutMs = isNumber(batchTimeout) ? batchTimeout : defaultTimeout;

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        batchAbortController.abort();
      }, timeoutMs);
    }

    const onCallerAbort = () => batchAbortController.abort();
    if (abortSignal) {
      if (abortSignal.aborted) {
        batchAbortController.abort();
      } else {
        abortSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        credentials: 'same-origin',
        signal: batchAbortController.signal,
      });
    } catch (err) {
      decrementTargetBusy();
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (abortSignal) {
        try {
          abortSignal.removeEventListener('abort', onCallerAbort);
        } catch (_e) {}
      }

      if (timedOut) {
        if (debug) {
          debug.trackRequestEnd(reqId, {
            status: 'failed',
            errorKind: 'timeout',
          });
        }
        const timeoutError = new Error(`Fragment refresh timed out after ${timeoutMs}ms.`);
        timeoutError.code = 'FRAGMENT_REFRESH_TIMEOUT';
        timeoutError.isTimedOut = true;
        lastFailedBatch = { targets, chainIds };
        for (const cid of chainIds) {
          if (debug) {
            debug.recordChainRefresh(cid, {
              fragmentIds: targets.map((t) => t.instanceId),
              status: 'failed',
              error: timeoutError,
            });
          }
        }
        throw timeoutError;
      }

      const isAbort =
        (abortSignal && abortSignal.aborted) ||
        batchAbortController.signal.aborted ||
        (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));

      if (debug) {
        debug.trackRequestEnd(reqId, {
          status: isAbort ? 'canceled' : 'failed',
          errorKind: isAbort ? 'canceled' : 'network',
        });
      }
      if (isAbort) {
        return { ok: false, refreshed: [], canceled: true };
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
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (abortSignal) {
        try {
          abortSignal.removeEventListener('abort', onCallerAbort);
        } catch (_e) {}
      }
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
    } finally {
      decrementTargetBusy();
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

    const rawFragments = (body && body.fragments) || {};
    const rawErrors = (body && body.errors && typeof body.errors === 'object' ? body.errors : {}) || {};
    const resultsMap = {};
    if (isArray(rawFragments)) {
      for (const item of rawFragments) {
        if (item && typeof item === 'object') {
          if (item.instanceId) resultsMap[item.instanceId] = item;
          if (item.name && !resultsMap[item.name]) resultsMap[item.name] = item;
        }
      }
    } else if (rawFragments && typeof rawFragments === 'object') {
      Object.assign(resultsMap, rawFragments);
    }
    const refreshedIds = [];
    const batchErrors = [];
    const failedTargets = [];
    let staleDiscardCount = 0;
    let totalLoadMs = 0;
    let totalRenderMs = 0;

    for (const target of targets) {
      const inst = instances.get(target.instanceId);
      const fragError =
        rawErrors[target.instanceId] ||
        rawErrors[target.name] ||
        (resultsMap[target.instanceId] && resultsMap[target.instanceId].error) ||
        (resultsMap[target.name] && resultsMap[target.name].error) ||
        null;
      if (fragError) {
        const errObj =
          fragError instanceof Error
            ? fragError
            : Object.assign(
                new Error(
                  (fragError && typeof fragError === 'object' && fragError.message) ||
                    String(fragError) ||
                    `Fragment "${target.name}" failed to refresh`
                ),
                {
                  status: (fragError && fragError.status) || 500,
                  code: (fragError && fragError.code) || 'FRAGMENT_REFRESH_ERROR',
                  instanceId: target.instanceId,
                  fragmentName: target.name,
                }
              );
        batchErrors.push(errObj);
        failedTargets.push(target);
        continue;
      }

      const fragResult = resultsMap[target.instanceId] || resultsMap[target.name];
      if (!inst || !fragResult) continue;
      if (target.reqVersion < inst.version) {
        staleDiscardCount += 1;
      }
      if (isNumber(fragResult.loadMs)) totalLoadMs += fragResult.loadMs;
      if (isNumber(fragResult.renderMs)) totalRenderMs += fragResult.renderMs;

      const applied = applyFragmentPatch(
        inst,
        fragResult,
        target.reqVersion,
        chainIds[0] || null,
        target.input
      );
      if (applied) {
        refreshedIds.push(target.instanceId);
      }
    }

    const allSuperseded =
      refreshedIds.length === 0 &&
      batchErrors.length === 0 &&
      staleDiscardCount > 0 &&
      staleDiscardCount === targets.length;

    if (refreshedIds.length > 0 && lastFailedBatch && isArray(lastFailedBatch.targets)) {
      const refreshedSet = new Set(refreshedIds);
      const remainingFailed = lastFailedBatch.targets.filter((t) => !refreshedSet.has(t.instanceId));
      lastFailedBatch =
        remainingFailed.length > 0
          ? { targets: remainingFailed, chainIds: lastFailedBatch.chainIds }
          : null;
    }

    if (batchErrors.length > 0) {
      lastFailedBatch = {
        targets: failedTargets,
        chainIds,
      };
    }

    for (const cid of chainIds) {
      if (debug) {
        debug.recordChainRefresh(cid, {
          fragmentIds: refreshedIds,
          status: batchErrors.length > 0 ? (refreshedIds.length > 0 ? 'partial-error' : 'error') : allSuperseded ? 'superseded' : 'ok',
          error: batchErrors[0] || null,
          loadMs: totalLoadMs,
          renderMs: totalRenderMs,
          totalServerMs: body && isNumber(body.totalMs) ? body.totalMs : null,
        });
      }
    }

    if (allSuperseded) {
      return {
        ok: false,
        canceled: true,
        superseded: true,
        refreshed: [],
        errors: [],
        timings: {
          loadMs: totalLoadMs,
          renderMs: totalRenderMs,
        },
      };
    }

    if (batchErrors.length > 0) {
      return {
        ok: false,
        partial: refreshedIds.length > 0,
        refreshed: refreshedIds,
        errors: batchErrors,
        error: batchErrors[0],
        timings: {
          loadMs: totalLoadMs,
          renderMs: totalRenderMs,
        },
      };
    }

    return {
      ok: true,
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
      return { ok: true, refreshed: [], skipped: true };
    }

    const tagsToFlush = new Set(pendingTags);
    const chainsToFlush = [...pendingChains];
    pendingTags.clear();
    pendingChains.length = 0;

    scanDomInstances();

    // Find all mounted fragment instances whose `dependsOn` intersects `tagsToFlush`
    const matchingInstances = [];
    for (const inst of instances.values()) {
      let matched = false;
      for (const tag of tagsToFlush) {
        if (inst.dependsOn.has(tag) || inst.name === tag || inst.instanceId === tag) {
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
      return { ok: true, refreshed: [], skipped: true };
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
    const tagList = isArray(tags) ? tags : [tags];
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
    scanDomInstances();

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
      const skippedRes = { ok: true, refreshed: [], skipped: true };
      if (typeof refreshOpts.onSuccess === 'function') {
        await refreshOpts.onSuccess(skippedRes);
      }
      if (typeof refreshOpts.onSettled === 'function') {
        await refreshOpts.onSettled(skippedRes, null);
      } else if (typeof refreshOpts.onComplete === 'function') {
        await refreshOpts.onComplete(skippedRes, null);
      }
      return skippedRes;
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

      const candidateInput =
        nextInput && typeof nextInput === 'object'
          ? refreshOpts.replaceInput
            ? { ...nextInput }
            : { ...inst.input, ...nextInput }
          : { ...inst.input };

      return {
        instanceId: inst.instanceId,
        name: inst.name,
        pagePath: inst.pagePath,
        input: candidateInput,
        reqVersion: inst.version,
      };
    });

    const clearOwnedAbortControllers = () => {
      for (const inst of deduped) {
        if (inst.abortController === abortController) {
          inst.abortController = null;
        }
      }
    };

    try {
      const result = await executeBatchRefresh(targets, [], abortController.signal, refreshOpts.timeout);
      clearOwnedAbortControllers();
      const enrichedResult = { ok: true, ...result };
      if (enrichedResult.ok === false && !enrichedResult.canceled && !enrichedResult.superseded && enrichedResult.error) {
        const failHandler = refreshOpts.onFailure || refreshOpts.onError;
        if (typeof failHandler === 'function') {
          await failHandler(enrichedResult.error);
        }
        if (typeof refreshOpts.onSettled === 'function') {
          await refreshOpts.onSettled(enrichedResult, enrichedResult.error);
        } else if (typeof refreshOpts.onComplete === 'function') {
          await refreshOpts.onComplete(enrichedResult, enrichedResult.error);
        }
        if (refreshOpts.throwOnError === true) {
          throw enrichedResult.error;
        }
        return enrichedResult;
      }
      if (!enrichedResult.canceled && !enrichedResult.superseded && enrichedResult.ok !== false) {
        if (typeof refreshOpts.onSuccess === 'function') {
          await refreshOpts.onSuccess(enrichedResult);
        }
      }
      if (typeof refreshOpts.onSettled === 'function') {
        await refreshOpts.onSettled(enrichedResult, null);
      } else if (typeof refreshOpts.onComplete === 'function') {
        await refreshOpts.onComplete(enrichedResult, null);
      }
      return enrichedResult;
    } catch (err) {
      clearOwnedAbortControllers();
      const failHandler = refreshOpts.onFailure || refreshOpts.onError;
      if (typeof failHandler === 'function') {
        try {
          await failHandler(err);
        } catch (callbackErr) {
          throw callbackErr;
        }
      }
      if (typeof refreshOpts.onSettled === 'function') {
        await refreshOpts.onSettled(null, err);
      } else if (typeof refreshOpts.onComplete === 'function') {
        await refreshOpts.onComplete(null, err);
      }

      if (refreshOpts.throwOnError !== true && (typeof failHandler === 'function' || refreshOpts.throwOnError === false)) {
        return {
          ok: false,
          error: err,
          refreshed: [],
          timings: { loadMs: 0, renderMs: 0 },
        };
      }
      throw err;
    }
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
          input: t.input ? { ...t.input } : { ...inst.input },
          reqVersion: inst.version,
        });
      }
    }

    if (retryTargets.length === 0) {
      return { refreshed: [], skipped: true };
    }

    return executeBatchRefresh(retryTargets, chainIds);
  }

  function resolveInstanceByIdOrName(idOrName) {
    if (!idOrName) return null;
    const direct = instances.get(idOrName);
    if (direct && (!direct.el || direct.el.isConnected !== false)) {
      return direct;
    }
    const defaultInst = instances.get(`${idOrName}:default`);
    if (defaultInst && (!defaultInst.el || defaultInst.el.isConnected !== false)) {
      return defaultInst;
    }
    for (const inst of instances.values()) {
      if (inst.name === idOrName && (!inst.el || inst.el.isConnected !== false)) {
        return inst;
      }
    }
    return null;
  }

  return {
    syncDomInstances,
    invalidate,
    refresh,
    refreshFragments(items = []) {
      if (!isArray(items) || items.length === 0) {
        return Promise.resolve({ refreshed: [], skipped: true });
      }
      scanDomInstances();
      for (const item of items) {
        const key = item.instanceId || item.name;
        const matchedList = [];
        if (item.instanceId && instances.has(item.instanceId)) {
          matchedList.push(instances.get(item.instanceId));
        } else {
          for (const inst of instances.values()) {
            if (inst.instanceId === key || inst.name === key) {
              matchedList.push(inst);
            }
          }
        }
        if (matchedList.length > 0) {
          for (const inst of matchedList) {
            if (item.input && typeof item.input === 'object') {
              inst.input = { ...item.input };
              if (inst.el && typeof inst.el.setAttribute === 'function') {
                const serializedInput = JSON.stringify(inst.input);
                inst.el.setAttribute('data-w-fragment-input', serializedInput);
                inst._rawInput = serializedInput;
              }
            }
            pendingTags.add(item.instanceId ? inst.instanceId : inst.name);
          }
        } else if (key) {
          pendingTags.add(String(key).trim());
        }
      }
      return flushInvalidations();
    },
    findFragmentsByTags(tags = []) {
      scanDomInstances();
      const tagSet = new Set((isArray(tags) ? tags : [tags]).map((t) => String(t || '').trim()).filter(Boolean));
      const matching = [];
      for (const inst of instances.values()) {
        for (const t of tagSet) {
          if (inst.dependsOn.has(t) || inst.name === t || inst.instanceId === t) {
            matching.push(inst);
            break;
          }
        }
      }
      return deduplicateParentChildFragments(matching);
    },
    retryFailed,
    retryLastFailed: retryFailed,
    getInstance(instanceIdOrName) {
      const hit = resolveInstanceByIdOrName(instanceIdOrName);
      if (hit) {
        return hit;
      }
      scanDomInstances();
      return resolveInstanceByIdOrName(instanceIdOrName);
    },
    getInstances(nameOrId) {
      scanDomInstances();
      const all = Array.from(instances.values());
      if (!nameOrId) return all;
      return all.filter((inst) => inst.instanceId === nameOrId || inst.name === nameOrId);
    },
    getStoredInput(instanceIdOrName, storageType = 'session') {
      const store = storageType === 'local' ? defaultStorage.local : defaultStorage.session;
      const direct = store.get(`frag_input:${instanceIdOrName}`, null);
      if (direct !== null) return direct;
      const inst = instances.get(instanceIdOrName) || Array.from(instances.values()).find((i) => i.name === instanceIdOrName);
      if (inst && inst.persistInput) {
        const instStore = inst.persistInput.type === 'local' ? defaultStorage.local : defaultStorage.session;
        return instStore.get(inst.persistInput.key, null);
      }
      return null;
    },
    clearStoredInput(instanceIdOrName, storageType = 'session') {
      const store = storageType === 'local' ? defaultStorage.local : defaultStorage.session;
      const inst = instances.get(instanceIdOrName) || Array.from(instances.values()).find((i) => i.name === instanceIdOrName);
      if (inst && inst.persistInput) {
        const instStore = inst.persistInput.type === 'local' ? defaultStorage.local : defaultStorage.session;
        instStore.remove(inst.persistInput.key);
      }
      return store.remove(`frag_input:${instanceIdOrName}`);
    },
    get hasFailedRefresh() {
      return Boolean(lastFailedBatch);
    },
    dispose() {
      isDisposed = true;
      if (focusDebounceTimer) {
        clearTimeout(focusDebounceTimer);
        focusDebounceTimer = null;
      }
      if (autoBatchTimer) {
        clearTimeout(autoBatchTimer);
        autoBatchTimer = null;
      }
      pendingAutoInstanceIds.clear();
      pendingAutoReasons.clear();
      removeLifecycleListeners();
      for (const inst of instances.values()) {
        clearInstanceInterval(inst);
        if (inst.abortController) {
          try {
            inst.abortController.abort();
          } catch (_e) {}
          inst.abortController = null;
        }
      }
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

