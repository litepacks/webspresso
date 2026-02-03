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
  filterPanelOpen: false, // Filter panel visibility
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

// Filter Badges Component - shows active filters
const FilterBadges = {
  view: (vnode) => {
    const { filters, modelMeta, onRemove } = vnode.attrs;
    if (!filters || Object.keys(filters).length === 0) return null;
    
    const badges = [];
    for (const [colName, filter] of Object.entries(filters)) {
      const col = modelMeta?.columns?.find(c => c.name === colName);
      const label = col?.ui?.label || col?.name?.replace(/_/g, ' ') || colName;
      let text = '';
      
      if (filter.op === 'between') {
        text = label + ': ' + filter.from + ' to ' + filter.to;
      } else if (filter.op === 'in') {
        text = label + ': ' + (Array.isArray(filter.value) ? filter.value.join(', ') : filter.value);
      } else if (filter.op) {
        text = label + ' ' + filter.op + ': ' + filter.value;
      } else {
        text = label + ': ' + filter.value;
      }
      
      badges.push(
        m('span.inline-flex.items-center.px-2.py-0.5.rounded-full.text-xs.bg-blue-50.text-blue-700.mr-1.mb-1', [
          text,
          m('button.ml-1.hover:text-blue-900.text-blue-400', {
            onclick: () => onRemove(colName),
            type: 'button',
          }, '×'),
        ])
      );
    }
    
    return badges.length > 0 ? m('.mb-2.flex.flex-wrap', badges) : null;
  },
};

