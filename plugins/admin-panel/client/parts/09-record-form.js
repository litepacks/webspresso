// Record Form Component - renders fields based on model schema with dynamic validation

/**
 * Validate a single column value against schema and metadata rules
 */
function validateField(col, value, formData) {
  const validations = col.validations || {};
  const isRequired = !col.nullable;
  const label = col.ui?.label || formatColumnLabel(col.name);

  // 1. Required / Nullable check
  if (isRequired) {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      return label + ' is required';
    }
    if (col.customField && col.customField.type === 'rich-text' && isRichTextEmpty(value)) {
      return label + ' is required';
    }
  }

  // If value is empty and column is nullable, it's valid
  if (value === undefined || value === null || value === '') {
    return null;
  }

  // 2. Type validation
  if (col.type === 'integer' || col.type === 'bigint') {
    const num = Number(value);
    if (isNaN(num) || !Number.isInteger(num)) {
      return label + ' must be an integer';
    }
  } else if (col.type === 'float' || col.type === 'decimal') {
    const num = Number(value);
    if (isNaN(num)) {
      return label + ' must be a valid number';
    }
  } else if (col.type === 'json') {
    if (typeof value === 'string') {
      try {
        JSON.parse(value);
      } catch {
        return label + ' must be valid JSON';
      }
    }
  }

  // 3. String Length & Format Validations
  if (typeof value === 'string') {
    const minLen = validations.minLength !== undefined ? validations.minLength : validations.min;
    if (minLen !== undefined && value.length < minLen) {
      return label + ' must be at least ' + minLen + ' characters';
    }
    const maxLen = validations.maxLength !== undefined ? validations.maxLength : (validations.max || col.maxLength);
    if (maxLen !== undefined && value.length > maxLen) {
      return label + ' must be at most ' + maxLen + ' characters';
    }
    if (validations.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value.trim())) {
        return label + ' must be a valid email address';
      }
    }
    if (validations.url) {
      try {
        new URL(value.trim());
      } catch {
        return label + ' must be a valid URL';
      }
    }
    if (validations.pattern) {
      try {
        const regex = new RegExp(validations.pattern);
        if (!regex.test(value)) {
          return label + ' format is invalid';
        }
      } catch {}
    }
  }

  // 4. Numeric Bounds
  if (typeof value === 'number') {
    if (validations.min !== undefined && value < validations.min) {
      return label + ' must be at least ' + validations.min;
    }
    if (validations.max !== undefined && value > validations.max) {
      return label + ' must be at most ' + validations.max;
    }
  }

  // 5. Enum validation
  if (col.enumValues && Array.isArray(col.enumValues) && col.enumValues.length > 0) {
    if (!col.enumValues.includes(value)) {
      return label + ' must be one of: ' + col.enumValues.join(', ');
    }
  }

  // 6. Custom Field Validator
  if (col.customField && typeof col.customField.validate === 'function') {
    const customErr = col.customField.validate(value, formData);
    if (customErr) return customErr;
  }

  return null;
}

/**
 * Validate all columns in a form
 */
function validateForm(columns, formData) {
  const errors = {};
  if (!columns || !Array.isArray(columns)) return errors;

  for (const col of columns) {
    const autoType = isAutoColumn(col);
    if (autoType === 'primary' || autoType === 'auto') continue;
    if (col.ui && col.ui.hidden) continue;

    let val = formData[col.name];
    if (col.customField && col.customField.type === 'rich-text') {
      const hiddenInput = document.getElementById(col.name + '-value');
      if (hiddenInput) val = hiddenInput.value;
    }

    const err = validateField(col, val, formData);
    if (err) {
      errors[col.name] = err;
    }
  }

  return errors;
}

const RecordForm = {
  oninit: () => {
    const modelName = m.route.param('model');
    const id = m.route.param('id');
    state.error = null;
    state.fieldErrors = {};
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
          state.error = null;
          state.fieldErrors = {};

          // 1. Run client-side validation
          if (modelMeta && modelMeta.columns) {
            const validationErrors = validateForm(modelMeta.columns, state.formData);
            if (Object.keys(validationErrors).length > 0) {
              state.fieldErrors = validationErrors;
              state.error = 'Please fix the errors indicated below.';
              m.redraw();
              setTimeout(() => {
                const firstInvalidKey = Object.keys(validationErrors)[0];
                const targetEl = document.getElementById(firstInvalidKey) ||
                  document.getElementById('file-input-' + firstInvalidKey) ||
                  document.getElementById('quill-editor-' + firstInvalidKey);
                if (targetEl && targetEl.scrollIntoView) {
                  targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  if (typeof targetEl.focus === 'function') targetEl.focus();
                }
              }, 50);
              return;
            }
          }

          state.loading = true;
          try {
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
            state.error = err.message || 'Failed to save record';
            if (err.fields && typeof err.fields === 'object') {
              state.fieldErrors = err.fields;
            }
          } finally {
            state.loading = false;
            m.redraw();
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
            const fieldError = state.fieldErrors ? state.fieldErrors[col.name] : null;
            
            const onChange = (newValue) => {
              state.formData[col.name] = newValue;
              if (state.fieldErrors && state.fieldErrors[col.name]) {
                delete state.fieldErrors[col.name];
              }
            };
            
            return renderer(col, value, onChange, isReadonly, fieldError);
          }) : m('p.text-gray-600 dark:text-slate-400.mb-4', 'Loading form fields...'),
        ]),
        
        // Sticky footer buttons
        m('.flex.gap-4.p-4.border-t.border-gray-200.dark:border-slate-700.bg-gray-50.dark:bg-slate-900.sticky.bottom-0', [
          m('button.bg-blue-600.dark:bg-blue-500.text-white.px-6.py-2.rounded-lg.hover:bg-blue-700.dark:hover:bg-blue-600.disabled:opacity-50', {
            type: 'submit',
            disabled: state.loading,
          }, state.loading ? 'Saving...' : 'Save'),
          m('button.bg-gray-200.dark:bg-slate-700.text-gray-800.dark:text-slate-200.px-6.py-2.rounded.hover:bg-gray-300.dark:hover:bg-slate-600[type=button]', {
            onclick: () => m.route.set('/models/' + modelName),
          }, 'Cancel'),
        ]),
      ]),
    ]);
  },
};
