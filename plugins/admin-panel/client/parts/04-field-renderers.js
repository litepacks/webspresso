// Field Renderers - render appropriate input based on column type

// BelongsTo relation dropdown select component
const BelongsToField = {
  oninit: (vnode) => {
    const { col } = vnode.attrs;
    const customField = col.customField || {};
    const relationName = customField.relation || col.name.replace(/_id$/, '');
    const modelName = m.route.param('model');
    vnode.state.loading = true;
    vnode.state.options = [];
    
    api.get('/models/' + modelName + '/relations/' + relationName)
      .then(result => {
        vnode.state.options = result.data || [];
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
    const { col, value, onChange, readonly, error } = vnode.attrs;
    const customField = col.customField || {};
    const label = col.ui?.label || formatColumnLabel(col.name);
    const hint = col.ui?.hint || '';
    const valueKey = customField.valueKey || 'id';
    const displayKey = customField.displayKey || 
      (vnode.state.options.length > 0 ? ['name', 'title', 'label', 'username', 'email'].find(k => k in vnode.state.options[0]) : null) || 
      'id';
    
    if (vnode.state.loading) {
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', label),
        m('.text-xs.text-gray-500.dark:text-slate-400', 'Loading options...')
      ]);
    }

    const borderClass = error
      ? 'border-red-500 dark:border-red-500 focus:ring-red-500'
      : 'border-gray-300 dark:border-slate-600 focus:ring-blue-500 dark:focus:ring-blue-400';
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', { for: col.name }, [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null
      ]),
      m('select.w-full.px-3.py-2.border.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.focus:outline-none.focus:ring-2', {
        id: col.name,
        name: col.name,
        value: value !== null && value !== undefined ? String(value) : '',
        disabled: readonly,
        class: (readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed ' : '') + borderClass,
        onchange: (e) => {
          const selectedValue = e.target.value === '' ? null : e.target.value;
          const typedValue = (col.type === 'integer' || col.type === 'bigint' || col.type === 'float' || col.type === 'decimal') && selectedValue !== null
            ? Number(selectedValue)
            : selectedValue;
          onChange(typedValue);
        },
      }, [
        col.nullable ? m('option', { value: '' }, '-- Select --') : m('option', { value: '' }, '-- Select --'),
        vnode.state.options.map(item => {
          const itemValue = item[valueKey];
          const itemDisplay = item[displayKey] || String(itemValue);
          return m('option', {
            value: String(itemValue),
            selected: value !== null && value !== undefined && String(value) === String(itemValue)
          }, itemDisplay);
        }),
      ]),
      error ? m('p.text-xs.text-red-600.dark:text-red-400.mt-1.font-medium', error) : (hint ? m('p.text-xs.text-gray-500.dark:text-slate-400.mt-1', hint) : null),
    ]);
  }
};

// HasMany relation multi-select checkbox component
const HasManyField = {
  oninit: (vnode) => {
    const { col } = vnode.attrs;
    const customField = col.customField || {};
    const relationName = customField.relation || col.name.replace(/_ids$/, '').replace(/_id$/, '');
    const modelName = m.route.param('model');
    vnode.state.loading = true;
    vnode.state.options = [];
    
    api.get('/models/' + modelName + '/relations/' + relationName)
      .then(result => {
        vnode.state.options = result.data || [];
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
    const valueKey = customField.valueKey || 'id';
    const displayKey = customField.displayKey || 
      (vnode.state.options.length > 0 ? ['name', 'title', 'label', 'username', 'email'].find(k => k in vnode.state.options[0]) : null) || 
      'id';
    const selectedIds = Array.isArray(value) ? value.map(v => String(v)) : [];
    
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
      m('label.block.text-sm.font-medium.text-gray-700.dark:text-slate-300.mb-1', [
        label,
        !col.nullable && !readonly ? m('span.text-red-500', ' *') : null
      ]),
      m('.border.rounded-md.p-3.max-h-48.overflow-y-auto.bg-white.dark:bg-slate-900/70', { class: borderClass }, [
        vnode.state.options.map(item => {
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
                
                // Convert type if needed
                const typedSelected = col.type === 'array' || typeof value[0] === 'string'
                  ? newSelected
                  : newSelected.map(Number);
                onChange(typedSelected);
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
