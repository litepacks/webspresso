/**
 * Array Field Renderer
 * Component for editing array fields
 */

module.exports = {
  ArrayField: {
    view: (vnode) => {
      const { name, value = [], meta = {}, required = false } = vnode.attrs;
      const items = Array.isArray(value) ? value : [];
      
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2',
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('.border.border-gray-300 dark:border-slate-600.rounded.p-4', [
          items.map((item, index) =>
            m('.flex.items-center.gap-2.mb-2', [
              m('input.flex-1.px-3.py-2.border.border-gray-300 dark:border-slate-600.rounded', {
                type: 'text',
                value: String(item),
                oninput: (e) => {
                  const newItems = [...items];
                  newItems[index] = e.target.value;
                  if (vnode.attrs.onchange) {
                    vnode.attrs.onchange(newItems);
                  }
                }
              }),
              m('button.text-red-600.hover:text-red-800', {
                onclick: () => {
                  const newItems = items.filter((_, i) => i !== index);
                  if (vnode.attrs.onchange) {
                    vnode.attrs.onchange(newItems);
                  }
                }
              }, 'Remove'),
            ])
          ),
          m('button.text-blue-600.hover:text-blue-800.text-sm', {
            onclick: () => {
              const newItems = [...items, ''];
              if (vnode.attrs.onchange) {
                vnode.attrs.onchange(newItems);
              }
            }
          }, '+ Add Item'),
        ]),
        m('input[type=hidden]', {
          name,
          value: JSON.stringify(items),
        }),
      ]);
    }
  },
};
