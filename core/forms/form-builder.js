/**
 * Webspresso - Form Builder & HTML Generator (Django ModelForm-inspired)
 * Generates accessible HTML form inputs, field wrappers, and auto-forms from ORM models
 * @module core/forms/form-builder
 */

const { escapeHtml } = require('../utils/html');

/**
 * Render a single form field with label, input, and validation error message
 * @param {string} name - Field name
 * @param {Object} [options={}] - Field configuration options
 * @param {Object} [ctx={}] - Request / helpers context
 * @returns {string} HTML string
 */
function renderField(name, options = {}, ctx = {}) {
  const {
    label = humanize(name),
    type = 'text',
    placeholder = '',
    required = false,
    disabled = false,
    readonly = false,
    className = 'form-control',
    wrapperClass = 'form-group mb-3',
    errorClass = 'is-invalid',
    showError = true,
    rows = 4,
    selectOptions = [],
    helpText = '',
    attributes = {},
  } = options;

  // Resolve old value or default
  const req = ctx.req;
  const oldVal = req && typeof req.old === 'function' ? req.old(name) : undefined;
  const value = oldVal !== undefined ? oldVal : (options.value !== undefined ? options.value : (options.default ?? ''));

  // Check error state
  const errors = req?.__flash?.errors || {};
  const fieldErrors = errors[name] || [];
  const hasError = fieldErrors.length > 0;
  const inputClass = `${className}${hasError ? ` ${errorClass}` : ''}`.trim();

  const extraAttrs = Object.entries(attributes)
    .map(([k, v]) => `${escapeHtml(k)}="${escapeHtml(v)}"`)
    .join(' ');

  let inputHtml = '';

  if (type === 'textarea') {
    inputHtml = `<textarea id="field_${escapeHtml(name)}" name="${escapeHtml(name)}" class="${escapeHtml(inputClass)}" placeholder="${escapeHtml(placeholder)}"${required ? ' required' : ''}${disabled ? ' disabled' : ''}${readonly ? ' readonly' : ''} rows="${rows}"${extraAttrs ? ' ' + extraAttrs : ''}>${escapeHtml(value)}</textarea>`;
  } else if (type === 'select') {
    const optsHtml = selectOptions
      .map((opt) => {
        const optVal = typeof opt === 'object' && opt !== null ? opt.value : opt;
        const optLabel = typeof opt === 'object' && opt !== null ? opt.label : opt;
        const isSelected = String(optVal) === String(value);
        return `<option value="${escapeHtml(optVal)}"${isSelected ? ' selected' : ''}>${escapeHtml(optLabel)}</option>`;
      })
      .join('\n      ');
    inputHtml = `<select id="field_${escapeHtml(name)}" name="${escapeHtml(name)}" class="${escapeHtml(inputClass)}"${required ? ' required' : ''}${disabled ? ' disabled' : ''}${extraAttrs ? ' ' + extraAttrs : ''}>\n      ${optsHtml}\n    </select>`;
  } else if (type === 'checkbox') {
    const isChecked = Boolean(value) && value !== '0' && value !== 'false';
    inputHtml = `<div class="form-check">
      <input type="checkbox" id="field_${escapeHtml(name)}" name="${escapeHtml(name)}" value="true" class="form-check-input${hasError ? ` ${errorClass}` : ''}"${isChecked ? ' checked' : ''}${disabled ? ' disabled' : ''}${extraAttrs ? ' ' + extraAttrs : ''}>
      <label class="form-check-label" for="field_${escapeHtml(name)}">${escapeHtml(label)}</label>
    </div>`;
  } else {
    // Standard input (text, email, password, number, date, file, etc.)
    inputHtml = `<input type="${escapeHtml(type)}" id="field_${escapeHtml(name)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" class="${escapeHtml(inputClass)}" placeholder="${escapeHtml(placeholder)}"${required ? ' required' : ''}${disabled ? ' disabled' : ''}${readonly ? ' readonly' : ''}${extraAttrs ? ' ' + extraAttrs : ''}>`;
  }

  const labelHtml =
    type !== 'checkbox' && label
      ? `<label for="field_${escapeHtml(name)}" class="form-label">${escapeHtml(label)}${required ? ' <span class="text-danger">*</span>' : ''}</label>`
      : '';

  const helpHtml = helpText ? `<div class="form-text text-muted">${escapeHtml(helpText)}</div>` : '';

  const errorHtml =
    showError && hasError
      ? `<div class="invalid-feedback d-block text-danger mt-1">${escapeHtml(fieldErrors[0])}</div>`
      : '';

  return `<div class="${escapeHtml(wrapperClass)}">
    ${labelHtml ? labelHtml + '\n    ' : ''}${inputHtml}
    ${helpHtml ? helpHtml + '\n    ' : ''}${errorHtml}
  </div>`.trim();
}

