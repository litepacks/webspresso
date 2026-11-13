'use strict';

/**
 * Webspresso Client DevTools Dock & Inspector
 *
 * Integrated development-mode toolbar and inspector for Webspresso client applications:
 *   - 🎮 Controllers: Live reactive state, computed values, bound forms, tasks (with manual trigger), watchers
 *   - 🧩 Fragments: Live SSR fragments, input parameters, dependsOn tags, on-demand refresh & DOM highlight
 *   - 🌐 Network & Causal Chains: Client API timeline, concurrency policies, invalidation-to-patch chains
 *   - 💾 Storage: Webspresso namespaced local/session storage viewer and cleaner
 *   - 🛠️ Studio & Server: Direct link to Webspresso DB Studio, Admin Panel, and SSE live-reload status
 *   - 🔌 Redux DevTools Bridge: Auto-connects to browser Redux DevTools extension if present
 *   - ⌨️ Hotkey: Alt+W (or Cmd+Shift+D) toggles the dock
 *   - 🖥️ Console API: window.__WEBSPRESSO_DEVTOOLS__
 */

const { defaultStorage } = require('./storage');
const { isArray, isNumber } = require('./utils');

const DEVTOOL_HOST_ID = 'webspresso-client-devtools-host';

const PKG_VERSION =
  (typeof window !== 'undefined' &&
    window.__WEBSPRESSO_DEV_META__ &&
    window.__WEBSPRESSO_DEV_META__.version) ||
  '0.0.110';

/**
 * Connect to Redux DevTools browser extension if installed.
 */
function setupReduxDevToolsBridge(runtime) {
  if (typeof window === 'undefined' || !window.__REDUX_DEVTOOLS_EXTENSION__) {
    return null;
  }
  try {
    const devTools = window.__REDUX_DEVTOOLS_EXTENSION__.connect({
      name: 'Webspresso Client',
      features: {
        jump: false,
        skip: false,
        reorder: false,
        dispatch: false,
        test: false,
      },
    });

    function getCombinedState() {
      const stateObj = {};
      const instances = runtime.controllers ? runtime.controllers.getActiveInstances() : [];
      for (const inst of instances) {
        stateObj[inst.name || inst.instanceId] = inst.state ? { ...inst.state } : {};
      }
      return stateObj;
    }

    devTools.init(getCombinedState());

    // Dispatches state snapshot when events occur
    if (runtime.debug && typeof runtime.debug.getSnapshot === 'function') {
      const origRecordEvent = runtime.debug.recordEvent;
      if (typeof origRecordEvent === 'function') {
        runtime.debug.recordEvent = function (type, detail) {
          const res = origRecordEvent.call(this, type, detail);
          try {
            devTools.send({ type: `[Webspresso] ${type}`, ...detail }, getCombinedState());
          } catch (_) {}
          return res;
        };
      }
    }

    return devTools;
  } catch (_) {
    return null;
  }
}

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHref(url, fallback = '#') {
  if (!url || typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  if (!trimmed || /[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) return fallback;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return escapeHtml(trimmed);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return escapeHtml(parsed.href);
    }
  } catch {
    return fallback;
  }
  return fallback;
}

/**
 * Format JSON with syntax-colored HTML or safe text.
 */
function formatJsonHtml(data) {
  if (data === undefined) return '<span style="color:#71717a">undefined</span>';
  if (data === null) return '<span style="color:#f43f5e">null</span>';
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    return escapeHtml(jsonStr).replace(
      /(&quot;(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\&])*&quot;(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'color:#38bdf8;'; // number
        if (/^&quot;/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'color:#a78bfa;font-weight:600;'; // key
          } else {
            cls = 'color:#34d399;'; // string
          }
        } else if (/true|false/.test(match)) {
          cls = 'color:#fbbf24;'; // boolean
        } else if (/null/.test(match)) {
          cls = 'color:#f43f5e;'; // null
        }
        return `<span style="${cls}">${match}</span>`;
      }
    );
  } catch (_) {
    return escapeHtml(data);
  }
}

/**
 * Highlight a DOM element with a temporary pulsing outline.
 */
