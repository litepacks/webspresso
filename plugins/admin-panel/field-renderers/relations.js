/**
 * Relation Field Renderers
 * Components for editing relation fields (belongsTo, hasMany)
 */

module.exports = {
  /**
   * BelongsTo relation field (dropdown)
   */
  BelongsToField: {
    view: (vnode) => {
      const { name, value = null, meta = {}, relationData = [], required = false } = vnode.attrs;
      const displayKey = meta.displayKey || 'id';
      const valueKey = meta.valueKey || 'id';
      
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2',
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('select.w-full.px-3.py-2.border.border-gray-300.rounded', {
          name,
          value: value ? String(value) : '',
          required,
          onchange: (e) => {
            const selectedValue = e.target.value === '' ? null : e.target.value;
            if (vnode.attrs.onchange) {
              vnode.attrs.onchange(selectedValue);
            }
          }
        }, [
          !required ? m('option', { value: '' }, '-- None --') : null,
          ...relationData.map(item => {
            const itemValue = item[valueKey];
            const itemDisplay = item[displayKey] || String(itemValue);
            return m('option', {
              value: String(itemValue),
              selected: value && String(value) === String(itemValue)
            }, itemDisplay);
          }),
        ]),
      ]);
    }
  },

  /**
   * HasMany relation field (multi-select)
   */
  HasManyField: {
    view: (vnode) => {
      const { name, value = [], meta = {}, relationData = [], required = false } = vnode.attrs;
      const selectedIds = Array.isArray(value) ? value.map(v => String(v)) : [];
      const displayKey = meta.displayKey || 'id';
      const valueKey = meta.valueKey || 'id';
      
      return m('.mb-4', [
        m('label.block.text-sm.font-medium.mb-2',
          meta.label || name,
          required ? m('span.text-red-500', ' *') : null
        ),
        m('.border.border-gray-300.rounded.p-4.max-h-64.overflow-y-auto', [
          relationData.map(item => {
            const itemValue = String(item[valueKey]);
            const itemDisplay = item[displayKey] || itemValue;
            const isSelected = selectedIds.includes(itemValue);
            
            return m('label.flex.items-center.mb-2', [
              m('input.mr-2', {
                type: 'checkbox',
                checked: isSelected,
                onchange: (e) => {
                  let newSelected = [...selectedIds];
                  if (e.target.checked) {
                    if (!newSelected.includes(itemValue)) {
                      newSelected.push(itemValue);
                    }
                  } else {
                    newSelected = newSelected.filter(id => id !== itemValue);
                  }
                  if (vnode.attrs.onchange) {
                    vnode.attrs.onchange(newSelected);
                  }
                }
              }),
              m('span', itemDisplay),
            ]);
          }),
        ]),
        m('input[type=hidden]', {
          name,
          value: JSON.stringify(selectedIds),
        }),
      ]);
    }
  },
};