// Filter Panel Component
const FilterPanel = {
  view: (vnode) => {
    const { modelMeta, filters, onFilterChange, onApply, onClear } = vnode.attrs;
    const isOpen = vnode.attrs.isOpen || false;
    
    if (!isOpen) return null;
    if (!modelMeta || !modelMeta.columns) return null;
    
    // Get filterable columns (exclude auto columns, json, and relations)
    const filterableColumns = modelMeta.columns.filter(col => {
      if (col.primary || col.autoIncrement) return false;
      if (col.auto === 'create' || col.auto === 'update') return false;
      if (col.type === 'json') return false;
      return true;
    });
    
    const filterInputs = filterableColumns.map(col => {
      const currentFilter = filters[col.name] || {};
      const colLabel = col.ui?.label || formatColumnLabel(col.name);
      
      if (col.type === 'boolean') {
        return m('.mb-2', [
          m('label.block.text-xs.font-medium.text-gray-600.mb-1', colLabel),
          m('.flex.items-center.gap-3', [
            m('label.flex.items-center.cursor-pointer', [
              m('input.mr-1.w-3.h-3', {
                type: 'radio',
                name: 'filter_' + col.name,
                checked: currentFilter.value === 'true',
                onchange: () => onFilterChange(col.name, { value: 'true' }),
              }),
              m('span.text-xs', 'Yes'),
            ]),
            m('label.flex.items-center.cursor-pointer', [
              m('input.mr-1.w-3.h-3', {
                type: 'radio',
                name: 'filter_' + col.name,
                checked: currentFilter.value === 'false',
                onchange: () => onFilterChange(col.name, { value: 'false' }),
              }),
              m('span.text-xs', 'No'),
            ]),
            m('label.flex.items-center.cursor-pointer', [
              m('input.mr-1.w-3.h-3', {
                type: 'radio',
                name: 'filter_' + col.name,
                checked: !currentFilter.value,
                onchange: () => onFilterChange(col.name, null),
              }),
              m('span.text-xs', 'All'),
            ]),
          ]),
        ]);
      } else if (col.type === 'date' || col.type === 'datetime' || col.type === 'timestamp') {
        return m('.mb-2', [
          m('label.block.text-xs.font-medium.text-gray-600.mb-1', colLabel),
          m('.flex.items-center.gap-1', [
            m('select.px-1.py-0.5.border.border-gray-300.rounded.text-xs', {
              value: currentFilter.op || 'eq',
              onchange: (e) => {
                const op = e.target.value;
                const existing = currentFilter.value || {};
                onFilterChange(col.name, { ...existing, op });
              },
            }, [
              m('option', { value: 'eq' }, '='),
              m('option', { value: 'gt' }, '>'),
              m('option', { value: 'gte' }, '≥'),
              m('option', { value: 'lt' }, '<'),
              m('option', { value: 'lte' }, '≤'),
              m('option', { value: 'between' }, '↔'),
            ]),
            currentFilter.op === 'between' ? [
              m('input.px-1.py-0.5.border.border-gray-300.rounded.text-xs.w-24', {
                type: col.type === 'date' ? 'date' : 'datetime-local',
                value: currentFilter.from || '',
                oninput: (e) => {
                  onFilterChange(col.name, { 
                    op: 'between', 
                    from: e.target.value, 
                    to: currentFilter.to || '' 
                  });
                },
              }),
              m('span.text-xs.text-gray-400', '-'),
              m('input.px-1.py-0.5.border.border-gray-300.rounded.text-xs.w-24', {
                type: col.type === 'date' ? 'date' : 'datetime-local',
                value: currentFilter.to || '',
                oninput: (e) => {
                  onFilterChange(col.name, { 
                    op: 'between', 
                    from: currentFilter.from || '', 
                    to: e.target.value 
                  });
                },
              }),
            ] : m('input.px-1.py-0.5.border.border-gray-300.rounded.text-xs.flex-1', {
              type: col.type === 'date' ? 'date' : 'datetime-local',
              value: currentFilter.value || '',
              oninput: (e) => {
                onFilterChange(col.name, { 
                  op: currentFilter.op || 'eq', 
                  value: e.target.value 
                });
              },
            }),
          ]),
        ]);
      } else if (col.type === 'integer' || col.type === 'bigint' || col.type === 'float' || col.type === 'decimal') {
        return m('.mb-2', [
          m('label.block.text-xs.font-medium.text-gray-600.mb-1', colLabel),
          m('.flex.items-center.gap-1', [
            m('select.px-1.py-0.5.border.border-gray-300.rounded.text-xs', {
              value: currentFilter.op || 'eq',
              onchange: (e) => {
                const op = e.target.value;
                const existing = currentFilter.value || {};
                onFilterChange(col.name, { ...existing, op });
              },
            }, [
              m('option', { value: 'eq' }, '='),
              m('option', { value: 'gt' }, '>'),
              m('option', { value: 'gte' }, '≥'),
              m('option', { value: 'lt' }, '<'),
              m('option', { value: 'lte' }, '≤'),
              m('option', { value: 'between' }, '↔'),
            ]),
            currentFilter.op === 'between' ? [
              m('input.px-1.py-0.5.border.border-gray-300.rounded.text-xs.w-16', {
                type: 'number',
                value: currentFilter.from || '',
                placeholder: 'Min',
                oninput: (e) => {
                  onFilterChange(col.name, { 
                    op: 'between', 
                    from: e.target.value, 
                    to: currentFilter.to || '' 
                  });
                },
              }),
              m('span.text-xs.text-gray-400', '-'),
              m('input.px-1.py-0.5.border.border-gray-300.rounded.text-xs.w-16', {
                type: 'number',
                value: currentFilter.to || '',
                placeholder: 'Max',
                oninput: (e) => {
                  onFilterChange(col.name, { 
                    op: 'between', 
                    from: currentFilter.from || '', 
                    to: e.target.value 
                  });
                },
              }),
            ] : m('input.px-1.py-0.5.border.border-gray-300.rounded.text-xs.flex-1', {
              type: 'number',
              value: currentFilter.value || '',
              placeholder: 'Value',
              oninput: (e) => {
                onFilterChange(col.name, { 
                  op: currentFilter.op || 'eq', 
                  value: e.target.value 
                });
              },
            }),
          ]),
        ]);
      } else if (col.type === 'enum') {
        return m('.mb-2', [
          m('label.block.text-xs.font-medium.text-gray-600.mb-1', colLabel),
          m('select.px-1.py-0.5.border.border-gray-300.rounded.text-xs.w-full', {
            multiple: true,
            style: 'min-height: 50px;',
            value: Array.isArray(currentFilter.value) ? currentFilter.value : (currentFilter.value ? [currentFilter.value] : []),
            onchange: (e) => {
              const selected = Array.from(e.target.selectedOptions, opt => opt.value);
              onFilterChange(col.name, selected.length > 0 ? { op: 'in', value: selected } : null);
            },
          }, [
            ...(col.enumValues || []).map(val => 
              m('option', { value: val }, val)
            ),
          ]),
        ]);
      } else {
        // String/text fields
        return m('.mb-2', [
          m('label.block.text-xs.font-medium.text-gray-600.mb-1', colLabel),
          m('.flex.items-center.gap-1', [
            m('select.px-1.py-0.5.border.border-gray-300.rounded.text-xs', {
              value: currentFilter.op || 'contains',
              onchange: (e) => {
                const op = e.target.value;
                const existing = currentFilter.value || {};
                onFilterChange(col.name, { ...existing, op });
              },
            }, [
              m('option', { value: 'contains' }, '~'),
              m('option', { value: 'equals' }, '='),
              m('option', { value: 'starts_with' }, 'A*'),
              m('option', { value: 'ends_with' }, '*Z'),
            ]),
            m('input.px-1.py-0.5.border.border-gray-300.rounded.text-xs.flex-1', {
              type: 'text',
              value: currentFilter.value || '',
              placeholder: 'Enter search term',
              oninput: (e) => {
                onFilterChange(col.name, { 
                  op: currentFilter.op || 'contains', 
                  value: e.target.value 
                });
              },
            }),
          ]),
        ]);
      }
    });
    
    return m('.bg-white.border.border-gray-200.rounded-lg.shadow-sm.p-3.mb-3', [
      m('.flex.items-center.justify-between.mb-2.pb-2.border-b.border-gray-100', [
        m('span.text-sm.font-medium.text-gray-700', 'Filters'),
        m('button.text-xs.text-gray-400.hover:text-gray-600', {
          onclick: () => vnode.attrs.onToggle(false),
        }, '✕'),
      ]),
      m('.grid.grid-cols-2.md:grid-cols-3.lg:grid-cols-4.xl:grid-cols-5.gap-3', filterInputs),
      m('.flex.items-center.justify-end.gap-2.mt-3.pt-2.border-t.border-gray-100', [
        m('button.px-3.py-1.text-xs.bg-gray-100.text-gray-600.rounded.hover:bg-gray-200', {
          onclick: onClear,
        }, 'Clear'),
        m('button.px-3.py-1.text-xs.bg-blue-600.text-white.rounded.hover:bg-blue-700', {
          onclick: onApply,
        }, 'Apply'),
      ]),
    ]);
  },
};

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
  view: () => m('.max-w-md.mx-auto.mt-16', [
    m('h1.text-3xl.font-bold.mb-6', 'Admin Login'),
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
      state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'email' }, 'Email'),
        m('input#email.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'email',
          name: 'email',
          required: true,
        }),
      ]),
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'password' }, 'Password'),
        m('input#password.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'password',
          name: 'password',
          required: true,
        }),
      ]),
      m('button.w-full.bg-blue-600.text-white.py-2.px-4.rounded.hover:bg-blue-700', {
        type: 'submit',
        disabled: state.loading,
      }, state.loading ? 'Logging in...' : 'Login'),
    ]),
  ]),
};

