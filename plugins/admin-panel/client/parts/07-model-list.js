// Model List Component
const ModelList = {
  _load() {
    state.loading = true;
    state.error = null;
    m.redraw();
    return api.get('/models')
      .then(result => {
        state.models = result.models || [];
      })
      .catch(err => {
        state.error = err.message;
      })
      .finally(() => {
        state.loading = false;
        m.redraw();
      });
  },
  oninit(vnode) {
    vnode.state._stopPoll = null;
    vnode.state.refreshing = false;
    ModelList._load();
    vnode.state._stopPoll = runAdminAutoRefresh(() => ModelList._load());
  },
  onremove(vnode) {
    if (vnode.state._stopPoll) vnode.state._stopPoll();
  },
  view: (vnode) => m(Layout, [
    m('.flex.items-center.justify-between.mb-6', [
      m('h2.text-2xl.font-bold', 'Models'),
      m(RefreshIconButton, {
        title: 'Reload models',
        spinning: vnode.state.refreshing || state.loading,
        onclick: () => {
          vnode.state.refreshing = true;
          m.redraw();
          ModelList._load().finally(() => {
            vnode.state.refreshing = false;
            m.redraw();
          });
        },
      }),
    ]),
    state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
    state.loading
      ? m('p.text-gray-600', 'Loading models...')
      : state.models.length === 0
        ? m('p.text-gray-600', 'No models enabled in admin panel. Make sure your models have admin: { enabled: true }')
        : m('.grid.grid-cols-1.md:grid-cols-2.lg:grid-cols-3.gap-4', 
            state.models.map(model => 
              m('a.bg-white dark:bg-slate-800.p-6.rounded.shadow.hover:shadow-lg.transition', {
                href: '/models/' + model.name,
                onclick: (e) => {
                  e.preventDefault();
                  m.route.set('/models/' + model.name);
                }
              }, [
                model.icon ? m('span.text-2xl.mb-2.block', model.icon) : null,
                m('h3.font-semibold.text-lg', model.label || model.name),
                m('p.text-sm.text-gray-600 dark:text-slate-400.mt-2', model.table),
              ])
            )
          ),
  ]),
};

