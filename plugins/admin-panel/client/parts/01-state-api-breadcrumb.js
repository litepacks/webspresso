
/**
 * Shared client-side fetch wrapper with AbortController, timeout, and signal composition.
 * @param {string} url
 * @param {RequestInit & { timeout?: number }} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const { timeout = 30000, signal, ...fetchOptions } = options;

  if (signal && signal.aborted) {
    const reason = (signal.reason !== undefined && signal.reason !== null)
      ? signal.reason
      : new Error('This operation was aborted');
    throw reason;
  }

  if (typeof AbortController === 'undefined') {
    return fetch(url, { ...fetchOptions, signal });
  }

  const controller = new AbortController();
  let timer = null;
  let callerSignalListener = null;

  if (typeof timeout === 'number' && timeout > 0 && typeof setTimeout !== 'undefined') {
    timer = setTimeout(() => {
      const err = new Error('Request timed out after ' + timeout + 'ms');
      err.name = 'TimeoutError';
      err.code = 'ETIMEDOUT';
      controller.abort(err);
    }, timeout);
  }

  if (signal) {
    callerSignalListener = () => {
      controller.abort(signal.reason);
    };
    signal.addEventListener('abort', callerSignalListener, { once: true });
  }

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason) {
      const reason = controller.signal.reason;
      if (reason instanceof Error && (reason.name === 'TimeoutError' || reason.code === 'ETIMEDOUT')) {
        throw reason;
      }
    }
    if (err && err.name === 'AbortError' && controller.signal.aborted && controller.signal.reason) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && callerSignalListener) {
      signal.removeEventListener('abort', callerSignalListener);
    }
  }
}

// API helper
const api = {
  fetch: fetchWithTimeout,
  async request(path, options = {}) {
    const adminPath = window.__ADMIN_PATH__ || '/_admin';
    const url = adminPath + '/api' + path;
    const { timeout = 30000, signal, ...fetchOpts } = options;
    const response = await fetchWithTimeout(url, {
      ...fetchOpts,
      timeout,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOpts.headers,
      },
      credentials: 'include',
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      if (response.status === 401 && path.indexOf('/auth/') !== 0) {
        redirectToLogin('expired');
      }
      const err = new Error(error.error || error.message || 'Request failed');
      if (error.fields) err.fields = error.fields;
      err.response = error;
      err.status = response.status;
      throw err;
    }
    
    return response.json();
  },
  
  get(path, options) { return this.request(path, { ...options, method: 'GET' }); },
  post(path, data, options) { return this.request(path, { ...options, method: 'POST', body: JSON.stringify(data) }); },
  put(path, data, options) { return this.request(path, { ...options, method: 'PUT', body: JSON.stringify(data) }); },
  delete(path, options) { return this.request(path, { ...options, method: 'DELETE' }); },
};

/** POST /data-exchange/export/:model — validates JSON errors vs .xlsx blob */
async function downloadDataExchangeXlsx(modelName, payload, options = {}) {
  const adminPath = window.__ADMIN_PATH__ || '/_admin';
  const { timeout = 60000, signal, headers = {}, ...restOpts } = options;
  const res = await fetchWithTimeout(adminPath + '/api/data-exchange/export/' + modelName, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    timeout,
    signal,
    ...restOpts,
  });
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok || ct.indexOf('spreadsheet') === -1) {
    var msg = 'Export failed';
    try {
      if (ct.indexOf('json') !== -1) {
        var j = await res.json();
        msg = j.error || msg;
      } else {
        var t = await res.text();
        if (t) msg = t.slice(0, 300);
      }
    } catch (e) {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = modelName + '-export.xlsx';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

// Helper: Capitalize first letter of each word
function capitalizeWords(str) {
  if (!str) return '';
  return str.split(' ').map(function(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

// Helper: Format column name to label
function formatColumnLabel(name) {
  if (!name) return '';
  return capitalizeWords(name.replace(/_/g, ' '));
}

// State
const state = {
  user: null,
  needsSetup: false,
  loading: false,
  error: null,
  notice: null,
  toasts: [],
  models: [],
  currentModel: null,
  currentModelMeta: null, // Full model metadata with columns
  records: [],
  pagination: {
    page: 1,
    perPage: 20,
    total: 0,
    totalPages: 0,
  },
  currentRecord: null,
  formData: {}, // Form field values
  editing: false,
  filters: {}, // Active filters { column: { op, value, from, to } }
  sortColumn: null, // Currently sorted column name
  sortDirection: null, // Sort direction: 'asc' | 'desc' | null
  filterPanelOpen: false, // Filter panel visibility (deprecated)
  filterDrawerOpen: false, // Filter drawer visibility
  bulkFields: [], // Bulk-updatable fields (enum/boolean/date/datetime/timestamp)
  bulkFieldDropdownOpen: false, // Bulk field dropdown visibility
  selectedBulkField: null, // Currently selected bulk field for update
  selectAllMode: false, // true = all records selected (not just current page)
};

var INTENDED_ROUTE_KEY = 'webspresso.admin.intendedRoute';

function isSafeIntendedRoute(path) {
  if (!path || typeof path !== 'string') return false;
  var p = path.trim();
  if (p.charAt(0) !== '/' || p.indexOf('//') === 0 || p.indexOf('/\\') === 0) return false;
  if (p === '/login' || p === '/setup' || p.indexOf('/login?') === 0 || p.indexOf('/setup?') === 0) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return false;
  return true;
}

function saveIntendedRoute(explicitPath) {
  try {
    var path = explicitPath;
    if (!path && typeof m !== 'undefined' && m.route && typeof m.route.get === 'function') {
      path = m.route.get();
    }
    if (!isSafeIntendedRoute(path)) return;
    sessionStorage.setItem(INTENDED_ROUTE_KEY, path);
  } catch (e) {}
}

function clearIntendedRoute() {
  try {
    sessionStorage.removeItem(INTENDED_ROUTE_KEY);
  } catch (e) {}
}

function consumeIntendedRoute(defaultPath) {
  defaultPath = defaultPath || '/';

  // 1. Try route parameter or query string returnTo
  try {
    if (typeof m !== 'undefined' && m.route && typeof m.route.param === 'function') {
      var param = m.route.param('returnTo');
      if (param && isSafeIntendedRoute(param)) {
        clearIntendedRoute();
        return param;
      }
    }
  } catch (e) {}

  try {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      var match = window.location.search.match(/[?&]returnTo=([^&]+)/);
      if (match && match[1]) {
        var decoded = decodeURIComponent(match[1]);
        if (isSafeIntendedRoute(decoded)) {
          clearIntendedRoute();
          return decoded;
        }
      }
    }
  } catch (e) {}

  // 2. Fall back to sessionStorage
  try {
    var path = sessionStorage.getItem(INTENDED_ROUTE_KEY);
    sessionStorage.removeItem(INTENDED_ROUTE_KEY);
    if (isSafeIntendedRoute(path)) return path;
  } catch (e) {}

  return defaultPath;
}

function redirectToLogin(reason) {
  var currentRoute = '';
  try {
    if (typeof m !== 'undefined' && m.route && typeof m.route.get === 'function') {
      currentRoute = m.route.get();
    }
  } catch (e) {}

  if (isSafeIntendedRoute(currentRoute)) {
    saveIntendedRoute(currentRoute);
  }

  var params = [];
  if (isSafeIntendedRoute(currentRoute)) {
    params.push('returnTo=' + encodeURIComponent(currentRoute));
  }
  if (reason) {
    params.push('reason=' + encodeURIComponent(reason));
  }

  var target = '/login' + (params.length > 0 ? '?' + params.join('&') : '');
  try {
    if (typeof m !== 'undefined' && m.route && typeof m.route.set === 'function') {
      m.route.set(target);
    }
  } catch (e) {}
}

// ==========================================
// Toast Notification & Confirm Modal System
// ==========================================
var toastState = (typeof window !== 'undefined' && window.toastState) ? window.toastState : {
  items: [],
  add: function(type, message, options) {
    options = options || {};
    if (typeof type === 'object') {
      options = type;
      type = options.type || 'info';
      message = options.message || '';
    }
    var id = 'toast_' + Math.random().toString(36).substring(2, 9);
    var duration = options.duration !== undefined ? options.duration : 4000;
    var item = {
      id: id,
      type: type || 'info',
      message: message,
      title: options.title || '',
      duration: duration,
    };
    toastState.items.push(item);
    if (typeof state !== 'undefined') {
      state.toasts = toastState.items;
    }
    if (item.duration > 0) {
      setTimeout(function() {
        toastState.remove(id);
      }, item.duration);
    }
    try {
      if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
        m.redraw();
      }
    } catch (e) {}
    return id;
  },
  remove: function(id) {
    toastState.items = toastState.items.filter(function(t) { return t.id !== id; });
    if (typeof state !== 'undefined') {
      state.toasts = toastState.items;
    }
    try {
      if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
        m.redraw();
      }
    } catch (e) {}
  },
  clear: function() {
    toastState.items = [];
    if (typeof state !== 'undefined') {
      state.toasts = [];
    }
    try {
      if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
        m.redraw();
      }
    } catch (e) {}
  },
};

function normalizeToastOptions(options) {
  if (typeof options === 'number') {
    return { duration: options };
  }
  return options || {};
}

var notify = function(message, type, options) {
  var opts = normalizeToastOptions(options);
  if (typeof type === 'object') {
    opts = type;
    type = opts.type || 'info';
  }
  return toastState.add(type || 'info', message, opts);
};
notify.success = function(message, options) { return toastState.add('success', message, normalizeToastOptions(options)); };
notify.error = function(message, options) { return toastState.add('error', message, normalizeToastOptions(options)); };
notify.warning = function(message, options) { return toastState.add('warning', message, normalizeToastOptions(options)); };
notify.info = function(message, options) { return toastState.add('info', message, normalizeToastOptions(options)); };
notify.remove = function(id) { return toastState.remove(id); };
notify.clear = function() { return toastState.clear(); };

var ToastContainer = {
  view: function() {
    var items = (typeof toastState !== 'undefined' && toastState.items) || (typeof state !== 'undefined' && state.toasts) || [];
    if (!items || items.length === 0) return null;
    return m('div.fixed.top-4.right-4.z-50.flex.flex-col.gap-2.5.max-w-sm.w-full.pointer-events-none.px-4.sm:px-0',
      items.map(function(t) {
        var typeConfig = {
          success: {
            border: 'border-emerald-200 dark:border-emerald-800/80',
            bg: 'bg-white dark:bg-slate-900',
            iconColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60',
            symbol: '✓',
          },
          error: {
            border: 'border-red-200 dark:border-red-800/80',
            bg: 'bg-white dark:bg-slate-900',
            iconColor: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60',
            symbol: '!',
          },
          warning: {
            border: 'border-amber-200 dark:border-amber-800/80',
            bg: 'bg-white dark:bg-slate-900',
            iconColor: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60',
            symbol: '⚠',
          },
          info: {
            border: 'border-blue-200 dark:border-blue-800/80',
            bg: 'bg-white dark:bg-slate-900',
            iconColor: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60',
            symbol: 'ℹ',
          },
        };
        var cfg = typeConfig[t.type] || typeConfig.info;

        return m('div.pointer-events-auto.shadow-xl.rounded-xl.border.p-4.flex.items-start.gap-3.transition-all.transform', {
          key: t.id,
          class: cfg.border + ' ' + cfg.bg
        }, [
          m('div.w-7.h-7.rounded-lg.flex.items-center.justify-center.text-xs.font-bold.flex-shrink-0', {
            class: cfg.iconColor
          }, cfg.symbol),
          m('div.flex-1.min-w-0', [
            t.title ? m('h4.text-sm.font-semibold.text-gray-900.dark:text-slate-100', t.title) : null,
            m('p.text-xs.text-gray-600.dark:text-slate-300.break-words', t.message)
          ]),
          m('button.text-gray-400.hover:text-gray-600.dark:hover:text-slate-200.p-1.text-xs', {
            onclick: function() { toastState.remove(t.id); }
          }, '✕')
        ]);
      })
    );
  }
};

var confirmState = (typeof window !== 'undefined' && window.confirmState) ? window.confirmState : {
  current: null,
  open: function(options) {
    options = options || {};
    if (typeof options === 'string') {
      options = { message: options };
    }
    return new Promise(function(resolve) {
      confirmState.current = {
        title: options.title || 'Confirmation',
        message: options.message || 'Are you sure you want to proceed?',
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        confirmColor: options.confirmColor || (options.danger ? 'red' : 'blue'),
        danger: options.danger || false,
        resolve: resolve,
      };
      try {
        if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
          m.redraw();
        }
      } catch (e) {}
    });
  },
  close: function(result) {
    if (confirmState.current && confirmState.current.resolve) {
      confirmState.current.resolve(Boolean(result));
    }
    confirmState.current = null;
    try {
      if (typeof m !== 'undefined' && typeof m.redraw === 'function') {
        m.redraw();
      }
    } catch (e) {}
  }
};