// Setup Form Component
const SetupForm = {
  view: () => m('.max-w-md.mx-auto.mt-16', [
    m('h1.text-3xl.font-bold.mb-6', 'Setup Admin Account'),
    m('p.text-gray-600.mb-6', 'Create the first admin user account.'),
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
      state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'name' }, 'Name'),
        m('input#name.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'text',
          name: 'name',
          required: true,
        }),
      ]),
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'email' }, 'Email'),
        m('input#email.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'email',
          name: 'email',
          required: true,
        }),
      ]),
      m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: 'password' }, 'Password'),
        m('input#password.w-full.px-3.py-2.border.border-gray-300.rounded', {
          type: 'password',
          name: 'password',
          required: true,
        }),
      ]),
      m('button.w-full.bg-blue-600.text-white.py-2.px-4.rounded.hover:bg-blue-700', {
        type: 'submit',
        disabled: state.loading,
      }, state.loading ? 'Creating...' : 'Create Admin Account'),
    ]),
  ]),
};

// Layout Component
const Layout = {
  view: (vnode) => {
    const breadcrumbs = vnode.attrs.breadcrumbs || [];
    
    return m('.min-h-screen.bg-gray-100.flex.flex-col', [
      // Sticky header
      m('.bg-white.shadow.sticky.top-0.z-50', [
        m('.max-w-7xl.mx-auto.px-4.py-4', [
          m('.flex.items-center.justify-between', [
            m('a.text-xl.font-bold.hover:text-blue-600', {
              href: '/',
              onclick: (e) => {
                e.preventDefault();
                m.route.set('/');
              }
            }, 'Admin Panel'),
            state.user ? m('.flex.items-center.gap-4', [
              m('span.text-sm.text-gray-600', state.user.name || state.user.email),
              m('button.text-sm.text-red-600.hover:text-red-800', {
                onclick: async () => {
                  await api.post('/auth/logout');
                  state.user = null;
                  m.route.set('/login');
                }
              }, 'Logout'),
            ]) : null,
          ]),
        ]),
      ]),
      // Content area
      m('.max-w-7xl.mx-auto.px-4.py-6.flex-1.w-full', [
        // Breadcrumb
        breadcrumbs.length > 0 ? m(Breadcrumb, { items: breadcrumbs }) : null,
        // Page content
        vnode.children,
      ]),
    ]);
  },
};

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