// Format cell value based on column type
function formatCellValue(value, col) {
  if (value === null || value === undefined) {
    return m('span.text-gray-400 dark:text-slate-500.italic', 'null');
  }
  
  switch (col?.type) {
    case 'boolean':
      return value 
        ? m('span.inline-flex.items-center.px-2.py-1.rounded-full.text-xs.font-medium.bg-green-100.text-green-800', '✓ Yes')
        : m('span.inline-flex.items-center.px-2.py-1.rounded-full.text-xs.font-medium.bg-gray-100 dark:bg-slate-800.text-gray-600', '✗ No');
    
    case 'datetime':
    case 'timestamp':
      try {
        const date = new Date(value);
        return date.toLocaleString();
      } catch { return String(value); }
    
    case 'date':
      try {
        const date = new Date(value);
        return date.toLocaleDateString();
      } catch { return String(value); }
    
    case 'json':
    case 'array':
      if (Array.isArray(value)) {
        return value.length > 0 
          ? m('span.text-xs.bg-gray-100 dark:bg-slate-800.px-2.py-1.rounded', value.slice(0, 3).join(', ') + (value.length > 3 ? '...' : ''))
          : m('span.text-gray-400', '[]');
      }
      if (typeof value === 'object') {
        return m('span.text-xs.bg-gray-100 dark:bg-slate-800.px-2.py-1.rounded.font-mono', '{...}');
      }
      return String(value);
    
    case 'text': {
      const textStr = String(value);
      return textStr.length > 50 ? textStr.substring(0, 50) + '...' : textStr;
    }

    case 'file': {
      const s = String(value);
      const short = s.length > 72 ? s.substring(0, 72) + '…' : s;
      if (/^https?:\\/\\//.test(s) || s.startsWith('/')) {
        return m('a.text-indigo-600.dark:text-indigo-400.hover:underline.break-all', {
          href: s,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, short);
      }
      return short || m('span.text-gray-400', '—');
    }
    
    default: {
      const str = String(value);
      return str.length > 100 ? str.substring(0, 100) + '...' : str;
    }
  }
}

// Load bulk-updatable fields for a model
async function loadBulkFields(modelName) {
  try {
    const response = await api.get('/extensions/bulk-fields/' + modelName);
    state.bulkFields = response.fields || [];
    m.redraw();
  } catch (err) {
    console.error('Failed to load bulk fields:', err);
    state.bulkFields = [];
  }
}

// Execute bulk field update
async function executeBulkFieldUpdate(modelName, field, value, ids) {
  try {
    const response = await api.post('/extensions/bulk-update/' + modelName, {
      ids: ids,
      field: field,
      value: value,
    });
    return response;
  } catch (err) {
    throw err;
  }
}

// Execute bulk field update
async function executeBulkFieldUpdateWithSelectAll(modelName, field, value, selectedIds, selectAllMode, filters) {
  try {
    const payload = selectAllMode 
      ? { selectAll: true, filters: filters, field: field, value: value }
      : { ids: selectedIds, field: field, value: value };
    const response = await api.post('/extensions/bulk-update/' + modelName, payload);
    return response;
  } catch (err) {
    throw err;
  }
}

// Bulk Field Update Dropdown Component
const BulkFieldUpdateDropdown = {
  view: (vnode) => {
    const { modelName, selectedIds, selectAllMode, filters, onComplete } = vnode.attrs;
    
    if (!state.bulkFields || state.bulkFields.length === 0) {
      return null;
    }
    
    return m('.relative.inline-block', [
      // Dropdown trigger
      m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-purple-600.bg-white dark:bg-slate-800.border.border-purple-200.rounded.hover:bg-purple-50.transition-colors', {
        disabled: state.bulkActionInProgress,
        onclick: (e) => {
          e.stopPropagation();
          state.bulkFieldDropdownOpen = !state.bulkFieldDropdownOpen;
          state.selectedBulkField = null;
          m.redraw();
        },
      }, [
        m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' })
        ),
        'Set Field',
        m('svg.w-4.h-4.ml-1', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M19 9l-7 7-7-7' })
        ),
      ]),
      
      // Dropdown menu
      state.bulkFieldDropdownOpen && m('.absolute.z-50.mt-1.w-64.bg-white dark:bg-slate-800.rounded-lg.shadow-lg.border.border-gray-200 dark:border-slate-600.overflow-hidden', {
        style: 'left: 0; top: 100%;',
        onclick: (e) => e.stopPropagation(),
      }, [
        // Close button area click handler
        m('.fixed.inset-0.z-40', {
          onclick: () => {
            state.bulkFieldDropdownOpen = false;
            state.selectedBulkField = null;
            m.redraw();
          },
        }),
        
        // Dropdown content
        m('.relative.z-50.bg-white', [
          // Header
          m('.px-3.py-2.bg-gray-50 dark:bg-slate-900.border-b.border-gray-200', [
            m('span.text-xs.font-medium.text-gray-500 dark:text-slate-400.uppercase.tracking-wider', 
              state.selectedBulkField ? 'Select Value' : 'Select Field'
            ),
          ]),
          
          // Field list or value list
          m('.max-h-64.overflow-y-auto', [
            state.selectedBulkField 
              // Show values for selected field
              ? state.selectedBulkField.options.map(option => 
                  m('button.w-full.px-3.py-2.text-left.text-sm.hover:bg-purple-50.flex.items-center.justify-between.transition-colors', {
                    onclick: async () => {
                      state.bulkActionInProgress = true;
                      state.bulkFieldDropdownOpen = false;
                      m.redraw();
                      
                      try {
                        await executeBulkFieldUpdateWithSelectAll(modelName, state.selectedBulkField.name, option.value, selectedIds, selectAllMode, filters);
                        state.selectedBulkField = null;
                        if (onComplete) onComplete();
                      } catch (err) {
                        alert('Error: ' + err.message);
                      } finally {
                        state.bulkActionInProgress = false;
                        m.redraw();
                      }
                    },
                  }, [
                    m('span.text-gray-700', String(option.label)),
                    state.selectedBulkField.type === 'boolean' && m('span.ml-2', 
                      option.value === true 
                        ? m('span.inline-flex.items-center.px-2.py-0.5.rounded-full.text-xs.font-medium.bg-green-100.text-green-800', '✓')
                        : m('span.inline-flex.items-center.px-2.py-0.5.rounded-full.text-xs.font-medium.bg-gray-100 dark:bg-slate-800.text-gray-600', '✗')
                    ),
                  ])
                )
              // Show field list
              : state.bulkFields.map(field =>
                  m('button.w-full.px-3.py-2.text-left.text-sm.hover:bg-purple-50.flex.items-center.justify-between.transition-colors', {
                    onclick: () => {
                      state.selectedBulkField = field;
                      m.redraw();
                    },
                  }, [
                    m('.flex.items-center.gap-2', [
                      m('span.text-gray-700', formatColumnLabel(field.label || field.name)),
                      m('span.text-xs.text-gray-400 dark:text-slate-500.uppercase', field.type),
                    ]),
                    m('svg.w-4.h-4.text-gray-400', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M9 5l7 7-7 7' })
                    ),
                  ])
                ),
            
            // Back button when viewing values
            state.selectedBulkField && m('button.w-full.px-3.py-2.text-left.text-sm.text-gray-500 dark:text-slate-400.hover:bg-gray-50 dark:hover:bg-slate-800/50 dark:hover:bg-slate-800/50.border-t.border-gray-100 dark:border-slate-700.flex.items-center.gap-1', {
              onclick: () => {
                state.selectedBulkField = null;
                m.redraw();
              },
            }, [
              m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M15 19l-7-7 7-7' })
              ),
              'Back to fields',
            ]),
          ]),
        ]),
      ]),
    ]);
  },
};

