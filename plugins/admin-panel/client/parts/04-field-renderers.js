// Field Renderers - render appropriate input based on column type

// BelongsTo relation searchable combobox dropdown component
const BelongsToField = {
  oninit: (vnode) => {
    vnode.state.loading = true;
    vnode.state.loadingMore = false;
    vnode.state.options = [];
    vnode.state.isOpen = false;
    vnode.state.search = '';
    vnode.state.page = 1;
    vnode.state.hasMore = false;
    vnode.state.total = 0;
    vnode.state.displayField = null;
    vnode.state.primaryKey = 'id';
    vnode.state._searchTimer = null;

    vnode.state.fetchOptions = (vn, opts = {}) => {
      const page = opts.page || 1;
      const append = opts.append === true;
      const search = opts.search !== undefined ? opts.search : (vn.state.search || '');
      const { col, value } = vn.attrs;
      const customField = col.customField || {};
      const relationName = customField.relation || col.name.replace(/_id$/, '');
      const modelName = m.route.param('model');

      let url = '/models/' + modelName + '/relations/' + relationName + '?page=' + page + '&limit=50';
      if (search) url += '&search=' + encodeURIComponent(search);
      if (value !== null && value !== undefined && value !== '') {
        url += '&selected=' + encodeURIComponent(value);
      }

      if (append) {
        vn.state.loadingMore = true;
      } else {
        vn.state.loading = true;
      }
      m.redraw();

      return api.get(url)
        .then(result => {
          const incoming = result.data || [];
          const pk = result.primaryKey || vn.state.primaryKey || 'id';
          if (append) {
            const existingIds = new Set(vn.state.options.map(o => String(o[pk])));
            const newItems = incoming.filter(o => !existingIds.has(String(o[pk])));
            vn.state.options = vn.state.options.concat(newItems);
          } else {
            vn.state.options = incoming;
          }
          if (result.displayField) vn.state.displayField = result.displayField;
          if (result.primaryKey) vn.state.primaryKey = result.primaryKey;
          if (result.pagination) {
            vn.state.page = result.pagination.page;
            vn.state.hasMore = result.pagination.hasMore;
            vn.state.total = result.pagination.total;
          } else {
            vn.state.hasMore = false;
          }
        })
        .catch(err => {
          console.error('Failed to load relation data:', err);
        })
        .finally(() => {
          vn.state.loading = false;
          vn.state.loadingMore = false;
          m.redraw();
        });
    };

    vnode.state.fetchOptions(vnode);
  },
  onremove: (vnode) => {
    if (vnode.state._searchTimer) {
      clearTimeout(vnode.state._searchTimer);
      vnode.state._searchTimer = null;
    }
  },
  view: (vnode) => {
    const { col, value, onChange, readonly, error } = vnode.attrs;
    const customField = col.customField || {};
    const label = col.ui?.label || formatColumnLabel(col.name);
    const hint = col.ui?.hint || '';
    const valueKey = customField.valueKey || vnode.state.primaryKey || 'id';
    const displayKey = customField.displayKey || vnode.state.displayField ||
      (vnode.state.options.length > 0 ? ['name', 'title', 'label', 'username', 'email'].find(k => k in vnode.state.options[0]) : null) || 
      'id';

    const selectedItem = (value !== null && value !== undefined && value !== '')
      ? vnode.state.options.find(item => String(item[valueKey]) === String(value))
      : null;
    const selectedDisplay = selectedItem
      ? (selectedItem[displayKey] || String(selectedItem[valueKey]))
      : (value !== null && value !== undefined && value !== '' ? String(value) : '-- Select --');
    const hasSelection = value !== null && value !== undefined && value !== '';

    const selectItem = (item) => {
      const selectedValue = item ? item[valueKey] : null;
      const typedValue = (col.type === 'integer' || col.type === 'bigint' || col.type === 'float' || col.type === 'decimal') && selectedValue !== null
        ? Number(selectedValue)
        : selectedValue;
      onChange(typedValue);
      vnode.state.isOpen = false;
      vnode.state.search = '';
    };

    const clearSelection = (e) => {
      e.stopPropagation();
      onChange(null);
      vnode.state.search = '';
    };

    const borderClass = error
      ? 'border-red-500 dark:border-red-500 focus:ring-red-500'
      : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';

    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('.relative', [
        // Backdrop to close popover when clicked outside
        vnode.state.isOpen ? m('.fixed.inset-0.z-30', {
          onclick: () => { vnode.state.isOpen = false; },
        }) : null,

        // Trigger Button / Combobox Display
        m('button.w-full.flex.items-center.justify-between.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-left.text-sm.transition-colors.relative.z-30', {
          id: col.name,
          type: 'button',
          disabled: readonly,
          class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed text-gray-500 ' : 'hover:border-gray-400 dark:hover:border-slate-500 ') + borderClass,
          onclick: () => {
            if (!readonly) {
              vnode.state.isOpen = !vnode.state.isOpen;
            }
          },
        }, [
          m('span.truncate', {
            class: hasSelection ? 'text-gray-900 dark:text-slate-100 font-medium' : 'text-gray-400 dark:text-slate-500',
          }, selectedDisplay),
          m('.flex.items-center.gap-1.ml-2', [
            hasSelection && !readonly ? m('span.text-gray-400.hover:text-red-500.cursor-pointer.px-1', {
              title: 'Clear',
              onclick: clearSelection,
            }, '✕') : null,
            m('svg.w-4.h-4.text-gray-400.transition-transform', {
              class: vnode.state.isOpen ? 'rotate-180' : '',
              fill: 'none',
              stroke: 'currentColor',
              viewBox: '0 0 24 24',
            }, m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })),
          ]),
        ]),

        // Dropdown Popover
        vnode.state.isOpen ? m('.absolute.left-0.right-0.top-full.mt-1.bg-white.dark:bg-slate-900.border.border-gray-200.dark:border-slate-700.rounded-md.shadow-lg.z-40.overflow-hidden', [
          // Search input bar
          m('.p-2.border-b.border-gray-100.dark:border-slate-800.bg-gray-50/50.dark:bg-slate-900/50', [
            m('input.w-full.px-2.5.py-1.5.text-xs.border.border-gray-300.dark:border-slate-700.rounded.bg-white.dark:bg-slate-800.text-gray-900.dark:text-slate-100.focus:outline-none.focus:ring-1.focus:ring-blue-500', {
              type: 'text',
              placeholder: 'Search ' + label.toLowerCase() + '...',
              value: vnode.state.search,
              oncreate: (v) => {
                if (v.dom && typeof v.dom.focus === 'function') v.dom.focus();
              },
              oninput: (e) => {
                const term = e.target.value;
                vnode.state.search = term;
                clearTimeout(vnode.state._searchTimer);
                vnode.state._searchTimer = setTimeout(() => {
                  vnode.state.fetchOptions(vnode, { page: 1, append: false, search: term });
                }, 250);
              },
            }),
          ]),

          // Options list
          m('.max-h-60.overflow-y-auto.py-1', [
            vnode.state.loading ? m('.py-4.text-center.text-xs.text-gray-400', 'Loading...') : null,

            // Clear / None option
            col.nullable ? m('.px-3.py-2.text-xs.text-gray-500.hover:bg-gray-100.dark:hover:bg-slate-800.cursor-pointer', {
              onclick: () => selectItem(null),
            }, '-- None --') : null,

            // Item options
            !vnode.state.loading && vnode.state.options.length === 0 ? m('.py-4.text-center.text-xs.text-gray-400', 'No results found') : null,

            vnode.state.options.map(item => {
              const itemValue = item[valueKey];
              const itemDisplay = item[displayKey] || String(itemValue);
              const isSelected = String(value) === String(itemValue);
              return m('.px-3.py-2.text-xs.flex.items-center.justify-between.cursor-pointer.transition-colors', {
                class: isSelected
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-medium'
                  : 'text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800',
                onclick: () => selectItem(item),
              }, [
                m('span.truncate', itemDisplay),
                isSelected ? m('span.text-blue-600.dark:text-blue-400.font-bold.ml-2', '✓') : null,
              ]);
            }),
          ]),

          // Pagination Load More
          vnode.state.hasMore ? m('.p-2.border-t.border-gray-100.dark:border-slate-800.text-center.bg-gray-50/50.dark:bg-slate-900/50', [
            m('button.text-xs.text-blue-600.dark:text-blue-400.hover:underline.font-medium.py-1.px-2', {
              type: 'button',
              disabled: vnode.state.loadingMore,
              onclick: () => {
                vnode.state.fetchOptions(vnode, {
                  page: vnode.state.page + 1,
                  append: true,
                  search: vnode.state.search,
                });
              },
            }, vnode.state.loadingMore ? 'Loading more...' : 'Load more (' + (vnode.state.total - vnode.state.options.length) + ' remaining)'),
          ]) : null,
        ]) : null,
      ]),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  }
};