var confirmModal = function(options) {
  return confirmState.open(options);
};

var ConfirmModalContainer = {
  view: function() {
    var cur = (typeof confirmState !== 'undefined' && confirmState.current) || null;
    if (!cur) return null;
    var isDanger = cur.danger || cur.confirmColor === 'red';

    return m('div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4', [
      m('div.fixed.inset-0.bg-black/50.backdrop-blur-sm', {
        onclick: function() { confirmState.close(false); }
      }),
      m('div.relative.bg-white.dark:bg-slate-900.rounded-xl.shadow-2xl.border.border-gray-200.dark:border-slate-700.max-w-md.w-full.p-6.z-10', [
        m('div.flex.items-start.gap-4', [
          m('div.w-10.h-10.rounded-full.flex.items-center.justify-center.flex-shrink-0', {
            class: isDanger ? 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
          }, isDanger ? '⚠' : '?'),
          m('div.flex-1', [
            m('h3.text-base.font-bold.text-gray-900.dark:text-slate-100', cur.title),
            m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1.5', cur.message)
          ])
        ]),
        m('div.mt-6.flex.items-center.justify-end.gap-3', [
          m('button.px-4.py-2.text-xs.font-medium.text-gray-700.dark:text-slate-300.bg-gray-100.dark:bg-slate-800.hover:bg-gray-200.dark:hover:bg-slate-700.rounded-lg', {
            onclick: function() { confirmState.close(false); }
          }, cur.cancelText),
          m('button.px-4.py-2.text-xs.font-medium.text-white.rounded-lg.shadow-sm', {
            class: isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700',
            onclick: function() { confirmState.close(true); }
          }, cur.confirmText)
        ])
      ])
    ]);
  }
};

