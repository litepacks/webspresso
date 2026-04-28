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
      m('span.text-xs.font-medium.text-gray-500 dark:text-slate-400.uppercase.tracking-wide', 'Active filters:'),
      ...filterEntries.map(([colName, filter]) => {
        const col = modelMeta?.columns?.find(c => c.name === colName);
        return m(FilterBadge, { colName, filter, colMeta: col, onRemove });
      }),
      filterEntries.length > 1 ? m('button.text-xs.text-gray-500 dark:text-slate-400.hover:text-gray-700 dark:hover:text-slate-200 dark:hover:text-slate-200.underline.ml-2', {
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
      m('input.block.w-full.pl-9.pr-8.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.bg-white dark:bg-slate-800.placeholder-gray-400 dark:placeholder-slate-500.focus:outline-none.focus:ring-2.focus:ring-indigo-500.focus:border-transparent', {
        type: 'text',
        placeholder: placeholder || 'Quick search...',
        value: value || '',
        oninput: (e) => onChange(e.target.value),
      }),
      value ? m('button.absolute.inset-y-0.right-0.pr-3.flex.items-center.text-gray-400 dark:text-slate-500.hover:text-gray-600 dark:hover:text-slate-300 dark:hover:text-slate-300', {
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
    
    return m('.bg-white dark:bg-slate-800.border.border-gray-200 dark:border-slate-600.rounded-lg.p-3.mb-4.shadow-sm', [
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
                  : 'bg-gray-100 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600 dark:hover:bg-slate-600',
                onclick: () => onFilterChange(col.name, null),
              }, 'All'),
              ...col.enumValues.map(val => 
                m('button.px-2.py-1.text-xs.rounded-md.transition-colors', {
                  class: currentValue === val 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-gray-100 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600 dark:hover:bg-slate-600',
                  onclick: () => onFilterChange(col.name, { op: 'equals', value: val }),
                }, val)
              ),
            ]),
          ]);
        }),
        
        m('.flex-1'),
        
        m('button.inline-flex.items-center.gap-2.px-3.py-2.text-sm.font-medium.text-gray-700 dark:text-slate-300.bg-white dark:bg-slate-800.border.border-gray-300 dark:border-slate-600.rounded-lg.hover:bg-gray-50 dark:hover:bg-slate-800/50 dark:hover:bg-slate-800/50.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
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
              m('input.w-4.h-4.text-indigo-600.border-gray-300 dark:border-slate-600.focus:ring-indigo-500', {
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
                : 'bg-white border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800/50 dark:hover:bg-slate-800/50',
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
          m('select.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.bg-white dark:bg-slate-800.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
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
            m('input.flex-1.min-w-32.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              type: inputType,
                value: currentFilter.from || '',
              oninput: (e) => onChange({ op: 'between', from: e.target.value, to: currentFilter.to || '' }),
            }),
            m('span.text-gray-400 dark:text-slate-500.self-center', 'to'),
            m('input.flex-1.min-w-32.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              type: inputType,
                value: currentFilter.to || '',
              oninput: (e) => onChange({ op: 'between', from: currentFilter.from || '', to: e.target.value }),
            }),
          ] : m('input.flex-1.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
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
          m('select.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.bg-white dark:bg-slate-800.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
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
            m('input.w-24.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
                type: 'number',
                value: currentFilter.from || '',
                placeholder: 'Min',
              oninput: (e) => onChange({ op: 'between', from: e.target.value, to: currentFilter.to || '' }),
            }),
            m('span.text-gray-400 dark:text-slate-500.self-center', 'to'),
            m('input.w-24.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
                type: 'number',
                value: currentFilter.to || '',
                placeholder: 'Max',
              oninput: (e) => onChange({ op: 'between', from: currentFilter.from || '', to: e.target.value }),
            }),
          ] : m('input.flex-1.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
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
        m('select.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.bg-white dark:bg-slate-800.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
              value: currentFilter.op || 'contains',
          onchange: (e) => onChange({ op: e.target.value, value: currentFilter.value || '' }),
        }, ops.map(o => m('option', { value: o.value }, o.label))),
        m('input.flex-1.px-3.py-2.text-sm.border.border-gray-300 dark:border-slate-600.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-indigo-500', {
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
      if (col.type === 'file') return false;
      return true;
    });
    
    const textColumns = filterableColumns.filter(c => c.type === 'string' || c.type === 'text');
    const numericColumns = filterableColumns.filter(c => ['integer', 'bigint', 'float', 'decimal'].includes(c.type));
    const dateColumns = filterableColumns.filter(c => ['date', 'datetime', 'timestamp'].includes(c.type));
    const boolEnumColumns = filterableColumns.filter(c => c.type === 'boolean' || c.type === 'enum');
    
    const renderGroup = (title, columns) => {
      if (columns.length === 0) return null;
      return m('.mb-6', [
        m('h4.text-xs.font-semibold.text-gray-400 dark:text-slate-500.uppercase.tracking-wider.mb-3', title),
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
      m('.fixed.inset-y-0.right-0.w-full.max-w-md.bg-white dark:bg-slate-800.shadow-xl.z-50.flex.flex-col', {
        style: 'animation: filterDrawerSlideIn 0.2s ease-out;',
      }, [
        m('.flex.items-center.justify-between.px-6.py-4.border-b.border-gray-200', [
          m('div', [
            m('h3.text-lg.font-semibold.text-gray-900', 'Advanced Filters'),
            m('p.text-sm.text-gray-500', 'Filter records by multiple criteria'),
          ]),
          m('button.p-2.text-gray-400 dark:text-slate-500.hover:text-gray-600 dark:hover:text-slate-300 dark:hover:text-slate-300.rounded-lg.hover:bg-gray-100 dark:hover:bg-slate-700 dark:hover:bg-slate-700', {
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
        m('.flex.items-center.justify-between.gap-3.px-6.py-4.border-t.border-gray-200 dark:border-slate-600.bg-gray-50', [
          m('button.px-4.py-2.text-sm.font-medium.text-gray-700 dark:text-slate-300.hover:text-gray-900 dark:hover:text-slate-100 dark:hover:text-slate-100', {
          onclick: onClear,
            type: 'button',
          }, 'Clear all'),
          m('.flex.gap-3', [
            m('button.px-4.py-2.text-sm.font-medium.text-gray-700 dark:text-slate-300.bg-white dark:bg-slate-800.border.border-gray-300 dark:border-slate-600.rounded-lg.hover:bg-gray-50 dark:hover:bg-slate-800/50 dark:hover:bg-slate-800/50', {
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
