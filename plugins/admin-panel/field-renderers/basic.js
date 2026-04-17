/**
 * Basic Field Renderers
 * Standard input components for basic field types
 */

module.exports = {
  /**
   * Text input field
   */
  TextField: {
    view: (vnode) => {
      const { name, value = '', meta = {}, required = false } = vnode.attrs;
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: name }, 
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('input.w-full.px-3.py-2.border.border-gray-300 dark:border-slate-600.rounded', {
          id: name,
          name,
          type: 'text',
          value: String(value || ''),
          maxLength: meta.maxLength,
          required,
          oninput: (e) => {
            if (vnode.attrs.onchange) {
              vnode.attrs.onchange(e.target.value);
            }
          }
        }),
      ]);
    }
  },

  /**
   * Textarea field
   */
  TextAreaField: {
    view: (vnode) => {
      const { name, value = '', meta = {}, required = false } = vnode.attrs;
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: name },
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('textarea.w-full.px-3.py-2.border.border-gray-300 dark:border-slate-600.rounded', {
          id: name,
          name,
          rows: meta.rows || 5,
          required,
          oninput: (e) => {
            if (vnode.attrs.onchange) {
              vnode.attrs.onchange(e.target.value);
            }
          }
        }, value || ''),
      ]);
    }
  },

  /**
   * Number input field
   */
  NumberField: {
    view: (vnode) => {
      const { name, value = '', meta = {}, required = false } = vnode.attrs;
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: name },
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('input.w-full.px-3.py-2.border.border-gray-300 dark:border-slate-600.rounded', {
          id: name,
          name,
          type: 'number',
          value: value !== null && value !== undefined ? String(value) : '',
          step: meta.type === 'float' || meta.type === 'decimal' ? '0.01' : '1',
          required,
          oninput: (e) => {
            const numValue = e.target.value === '' ? null : Number(e.target.value);
            if (vnode.attrs.onchange) {
              vnode.attrs.onchange(numValue);
            }
          }
        }),
      ]);
    }
  },

  /**
   * Boolean checkbox field
   */
  BooleanField: {
    view: (vnode) => {
      const { name, value = false, meta = {}, required = false } = vnode.attrs;
      return m('.mb-4', [
        m('label.flex.items-center', [
          m('input.mr-2', {
            type: 'checkbox',
            name,
            checked: Boolean(value),
            required,
            onchange: (e) => {
              if (vnode.attrs.onchange) {
                vnode.attrs.onchange(e.target.checked);
              }
            }
          }),
          m('span.text-sm.font-medium',
            meta.label || name,
            required ? m('span.text-red-500', ' *') : null
          ),
        ]),
      ]);
    }
  },

  /**
   * Date input field
   */
  DateField: {
    view: (vnode) => {
      const { name, value = '', meta = {}, required = false } = vnode.attrs;
      const dateValue = value ? new Date(value).toISOString().split('T')[0] : '';
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: name },
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('input.w-full.px-3.py-2.border.border-gray-300 dark:border-slate-600.rounded', {
          id: name,
          name,
          type: 'date',
          value: dateValue,
          required,
          oninput: (e) => {
            if (vnode.attrs.onchange) {
              vnode.attrs.onchange(e.target.value);
            }
          }
        }),
      ]);
    }
  },

  /**
   * DateTime input field
   */
  DateTimeField: {
    view: (vnode) => {
      const { name, value = '', meta = {}, required = false } = vnode.attrs;
      const dateTimeValue = value ? new Date(value).toISOString().slice(0, 16) : '';
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: name },
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('input.w-full.px-3.py-2.border.border-gray-300 dark:border-slate-600.rounded', {
          id: name,
          name,
          type: 'datetime-local',
          value: dateTimeValue,
          required,
          oninput: (e) => {
            if (vnode.attrs.onchange) {
              vnode.attrs.onchange(e.target.value);
            }
          }
        }),
      ]);
    }
  },

  /**
   * Select dropdown field (for enum)
   */
  SelectField: {
    view: (vnode) => {
      const { name, value = '', meta = {}, required = false } = vnode.attrs;
      const options = meta.enumValues || [];
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2', { for: name },
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('select.w-full.px-3.py-2.border.border-gray-300 dark:border-slate-600.rounded', {
          id: name,
          name,
          value: String(value || ''),
          required,
          onchange: (e) => {
            if (vnode.attrs.onchange) {
              vnode.attrs.onchange(e.target.value);
            }
          }
        }, [
          !required ? m('option', { value: '' }, '-- Select --') : null,
          ...options.map(opt => 
            m('option', { value: String(opt), selected: String(value) === String(opt) }, String(opt))
          ),
        ]),
      ]);
    }
  },
};