// Convenience notification & confirmation helpers
function notifySuccess(msg, optionsOrTtl) {
  return notify.success(msg, optionsOrTtl);
}

function notifyError(msg, optionsOrTtl) {
  return notify.error(msg, optionsOrTtl);
}

function notifyWarning(msg, optionsOrTtl) {
  return notify.warning(msg, optionsOrTtl);
}

function notifyInfo(msg, optionsOrTtl) {
  return notify.info(msg, optionsOrTtl);
}

async function confirmAction(optionsOrMsg) {
  return await confirmModal(optionsOrMsg);
}

// Global window bindings
if (typeof window !== 'undefined') {
  window.toastState = toastState;
  window.confirmState = confirmState;
  window.notify = notify;
  window.toast = notify;
  window.confirmModal = confirmModal;
  window.ToastContainer = ToastContainer;
  window.ConfirmModalContainer = ConfirmModalContainer;
  window.Admin = window.Admin || {};
  window.Admin.toast = notify;
  window.Admin.confirm = confirmModal;
}

// Breadcrumb Component
const Breadcrumb = {
  view: (vnode) => {
    const items = vnode.attrs.items || [];
    if (items.length === 0) return null;
    
    return m('nav.mb-4', { 'aria-label': 'Breadcrumb' }, [
      m('ol.flex.items-center.space-x-2.text-sm', [
        // Home link
        m('li', [
          m('a.text-gray-500 dark:text-slate-400.hover:text-gray-700 dark:hover:text-slate-200 dark:hover:text-slate-200', {
            href: '/',
            onclick: (e) => {
              e.preventDefault();
              m.route.set('/');
            }
          }, [
            m('svg.w-4.h-4', { fill: 'currentColor', viewBox: '0 0 20 20' }, [
              m('path', { d: 'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z' }),
            ]),
          ]),
        ]),
        // Dynamic items
        ...items.map((item, idx) => [
          m('li.flex.items-center', [
            m('svg.w-4.h-4.text-gray-400 dark:text-slate-500.mx-1', { fill: 'currentColor', viewBox: '0 0 20 20' }, [
              m('path', { 'fill-rule': 'evenodd', d: 'M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z', 'clip-rule': 'evenodd' }),
            ]),
            idx === items.length - 1
              ? m('span.text-gray-700 dark:text-slate-300.font-medium', item.label)
              : m('a.text-gray-500 dark:text-slate-400.hover:text-gray-700 dark:hover:text-slate-200 dark:hover:text-slate-200', {
                  href: item.href,
                  onclick: (e) => {
                    e.preventDefault();
                    m.route.set(item.href);
                  }
                }, item.label),
          ]),
        ]),
      ]),
    ]);
  },
};

// ==========================================
// NEW FILTER COMPONENTS - Imported from filter-components.js
// ==========================================