// Record List Component - displays records with dynamic columns
const RecordList = {
  oninit: () => {
    const modelName = m.route.param('model');
    state.records = [];
    state.currentModelMeta = null;
    state.pagination = { page: 1, perPage: 20, total: 0, totalPages: 0 };
    state.filterPanelOpen = false;
    
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
        return loadRecords(modelName, page, state.filters);
      })
      .catch(err => {
        state.error = err.message;
        state.loading = false;
        m.redraw();
      });
  },
  view: () => {
    const modelName = m.route.param('model');
    const modelMeta = state.currentModelMeta;
    const displayColumns = modelMeta ? getDisplayColumns(modelMeta.columns) : [];
    const primaryKey = modelMeta?.primaryKey || 'id';
    
    const breadcrumbs = [
      { label: modelMeta?.label || modelName, href: '/models/' + modelName },
    ];
    
    return m(Layout, { breadcrumbs }, [
      m('.flex.items-center.justify-between.mb-6', [
        m('h2.text-2xl.font-bold', modelMeta?.label || modelName),
        m('.flex.items-center.gap-2', [
          m('button.bg-gray-200.text-gray-800.px-4.py-2.rounded.hover:bg-gray-300', {
            onclick: () => {
              state.filterPanelOpen = !state.filterPanelOpen;
              m.redraw();
            }
          }, [
            m('span.mr-2', '🔍'),
            'Filter',
          ]),
          m('button.bg-blue-600.text-white.px-4.py-2.rounded.hover:bg-blue-700', {
            onclick: () => {
              state.currentRecord = null;
              state.editing = true;
              m.route.set('/models/' + modelName + '/new');
            }
          }, 'New Record'),
        ]),
      ]),
      
      // Filter badges
      m(FilterBadges, {
        filters: state.filters,
        modelMeta: modelMeta,
        onRemove: (colName) => {
          const newFilters = { ...state.filters };
          delete newFilters[colName];
          state.filters = newFilters;
          loadRecords(modelName, 1, newFilters);
        },
      }),
      
      // Filter panel
      m(FilterPanel, {
        isOpen: state.filterPanelOpen,
        modelMeta: modelMeta,
        filters: state.filters,
        onToggle: (open) => {
          state.filterPanelOpen = open;
          m.redraw();
        },
        onFilterChange: (colName, filter) => {
          const newFilters = { ...state.filters };
          if (filter === null) {
            delete newFilters[colName];
          } else {
            newFilters[colName] = filter;
          }
          state.filters = newFilters;
          m.redraw();
        },
        onApply: () => {
          state.filterPanelOpen = false;
          loadRecords(modelName, 1, state.filters);
        },
        onClear: () => {
          state.filters = {};
          state.filterPanelOpen = false;
          loadRecords(modelName, 1, {});
        },
      }),
      
      state.error ? m('.bg-red-100.border.border-red-400.text-red-700.px-4.py-3.rounded.mb-4', state.error) : null,
      state.loading
        ? m('p.text-gray-600', 'Loading records...')
        : state.records.length === 0
          ? m('p.text-gray-600', 'No records found.')
          : m('.bg-white.rounded.shadow', [
            // Table container with sticky header and actions
            m('.overflow-x-auto.max-h-[calc(100vh-300px)]', { style: 'position: relative;' }, [
              m('table.w-full.border-collapse', { style: 'min-width: 100%;' }, [
                // Sticky header
                m('thead.bg-gray-50', { style: 'position: sticky; top: 0; z-index: 10;' }, [
                  m('tr', [
                    // Dynamic column headers
                    ...displayColumns.map(col => 
                      m('th.px-4.py-3.text-left.text-xs.font-medium.text-gray-500.uppercase.tracking-wider.whitespace-nowrap.bg-gray-50.border-b', 
                        col.name.replace(/_/g, ' ')
                      )
                    ),
                    // Sticky actions header
                    m('th.px-4.py-3.text-right.text-xs.font-medium.text-gray-500.uppercase.tracking-wider.bg-gray-50.border-b', {
                      style: 'position: sticky; right: 0; min-width: 120px;',
                    }, 'Actions'),
                  ]),
                ]),
                m('tbody.divide-y.divide-gray-200', state.records.map(record => 
                  m('tr.hover:bg-gray-50', [
                    // Dynamic cell values
                    ...displayColumns.map(col => 
                      m('td.px-4.py-3.text-sm.whitespace-nowrap', 
                        formatCellValue(record[col.name], col)
                      )
                    ),
                    // Sticky actions cell
                    m('td.px-4.py-3.text-sm.text-right.whitespace-nowrap.bg-white', {
                      style: 'position: sticky; right: 0; box-shadow: -4px 0 8px -4px rgba(0,0,0,0.1);',
                    }, [
                      m('button.text-blue-600.hover:text-blue-800.mr-3', {
                        onclick: () => {
                          state.currentRecord = record;
                          state.editing = true;
                          m.route.set('/models/' + modelName + '/edit/' + record[primaryKey]);
                        }
                      }, 'Edit'),
                      m('button.text-red-600.hover:text-red-800', {
                        onclick: async () => {
                          if (confirm('Are you sure you want to delete this record?')) {
                            try {
                              await api.delete('/models/' + modelName + '/records/' + record[primaryKey]);
                              // Refresh the list
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