/**
 * Generate a complete HTML form from an ORM model definition (Django ModelForm-inspired)
 * @param {Object} modelOrRepo - ORM model or repository
 * @param {Object} [options={}] - Form options (action, method, exclude, include, submitLabel)
 * @param {Object} [ctx={}] - Request / helpers context
 * @returns {string} HTML string
 */
function renderFormFor(modelOrRepo, options = {}, ctx = {}) {
  const model = modelOrRepo.model || modelOrRepo;
  if (!model || !model.columns) {
    throw new Error('renderFormFor requires an ORM model or repository with column definitions');
  }

  const {
    action = '',
    method = 'POST',
    exclude = ['id', 'created_at', 'updated_at', 'deleted_at'],
    include = null,
    submitLabel = 'Save',
    csrf = true,
    formClass = 'webspresso-form',
  } = options;

  const excludeSet = new Set(exclude);
  const includeSet = include ? new Set(include) : null;

  const fieldsHtml = [];

  for (const [colName, meta] of model.columns.entries()) {
    if (excludeSet.has(colName)) continue;
    if (includeSet && !includeSet.has(colName)) continue;

    const fieldConfig = inferFieldConfig(colName, meta);
    fieldsHtml.push(renderField(colName, fieldConfig, ctx));
  }

  let csrfHtml = '';
  if (csrf && ctx.req) {
    const token = ctx.req.csrfToken ? ctx.req.csrfToken() : ctx.req.session?._csrf || '';
    if (token) {
      csrfHtml = `  <input type="hidden" name="_csrf" value="${escapeHtml(token)}">\n`;
    }
  }

  const submitHtml = submitLabel
    ? `  <div class="form-actions mt-4">\n    <button type="submit" class="btn btn-primary">${escapeHtml(submitLabel)}</button>\n  </div>`
    : '';

  return `<form action="${escapeHtml(action)}" method="${escapeHtml(method)}" class="${escapeHtml(formClass)}">
${csrfHtml}  ${fieldsHtml.join('\n  ')}
${submitHtml}
</form>`;
}

function inferFieldConfig(name, meta) {
  const config = {
    label: humanize(name),
    required: !meta.nullable && meta.default === undefined && !meta.auto,
  };

  switch (meta.type) {
    case 'text':
      config.type = 'textarea';
      break;
    case 'boolean':
      config.type = 'checkbox';
      break;
    case 'integer':
    case 'bigint':
    case 'float':
    case 'decimal':
      config.type = 'number';
      break;
    case 'date':
      config.type = 'date';
      break;
    case 'datetime':
    case 'timestamp':
      config.type = 'datetime-local';
      break;
    case 'file':
    case 'files':
      config.type = 'file';
      break;
    case 'enum':
      config.type = 'select';
      config.selectOptions = (meta.enumValues || []).map((v) => ({ label: humanize(v), value: v }));
      break;
    default:
      if (name.includes('email')) {
        config.type = 'email';
      } else if (name.includes('password')) {
        config.type = 'password';
      } else {
        config.type = 'text';
      }
  }

  return config;
}

function humanize(str) {
  if (!str) return '';
  return str
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/^./, (m) => m.toUpperCase());
}

module.exports = {
  renderField,
  renderFormFor,
  humanize,
  escapeHtml,
};