// Get columns to display in table (limit to reasonable number)
function getDisplayColumns(columns) {
  if (!columns || columns.length === 0) return [];

  // Filter out hidden columns (password_hash, api_token, etc.)
  const visible = [...columns].filter((col) => !col.hidden);

  // Prioritize: id, name/title, then others (excluding long text/json fields)
  const priority = ['id', 'name', 'title', 'email', 'slug', 'status', 'published', 'created_at'];
  const exclude = ['password', 'content', 'body', 'description']; // Usually too long

  const sorted = visible.sort((a, b) => {
    const aIdx = priority.indexOf(a.name);
    const bIdx = priority.indexOf(b.name);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return 0;
  });
  
  // Filter and limit
  return sorted
    .filter(col => !exclude.includes(col.name) && col.type !== 'text' && col.type !== 'json')
    .slice(0, 6); // Max 6 columns for readability
}

// Build query string from filters
function buildFilterQuery(filters) {
  if (!filters || Object.keys(filters).length === 0) return '';
  
  const params = [];
  for (const [col, filter] of Object.entries(filters)) {
    if (!filter || (filter.value === '' && !filter.from && !filter.to)) continue;
    
    if (filter.op === 'between') {
      params.push('filter[' + col + '][op]=between');
      if (filter.from) params.push('filter[' + col + '][from]=' + encodeURIComponent(filter.from));
      if (filter.to) params.push('filter[' + col + '][to]=' + encodeURIComponent(filter.to));
    } else if (filter.op === 'in' && Array.isArray(filter.value)) {
      params.push('filter[' + col + '][op]=in');
      filter.value.forEach(v => params.push('filter[' + col + '][value]=' + encodeURIComponent(v)));
    } else {
      if (filter.op) params.push('filter[' + col + '][op]=' + encodeURIComponent(filter.op));
      if (filter.value !== undefined && filter.value !== null && filter.value !== '') {
        params.push('filter[' + col + '][value]=' + encodeURIComponent(filter.value));
      }
    }
  }
  
  return params.length > 0 ? '&' + params.join('&') : '';
}

// Parse query string to filters
function parseFilterQuery(queryString) {
  const filters = {};
  if (!queryString) return filters;
  
  const params = new URLSearchParams(queryString);
  const filterParams = {};
  
  // Group filter parameters using simple string parsing (no regex needed)
  for (const [key, value] of params.entries()) {
    // Parse filter[column][prop] format
    if (key.startsWith('filter[')) {
      const firstClose = key.indexOf(']');
      const secondOpen = key.indexOf('[', firstClose);
      const secondClose = key.indexOf(']', secondOpen);
      
      if (firstClose > 7 && secondOpen > firstClose && secondClose > secondOpen) {
        const col = key.substring(7, firstClose);
        const prop = key.substring(secondOpen + 1, secondClose);
        
        if (!filterParams[col]) filterParams[col] = {};
        if (prop === 'value' && filterParams[col].value) {
          // Multiple values for 'in' operator
          if (!Array.isArray(filterParams[col].value)) {
            filterParams[col].value = [filterParams[col].value];
          }
          filterParams[col].value.push(value);
        } else {
          filterParams[col][prop] = value;
        }
      }
    }
  }
  
  // Convert to filter format
  for (const [col, data] of Object.entries(filterParams)) {
    if (data.op === 'between') {
      filters[col] = { op: 'between', from: data.from || '', to: data.to || '' };
    } else if (data.op === 'in') {
      filters[col] = { op: 'in', value: Array.isArray(data.value) ? data.value : [data.value] };
    } else {
      filters[col] = { op: data.op || 'contains', value: data.value || '' };
    }
  }
  
  return filters;
}

