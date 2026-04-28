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
        m('h2.text-2xl.font-bold.text-gray-900.dark:text-slate-100', isNew ? 'New Record' : 'Edit Record'),
        modelMeta ? m('span.text-gray-500.dark:text-slate-400', modelMeta.label || modelMeta.name) : null,
      ]),
      
      state.loading ? m('p.text-gray-600.dark:text-slate-400', 'Loading...') :
      state.error && !modelMeta ? m('.bg-red-50.dark:bg-red-950/40.border.border-red-200.dark:border-red-800.text-red-800.dark:text-red-200.px-4.py-3.rounded-lg', state.error) :
      
      m('form.bg-white.dark:bg-slate-800.rounded-lg.shadow-sm.border.border-gray-200.dark:border-slate-700.flex.flex-col', {
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
          state.error ? m('.bg-red-50.dark:bg-red-950/40.border.border-red-200.dark:border-red-800.text-red-800.dark:text-red-200.px-4.py-3.rounded-lg.mb-4', state.error) : null,
          
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
          }) : m('p.text-gray-600 dark:text-slate-400.mb-4', 'Loading form fields...'),
        ]),
        
        // Sticky footer buttons
        m('.flex.gap-4.p-4.border-t.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-900.sticky.bottom-0', [
          m('button.bg-blue-600.dark:bg-blue-500.text-white.px-6.py-2.rounded-lg.hover:bg-blue-700.dark:hover:bg-blue-600.disabled:opacity-50', {
            type: 'submit',
            disabled: state.loading,
          }, state.loading ? 'Saving...' : 'Save'),
          m('button.bg-gray-200 dark:bg-slate-700.text-gray-800 dark:text-slate-200.px-6.py-2.rounded.hover:bg-gray-300 dark:hover:bg-slate-600 dark:hover:bg-slate-600[type=button]', {
            onclick: () => m.route.set('/models/' + modelName),
          }, 'Cancel'),
        ]),
      ]),
    ]);
  },
};
