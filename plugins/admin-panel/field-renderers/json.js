/**
 * JSON Field Renderer
 * Component for editing JSON fields
 */

module.exports = {
  JsonField: {
    view: (vnode) => {
      const { name, value = {}, meta = {}, required = false } = vnode.attrs;
      let jsonString = '';
      let parseError = null;
      
      try {
        jsonString = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      } catch (e) {
        jsonString = String(value);
        parseError = 'Invalid JSON';
      }
      
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2',
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('textarea.w-full.px-3.py-2.border.border-gray-300 dark:border-slate-600.rounded.font-mono.text-sm', {
          rows: 10,
          value: jsonString,
          oninput: (e) => {
            const newValue = e.target.value;
            try {
              const parsed = JSON.parse(newValue);
              parseError = null;
              if (vnode.attrs.onchange) {
                vnode.attrs.onchange(parsed);
              }
            } catch (err) {
              parseError = 'Invalid JSON';
              if (vnode.attrs.onchange) {
                vnode.attrs.onchange(newValue);
              }
            }
          }
        }),
        parseError ? m('.text-red-600.text-sm.mt-1', parseError) : null,
        m('input[type=hidden]', {
          name,
          value: typeof value === 'string' ? value : JSON.stringify(value),
        }),
      ]);
    }
  },
};
