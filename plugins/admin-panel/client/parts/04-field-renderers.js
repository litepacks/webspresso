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
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2.focus:ring-blue-500.dark:focus:ring-blue-400', {
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
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value),
      }),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
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
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: col.name }, label),
      m('textarea.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2.focus:ring-blue-500.dark:focus:ring-blue-400', {
        id: col.name,
        name: col.name,
        rows: rows,
        placeholder: placeholder,
        minlength: validations.minLength || validations.min,
        maxlength: validations.maxLength || validations.max,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value),
      }, value || ''),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
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
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2.focus:ring-blue-500.dark:focus:ring-blue-400', {
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
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10)),
      }),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
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
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2.focus:ring-blue-500.dark:focus:ring-blue-400', {
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
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value)),
      }),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
    ]);
  },

  // Boolean checkbox
  boolean: (col, value, onChange, readonly) => {
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
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
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
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2.focus:ring-blue-500.dark:focus:ring-blue-400', {
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
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value),
      }),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
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
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2.focus:ring-blue-500.dark:focus:ring-blue-400', {
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
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed' : '',
        oninput: (e) => onChange(e.target.value),
      }),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
    ]);
  },

  // Enum select
  enum: (col, value, onChange, readonly) => {
    const ui = col.ui || {};
    const label = ui.label || formatColumnLabel(col.name);
    const hint = ui.hint || '';
    const options = col.enumValues || [];
    
    return m('.mb-4', [
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: col.name }, label),
      m('select.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.focus:outline-none.focus:ring-2.focus:ring-blue-500.dark:focus:ring-blue-400', {
        id: col.name,
        name: col.name,
        value: value || '',
        required: !col.nullable && !readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed' : '',
        onchange: (e) => onChange(e.target.value),
      }, [
        col.nullable ? m('option', { value: '' }, '-- Select --') : null,
        ...options.map(opt => m('option', { value: opt, selected: value === opt }, opt)),
      ]),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
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
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: col.name }, label),
      m('textarea.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.font-mono.text-sm.focus:outline-none.focus:ring-2.focus:ring-blue-500.dark:focus:ring-blue-400', {
        id: col.name,
        name: col.name,
        rows: rows,
        placeholder: placeholder,
        required: !col.nullable && !readonly,
        readonly: readonly,
        disabled: readonly,
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed' : '',
        oninput: (e) => {
          try {
            const parsed = JSON.parse(e.target.value);
            onChange(parsed);
          } catch {
            onChange(e.target.value);
          }
        },
      }, jsonString),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
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
      m('label.block.text-sm.font-medium.text-gray-700 dark:text-slate-300.mb-1', { for: col.name }, label),
      m('input.w-full.px-3.py-2.border.border-gray-300.dark:border-slate-600.rounded-md.bg-white.dark:bg-slate-900/70.text-gray-900.dark:text-slate-100.placeholder-gray-400.dark:placeholder-slate-500.focus:outline-none.focus:ring-2.focus:ring-blue-500.dark:focus:ring-blue-400', {
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
        class: readonly ? 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed' : '',
        oninput: (e) => {
          const arr = e.target.value.split(',').map(s => s.trim()).filter(s => s);
          onChange(arr);
        },
      }),
      hint ? m('p.text-xs.text-gray-500 dark:text-slate-400.mt-1', hint) : null,
    ]);
  },
};