function highlightElement(el) {
  if (!el || !el.style) return false;
  try {
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const origOutline = el.style.outline;
    const origOutlineOffset = el.style.outlineOffset;
    const origBoxShadow = el.style.boxShadow;
    const origTransition = el.style.transition;

    el.style.transition = 'outline 0.2s, box-shadow 0.2s';
    el.style.outline = '3px solid #f59e0b';
    el.style.outlineOffset = '4px';
    el.style.boxShadow = '0 0 25px rgba(245, 158, 11, 0.7)';

    setTimeout(() => {
      try {
        el.style.outline = origOutline;
        el.style.outlineOffset = origOutlineOffset;
        el.style.boxShadow = origBoxShadow;
        el.style.transition = origTransition;
      } catch (_) {}
    }, 2000);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Mount the Webspresso Client DevTool onto the document.
 *
 * @param {object} runtime - Webspresso Client Runtime instance
 * @param {object} [options]
 * @param {string} [options.position='bottom-right'] - 'bottom-right' | 'bottom-left'
 * @param {boolean} [options.open=false] - Initial drawer open state
 * @param {number} [options.pollInterval=1500] - Snapshot refresh interval (ms)
 * @param {string} [options.studioUrl='http://localhost:4567'] - URL to Webspresso DB Studio
 * @returns {object} DevTools handle with open(), close(), toggle(), destroy()
 */
function mountDevtool(runtime, options = {}) {
  if (typeof document === 'undefined') {
    return {
      open: () => {},
      close: () => {},
      toggle: () => {},
      destroy: () => {},
      isOpen: () => false,
      getSnapshot: () => ({}),
    };
  }

  // Prevent multiple devtool instances on the same page
  const existing = document.getElementById(DEVTOOL_HOST_ID);
  if (existing) {
    if (existing.__webspressoDevtoolInstance) {
      return existing.__webspressoDevtoolInstance;
    }
    existing.remove();
  }

  const position = options.position || 'bottom-right';
  const isRight = position.includes('right');
  const studioUrl = options.studioUrl || 'http://localhost:4567';
  let metaOverrides =
    options.meta && typeof options.meta === 'object' ? { ...options.meta } : {};
  let isOpen = Boolean(options.open);
  let activeTab = 'controllers'; // 'controllers' | 'fragments' | 'network' | 'storage' | 'studio'
  let selectedControllerId = null;

  function resolveDevFeatures() {
    const winMeta =
      typeof window !== 'undefined' &&
      window.__WEBSPRESSO_DEV_META__ &&
      typeof window.__WEBSPRESSO_DEV_META__ === 'object'
        ? window.__WEBSPRESSO_DEV_META__
        : {};
    const merged = { ...winMeta, ...metaOverrides };
    const pluginsList = isArray(merged.plugins)
      ? merged.plugins
      : isArray(options.plugins)
        ? options.plugins
        : [];

    const hasStudio =
      options.hasStudio !== undefined
        ? Boolean(options.hasStudio)
        : merged.hasStudio !== undefined
          ? Boolean(merged.hasStudio)
          : merged.hasDb !== undefined
            ? Boolean(merged.hasDb)
            : Boolean(
                options.studioUrl ||
                  pluginsList.includes('studio') ||
                  pluginsList.includes('db-studio')
              );

    const hasAdmin =
      options.hasAdmin !== undefined
        ? Boolean(options.hasAdmin)
        : merged.hasAdmin !== undefined
          ? Boolean(merged.hasAdmin)
          : Boolean(
              options.adminPath ||
                options.adminUrl ||
                pluginsList.includes('admin-panel') ||
                pluginsList.includes('adminPanel') ||
                pluginsList.includes('admin')
            );

    const adminPath = merged.adminPath || options.adminPath || options.adminUrl || '/_admin';
    return {
      hasStudio,
      hasAdmin,
      adminPath,
      plugins: pluginsList,
    };
  }

  // Initialize Redux DevTools extension bridge if available
  const reduxBridge = setupReduxDevToolsBridge(runtime);

  // Host container
  const host = document.createElement('div');
  host.id = DEVTOOL_HOST_ID;
  host.style.cssText = 'position:fixed;z-index:999998;pointer-events:none;';

  // Use Shadow DOM to completely isolate styles from user CSS
  const shadow = typeof host.attachShadow === 'function' ? host.attachShadow({ mode: 'open' }) : host;

  // Style block
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .ws-devtool-root {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      color: #f4f4f5;
      line-height: 1.5;
      pointer-events: auto;
    }
    .ws-pill {
      position: fixed;
      bottom: 16px;
      ${isRight ? 'right: 16px;' : 'left: 16px;'}
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 9999px;
      padding: 6px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5), 0 0 10px rgba(0,0,0,0.3);
      user-select: none;
      transition: all 0.2s ease;
      z-index: 999998;
    }
    .ws-pill:hover {
      background: #27272a;
      border-color: #f59e0b;
      transform: translateY(-1px);
      box-shadow: 0 12px 30px -5px rgba(245,158,11,0.25);
    }
    .ws-pill-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 700;
      background: #27272a;
      color: #a1a1aa;
    }
    .ws-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      display: inline-block;
      box-shadow: 0 0 8px #10b981;
    }
    .ws-drawer {
      position: fixed;
      bottom: 16px;
      ${isRight ? 'right: 16px;' : 'left: 16px;'}
      width: min(780px, calc(100vw - 32px));
      height: 520px;
      max-height: calc(100vh - 32px);
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 12px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7), 0 0 30px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 999999;
    }
    .ws-drawer.ws-drawer-enter {
      animation: wsFadeIn 0.15s ease-out;
    }
    @keyframes wsFadeIn {
      from { opacity: 0; transform: scale(0.98) translateY(6px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .ws-header {
      background: #121215;
      border-bottom: 1px solid #27272a;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      user-select: none;
    }
    .ws-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 13px;
      color: #fbbf24;
    }
    .ws-tabs {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .ws-tabs::-webkit-scrollbar { display: none; }
    .ws-tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: #a1a1aa;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .ws-tab-btn:hover {
      background: #27272a;
      color: #f4f4f5;
    }
    .ws-tab-btn.active {
      background: #27272a;
      border-color: #3f3f46;
      color: #fbbf24;
    }
    .ws-btn {
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #f4f4f5;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .ws-btn:hover {
      background: #3f3f46;
      border-color: #71717a;
      color: #fff;
    }
    .ws-btn-primary {
      background: #d97706;
      border-color: #f59e0b;
      color: #fff;
    }
    .ws-btn-primary:hover {
      background: #f59e0b;
    }
    .ws-btn-sm {
      padding: 2px 7px;
      font-size: 10px;
    }
    .ws-content {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      background: #09090b;
    }
    .ws-footer {
      background: #121215;
      border-top: 1px solid #27272a;
      padding: 6px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: #71717a;
    }
    .ws-code-block {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 10px;
      font-size: 11px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .ws-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
    }
    .ws-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .ws-badge-success { background: #064e3b; color: #34d399; }
    .ws-badge-warning { background: #78350f; color: #fbbf24; }
    .ws-badge-info { background: #1e3a8a; color: #60a5fa; }
    .ws-badge-danger { background: #881337; color: #fb7185; }
  `;
  shadow.appendChild(styleEl);

  const container = document.createElement('div');
  container.className = 'ws-devtool-root';
  shadow.appendChild(container);

  // --- Snapshot Data Fetchers ---
  function getControllersSnapshot() {
    if (!runtime.controllers) return [];
    return runtime.controllers.getActiveInstances().map((inst) => ({
      instanceId: inst.instanceId,
      name: inst.name,
      tagName: inst.el ? inst.el.tagName.toLowerCase() : 'div',
      isConnected: Boolean(inst.isConnected),
      state: inst.state ? { ...inst.state } : {},
      el: inst.el,
      actions: inst.actions ? Object.keys(inst.actions) : [],
    }));
  }

  function getFragmentsSnapshot() {
    if (!runtime.fragments) return [];
    return runtime.fragments.getInstances().map((inst) => ({
      instanceId: inst.instanceId,
      name: inst.name,
      input: inst.input ? { ...inst.input } : {},
      dependsOn: inst.dependsOn ? Array.from(inst.dependsOn) : [],
      version: inst.version || 1,
      pagePath: inst.pagePath || '/',
      el: inst.el,
    }));
  }

  function getNetworkSnapshot() {
    if (!runtime.debug || typeof runtime.debug.getSnapshot !== 'function') return [];
    const snap = runtime.debug.getSnapshot();
    return {
      activeRequests: snap.activeRequests || [],
      causalChains: snap.causalChains || [],
      fragmentTimings: snap.fragmentTimings || [],
      events: snap.events || [],
    };
  }

  function getStorageSnapshot() {
    const localEntries = [];
    const sessionEntries = [];
    try {
      if (typeof localStorage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('w:')) {
            localEntries.push({ key: k, value: localStorage.getItem(k) });
          }
        }
      }
      if (typeof sessionStorage !== 'undefined') {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('w:')) {
            sessionEntries.push({ key: k, value: sessionStorage.getItem(k) });
          }
        }
      }
    } catch (_) {}
    return { localEntries, sessionEntries };
  }

  // --- Renderers ---
  function renderPill() {
    const controllers = getControllersSnapshot();
    const fragments = getFragmentsSnapshot();
    return `
      <div class="ws-pill" id="ws-devtool-pill" title="Toggle Webspresso Client DevTools (Alt+W)">
        <span style="font-weight:700;color:#fbbf24;">⚡ Webspresso</span>
        <span class="ws-pill-badge">${controllers.length} ctrl${controllers.length !== 1 ? 's' : ''}</span>
        <span class="ws-pill-badge">${fragments.length} frag${fragments.length !== 1 ? 's' : ''}</span>
        <span class="ws-dot" title="Dev server connected"></span>
      </div>
    `;
  }

  function renderControllersTab(controllers) {
    if (controllers.length === 0) {
      return `
        <div class="ws-card" style="text-align:center;padding:32px;color:#a1a1aa;">
          <p style="font-size:14px;margin-bottom:6px;">No active controllers found on this page.</p>
          <p style="font-size:11px;color:#71717a;">Define a controller with <code>defineController(...)</code> and mount with <code>data-controller="..."</code>.</p>
        </div>
      `;
    }

    if (!selectedControllerId || !controllers.find((c) => c.instanceId === selectedControllerId)) {
      selectedControllerId = controllers[0].instanceId;
    }
    const current = controllers.find((c) => c.instanceId === selectedControllerId) || controllers[0];

    return `
      <div style="display:grid;grid-template-columns:220px 1fr;gap:14px;height:100%;">
        <!-- Sidebar list -->
        <div style="border-right:1px solid #27272a;padding-right:12px;overflow-y:auto;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#71717a;margin-bottom:8px;">Mounted Controllers (${controllers.length})</div>
          ${controllers
            .map(
              (c) => `
            <div
              class="ws-card ws-controller-item"
              data-inst-id="${escapeHtml(c.instanceId)}"
              style="cursor:pointer;padding:8px 10px;margin-bottom:6px;${
                c.instanceId === current.instanceId ? 'border-color:#f59e0b;background:#27272a;' : ''
              }">
              <div style="font-weight:700;color:#f4f4f5;">${escapeHtml(c.name || 'anonymous')}</div>
              <div style="font-size:10px;color:#a1a1aa;">&lt;${escapeHtml(c.tagName)}&gt; • ${escapeHtml(c.instanceId)}</div>
            </div>
          `
            )
            .join('')}
        </div>

        <!-- Details pane -->
        <div style="overflow-y:auto;padding-right:4px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <div>
              <h3 style="font-size:14px;font-weight:700;color:#fff;">${escapeHtml(current.name || 'anonymous')}</h3>
              <p style="font-size:10px;color:#71717a;">Instance: ${escapeHtml(current.instanceId)} • Connected: ${current.isConnected ? '✅' : '❌'}</p>
            </div>
            <button class="ws-btn ws-btn-sm" id="ws-btn-highlight-ctrl" data-inst-id="${escapeHtml(current.instanceId)}">
              🎯 Highlight in DOM
            </button>
          </div>

          <!-- Reactive State -->
          <div class="ws-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <strong style="color:#fbbf24;font-size:11px;">REACTIVE STATE</strong>
              <button class="ws-btn ws-btn-sm" id="ws-btn-copy-state" data-inst-id="${escapeHtml(current.instanceId)}">📋 Copy</button>
            </div>
            <div class="ws-code-block">${formatJsonHtml(current.state)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderFragmentsTab(fragments) {
    if (fragments.length === 0) {
      return `
        <div class="ws-card" style="text-align:center;padding:32px;color:#a1a1aa;">
          <p style="font-size:14px;margin-bottom:6px;">No SSR fragments found in DOM.</p>
          <p style="font-size:11px;color:#71717a;">Mark elements with <code>data-w-fragment="name"</code> to enable targeted server partial refreshes.</p>
        </div>
      `;
    }

    return `
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div>
            <strong style="font-size:13px;color:#fff;">Active SSR Fragments (${fragments.length})</strong>
            <p style="font-size:10px;color:#71717a;">Targeted server-rendered DOM segments that can be refreshed independently.</p>
          </div>
          <button class="ws-btn ws-btn-primary ws-btn-sm" id="ws-btn-refresh-all-frags">
            🔄 Refresh All
          </button>
        </div>

        ${fragments
          .map(
            (f) => `
          <div class="ws-card" style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div>
                <strong style="color:#38bdf8;font-size:12px;">${escapeHtml(f.name)}</strong>
                <span style="font-size:10px;color:#71717a;margin-left:6px;">#${escapeHtml(f.instanceId)}</span>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="ws-btn ws-btn-sm" id="ws-btn-highlight-frag" data-inst-id="${escapeHtml(f.instanceId)}">
                  🎯 Highlight
                </button>
                <button class="ws-btn ws-btn-primary ws-btn-sm" id="ws-btn-refresh-frag" data-frag-name="${escapeHtml(f.name)}">
                  🔄 Refresh
                </button>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
              <div>
                <span style="color:#a1a1aa;">Depends On Tags:</span>
                ${
                  f.dependsOn.length > 0
                    ? f.dependsOn.map((t) => `<span class="ws-badge ws-badge-info" style="margin-left:4px;">${escapeHtml(t)}</span>`).join('')
                    : '<span style="color:#71717a;margin-left:4px;">(none)</span>'
                }
              </div>
              <div>
                <span style="color:#a1a1aa;">Version:</span>
                <span style="color:#f4f4f5;margin-left:4px;">${escapeHtml(f.version)}</span>
              </div>
            </div>
            ${
              Object.keys(f.input).length > 0
                ? `<div style="margin-top:6px;"><span style="color:#a1a1aa;font-size:10px;">Parameters:</span><div class="ws-code-block" style="margin-top:4px;padding:6px;">${formatJsonHtml(
                    f.input
                  )}</div></div>`
                : ''
            }
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  function renderNetworkTab(network) {
    const { activeRequests, causalChains, fragmentTimings } = network;
    return `
      <div>
        <div style="margin-bottom:12px;">
          <strong style="font-size:13px;color:#fff;">Client Network & Causal Invalidation Chains</strong>
          <p style="font-size:10px;color:#71717a;">Tracks API calls, concurrency policies (latest, drop), and mutation-to-patch timings.</p>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px;">IN-FLIGHT & RECENT REQUESTS</div>
          ${
            activeRequests.length === 0
              ? '<div class="ws-card" style="padding:10px;color:#71717a;">No active or tracked requests in ring buffer.</div>'
              : activeRequests
                  .map(
                    (r) => `
            <div class="ws-card" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin-bottom:6px;">
              <div>
                <span class="ws-badge ws-badge-${r.method === 'GET' ? 'info' : 'warning'}">${escapeHtml(r.method)}</span>
                <span style="font-weight:600;margin-left:6px;">${escapeHtml(r.url)}</span>
              </div>
              <div style="font-size:10px;color:#a1a1aa;">
                Policy: <span style="color:#38bdf8;">${escapeHtml(r.policy || 'none')}</span> • Status: <span style="color:#34d399;">${escapeHtml(r.status)}</span>
              </div>
            </div>
          `
                  )
                  .join('')
          }
        </div>

        ${
          causalChains.length > 0
            ? `
          <div style="margin-bottom:14px;">
            <div style="font-size:11px;font-weight:700;color:#a78bfa;margin-bottom:6px;">CAUSAL CHAINS (MUTATION ➔ REFRESH ➔ PATCH)</div>
            ${causalChains
              .map(
                (c) => `
              <div class="ws-card" style="padding:10px;margin-bottom:6px;">
                <div style="font-weight:600;color:#f4f4f5;font-size:11px;">Chain: ${escapeHtml(c.chainId)}</div>
                <div class="ws-code-block" style="margin-top:4px;padding:6px;">${formatJsonHtml(c)}</div>
              </div>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }

        ${
          fragmentTimings.length > 0
            ? `
          <div>
            <div style="font-size:11px;font-weight:700;color:#34d399;margin-bottom:6px;">RECENT FRAGMENT TIMINGS</div>
            <div class="ws-card" style="padding:8px 12px;">
              ${fragmentTimings
                .slice(-5)
                .map(
                  (t) => `
                <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #27272a;font-size:11px;">
                  <span>${escapeHtml(t.fragmentName || t.instanceId)}</span>
                  <span style="color:#fbbf24;">patch: ${escapeHtml(t.patchMs)}ms ${t.loadMs ? `(load: ${escapeHtml(t.loadMs)}ms, render: ${escapeHtml(t.renderMs)}ms)` : ''}</span>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  function renderStorageTab(storage) {
    const { localEntries, sessionEntries } = storage;
    const totalCount = localEntries.length + sessionEntries.length;

    return `
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div>
            <strong style="font-size:13px;color:#fff;">Webspresso Storage Inspector (${totalCount})</strong>
            <p style="font-size:10px;color:#71717a;">Inspects namespaced keys (<code>w:*</code>) in localStorage and sessionStorage.</p>
          </div>
          <button class="ws-btn ws-btn-sm" id="ws-btn-clear-storage" style="color:#fb7185;border-color:#881337;">
            🗑️ Clear Webspresso Storage
          </button>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;color:#38bdf8;margin-bottom:6px;">LOCAL STORAGE (w:*)</div>
          ${
            localEntries.length === 0
              ? '<div class="ws-card" style="padding:8px 12px;color:#71717a;">No Webspresso entries in localStorage.</div>'
              : localEntries
                  .map(
                    (e) => `
            <div class="ws-card" style="margin-bottom:6px;">
              <div style="font-weight:600;color:#38bdf8;font-size:11px;">${escapeHtml(e.key)}</div>
              <div class="ws-code-block" style="margin-top:4px;padding:6px;">${formatJsonHtml(
                (() => {
                  try {
                    return JSON.parse(e.value);
                  } catch (_) {
                    return e.value;
                  }
                })()
              )}</div>
            </div>
          `
                  )
                  .join('')
          }
        </div>

        <div>
          <div style="font-size:11px;font-weight:700;color:#a78bfa;margin-bottom:6px;">SESSION STORAGE (w:*)</div>
          ${
            sessionEntries.length === 0
              ? '<div class="ws-card" style="padding:8px 12px;color:#71717a;">No Webspresso entries in sessionStorage.</div>'
              : sessionEntries
                  .map(
                    (e) => `
            <div class="ws-card" style="margin-bottom:6px;">
              <div style="font-weight:600;color:#a78bfa;font-size:11px;">${escapeHtml(e.key)}</div>
              <div class="ws-code-block" style="margin-top:4px;padding:6px;">${formatJsonHtml(
                (() => {
                  try {
                    return JSON.parse(e.value);
                  } catch (_) {
                    return e.value;
                  }
                })()
              )}</div>
            </div>
          `
                  )
                  .join('')
          }
        </div>
      </div>
    `;
  }

  function renderStudioTab() {
    const features = resolveDevFeatures();

    const studioCardHtml = features.hasStudio
      ? `
        <div class="ws-card" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;color:#fbbf24;font-size:13px;">🗄️ Webspresso DB Studio</div>
            <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">Visual database browser, query runner, and table inspector.</div>
            <div style="font-size:9px;color:#71717a;margin-top:4px;">Run in terminal: <code>npx webspresso studio</code> (port 4567)</div>
          </div>
          <a href="${sanitizeHref(studioUrl)}" target="_blank" rel="noopener noreferrer" class="ws-btn ws-btn-primary" id="ws-btn-open-studio" style="text-decoration:none;">
            Open DB Studio ↗
          </a>
        </div>
      `
      : '';

    const adminCardHtml = features.hasAdmin
      ? `
        <div class="ws-card" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;color:#38bdf8;font-size:13px;">⚙️ Admin Panel SPA</div>
            <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">Mithril.js model CRUD and staff administration cockpit.</div>
          </div>
          <a href="${sanitizeHref(features.adminPath)}" target="_blank" rel="noopener noreferrer" class="ws-btn" id="ws-btn-open-admin" style="text-decoration:none;">
            Open ${escapeHtml(features.adminPath)} ↗
          </a>
        </div>
      `
      : '';

    return `
      <div>
        <div style="margin-bottom:16px;">
          <strong style="font-size:13px;color:#fff;">Developer Tools & Studio Integrations</strong>
          <p style="font-size:10px;color:#71717a;">Direct shortcuts to Webspresso's integrated developer productivity tools.</p>
        </div>

        ${studioCardHtml}
        ${adminCardHtml}

        <div class="ws-card" style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-weight:700;color:#34d399;font-size:13px;">⚡ Dev Live Reload Hub</div>
            <div style="font-size:10px;color:#a1a1aa;margin-top:2px;">SSE-based CSS hot reload and server page reload connection.</div>
          </div>
          <button class="ws-btn ws-btn-sm" id="ws-btn-force-reload">
            🔄 Force Page Reload
          </button>
        </div>
      </div>
    `;
  }

  function renderDrawer() {
    const controllers = getControllersSnapshot();
    const fragments = getFragmentsSnapshot();
    const network = getNetworkSnapshot();
    const storage = getStorageSnapshot();

    return `
      <div class="ws-drawer" id="ws-devtool-drawer">
        <!-- Header -->
        <div class="ws-header">
          <div class="ws-title">
            <span>⚡ Webspresso DevTools</span>
            <span class="ws-badge ws-badge-warning">DEV</span>
          </div>

          <!-- Navigation tabs -->
          <div class="ws-tabs">
            <button class="ws-tab-btn ${activeTab === 'controllers' ? 'active' : ''}" data-tab="controllers">
              🎮 Controllers (${controllers.length})
            </button>
            <button class="ws-tab-btn ${activeTab === 'fragments' ? 'active' : ''}" data-tab="fragments">
              🧩 Fragments (${fragments.length})
            </button>
            <button class="ws-tab-btn ${activeTab === 'network' ? 'active' : ''}" data-tab="network">
              🌐 Network
            </button>
            <button class="ws-tab-btn ${activeTab === 'storage' ? 'active' : ''}" data-tab="storage">
              💾 Storage
            </button>
            <button class="ws-tab-btn ${activeTab === 'studio' ? 'active' : ''}" data-tab="studio">
              🛠️ Studio
            </button>
          </div>

          <!-- Controls -->
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="ws-btn ws-btn-sm" id="ws-btn-refresh-snap" title="Refresh Snapshot">🔄</button>
            <button class="ws-btn ws-btn-sm" id="ws-btn-close" title="Minimize DevTools (Alt+W)">✕</button>
          </div>
        </div>

        <!-- Body -->
        <div class="ws-content">
          ${
            activeTab === 'controllers'
              ? renderControllersTab(controllers)
              : activeTab === 'fragments'
                ? renderFragmentsTab(fragments)
                : activeTab === 'network'
                  ? renderNetworkTab(network)
                  : activeTab === 'storage'
                    ? renderStorageTab(storage)
                    : renderStudioTab()
          }
        </div>

        <!-- Footer -->
        <div class="ws-footer">
          <span>Shortcuts: <strong>Alt + W</strong> to toggle • Console: <code>window.__WEBSPRESSO_DEVTOOLS__</code></span>
          <span style="color:#a1a1aa;">Webspresso v${escapeHtml(PKG_VERSION)}</span>
        </div>
      </div>
    `;
  }

  let lastRenderedHtml = '';
  let wasOpen = false;

  function findInShadow(id) {
    if (shadow && typeof shadow.getElementById === 'function') {
      return shadow.getElementById(id);
    }
    return shadow && typeof shadow.querySelector === 'function' ? shadow.querySelector(`#${id}`) : null;
  }

  function updateDom(force = false) {
    const nextHtml = isOpen ? renderDrawer() : renderPill();
    if (!force && nextHtml === lastRenderedHtml && isOpen === wasOpen) {
      return;
    }

    // Preserve scroll positions inside drawer before updating DOM
    let prevContentScrollTop = 0;
    const prevContentEl =
      isOpen && wasOpen && shadow && typeof shadow.querySelector === 'function'
        ? shadow.querySelector('.ws-content')
        : null;
    if (prevContentEl) {
      prevContentScrollTop = prevContentEl.scrollTop || 0;
    }

    lastRenderedHtml = nextHtml;
    const openingTransition = isOpen && !wasOpen;
    wasOpen = isOpen;

    container.innerHTML = nextHtml;
    if (openingTransition) {
      const drawerEl = findInShadow('ws-devtool-drawer');
      if (drawerEl && drawerEl.classList) {
        drawerEl.classList.add('ws-drawer-enter');
      }
    }
    if (prevContentScrollTop > 0 && shadow && typeof shadow.querySelector === 'function') {
      const nextContentEl = shadow.querySelector('.ws-content');
      if (nextContentEl) {
        nextContentEl.scrollTop = prevContentScrollTop;
      }
    }
    bindEvents();
  }

  function bindEvents() {
    if (!isOpen) {
      const pill = findInShadow('ws-devtool-pill');
      if (pill) {
        pill.addEventListener('click', () => {
          isOpen = true;
          updateDom();
        });
      }
      return;
    }

    // Close button
    const closeBtn = findInShadow('ws-btn-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        isOpen = false;
        updateDom();
      });
    }

    // Refresh snapshot button
    const refreshSnapBtn = findInShadow('ws-btn-refresh-snap');
    if (refreshSnapBtn) {
      refreshSnapBtn.addEventListener('click', () => {
        updateDom();
      });
    }

    // Tab buttons
    const tabBtns = shadow.querySelectorAll('.ws-tab-btn');
    for (let i = 0; i < tabBtns.length; i++) {
      tabBtns[i].addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        if (tab) {
          activeTab = tab;
          updateDom();
        }
      });
    }

    // Controller selection in sidebar
    const ctrlItems = shadow.querySelectorAll('.ws-controller-item');
    for (let i = 0; i < ctrlItems.length; i++) {
      ctrlItems[i].addEventListener('click', (e) => {
        selectedControllerId = e.currentTarget.getAttribute('data-inst-id');
        updateDom();
      });
    }

    // Highlight controller in DOM
    const hlCtrlBtn = findInShadow('ws-btn-highlight-ctrl');
    if (hlCtrlBtn) {
      hlCtrlBtn.addEventListener('click', (e) => {
        const instId = e.currentTarget.getAttribute('data-inst-id');
        const instances = runtime.controllers ? runtime.controllers.getActiveInstances() : [];
        const target = instances.find((i) => i.instanceId === instId);
        if (target && target.el) {
          highlightElement(target.el);
        }
      });
    }

    // Copy state
    const copyStateBtn = findInShadow('ws-btn-copy-state');
    if (copyStateBtn) {
      copyStateBtn.addEventListener('click', (e) => {
        const instId = e.currentTarget.getAttribute('data-inst-id');
        const instances = runtime.controllers ? runtime.controllers.getActiveInstances() : [];
        const target = instances.find((i) => i.instanceId === instId);
        if (target && target.state && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(JSON.stringify(target.state, null, 2));
          copyStateBtn.textContent = '✅ Copied!';
          setTimeout(() => {
            try {
              copyStateBtn.textContent = '📋 Copy';
            } catch (_) {}
          }, 1500);
        }
      });
    }

    // Highlight fragment in DOM
    const hlFragBtns = shadow.querySelectorAll('#ws-btn-highlight-frag');
    for (let i = 0; i < hlFragBtns.length; i++) {
      hlFragBtns[i].addEventListener('click', (e) => {
        const instId = e.currentTarget.getAttribute('data-inst-id');
        const frag = runtime.fragments ? runtime.fragments.getInstance(instId) : null;
        if (frag && frag.el) {
          highlightElement(frag.el);
        }
      });
    }

    // Refresh fragment on demand
    const refreshFragBtns = shadow.querySelectorAll('#ws-btn-refresh-frag');
    for (let i = 0; i < refreshFragBtns.length; i++) {
      refreshFragBtns[i].addEventListener('click', async (e) => {
        const name = e.currentTarget.getAttribute('data-frag-name');
        if (name && runtime.fragments) {
          const btn = e.currentTarget;
          const origText = btn.textContent;
          btn.textContent = '⏳ ...';
          try {
            await runtime.fragments.refresh(name);
          } finally {
            setTimeout(() => {
              btn.textContent = origText;
              updateDom();
            }, 300);
          }
        }
      });
    }

    // Refresh all fragments
    const refreshAllBtn = findInShadow('ws-btn-refresh-all-frags');
    if (refreshAllBtn) {
      refreshAllBtn.addEventListener('click', async () => {
        if (!runtime.fragments) return;
        const origText = refreshAllBtn.textContent;
        refreshAllBtn.textContent = '⏳ Refreshing...';
        try {
          const frags = runtime.fragments.getInstances();
          for (const f of frags) {
            await runtime.fragments.refresh(f.name);
          }
        } finally {
          setTimeout(() => {
            refreshAllBtn.textContent = origText;
            updateDom();
          }, 300);
        }
      });
    }

    // Clear Webspresso storage
    const clearStorageBtn = findInShadow('ws-btn-clear-storage');
    if (clearStorageBtn) {
      clearStorageBtn.addEventListener('click', () => {
        defaultStorage.local.clear();
        defaultStorage.session.clear();
        clearStorageBtn.textContent = '✅ Cleared!';
        setTimeout(() => {
          updateDom();
        }, 800);
      });
    }

    // Force page reload
    const forceReloadBtn = findInShadow('ws-btn-force-reload');
    if (forceReloadBtn) {
      forceReloadBtn.addEventListener('click', () => {
        if (typeof window !== 'undefined' && window.location) {
          window.location.reload();
        }
      });
    }
  }

  // Hotkey listener: Alt+W toggles the DevTool dock
  function onKeyDown(e) {
    if (e.altKey && (e.key === 'w' || e.key === 'W' || e.code === 'KeyW')) {
      e.preventDefault();
      isOpen = !isOpen;
      updateDom();
    }
  }

  document.addEventListener('keydown', onKeyDown);

  // Periodic polling to keep snapshots live
  const pollIntervalMs = isNumber(options.pollInterval) ? options.pollInterval : 2000;
  let pollTimer = null;
  if (pollIntervalMs > 0) {
    pollTimer = setInterval(() => {
      // If open, re-render to reflect live state changes
      if (isOpen) {
        updateDom();
      }
    }, pollIntervalMs);
  }

  // Mount into DOM
  const targetBody = document.body || document.documentElement;
  targetBody.appendChild(host);
  updateDom();

  // Public handle & window console export
  const devtoolApi = {
    open() {
      isOpen = true;
      updateDom();
    },
    close() {
      isOpen = false;
      updateDom();
    },
    toggle() {
      isOpen = !isOpen;
      updateDom();
    },
    isOpen() {
      return isOpen;
    },
    setMeta(nextMeta = {}) {
      if (nextMeta && typeof nextMeta === 'object') {
        metaOverrides = { ...metaOverrides, ...nextMeta };
        updateDom();
      }
    },
    getSnapshot() {
      return {
        controllers: getControllersSnapshot(),
        fragments: getFragmentsSnapshot(),
        network: getNetworkSnapshot(),
        storage: getStorageSnapshot(),
      };
    },
    getState(controllerName) {
      const controllers = getControllersSnapshot();
      const match = controllers.find((c) => c.name === controllerName || c.instanceId === controllerName);
      return match ? match.state : null;
    },
    refresh(fragmentName) {
      return runtime.fragments ? runtime.fragments.refresh(fragmentName) : Promise.resolve();
    },
    highlight(controllerOrFragmentName) {
      const controllers = getControllersSnapshot();
      const ctrl = controllers.find((c) => c.name === controllerOrFragmentName || c.instanceId === controllerOrFragmentName);
      if (ctrl && ctrl.el) {
        return highlightElement(ctrl.el);
      }
      const fragments = getFragmentsSnapshot();
      const frag = fragments.find((f) => f.name === controllerOrFragmentName || f.instanceId === controllerOrFragmentName);
      if (frag && frag.el) {
        return highlightElement(frag.el);
      }
      return false;
    },
    destroy() {
      document.removeEventListener('keydown', onKeyDown);
      if (pollTimer) clearInterval(pollTimer);
      try {
        host.remove();
      } catch (_) {}
      if (typeof window !== 'undefined' && window.__WEBSPRESSO_DEVTOOLS__ === devtoolApi) {
        delete window.__WEBSPRESSO_DEVTOOLS__;
      }
    },
  };

  host.__webspressoDevtoolInstance = devtoolApi;

  if (typeof window !== 'undefined') {
    window.__WEBSPRESSO_DEVTOOLS__ = devtoolApi;
  }

  return devtoolApi;
}

module.exports = {
  mountDevtool,
  highlightElement,
  setupReduxDevToolsBridge,
  formatJsonHtml,
};
