
// API helper
const api = {
  async request(path, options = {}) {
    const adminPath = window.__ADMIN_PATH__ || '/_admin';
    const url = adminPath + '/api' + path;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include',
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    
    return response.json();
  },
  
  get(path) { return this.request(path, { method: 'GET' }); },
  post(path, data) { return this.request(path, { method: 'POST', body: JSON.stringify(data) }); },
  put(path, data) { return this.request(path, { method: 'PUT', body: JSON.stringify(data) }); },
  delete(path) { return this.request(path, { method: 'DELETE' }); },
};

/** POST /data-exchange/export/:model — validates JSON errors vs .xlsx blob */
async function downloadDataExchangeXlsx(modelName, payload) {
  const adminPath = window.__ADMIN_PATH__ || '/_admin';
  const res = await fetch(adminPath + '/api/data-exchange/export/' + modelName, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
  a.href = url;
  a.download = modelName + '-export.xlsx';
  a.click();
  URL.revokeObjectURL(url);
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
  filterPanelOpen: false, // Filter panel visibility (deprecated)
  filterDrawerOpen: false, // Filter drawer visibility
  bulkFields: [], // Bulk-updatable fields (enum/boolean/date/datetime/timestamp)
  bulkFieldDropdownOpen: false, // Bulk field dropdown visibility
  selectedBulkField: null, // Currently selected bulk field for update
  selectAllMode: false, // true = all records selected (not just current page)
};

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