// HasMany relation multi-select checkbox component with filter & select-all
const HasManyField = {
  oninit: (vnode) => {
    const { col } = vnode.attrs;
    const customField = col.customField || {};
    const relationName = customField.relation || col.name.replace(/_ids$/, '').replace(/_id$/, '');
    const modelName = m.route.param('model');
    vnode.state.loading = true;
    vnode.state.options = [];
    vnode.state.filter = '';
    
    api.get('/models/' + modelName + '/relations/' + relationName + '?all=true')
      .then(result => {
        vnode.state.options = result.data || [];
        if (result.displayField) vnode.state.displayField = result.displayField;
        if (result.primaryKey) vnode.state.primaryKey = result.primaryKey;
      })
      .catch(err => {
        console.error('Failed to load relation data:', err);
      })
      .finally(() => {
        vnode.state.loading = false;
        m.redraw();
      });
  },
  view: (vnode) => {
    const { col, value = [], onChange, readonly, error } = vnode.attrs;
    const customField = col.customField || {};
    const label = col.ui?.label || formatColumnLabel(col.name);
    const hint = col.ui?.hint || '';
    const valueKey = customField.valueKey || vnode.state.primaryKey || 'id';
    const displayKey = customField.displayKey || vnode.state.displayField ||
      (vnode.state.options.length > 0 ? ['name', 'title', 'label', 'username', 'email'].find(k => k in vnode.state.options[0]) : null) || 
      'id';
    const selectedIds = Array.isArray(value) ? value.map(v => String(v)) : [];

    const filterTerm = (vnode.state.filter || '').trim().toLowerCase();
    const visibleOptions = vnode.state.options.filter(item => {
      if (!filterTerm) return true;
      const text = String(item[displayKey] || item[valueKey] || '').toLowerCase();
      return text.includes(filterTerm);
    });

    const updateSelection = (newSelected) => {
      const typedSelected = col.type === 'array' || (Array.isArray(value) && typeof value[0] === 'string')
        ? newSelected
        : newSelected.map(Number);
      onChange(typedSelected);
    };

    const selectAll = () => {
      const visibleIds = visibleOptions.map(item => String(item[valueKey]));
      const merged = Array.from(new Set([...selectedIds, ...visibleIds]));
      updateSelection(merged);
    };

    const deselectAll = () => {
      const visibleIds = new Set(visibleOptions.map(item => String(item[valueKey])));
      const filtered = selectedIds.filter(id => !visibleIds.has(id));
      updateSelection(filtered);
    };

    if (vnode.state.loading) {
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', label),
        m('.text-xs.text-gray-500.dark:text-slate-400', 'Loading options...')
      ]);
    }

    const borderClass = error
      ? 'border-red-500 dark:border-red-500'
      : 'border-gray-300 dark:border-slate-600';

    return m('.mb-4', [
      m('.flex.items-center.justify-between.mb-1', [
        m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300', [
          label,
          !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
        ]),
        m('.text-xs.text-gray-500.dark:text-slate-400', selectedIds.length + ' of ' + vnode.state.options.length + ' selected'),
      ]),

      // Search & select all controls
      vnode.state.options.length > 5 ? m('.flex.items-center.gap-2.mb-2', [
        m('input.flex-1.px-2.5.py-1.text-xs.border.border-gray-300.dark:border-slate-700.rounded.bg-white.dark:bg-slate-800.text-gray-900.dark:text-slate-100.focus:outline-none.focus:ring-1.focus:ring-blue-500', {
          type: 'text',
          placeholder: 'Filter ' + label.toLowerCase() + '...',
          value: vnode.state.filter,
          oninput: (e) => { vnode.state.filter = e.target.value; },
        }),
        !readonly ? m('.flex.items-center.gap-1', [
          m('button.px-2.py-1.text-xs.border.border-gray-300.dark:border-slate-700.rounded.hover:bg-gray-100.dark:hover:bg-slate-800.text-gray-700.dark:text-slate-300', {
            type: 'button',
            onclick: selectAll,
          }, 'All'),
          m('button.px-2.py-1.text-xs.border.border-gray-300.dark:border-slate-700.rounded.hover:bg-gray-100.dark:hover:bg-slate-800.text-gray-700.dark:text-slate-300', {
            type: 'button',
            onclick: deselectAll,
          }, 'None'),
        ]) : null,
      ]) : null,

      m('.border.rounded-md.p-3.max-h-48.overflow-y-auto.bg-white.dark:bg-slate-900/70', { class: borderClass }, [
        visibleOptions.length === 0 ? m('.py-2.text-center.text-xs.text-gray-400', 'No matching items') : null,
        visibleOptions.map(item => {
          const itemValue = String(item[valueKey]);
          const itemDisplay = item[displayKey] || itemValue;
          const isSelected = selectedIds.includes(itemValue);
          
          return m('label.flex.items-center.mb-2.cursor-pointer.text-sm.text-gray-700.dark:text-slate-300', [
            m('input.mr-2.rounded.border-gray-300.dark:border-slate-600.text-indigo-600.focus:ring-indigo-500', {
              type: 'checkbox',
              checked: isSelected,
              disabled: readonly,
              onchange: (e) => {
                let newSelected = [...selectedIds];
                if (e.target.checked) {
                  if (!newSelected.includes(itemValue)) {
                    newSelected.push(itemValue);
                  }
                } else {
                  newSelected = newSelected.filter(id => id !== itemValue);
                }
                updateSelection(newSelected);
              }
            }),
            m('span', itemDisplay),
          ]);
        }),
      ]),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  }
};

