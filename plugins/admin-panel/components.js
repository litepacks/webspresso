/**
 * Admin Panel Components
 * Mithril.js components for admin panel UI
 */

module.exports = `
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
  bulkFields: [], // Bulk-updatable fields (enum/boolean)
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
          m('a.text-gray-500.hover:text-gray-700', {
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
            m('svg.w-4.h-4.text-gray-400.mx-1', { fill: 'currentColor', viewBox: '0 0 20 20' }, [
              m('path', { 'fill-rule': 'evenodd', d: 'M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z', 'clip-rule': 'evenodd' }),
            ]),
            idx === items.length - 1
              ? m('span.text-gray-700.font-medium', item.label)
              : m('a.text-gray-500.hover:text-gray-700', {
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

// Filter Operator Labels
const FILTER_OPERATORS = {
  string: [
    { value: 'contains', label: 'Contains' },
    { value: 'equals', label: 'Equals' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'ends_with', label: 'Ends with' },
  ],
  number: [
    { value: 'eq', label: 'Equals' },
    { value: 'gt', label: 'Greater than' },
    { value: 'gte', label: 'Greater or equal' },
    { value: 'lt', label: 'Less than' },
    { value: 'lte', label: 'Less or equal' },
    { value: 'between', label: 'Between' },
  ],
  date: [
    { value: 'eq', label: 'Equals' },
    { value: 'gt', label: 'After' },
    { value: 'gte', label: 'On or after' },
    { value: 'lt', label: 'Before' },
    { value: 'lte', label: 'On or before' },
    { value: 'between', label: 'Between' },
  ],
};

function getOperatorLabel(op, colType) {
  const ops = colType === 'date' || colType === 'datetime' || colType === 'timestamp' 
    ? FILTER_OPERATORS.date 
    : colType === 'integer' || colType === 'bigint' || colType === 'float' || colType === 'decimal'
      ? FILTER_OPERATORS.number
      : FILTER_OPERATORS.string;
  
  const found = ops.find(o => o.value === op);
  return found ? found.label : op;
}

// Filter Badge Component
const FilterBadge = {
  view: (vnode) => {
    const { colName, filter, colMeta, onRemove } = vnode.attrs;
    const label = colMeta?.ui?.label || formatColumnLabel(colName);
    const opLabel = getOperatorLabel(filter.op, colMeta?.type);
    
    let displayValue = '';
      if (filter.op === 'between') {
      displayValue = (filter.from || '?') + ' - ' + (filter.to || '?');
    } else if (filter.op === 'in' && Array.isArray(filter.value)) {
      displayValue = filter.value.join(', ');
      } else {
      displayValue = String(filter.value || '');
    }
    
    if (displayValue.length > 20) {
      displayValue = displayValue.substring(0, 20) + '...';
    }
    
    return m('span.inline-flex.items-center.gap-1.px-2.5.py-1.rounded-full.text-xs.font-medium.bg-indigo-50.text-indigo-700.border.border-indigo-200', [
      m('span.font-semibold', label),
      m('span.text-indigo-400', opLabel.toLowerCase()),
      m('span', '"' + displayValue + '"'),
      m('button.ml-1.text-indigo-400.hover:text-indigo-600.focus:outline-none', {
        onclick: (e) => {
          e.stopPropagation();
          onRemove(colName);
        },
            type: 'button',
      }, [
        m('svg.w-3.5.h-3.5', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', 'stroke-width': '2' }, [
          m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', d: 'M6 18L18 6M6 6l12 12' }),
        ]),
      ]),
    ]);
  },
};

// Active Filters Bar
const ActiveFiltersBar = {
  view: (vnode) => {
    const { filters, modelMeta, onRemove, onClearAll } = vnode.attrs;
    if (!filters || Object.keys(filters).length === 0) return null;
    
    const filterEntries = Object.entries(filters).filter(([_, f]) => 
      f && (f.value !== '' || f.from || f.to)
    );
    
    if (filterEntries.length === 0) return null;
    
    return m('.flex.items-center.gap-2.py-2.flex-wrap', [
      m('span.text-xs.font-medium.text-gray-500.uppercase.tracking-wide', 'Active filters:'),
      ...filterEntries.map(([colName, filter]) => {
        const col = modelMeta?.columns?.find(c => c.name === colName);
        return m(FilterBadge, { colName, filter, colMeta: col, onRemove });
      }),
      filterEntries.length > 1 ? m('button.text-xs.text-gray-500.hover:text-gray-700.underline.ml-2', {
        onclick: onClearAll,
        type: 'button',
      }, 'Clear all') : null,
    ]);
  },
};

// Quick Filter Input
const QuickFilterInput = {
  view: (vnode) => {
    const { placeholder, value, onChange, onClear } = vnode.attrs;
    
    return m('.relative.flex-1.max-w-xs', [
      m('div.absolute.inset-y-0.left-0.pl-3.flex.items-center.pointer-events-none', [
        m('svg.h-4.w-4.text-gray-400', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
          m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' }),
        ]),
      ]),
      m('input.block.w-full.pl-9.pr-8.py-2.text-sm.border.border-gray-300.rounded-lg.bg-white.placeholder-gray-400.focus:outline-none.focus:ring-2.focus:ring-indigo-500.focus:border-transparent', {
        type: 'text',
        placeholder: placeholder || 'Quick search...',
        value: value || '',
        oninput: (e) => onChange(e.target.value),
      }),
      value ? m('button.absolute.inset-y-0.right-0.pr-3.flex.items-center.text-gray-400.hover:text-gray-600', {
        onclick: onClear,
        type: 'button',
      }, [
        m('svg.h-4.w-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
          m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M6 18L18 6M6 6l12 12' }),
        ]),
      ]) : null,
    ]);
  },
};

// Quick Filters Bar
const QuickFiltersBar = {
  view: (vnode) => {
    const { modelMeta, filters, onFilterChange, onOpenDrawer, activeFilterCount } = vnode.attrs;
    
    const searchableColumns = (modelMeta?.columns || []).filter(col => 
      (col.type === 'string' || col.type === 'text') && 
      !col.primary && 
      ['name', 'title', 'email', 'slug', 'username'].some(n => col.name.includes(n))
    );
    
    const enumColumns = (modelMeta?.columns || []).filter(col => 
      col.type === 'enum' && col.enumValues && col.enumValues.length <= 6
    );
    
    const quickSearchCol = searchableColumns[0];
    const quickSearchFilter = quickSearchCol ? filters[quickSearchCol.name] : null;
    
    return m('.bg-white.border.border-gray-200.rounded-lg.p-3.mb-4.shadow-sm', [
      m('.flex.items-center.gap-3.flex-wrap', [
        quickSearchCol ? m(QuickFilterInput, {
          placeholder: 'Search by ' + (quickSearchCol.ui?.label || formatColumnLabel(quickSearchCol.name)).toLowerCase() + '...',
          value: quickSearchFilter?.value || '',
          onChange: (value) => {
            if (value) {
              onFilterChange(quickSearchCol.name, { op: 'contains', value });
            } else {
              onFilterChange(quickSearchCol.name, null);
            }
          },
          onClear: () => onFilterChange(quickSearchCol.name, null),
        }) : null,
        
        ...enumColumns.slice(0, 2).map(col => {
          const currentFilter = filters[col.name];
          const currentValue = currentFilter?.value;
          const label = col.ui?.label || formatColumnLabel(col.name);
          
          return m('.flex.items-center.gap-1', [
            m('span.text-xs.font-medium.text-gray-500', label + ':'),
            m('.flex.gap-1', [
              m('button.px-2.py-1.text-xs.rounded-md.transition-colors', {
                class: !currentValue 
                  ? 'bg-gray-200 text-gray-800' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                onclick: () => onFilterChange(col.name, null),
              }, 'All'),
              ...col.enumValues.map(val => 
                m('button.px-2.py-1.text-xs.rounded-md.transition-colors', {
                  class: currentValue === val 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  onclick: () => onFilterChange(col.name, { op: 'equals', value: val }),
                }, val)
              ),
            ]),
          ]);
        }),
        
        m('.flex-1'),
        
        m('button.inline-flex.items-center.gap-2.px-3.py-2.text-sm.font-medium.text-gray-700.bg-white.border.border-gray-300.rounded-lg.hover:bg-gray-50.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
          onclick: onOpenDrawer,
          type: 'button',
        }, [
          m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
            m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z' }),
          ]),
          'All Filters',
          activeFilterCount > 0 ? m('span.inline-flex.items-center.justify-center.w-5.h-5.text-xs.font-bold.text-white.bg-indigo-600.rounded-full', activeFilterCount) : null,
        ]),
      ]),
    ]);
  },
};

// Filter Field Component
const FilterField = {
  view: (vnode) => {
    const { col, filter, onChange } = vnode.attrs;
    const currentFilter = filter || {};
    const label = col.ui?.label || formatColumnLabel(col.name);
    
    if (col.type === 'boolean') {
      return m('.space-y-2', [
        m('label.block.text-sm.font-medium.text-gray-700', label),
        m('.flex.items-center.gap-4', [
          ['true', 'false', ''].map((val, idx) => {
            const labels = ['Yes', 'No', 'Any'];
            return m('label.inline-flex.items-center.cursor-pointer', [
              m('input.w-4.h-4.text-indigo-600.border-gray-300.focus:ring-indigo-500', {
                type: 'radio',
                name: 'filter_bool_' + col.name,
                checked: (currentFilter.value || '') === val,
                onchange: () => onChange(val ? { value: val } : null),
              }),
              m('span.ml-2.text-sm.text-gray-600', labels[idx]),
            ]);
          }),
        ]),
      ]);
    }
    
    if (col.type === 'enum' && col.enumValues) {
      const selectedValues = currentFilter.op === 'in' && Array.isArray(currentFilter.value) 
        ? currentFilter.value 
        : currentFilter.value ? [currentFilter.value] : [];
      
      return m('.space-y-2', [
        m('label.block.text-sm.font-medium.text-gray-700', label),
        m('.flex.flex-wrap.gap-2', [
          ...col.enumValues.map(val => {
            const isSelected = selectedValues.includes(val);
            return m('button.px-3.py-1.5.text-sm.rounded-md.border.transition-colors', {
              type: 'button',
              class: isSelected 
                ? 'bg-indigo-100 border-indigo-300 text-indigo-700' 
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50',
              onclick: () => {
                const newSelected = isSelected 
                  ? selectedValues.filter(v => v !== val)
                  : [...selectedValues, val];
                onChange(newSelected.length > 0 ? { op: 'in', value: newSelected } : null);
              },
            }, val);
          }),
          ]),
        ]);
    }
    
    if (col.type === 'date' || col.type === 'datetime' || col.type === 'timestamp') {
      const inputType = col.type === 'date' ? 'date' : 'datetime-local';
      const ops = FILTER_OPERATORS.date;
      
      return m('.space-y-2', [
        m('label.block.text-sm.font-medium.text-gray-700', label),
        m('.flex.items-start.gap-2.flex-wrap', [
          m('select.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.bg-white.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              value: currentFilter.op || 'eq',
              onchange: (e) => {
                const op = e.target.value;
              if (op === 'between') {
                onChange({ op, from: currentFilter.from || '', to: currentFilter.to || '' });
              } else {
                onChange({ op, value: currentFilter.value || '' });
              }
            },
          }, ops.map(o => m('option', { value: o.value }, o.label))),
            currentFilter.op === 'between' ? [
            m('input.flex-1.min-w-32.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              type: inputType,
                value: currentFilter.from || '',
              oninput: (e) => onChange({ op: 'between', from: e.target.value, to: currentFilter.to || '' }),
            }),
            m('span.text-gray-400.self-center', 'to'),
            m('input.flex-1.min-w-32.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              type: inputType,
                value: currentFilter.to || '',
              oninput: (e) => onChange({ op: 'between', from: currentFilter.from || '', to: e.target.value }),
            }),
          ] : m('input.flex-1.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
            type: inputType,
              value: currentFilter.value || '',
            oninput: (e) => onChange({ op: currentFilter.op || 'eq', value: e.target.value }),
            }),
          ]),
        ]);
    }
    
    if (col.type === 'integer' || col.type === 'bigint' || col.type === 'float' || col.type === 'decimal') {
      const ops = FILTER_OPERATORS.number;
      
      return m('.space-y-2', [
        m('label.block.text-sm.font-medium.text-gray-700', label),
        m('.flex.items-start.gap-2', [
          m('select.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.bg-white.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              value: currentFilter.op || 'eq',
              onchange: (e) => {
                const op = e.target.value;
              if (op === 'between') {
                onChange({ op, from: currentFilter.from || '', to: currentFilter.to || '' });
              } else {
                onChange({ op, value: currentFilter.value || '' });
              }
            },
          }, ops.map(o => m('option', { value: o.value }, o.label))),
            currentFilter.op === 'between' ? [
            m('input.w-24.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
                type: 'number',
                value: currentFilter.from || '',
                placeholder: 'Min',
              oninput: (e) => onChange({ op: 'between', from: e.target.value, to: currentFilter.to || '' }),
            }),
            m('span.text-gray-400.self-center', 'to'),
            m('input.w-24.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
                type: 'number',
                value: currentFilter.to || '',
                placeholder: 'Max',
              oninput: (e) => onChange({ op: 'between', from: currentFilter.from || '', to: e.target.value }),
            }),
          ] : m('input.flex-1.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              type: 'number',
              value: currentFilter.value || '',
            placeholder: 'Enter value',
            oninput: (e) => onChange({ op: currentFilter.op || 'eq', value: e.target.value }),
            }),
          ]),
        ]);
    }
    
    // String/Text field (default)
    const ops = FILTER_OPERATORS.string;
    
    return m('.space-y-2', [
      m('label.block.text-sm.font-medium.text-gray-700', label),
      m('.flex.items-center.gap-2', [
        m('select.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.bg-white.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              value: currentFilter.op || 'contains',
          onchange: (e) => onChange({ op: e.target.value, value: currentFilter.value || '' }),
        }, ops.map(o => m('option', { value: o.value }, o.label))),
        m('input.flex-1.px-3.py-2.text-sm.border.border-gray-300.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              type: 'text',
              value: currentFilter.value || '',
              placeholder: 'Enter search term',
          oninput: (e) => onChange({ op: currentFilter.op || 'contains', value: e.target.value }),
            }),
          ]),
        ]);
  },
};

// Filter Drawer Component
const FilterDrawer = {
  view: (vnode) => {
    const { isOpen, modelMeta, filters, onFilterChange, onApply, onClear, onClose } = vnode.attrs;
    
    if (!isOpen) return null;
    
    const filterableColumns = (modelMeta?.columns || []).filter(col => {
      if (col.primary || col.autoIncrement) return false;
      if (col.auto === 'create' || col.auto === 'update') return false;
      if (col.type === 'json') return false;
      return true;
    });
    
    const textColumns = filterableColumns.filter(c => c.type === 'string' || c.type === 'text');
    const numericColumns = filterableColumns.filter(c => ['integer', 'bigint', 'float', 'decimal'].includes(c.type));
    const dateColumns = filterableColumns.filter(c => ['date', 'datetime', 'timestamp'].includes(c.type));
    const boolEnumColumns = filterableColumns.filter(c => c.type === 'boolean' || c.type === 'enum');
    
    const renderGroup = (title, columns) => {
      if (columns.length === 0) return null;
      return m('.mb-6', [
        m('h4.text-xs.font-semibold.text-gray-400.uppercase.tracking-wider.mb-3', title),
        m('.space-y-4', columns.map(col => 
          m(FilterField, {
            col,
            filter: filters[col.name],
            onChange: (filter) => onFilterChange(col.name, filter),
          })
        )),
      ]);
    };
    
    return [
      m('.fixed.inset-0.bg-black.bg-opacity-25.z-40.transition-opacity', { onclick: onClose }),
      m('.fixed.inset-y-0.right-0.w-full.max-w-md.bg-white.shadow-xl.z-50.flex.flex-col', {
        style: 'animation: filterDrawerSlideIn 0.2s ease-out;',
      }, [
        m('.flex.items-center.justify-between.px-6.py-4.border-b.border-gray-200', [
          m('div', [
            m('h3.text-lg.font-semibold.text-gray-900', 'Advanced Filters'),
            m('p.text-sm.text-gray-500', 'Filter records by multiple criteria'),
          ]),
          m('button.p-2.text-gray-400.hover:text-gray-600.rounded-lg.hover:bg-gray-100', {
            onclick: onClose,
            type: 'button',
          }, [
            m('svg.w-5.h-5', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
              m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M6 18L18 6M6 6l12 12' }),
            ]),
          ]),
        ]),
        m('.flex-1.overflow-y-auto.px-6.py-4', [
          renderGroup('Text Fields', textColumns),
          renderGroup('Options', boolEnumColumns),
          renderGroup('Numbers', numericColumns),
          renderGroup('Dates', dateColumns),
        ]),
        m('.flex.items-center.justify-between.gap-3.px-6.py-4.border-t.border-gray-200.bg-gray-50', [
          m('button.px-4.py-2.text-sm.font-medium.text-gray-700.hover:text-gray-900', {
          onclick: onClear,
            type: 'button',
          }, 'Clear all'),
          m('.flex.gap-3', [
            m('button.px-4.py-2.text-sm.font-medium.text-gray-700.bg-white.border.border-gray-300.rounded-lg.hover:bg-gray-50', {
              onclick: onClose,
              type: 'button',
            }, 'Cancel'),
            m('button.px-4.py-2.text-sm.font-medium.text-white.bg-indigo-600.rounded-lg.hover:bg-indigo-700', {
              onclick: () => {
                onApply();
                onClose();
              },
              type: 'button',
            }, 'Apply Filters'),
          ]),
        ]),
      ]),
    ];
  },
};

// Add drawer animation styles
if (typeof document !== 'undefined' && !document.getElementById('filter-drawer-styles')) {
  const style = document.createElement('style');
  style.id = 'filter-drawer-styles';
  style.textContent = '@keyframes filterDrawerSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }';
  document.head.appendChild(style);
}

// Pagination Component
const Pagination = {
  view: (vnode) => {
    const { page, totalPages, total, perPage, onPageChange } = vnode.attrs;
    if (totalPages <= 1) return null;
    
    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start < maxVisible - 1) {
      start = Math.max(1, end - maxVisible + 1);
    }
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    
    return m('.flex.items-center.justify-between.px-4.py-3.bg-white.border-t', [
      m('.text-sm.text-gray-700', [
        'Showing ',
        m('span.font-medium', ((page - 1) * perPage) + 1),
        ' to ',
        m('span.font-medium', Math.min(page * perPage, total)),
        ' of ',
        m('span.font-medium', total),
        ' results',
      ]),
      m('nav.flex.items-center.space-x-1', [
        // Previous button
        m('button.px-3.py-1.rounded.border.text-sm', {
          disabled: page <= 1,
          class: page <= 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100',
          onclick: () => page > 1 && onPageChange(page - 1),
        }, '← Prev'),
        
        // Page numbers
        start > 1 ? [
          m('button.px-3.py-1.rounded.text-sm.text-gray-700.hover:bg-gray-100', {
            onclick: () => onPageChange(1),
          }, '1'),
          start > 2 ? m('span.px-2.text-gray-400', '...') : null,
        ] : null,
        
        ...pages.map(p => 
          m('button.px-3.py-1.rounded.text-sm', {
            class: p === page 
              ? 'bg-blue-600 text-white' 
              : 'text-gray-700 hover:bg-gray-100',
            onclick: () => onPageChange(p),
          }, p)
        ),
        
        end < totalPages ? [
          end < totalPages - 1 ? m('span.px-2.text-gray-400', '...') : null,
          m('button.px-3.py-1.rounded.text-sm.text-gray-700.hover:bg-gray-100', {
            onclick: () => onPageChange(totalPages),
          }, totalPages),
        ] : null,
        
        // Next button
        m('button.px-3.py-1.rounded.border.text-sm', {
          disabled: page >= totalPages,
          class: page >= totalPages ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100',
          onclick: () => page < totalPages && onPageChange(page + 1),
        }, 'Next →'),
      ]),
    ]);
  },
};

// Field Renderers - render appropriate input based on column type
const FieldRenderers = {
  // Text input (string)
  string: (col, value, onChange, readonly) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const inputType = ui.inputType || (validations.email ? 'email' : validations.url ? 'url' : 'text');
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.rounded.focus:outline-none.focus:ring-2.focus:ring-blue-500', {
        id: col.name,
        name: col.name,
        type: inputType,
        value: value || '',
        placeholder: placeholder,
        minlength: validations.minLength || validations.min,
        maxlength: validations.maxLength || validations.max || col.maxLength || 255,
        pattern: validations.pattern || undefined,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value),
      }),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },

  // Textarea (text)
  text: (col, value, onChange, readonly) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const rows = ui.rows || 4;
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: col.name }, label),
      m('textarea.w-full.px-3.py-2.border.border-gray-300.rounded.focus:outline-none.focus:ring-2.focus:ring-blue-500', {
        id: col.name,
        name: col.name,
        rows: rows,
        placeholder: placeholder,
        minlength: validations.minLength || validations.min,
        maxlength: validations.maxLength || validations.max,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value),
      }, value || ''),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },

  // Number input (integer, bigint)
  integer: (col, value, onChange, readonly) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.rounded.focus:outline-none.focus:ring-2.focus:ring-blue-500', {
        id: col.name,
        name: col.name,
        type: 'number',
        step: validations.step || '1',
        min: validations.min,
        max: validations.max,
        value: value !== null && value !== undefined ? value : '',
        placeholder: placeholder,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10)),
      }),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },

  // Float/Decimal input
  float: (col, value, onChange, readonly) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.rounded.focus:outline-none.focus:ring-2.focus:ring-blue-500', {
        id: col.name,
        name: col.name,
        type: 'number',
        step: validations.step || '0.01',
        min: validations.min,
        max: validations.max,
        value: value !== null && value !== undefined ? value : '',
        placeholder: placeholder,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value)),
      }),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },

  // Boolean checkbox
  boolean: (col, value, onChange, readonly) => {
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const hint = ui.hint || '';
    
    return m('.mb-4', [
      m('label.flex.items-center.cursor-pointer', { class: readonly ? 'cursor-not-allowed' : '' }, [
        m('input.mr-2.w-4.h-4', {
          type: 'checkbox',
          name: col.name,
          checked: Boolean(value),
          disabled: readonly,
          onchange: (e) => onChange(e.target.checked),
        }),
        m('span.text-sm.font-medium.text-gray-700', label),
      ]),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },

  // Date input
  date: (col, value, onChange, readonly) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const dateValue = value ? new Date(value).toISOString().split('T')[0] : '';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.rounded.focus:outline-none.focus:ring-2.focus:ring-blue-500', {
        id: col.name,
        name: col.name,
        type: 'date',
        value: dateValue,
        placeholder: placeholder,
        min: validations.min,
        max: validations.max,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value),
      }),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },

  // DateTime input (datetime, timestamp)
  datetime: (col, value, onChange, readonly) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const dateTimeValue = value ? new Date(value).toISOString().slice(0, 16) : '';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.rounded.focus:outline-none.focus:ring-2.focus:ring-blue-500', {
        id: col.name,
        name: col.name,
        type: 'datetime-local',
        value: dateTimeValue,
        placeholder: placeholder,
        min: validations.min,
        max: validations.max,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value),
      }),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },

  // Enum select
  enum: (col, value, onChange, readonly) => {
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const hint = ui.hint || '';
    const options = col.enumValues || [];
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: col.name }, label),
      m('select.w-full.px-3.py-2.border.border-gray-300.rounded.focus:outline-none.focus:ring-2.focus:ring-blue-500', {
        id: col.name,
        name: col.name,
        value: value || '',
        required: !col.nullable && !readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 cursor-not-allowed' : '',
        onchange: (e) => onChange(e.target.value),
      }, [
        col.nullable ? m('option', { value: '' }, '-- Select --') : null,
        ...options.map(opt => m('option', { value: opt, selected: value === opt }, opt)),
      ]),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },

  // JSON textarea
  json: (col, value, onChange, readonly) => {
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const rows = ui.rows || 6;
    const jsonString = value ? (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) : '';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: col.name }, label),
      m('textarea.w-full.px-3.py-2.border.border-gray-300.rounded.font-mono.text-sm.focus:outline-none.focus:ring-2.focus:ring-blue-500', {
        id: col.name,
        name: col.name,
        rows: rows,
        placeholder: placeholder,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 cursor-not-allowed' : '',
        oninput: (e) => {
          try {
            const parsed = JSON.parse(e.target.value);
            onChange(parsed);
          } catch {
            onChange(e.target.value);
          }
        },
      }, jsonString),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },

  // Array (as JSON or tags)
  array: (col, value, onChange, readonly) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || 'Comma-separated values';
    const hint = ui.hint || 'Enter comma-separated values';
    const arrayValue = Array.isArray(value) ? value.join(', ') : (value || '');
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.rounded.focus:outline-none.focus:ring-2.focus:ring-blue-500', {
        id: col.name,
        name: col.name,
        type: 'text',
        placeholder: placeholder,
        value: arrayValue,
        minlength: validations.minLength || validations.min,
        maxlength: validations.maxLength || validations.max,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 cursor-not-allowed' : '',
        oninput: (e) => {
          const arr = e.target.value.split(',').map(s => s.trim()).filter(s => s);
          onChange(arr);
        },
      }),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  },
};

// Rich Text Field Renderer Component
const RichTextField = {
    oncreate: (vnode) => {
      const { name, value = '', onchange, readonly = false } = vnode.attrs;
      
      // Load Quill if not already loaded
      if (typeof window.Quill === 'undefined') {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.quilljs.com/1.3.6/quill.snow.css';
        document.head.appendChild(link);
        
        const script = document.createElement('script');
        script.src = 'https://cdn.quilljs.com/1.3.6/quill.js';
        script.onload = () => {
          initEditor(vnode);
        };
        document.head.appendChild(script);
      } else {
        initEditor(vnode);
      }
      
      function initEditor(vnode) {
        const editorId = 'quill-editor-' + name;
        const editorEl = document.getElementById(editorId);
        const hiddenInput = document.getElementById(name + '-value');
        const isReadonly = readonly || false;
        
        if (editorEl && !editorEl._quill) {
          const quill = new window.Quill(editorEl, {
            theme: 'snow',
            readOnly: isReadonly,
            modules: {
              toolbar: isReadonly ? false : [
                [{ 'header': [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['link', 'image'],
                ['clean']
              ]
            }
          });
          
          // Set initial content
          if (value) {
            quill.root.innerHTML = value;
            if (hiddenInput) {
              hiddenInput.value = value;
            }
          }
          
          // Handle content changes
          if (!isReadonly) {
            quill.on('text-change', () => {
              const content = quill.root.innerHTML;
              if (hiddenInput) {
                hiddenInput.value = content;
              }
              if (onchange) {
                onchange(content);
              }
            });
          }
          
          editorEl._quill = quill;
        }
      }
    },
  
  onupdate: (vnode) => {
    // Update editor content if value changed externally
    const { name, value = '', readonly = false } = vnode.attrs;
    const editorId = 'quill-editor-' + name;
    const editorEl = document.getElementById(editorId);
    const hiddenInput = document.getElementById(name + '-value');
    
    if (editorEl && editorEl._quill) {
      const currentContent = editorEl._quill.root.innerHTML;
      const newValue = value || '';
      if (currentContent !== newValue) {
        editorEl._quill.root.innerHTML = newValue;
        if (hiddenInput) {
          hiddenInput.value = newValue;
        }
      }
    }
  },
  
  view: (vnode) => {
    const { name, col, value = '', onChange, readonly } = vnode.attrs;
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const hint = ui.hint || '';
    const editorId = 'quill-editor-' + name;
    const required = !col.nullable && !readonly;
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.mb-1', { for: name },
        label,
        required ? m('span.text-red-500', ' *') : null
      ),
      m('div.border.border-gray-300.rounded', {
        id: editorId,
        class: readonly ? 'bg-gray-100 opacity-50' : '',
        style: 'min-height: 200px;'
      }),
      m('input[type=hidden]', {
        name,
        id: name + '-value',
        value: value || '',
      }),
      hint ? m('p.text-xs.text-gray-500.mt-1', hint) : null,
    ]);
  }
};

// Get appropriate renderer for a column type
function getFieldRenderer(col, modelMeta) {
  // Check for custom field first
  if (col.customField && col.customField.type) {
    if (col.customField.type === 'rich-text') {
      return (col, value, onChange, readonly) => {
        return m(RichTextField, {
          name: col.name,
          col,
          value: value || '',
          onChange,
          readonly: readonly || false,
        });
      };
    }
    // Add other custom field types here if needed
  }
  
  // Fallback to standard type renderers
  const typeMap = {
    string: 'string',
    text: 'text',
    integer: 'integer',
    bigint: 'integer',
    float: 'float',
    decimal: 'float',
    boolean: 'boolean',
    date: 'date',
    datetime: 'datetime',
    timestamp: 'datetime',
    enum: 'enum',
    json: 'json',
    array: 'array',
    uuid: 'string',
  };
  return FieldRenderers[typeMap[col.type] || 'string'];
}

// Check if a column is auto-generated (readonly)
function isAutoColumn(col) {
  // Primary key with auto-increment is readonly
  if (col.primary || col.autoIncrement) return 'primary';
  // Auto timestamps are always readonly
  if (col.auto === 'create' || col.auto === 'update') return 'auto';
  // Common timestamp field names
  if (col.name === 'created_at' || col.name === 'updated_at') return 'auto';
  return false;
}

// Check if rich-text content is empty
function isRichTextEmpty(value) {
  if (!value) return true;
  // Remove all HTML tags and check if only whitespace remains
  const stripped = value.replace(/<[^>]*>/g, '').trim();
  // Check for common empty Quill outputs
  return stripped === '' || value === '<p><br></p>' || value === '<p></p>';
}

// Login Form Component
const LoginForm = {
  view: () => m('.min-h-screen.flex.items-center.justify-center.p-4.sm:p-6.bg-gradient-to-br.from-blue-600.via-indigo-600.to-purple-700', [
    m('.w-full.max-w-md', [
      m('.bg-white.rounded-2xl.shadow-2xl.p-6.sm:p-8', [
        m('div.text-center.mb-6', [
          m('h1.text-2xl.sm:text-3xl.font-bold.text-gray-900', 'Admin Login'),
          m('p.text-gray-500.text-sm.mt-1', 'Sign in to your account'),
        ]),
        m('form', {
          onsubmit: async (e) => {
            e.preventDefault();
            state.loading = true;
            state.error = null;
            try {
              const data = new FormData(e.target);
              const result = await api.post('/auth/login', {
                email: data.get('email'),
                password: data.get('password'),
              });
              state.user = result.user;
              m.route.set('/');
            } catch (err) {
              state.error = err.message;
            } finally {
              state.loading = false;
            }
          }
        }, [
          state.error ? m('.bg-red-50.border.border-red-200.text-red-700.px-4.py-3.rounded-lg.mb-4.text-sm', state.error) : null,
          m('.mb-4', [
            m('label.block.text-sm.font-medium.text-gray-700.mb-2', { for: 'email' }, 'Email'),
            m('input#email.w-full.px-3.py-2.5.border.border-gray-300.rounded-lg.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors', {
              type: 'email',
              name: 'email',
              required: true,
              placeholder: 'admin@example.com',
            }),
          ]),
          m('.mb-6', [
            m('label.block.text-sm.font-medium.text-gray-700.mb-2', { for: 'password' }, 'Password'),
            m('input#password.w-full.px-3.py-2.5.border.border-gray-300.rounded-lg.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors', {
              type: 'password',
              name: 'password',
              required: true,
            }),
          ]),
          m('button.w-full.bg-blue-600.text-white.py-2.5.px-4.rounded-lg.font-medium.hover:bg-blue-700.focus:ring-2.focus:ring-blue-500.focus:ring-offset-2.disabled:opacity-50.transition-colors', {
            type: 'submit',
            disabled: state.loading,
          }, state.loading ? 'Logging in...' : 'Sign in'),
        ]),
      ]),
    ]),
  ]),
};

// Setup Form Component
const SetupForm = {
  view: () => m('.min-h-screen.flex.items-center.justify-center.p-4.sm:p-6.bg-gradient-to-br.from-blue-600.via-indigo-600.to-purple-700', [
    m('.w-full.max-w-md', [
      m('.bg-white.rounded-2xl.shadow-2xl.p-6.sm:p-8', [
        m('div.text-center.mb-6', [
          m('h1.text-2xl.sm:text-3xl.font-bold.text-gray-900', 'Setup Admin Account'),
          m('p.text-gray-500.text-sm.mt-1', 'Create the first admin user account.'),
        ]),
        m('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        state.loading = true;
        state.error = null;
        try {
          const data = new FormData(e.target);
          const result = await api.post('/auth/setup', {
            email: data.get('email'),
            password: data.get('password'),
            name: data.get('name'),
          });
          state.user = result.user;
          state.needsSetup = false;
          m.route.set('/');
        } catch (err) {
          state.error = err.message;
        } finally {
          state.loading = false;
        }
      }
    }, [
      state.error ? m('.bg-red-50.border.border-red-200.text-red-700.px-4.py-3.rounded-lg.mb-4.text-sm', state.error) : null,
          m('.mb-4', [
            m('label.block.text-sm.font-medium.text-gray-700.mb-2', { for: 'name' }, 'Name'),
            m('input#name.w-full.px-3.py-2.5.border.border-gray-300.rounded-lg.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors', {
              type: 'text',
              name: 'name',
              required: true,
            }),
          ]),
          m('.mb-4', [
            m('label.block.text-sm.font-medium.text-gray-700.mb-2', { for: 'email' }, 'Email'),
            m('input#email.w-full.px-3.py-2.5.border.border-gray-300.rounded-lg.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors', {
              type: 'email',
              name: 'email',
              required: true,
              placeholder: 'admin@example.com',
            }),
          ]),
          m('.mb-6', [
            m('label.block.text-sm.font-medium.text-gray-700.mb-2', { for: 'password' }, 'Password'),
            m('input#password.w-full.px-3.py-2.5.border.border-gray-300.rounded-lg.focus:ring-2.focus:ring-blue-500.focus:border-blue-500.transition-colors', {
              type: 'password',
              name: 'password',
              required: true,
            }),
          ]),
          m('button.w-full.bg-blue-600.text-white.py-2.5.px-4.rounded-lg.font-medium.hover:bg-blue-700.focus:ring-2.focus:ring-blue-500.focus:ring-offset-2.disabled:opacity-50.transition-colors', {
            type: 'submit',
            disabled: state.loading,
          }, state.loading ? 'Creating...' : 'Create Admin Account'),
        ]),
      ]),
    ]),
  ]),
};

// Layout Component is defined in menu.js module (uses Sidebar)

// Model List Component
const ModelList = {
  oninit: () => {
    state.loading = true;
    state.error = null;
    api.get('/models')
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
  view: () => m(Layout, [
    m('h2.text-2xl.font-bold.mb-6', 'Models'),
    state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
    state.loading
      ? m('p.text-gray-600', 'Loading models...')
      : state.models.length === 0
        ? m('p.text-gray-600', 'No models enabled in admin panel. Make sure your models have admin: { enabled: true }')
        : m('.grid.grid-cols-1.md:grid-cols-2.lg:grid-cols-3.gap-4', 
            state.models.map(model => 
              m('a.bg-white.p-6.rounded.shadow.hover:shadow-lg.transition', {
                href: '/models/' + model.name,
                onclick: (e) => {
                  e.preventDefault();
                  m.route.set('/models/' + model.name);
                }
              }, [
                model.icon ? m('span.text-2xl.mb-2.block', model.icon) : null,
                m('h3.font-semibold.text-lg', model.label || model.name),
                m('p.text-sm.text-gray-600.mt-2', model.table),
              ])
            )
          ),
  ]),
};

// Format cell value based on column type
function formatCellValue(value, col) {
  if (value === null || value === undefined) {
    return m('span.text-gray-400.italic', 'null');
  }
  
  switch (col?.type) {
    case 'boolean':
      return value 
        ? m('span.inline-flex.items-center.px-2.py-1.rounded-full.text-xs.font-medium.bg-green-100.text-green-800', '✓ Yes')
        : m('span.inline-flex.items-center.px-2.py-1.rounded-full.text-xs.font-medium.bg-gray-100.text-gray-600', '✗ No');
    
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
          ? m('span.text-xs.bg-gray-100.px-2.py-1.rounded', value.slice(0, 3).join(', ') + (value.length > 3 ? '...' : ''))
          : m('span.text-gray-400', '[]');
      }
      if (typeof value === 'object') {
        return m('span.text-xs.bg-gray-100.px-2.py-1.rounded.font-mono', '{...}');
      }
      return String(value);
    
    case 'text':
      const textStr = String(value);
      return textStr.length > 50 ? textStr.substring(0, 50) + '...' : textStr;
    
    default:
      const str = String(value);
      return str.length > 100 ? str.substring(0, 100) + '...' : str;
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
      m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-purple-600.bg-white.border.border-purple-200.rounded.hover:bg-purple-50.transition-colors', {
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
      state.bulkFieldDropdownOpen && m('.absolute.z-50.mt-1.w-64.bg-white.rounded-lg.shadow-lg.border.border-gray-200.overflow-hidden', {
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
          m('.px-3.py-2.bg-gray-50.border-b.border-gray-200', [
            m('span.text-xs.font-medium.text-gray-500.uppercase.tracking-wider', 
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
                        : m('span.inline-flex.items-center.px-2.py-0.5.rounded-full.text-xs.font-medium.bg-gray-100.text-gray-600', '✗')
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
                      m('span.text-xs.text-gray-400.uppercase', field.type),
                    ]),
                    m('svg.w-4.h-4.text-gray-400', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                      m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M9 5l7 7-7 7' })
                    ),
                  ])
                ),
            
            // Back button when viewing values
            state.selectedBulkField && m('button.w-full.px-3.py-2.text-left.text-sm.text-gray-500.hover:bg-gray-50.border-t.border-gray-100.flex.items-center.gap-1', {
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
  
  // Prioritize: id, name/title, then others (excluding long text/json fields)
  const priority = ['id', 'name', 'title', 'email', 'slug', 'status', 'published', 'created_at'];
  const exclude = ['password', 'content', 'body', 'description']; // Usually too long
  
  const sorted = [...columns].sort((a, b) => {
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
  
  api.get('/models/' + modelName + '/records?page=' + page + '&perPage=' + perPage + filterQuery)
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

// Record List Component - displays records with dynamic columns
const RecordList = {
  oninit: () => {
    const modelName = m.route.param('model');
    initializeModelView(modelName);
  },
  onbeforeupdate: () => {
    // Check if model changed (navigation between different models)
    const modelName = m.route.param('model');
    if (state._currentModelName !== modelName) {
      initializeModelView(modelName);
    }
    return true;
  },
  view: () => {
    const modelName = m.route.param('model');
    const modelMeta = state.currentModelMeta;
    const displayColumns = modelMeta ? getDisplayColumns(modelMeta.columns) : [];
    const primaryKey = modelMeta?.primaryKey || 'id';
    
    // Count active filters
    const activeFilterCount = Object.values(state.filters || {}).filter(f => 
      f && (f.value !== '' || f.from || f.to)
    ).length;
    
    const breadcrumbs = [
      { label: modelMeta?.label || modelName, href: '/models/' + modelName },
    ];
    
    // Filter change handler with auto-apply for quick filters
    const handleQuickFilterChange = (colName, filter) => {
      const newFilters = { ...state.filters };
      if (filter === null) {
        delete newFilters[colName];
      } else {
        newFilters[colName] = filter;
      }
      state.filters = newFilters;
      loadRecords(modelName, 1, newFilters);
    };
    
    // Filter change handler for drawer (no auto-apply)
    const handleDrawerFilterChange = (colName, filter) => {
      const newFilters = { ...state.filters };
      if (filter === null) {
        delete newFilters[colName];
      } else {
        newFilters[colName] = filter;
      }
      state.filters = newFilters;
      m.redraw();
    };
    
    return m(Layout, { breadcrumbs }, [
      // Header
      m('.flex.items-center.justify-between.mb-4', [
        m('h2.text-2xl.font-bold', modelMeta?.label || modelName),
        m('button.inline-flex.items-center.gap-2.px-4.py-2.text-sm.font-medium.text-white.bg-indigo-600.rounded-lg.hover:bg-indigo-700.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
          onclick: () => {
            state.currentRecord = null;
            state.editing = true;
            m.route.set('/models/' + modelName + '/new');
          }
        }, [
          m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
            m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M12 4v16m8-8H4' }),
          ]),
          'New Record',
        ]),
      ]),
      
      // Quick Filters Bar
      m(QuickFiltersBar, {
        modelMeta: modelMeta,
        filters: state.filters,
        onFilterChange: handleQuickFilterChange,
        onOpenDrawer: () => {
          state.filterDrawerOpen = true;
          m.redraw();
        },
        activeFilterCount: activeFilterCount,
      }),
      
      // Active filters badges
      m(ActiveFiltersBar, {
        filters: state.filters,
        modelMeta: modelMeta,
        onRemove: (colName) => {
          const newFilters = { ...state.filters };
          delete newFilters[colName];
          state.filters = newFilters;
          loadRecords(modelName, 1, newFilters);
        },
        onClearAll: () => {
          state.filters = {};
          loadRecords(modelName, 1, {});
        },
      }),
      
      // Filter Drawer
      m(FilterDrawer, {
        isOpen: state.filterDrawerOpen,
        modelMeta: modelMeta,
        filters: state.filters,
        onFilterChange: handleDrawerFilterChange,
        onApply: () => {
          loadRecords(modelName, 1, state.filters);
        },
        onClear: () => {
          state.filters = {};
          m.redraw();
        },
        onClose: () => {
          state.filterDrawerOpen = false;
          m.redraw();
        },
      }),
      
      state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
      state.loading
        ? m('.flex.items-center.justify-center.py-12', [
            m('.animate-spin.rounded-full.h-8.w-8.border-b-2.border-indigo-600'),
          ])
        : state.records.length === 0
          ? m('.bg-white.rounded-lg.shadow-sm.border.border-gray-200.p-12.text-center', [
              m('svg.w-12.h-12.mx-auto.text-gray-400.mb-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
                m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '1.5', d: 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4' }),
              ]),
              m('h3.text-lg.font-medium.text-gray-900.mb-1', 'No records found'),
              m('p.text-gray-500', activeFilterCount > 0 ? 'Try adjusting your filters' : 'Get started by creating your first record'),
            ])
          : m('.bg-white.rounded-lg.shadow-sm.border.border-gray-200.overflow-hidden', [
            // Bulk Actions Toolbar (shown when items selected)
            (state.selectedRecords && state.selectedRecords.size > 0) || state.selectAllMode ? m('.bg-indigo-50.border-b.border-indigo-100.px-4.py-3.flex.items-center.justify-between', [
              m('.flex.items-center.gap-3', [
                m('span.text-sm.text-indigo-700.font-medium', 
                  state.selectAllMode 
                    ? 'All ' + state.pagination.total + ' records selected'
                    : state.selectedRecords.size + ' record' + (state.selectedRecords.size > 1 ? 's' : '') + ' selected'
                ),
                // Show "Select all X records" option when current page is fully selected
                !state.selectAllMode && state.selectedRecords.size === state.records.length && state.pagination.total > state.records.length && m('button.text-sm.text-indigo-600.hover:text-indigo-800.underline.font-medium', {
                  onclick: () => {
                    state.selectAllMode = true;
                    m.redraw();
                  },
                }, 'Select all ' + state.pagination.total + ' records'),
                // Show "Select only this page" when in selectAllMode
                state.selectAllMode && m('button.text-sm.text-indigo-600.hover:text-indigo-800.underline', {
                  onclick: () => {
                    state.selectAllMode = false;
                    m.redraw();
                  },
                }, 'Select only this page (' + state.selectedRecords.size + ')'),
              ]),
              m('.flex.items-center.gap-2', [
                m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-red-600.bg-white.border.border-red-200.rounded.hover:bg-red-50.transition-colors', {
                  disabled: state.bulkActionInProgress,
                  onclick: async () => {
                    const count = state.selectAllMode ? state.pagination.total : state.selectedRecords.size;
                    if (!confirm('Are you sure you want to delete ' + count + ' records? This action cannot be undone.')) return;
                    state.bulkActionInProgress = true;
                    m.redraw();
                    try {
                      const payload = state.selectAllMode 
                        ? { selectAll: true, filters: state.filters }
                        : { ids: Array.from(state.selectedRecords) };
                      await api.post('/extensions/bulk-actions/bulk-delete/' + modelName, payload);
                      state.selectedRecords = new Set();
                      state.selectAllMode = false;
                      loadRecords(modelName, 1);
                    } catch (err) {
                      alert('Error: ' + err.message);
                    } finally {
                      state.bulkActionInProgress = false;
                      m.redraw();
                    }
                  },
                }, [
                  m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' })
                  ),
                  'Delete',
                ]),
                m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-blue-600.bg-white.border.border-blue-200.rounded.hover:bg-blue-50.transition-colors', {
                  disabled: state.bulkActionInProgress,
                  onclick: async () => {
                    state.bulkActionInProgress = true;
                    m.redraw();
                    try {
                      const payload = state.selectAllMode 
                        ? { selectAll: true, filters: state.filters }
                        : { ids: Array.from(state.selectedRecords) };
                      const response = await api.post('/extensions/export?model=' + modelName + '&format=json', payload);
                      // Download as file
                      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = modelName + '-export.json';
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      alert('Error: ' + err.message);
                    } finally {
                      state.bulkActionInProgress = false;
                      m.redraw();
                    }
                  },
                }, [
                  m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                  ),
                  'Export JSON',
                ]),
                m('button.inline-flex.items-center.gap-1.px-3.py-1.5.text-sm.font-medium.text-green-600.bg-white.border.border-green-200.rounded.hover:bg-green-50.transition-colors', {
                  disabled: state.bulkActionInProgress,
                  onclick: async () => {
                    state.bulkActionInProgress = true;
                    m.redraw();
                    try {
                      const payload = state.selectAllMode 
                        ? { selectAll: true, filters: state.filters }
                        : { ids: Array.from(state.selectedRecords) };
                      const response = await api.post('/extensions/export?model=' + modelName + '&format=csv', payload);
                      // Download as file
                      const blob = new Blob([response.data], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = modelName + '-export.csv';
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      alert('Error: ' + err.message);
                    } finally {
                      state.bulkActionInProgress = false;
                      m.redraw();
                    }
                  },
                }, [
                  m('svg.w-4.h-4', { fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    m('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                  ),
                  'Export CSV',
                ]),
                // Bulk Field Update Dropdown
                m(BulkFieldUpdateDropdown, {
                  modelName: modelName,
                  selectedIds: state.selectAllMode ? null : Array.from(state.selectedRecords),
                  selectAllMode: state.selectAllMode,
                  filters: state.filters,
                  onComplete: () => {
                    state.selectedRecords = new Set();
                    state.selectAllMode = false;
                    loadRecords(modelName, state.pagination.page);
                  },
                }),
                m('button.px-3.py-1.5.text-sm.text-gray-500.hover:text-gray-700', {
                  onclick: () => {
                    state.selectedRecords = new Set();
                    state.selectAllMode = false;
                    state.bulkFieldDropdownOpen = false;
                    state.selectedBulkField = null;
                    m.redraw();
                  },
                }, 'Clear'),
              ]),
            ]) : null,
            // Table container with sticky header and actions
            m('.overflow-x-auto.max-h-[calc(100vh-380px)]', { style: 'position: relative;' }, [
              m('table.w-full.border-collapse', { style: 'min-width: 100%;' }, [
                // Sticky header
                m('thead.bg-gray-50', { style: 'position: sticky; top: 0; z-index: 10;' }, [
                  m('tr', [
                    // Checkbox column header
                    m('th.px-4.py-3.text-left.bg-gray-50.border-b.border-gray-200', { style: 'width: 40px;' }, [
                      m('input[type=checkbox].rounded.border-gray-300.text-indigo-600.focus:ring-indigo-500', {
                        checked: state.records.length > 0 && state.selectedRecords && state.selectedRecords.size === state.records.length,
                        indeterminate: state.selectedRecords && state.selectedRecords.size > 0 && state.selectedRecords.size < state.records.length,
                        onchange: (e) => {
                          if (e.target.checked) {
                            state.selectedRecords = new Set(state.records.map(r => r[primaryKey]));
                          } else {
                            state.selectedRecords = new Set();
                          }
                          m.redraw();
                        },
                      }),
                    ]),
                    // Dynamic column headers
                    ...displayColumns.map(col => 
                      m('th.px-4.py-3.text-left.text-xs.font-medium.text-gray-500.uppercase.tracking-wider.whitespace-nowrap.bg-gray-50.border-b.border-gray-200', 
                        formatColumnLabel(col.name)
                      )
                    ),
                    // Sticky actions header
                    m('th.px-4.py-3.text-right.text-xs.font-medium.text-gray-500.uppercase.tracking-wider.bg-gray-50.border-b.border-gray-200', {
                      style: 'position: sticky; right: 0; min-width: 120px;',
                    }, 'Actions'),
                  ]),
                ]),
                m('tbody.divide-y.divide-gray-100', state.records.map(record => 
                  m('tr.hover:bg-gray-50.transition-colors', {
                    class: state.selectedRecords && state.selectedRecords.has(record[primaryKey]) ? 'bg-indigo-50' : '',
                  }, [
                    // Checkbox cell
                    m('td.px-4.py-3', [
                      m('input[type=checkbox].rounded.border-gray-300.text-indigo-600.focus:ring-indigo-500', {
                        checked: state.selectedRecords && state.selectedRecords.has(record[primaryKey]),
                        onchange: (e) => {
                          if (!state.selectedRecords) state.selectedRecords = new Set();
                          if (e.target.checked) {
                            state.selectedRecords.add(record[primaryKey]);
                          } else {
                            state.selectedRecords.delete(record[primaryKey]);
                          }
                          m.redraw();
                        },
                      }),
                    ]),
                    // Dynamic cell values
                    ...displayColumns.map(col => 
                      m('td.px-4.py-3.text-sm.whitespace-nowrap.text-gray-700', 
                        formatCellValue(record[col.name], col)
                      )
                    ),
                    // Sticky actions cell
                    m('td.px-4.py-3.text-sm.text-right.whitespace-nowrap.bg-white', {
                      style: 'position: sticky; right: 0; box-shadow: -4px 0 8px -4px rgba(0,0,0,0.05);',
                    }, [
                      m('button.inline-flex.items-center.px-2.py-1.text-sm.text-indigo-600.hover:text-indigo-800.hover:bg-indigo-50.rounded.mr-1.transition-colors', {
                        onclick: () => {
                          state.currentRecord = record;
                          state.editing = true;
                          m.route.set('/models/' + modelName + '/edit/' + record[primaryKey]);
                        }
                      }, 'Edit'),
                      m('button.inline-flex.items-center.px-2.py-1.text-sm.text-red-600.hover:text-red-800.hover:bg-red-50.rounded.transition-colors', {
                        onclick: async () => {
                          if (confirm('Are you sure you want to delete this record?')) {
                            try {
                              await api.delete('/models/' + modelName + '/records/' + record[primaryKey]);
                              loadRecords(modelName, state.pagination.page);
                            } catch (err) {
                              alert('Error: ' + err.message);
                            }
                          }
                        }
                      }, 'Delete'),
                    ]),
                  ])
                )),
              ]),
            ]),
            // Pagination
            m(Pagination, {
              page: state.pagination.page,
              perPage: state.pagination.perPage,
              total: state.pagination.total,
              totalPages: state.pagination.totalPages,
              onPageChange: (newPage) => loadRecords(modelName, newPage),
            }),
          ]),
    ]);
  },
};

// Record Form Component - renders fields based on model schema
const RecordForm = {
  oninit: () => {
    const modelName = m.route.param('model');
    const id = m.route.param('id');
    state.error = null;
    state.loading = true;
    state.formData = {};
    state.currentModelMeta = null;
    
    // Load model metadata first
    api.get('/models/' + modelName)
      .then(modelMeta => {
        state.currentModelMeta = modelMeta;
        
        // Initialize form data with defaults
        modelMeta.columns.forEach(col => {
          if (col.default !== undefined) {
            state.formData[col.name] = col.default;
          }
        });
        
        // If editing, load the record
        if (id && id !== 'new') {
          return api.get('/models/' + modelName + '/records/' + id)
            .then(result => {
              state.currentRecord = result.data;
              // Populate form data with record values
              Object.keys(result.data).forEach(key => {
                state.formData[key] = result.data[key];
              });
            });
        } else {
          state.currentRecord = null;
        }
      })
      .catch(err => {
        state.error = err.message;
      })
      .finally(() => {
        state.loading = false;
        m.redraw();
      });
  },
  view: () => {
    const modelName = m.route.param('model');
    const id = m.route.param('id');
    const isNew = !id || id === 'new';
    const modelMeta = state.currentModelMeta;
    
    const breadcrumbs = [
      { label: modelMeta?.label || modelName, href: '/models/' + modelName },
      { label: isNew ? 'New' : 'Edit #' + id, href: '#' },
    ];
    
    return m(Layout, { breadcrumbs }, [
      m('.flex.items-center.justify-between.mb-6', [
        m('h2.text-2xl.font-bold', isNew ? 'New Record' : 'Edit Record'),
        modelMeta ? m('span.text-gray-500', modelMeta.label || modelMeta.name) : null,
      ]),
      
      state.loading ? m('p.text-gray-600', 'Loading...') :
      state.error && !modelMeta ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded', state.error) :
      
      m('form.bg-white.rounded.shadow.flex.flex-col', {
        style: 'min-height: calc(100vh - 280px);',
        onsubmit: async (e) => {
          e.preventDefault();
          state.loading = true;
          state.error = null;
          try {
            // Validate rich-text fields first
            if (modelMeta && modelMeta.columns) {
              for (const col of modelMeta.columns) {
                if (col.customField && col.customField.type === 'rich-text' && !col.nullable) {
                  const hiddenInput = document.getElementById(col.name + '-value');
                  const value = hiddenInput ? hiddenInput.value : state.formData[col.name];
                  if (isRichTextEmpty(value)) {
                    state.error = (col.ui?.label || col.name) + ' is required';
                    state.loading = false;
                    return;
                  }
                }
              }
            }
            
            // Build payload, excluding auto-generated fields
            const payload = {};
            if (modelMeta && modelMeta.columns) {
              modelMeta.columns.forEach(col => {
                const autoType = isAutoColumn(col);
                // Skip primary key and auto timestamps in payload
                if (autoType === 'primary' || autoType === 'auto') return;
                
                // For rich-text fields, get value from hidden input
                let value = state.formData[col.name];
                if (col.customField && col.customField.type === 'rich-text') {
                  const hiddenInput = document.getElementById(col.name + '-value');
                  if (hiddenInput) {
                    value = hiddenInput.value;
                  }
                  // Skip empty rich-text values (normalize to null if nullable)
                  if (isRichTextEmpty(value)) {
                    if (col.nullable) {
                      payload[col.name] = null;
                    }
                    return;
                  }
                }
                
                if (value !== undefined && value !== null && value !== '') {
                  payload[col.name] = value;
                } else if (value === null && col.nullable) {
                  payload[col.name] = null;
                }
              });
            }
            
            if (isNew) {
              await api.post('/models/' + modelName + '/records', payload);
            } else {
              await api.put('/models/' + modelName + '/records/' + id, payload);
            }
            m.route.set('/models/' + modelName);
          } catch (err) {
            state.error = err.message;
          } finally {
            state.loading = false;
          }
        }
      }, [
        // Form content (scrollable)
        m('.p-6.flex-1.overflow-y-auto', [
          state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
          
          // Render form fields based on model columns
          modelMeta && modelMeta.columns ? modelMeta.columns.map(col => {
            const autoType = isAutoColumn(col);
            
            // Hide primary key in new mode
            if (autoType === 'primary' && isNew) return null;
            
            // Hide hidden fields
            if (col.ui && col.ui.hidden) return null;
            
            const isReadonly = !!autoType || (col.ui && col.ui.readonly);
            const renderer = getFieldRenderer(col, modelMeta);
            const value = state.formData[col.name];
            const onChange = (newValue) => {
              state.formData[col.name] = newValue;
            };
            
            return renderer(col, value, onChange, isReadonly);
          }) : m('p.text-gray-600.mb-4', 'Loading form fields...'),
        ]),
        
        // Sticky footer buttons
        m('.flex.gap-4.p-4.border-t.bg-gray-50.sticky.bottom-0', [
          m('button.bg-blue-600.text-white.px-6.py-2.rounded.hover:bg-blue-700.disabled:opacity-50', {
            type: 'submit',
            disabled: state.loading,
          }, state.loading ? 'Saving...' : 'Save'),
          m('button.bg-gray-200.text-gray-800.px-6.py-2.rounded.hover:bg-gray-300[type=button]', {
            onclick: () => m.route.set('/models/' + modelName),
          }, 'Cancel'),
        ]),
      ]),
    ]);
  },
};

// Export components
window.__ADMIN_COMPONENTS__ = {
  LoginForm,
  SetupForm,
  Layout,
  ModelList,
  RecordList,
  RecordForm,
  api,
  state,
};
`;