// Load records with pagination and filters
function loadRecords(modelName, page = 1, filters = null) {
  state.loading = true;
  state.error = null;
  
  const perPage = state.pagination.perPage || 20;
  const activeFilters = filters !== null ? filters : state.filters;
  const filterQuery = buildFilterQuery(activeFilters);
  
  // Update URL with filters
  const queryParams = new URLSearchParams();
  queryParams.set('page', page);
  if (state.trashedView) {
    queryParams.set('trashed', 'only');
  }
  if (Object.keys(activeFilters).length > 0) {
    for (const [col, filter] of Object.entries(activeFilters)) {
      if (!filter || (filter.value === '' && !filter.from && !filter.to)) continue;
      if (filter.op === 'between') {
        queryParams.set('filter[' + col + '][op]', 'between');
        if (filter.from) queryParams.set('filter[' + col + '][from]', filter.from);
        if (filter.to) queryParams.set('filter[' + col + '][to]', filter.to);
      } else if (filter.op === 'in' && Array.isArray(filter.value)) {
        queryParams.set('filter[' + col + '][op]', 'in');
        filter.value.forEach(v => queryParams.append('filter[' + col + '][value]', v));
      } else {
        if (filter.op) queryParams.set('filter[' + col + '][op]', filter.op);
        if (filter.value !== undefined && filter.value !== null && filter.value !== '') {
          queryParams.set('filter[' + col + '][value]', filter.value);
        }
      }
    }
  }
  
  // Update browser URL without reload
  const newUrl = window.location.pathname + (queryParams.toString() ? '?' + queryParams.toString() : '');
  window.history.replaceState({}, '', newUrl);
  
  const trashedParam = state.trashedView ? '&trashed=only' : '';
  return api.get('/models/' + modelName + '/records?page=' + page + '&perPage=' + perPage + trashedParam + filterQuery)
    .then(result => {
      state.records = result.data || [];
      state.pagination = {
        page: result.pagination?.page || page,
        perPage: result.pagination?.perPage || perPage,
        total: result.pagination?.total || state.records.length,
        totalPages: result.pagination?.totalPages || Math.ceil((result.pagination?.total || state.records.length) / perPage),
      };
    })
    .catch(err => {
      state.error = err.message;
    })
    .finally(() => {
      state.loading = false;
      m.redraw();
    });
}

// Initialize model data
function initializeModelView(modelName) {
  state.records = [];
  state.currentModelMeta = null;
  state.pagination = { page: 1, perPage: 20, total: 0, totalPages: 0 };
  state.filterPanelOpen = false;
  state.filterDrawerOpen = false;
  state.selectedRecords = new Set(); // Bulk selection
  state.selectAllMode = false; // Reset select all mode
  state.trashedView = false; // Soft delete: show trashed records
  state.bulkActionInProgress = false;
  state.bulkFields = []; // Reset bulk fields
  state.bulkFieldDropdownOpen = false;
  state.selectedBulkField = null;
  state._currentModelName = modelName;
  
  // Parse filters from URL query string
  const urlParams = new URLSearchParams(window.location.search);
  const page = parseInt(urlParams.get('page')) || 1;
  state.filters = parseFilterQuery(window.location.search);
  
  // Load model metadata first, then records
  state.loading = true;
  api.get('/models/' + modelName)
    .then(modelMeta => {
      state.currentModelMeta = modelMeta;
      state.currentModel = modelMeta;
      // Load bulk-updatable fields for this model
      loadBulkFields(modelName);
      return loadRecords(modelName, page, state.filters);
    })
    .catch(err => {
      state.error = err.message;
      state.loading = false;
      m.redraw();
    });
}