const FieldRenderers = {
  // Text input (string)
  string: (col, value, onChange, readonly, error) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const inputType = ui.inputType || (validations.email ? 'email' : validations.url ? 'url' : 'text');
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const borderClass = error ? 'border-red-500 dark:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('input.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2', {
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
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        oninput: (e) => onChange(e.target.value),
      }),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // Textarea (text)
  text: (col, value, onChange, readonly, error) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const rows = ui.rows || 4;
    const borderClass = error ? 'border-red-500 dark:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('textarea.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2', {
        id: col.name,
        name: col.name,
        rows: rows,
        placeholder: placeholder,
        minlength: validations.minLength || validations.min,
        maxlength: validations.maxLength || validations.max,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        oninput: (e) => onChange(e.target.value),
      }, value || ''),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // Number input (integer, bigint)
  integer: (col, value, onChange, readonly, error) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const borderClass = error ? 'border-red-500 dark:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('input.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2', {
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
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        oninput: (e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10)),
      }),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // Float/Decimal input
  float: (col, value, onChange, readonly, error) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const borderClass = error ? 'border-red-500 dark:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('input.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2', {
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
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        oninput: (e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value)),
      }),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // Boolean checkbox
  boolean: (col, value, onChange, readonly, error) => {
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const hint = ui.hint || '';
    
    return m('.mb-4', [
      m('label.flex.items-center.cursor-pointer', { class: readonly ? 'cursor-not-allowed' : '' }, [
        m('input.mr-2.w-4.h-4.rounded.border-gray-300.dark:border-slate-600.text-indigo-600.focus:ring-indigo-500', {
          type: 'checkbox',
          name: col.name,
          checked: Boolean(value),
          disabled: readonly,
          onchange: (e) => onChange(e.target.checked),
        }),
        m('span.text-sm.font-medium.text-gray-700.dark:text-slate-300', label),
      ]),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // Date input
  date: (col, value, onChange, readonly, error) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const borderClass = error ? 'border-red-500 dark:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    let dateValue = '';
    if (value) {
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          dateValue = d.toISOString().split('T')[0];
        }
      } catch {}
    }
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('input.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2', {
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
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        oninput: (e) => onChange(e.target.value),
      }),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // DateTime input (datetime, timestamp)
  datetime: (col, value, onChange, readonly, error) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const borderClass = error ? 'border-red-500 dark:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    let dateTimeValue = '';
    if (value) {
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          dateTimeValue = d.toISOString().slice(0, 16);
        }
      } catch {}
    }
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('input.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2', {
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
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        oninput: (e) => onChange(e.target.value),
      }),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // Enum select
  enum: (col, value, onChange, readonly, error) => {
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const hint = ui.hint || '';
    const options = col.enumValues || [];
    const borderClass = error ? 'border-red-500 dark:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('select.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.focus:outline-none.focus:ring-2', {
        id: col.name,
        name: col.name,
        value: value || '',
        required: !col.nullable && !readonly,
        disabled: readonly,
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        onchange: (e) => onChange(e.target.value),
      }, [
        col.nullable ? m('option', { value: '' }, '-- Select --') : null,
        ...options.map(opt => m('option', { value: opt, selected: value === opt }, opt)),
      ]),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // JSON textarea
  json: (col, value, onChange, readonly, error) => {
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || '';
    const hint = ui.hint || '';
    const rows = ui.rows || 6;
    const jsonString = value ? (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) : '';
    const borderClass = error ? 'border-red-500 dark:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('textarea.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.font-mono.text-sm.focus:outline-none.focus:ring-2', {
        id: col.name,
        name: col.name,
        rows: rows,
        placeholder: placeholder,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        oninput: (e) => {
          try {
            const parsed = JSON.parse(e.target.value);
            onChange(parsed);
          } catch {
            onChange(e.target.value);
          }
        },
      }, jsonString),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // Array (as JSON or tags)
  array: (col, value, onChange, readonly, error) => {
    const validations = col.validations || {};
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const placeholder = ui.placeholder || 'Comma-separated values';
    const hint = ui.hint || 'Enter comma-separated values';
    const arrayValue = Array.isArray(value) ? value.join(', ') : (value || '');
    const borderClass = error ? 'border-red-500 dark:border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null,
      ]),
      m('input.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2', {
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
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        oninput: (e) => {
          const arr = e.target.value.split(',').map(s => s.trim()).filter(s => s);
          onChange(arr);
        },
      }),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  },

  // belongsTo relation dropdown
  belongsTo: (col, value, onChange, readonly, error) => {
    return m(BelongsToField, { col, value, onChange, readonly, error });
  },

  // hasMany relation checklist
  hasMany: (col, value, onChange, readonly, error) => {
    return m(HasManyField, { col, value, onChange, readonly, error });
  },
};
