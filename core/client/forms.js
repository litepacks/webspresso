'use strict';

/**
 * Webspresso Native HTML Form Layer & Typed Form Handle
 *
 * Principles:
 * - Built on native HTML <form action="/api/..." method="post" data-w-form="name"> semantics
 * - Zero client JS required for standard form submission, validation error display, and fragment invalidation
 * - Explicit, deterministic form-to-payload conversion rules
 * - Starts with native constraint validation (`form.reportValidity()`); server validation remains authoritative
 * - Accessible field error binding (`aria-invalid`, `aria-describedby`) and focus on first invalid field
 * - Separation of `reset()` (restores initial default values) vs `clear()` (empties all controls)
 * - Mutation success vs refresh failure separation: a refresh failure never puts a succeeded form into validation error state
 */

let errorIdSeq = 0;

/**
 * Check if a form control is disabled (either directly or via an ancestor <fieldset disabled>).
 * Note: Per HTML spec, controls inside the first <legend> of a disabled <fieldset> remain enabled.
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isControlDisabled(el) {
  if (!el) return true;
  if (el.disabled) return true;
  let parent = el.parentElement;
  while (parent) {
    if (parent.tagName === 'FIELDSET' && parent.disabled) {
      // Check if el is inside the first <legend> child of this fieldset
      let firstLegend = null;
      for (let i = 0; i < parent.children.length; i++) {
        if (parent.children[i].tagName === 'LEGEND') {
          firstLegend = parent.children[i];
          break;
        }
      }
      if (!firstLegend || !firstLegend.contains(el)) {
        return true;
      }
    }
    parent = parent.parentElement;
  }
  return false;
}

/**
 * Coerce a single raw string value according to control type and `data-w-*` hints.
 *
 * @param {Element} el
 * @param {string} rawValue
 * @returns {unknown}
 */
function coerceScalarControlValue(el, rawValue) {
  const inputType = ((el.getAttribute && el.getAttribute('type')) || el.type || 'text').toLowerCase();
  const dataType = ((el.getAttribute && el.getAttribute('data-w-type')) || '').toLowerCase();
  const emptyMode = ((el.getAttribute && el.getAttribute('data-w-empty')) || '').toLowerCase();

  if (rawValue === '') {
    if (emptyMode === 'null') return null;
    if (emptyMode === 'undefined' || emptyMode === 'omit') return undefined;
    if (inputType === 'number' || inputType === 'range' || dataType === 'number') {
      return null;
    }
    return '';
  }

  if (inputType === 'number' || inputType === 'range' || dataType === 'number') {
    const num = Number(rawValue);
    return Number.isNaN(num) ? rawValue : num;
  }

  if (dataType === 'boolean') {
    if (rawValue === 'true' || rawValue === '1' || rawValue === 'on') return true;
    if (rawValue === 'false' || rawValue === '0' || rawValue === 'off') return false;
    return Boolean(rawValue);
  }

  return rawValue;
}

/**
 * Parse a `<form>` element into a structured payload and transport descriptor.
 *
 * Explicit Coercion Rules:
 * 1. `disabled` controls (including inside disabled `<fieldset>`) are excluded.
 * 2. `submitter`: if a submit button with `name` triggered the submit and is not disabled, its `name`/`value` is included.
 * 3. `checkbox`:
 *    - Single checkbox for a given `name`:
 *      - Boolean checkbox (no custom `value` attribute, or `value="true"|"on"`, or `data-w-type="boolean"`): `true` when checked, `false` when unchecked.
 *      - Custom value checkbox (e.g. `value="yes"`): `"yes"` when checked, `null` (or `data-w-unchecked` value) when unchecked.
 *    - Multiple checkboxes sharing the same `name` (or `name="tags[]"`): `Array` of checked values (`[]` when none checked).
 * 4. `number` / `range`: coerced to `number` (`null` when empty, or `undefined` with `data-w-empty="undefined"`).
 * 5. `empty string`: preserved as `""` for text controls unless `data-w-empty="null|undefined"` is specified.
 * 6. `repeated field names`: collected into an `Array` in DOM order. Trailing `[]` in `name="tags[]"` is normalized to `tags`.
 * 7. `select[multiple]`: always returns an `Array` of selected option values (`[]` when none selected).
 * 8. `file`:
 *    - Empty file input (`files.length === 0` or single 0-byte unnamed file): omitted (`undefined`).
 *    - `input[ type="file" multiple ]`: `File[]`.
 *    - Single `input[type="file"]`: `File`.
 *    - When any non-empty `File` is present or `form.enctype === 'multipart/form-data'`, `isMultipart` is `true` and `formData` is populated.
 *
 * @param {HTMLFormElement} formEl
 * @param {HTMLElement|null} [submitter]
 * @returns {{ data: Record<string, unknown>, formData: FormData|null, isMultipart: boolean }}
 */
function parseFormElement(formEl, submitterOrOptions = null) {
  if (!formEl || typeof formEl.querySelectorAll !== 'function') {
    return { data: {}, values: {}, formData: null, isMultipart: false };
  }

  const submitter =
    submitterOrOptions &&
    typeof submitterOrOptions === 'object' &&
    !submitterOrOptions.nodeType &&
    !('tagName' in submitterOrOptions) &&
    'submitter' in submitterOrOptions
      ? submitterOrOptions.submitter
      : submitterOrOptions;

  const rawControls = Array.from(
    formEl.querySelectorAll('input, select, textarea')
  );

  // Filter out disabled controls and button/submit/reset inputs (handled via submitter)
  const controls = rawControls.filter((el) => {
    if (isControlDisabled(el)) return false;
    const rawName = el.getAttribute('name');
    if (!rawName || !rawName.trim()) return false;
    const type = (el.type || '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
      return false;
    }
    return true;
  });

  // Count occurrences per normalized field name and per checkbox/radio group
  const nameCounts = new Map();
  const checkboxCounts = new Map();
  const radioNames = new Set();

  function normalizeFieldName(rawName) {
    const trimmed = String(rawName || '').trim();
    return trimmed.endsWith('[]') ? trimmed.slice(0, -2) : trimmed;
  }

  for (const el of controls) {
    const rawName = el.getAttribute('name').trim();
    const normName = normalizeFieldName(rawName);
    const isExplicitArray = rawName.endsWith('[]');
    const type = (el.type || '').toLowerCase();

    if (type === 'checkbox') {
      checkboxCounts.set(normName, (checkboxCounts.get(normName) || 0) + (isExplicitArray ? 2 : 1));
    } else if (type === 'radio') {
      radioNames.add(normName);
    } else {
      nameCounts.set(normName, (nameCounts.get(normName) || 0) + (isExplicitArray ? 2 : 1));
    }
  }

  const data = {};
  let hasBinaryFile = false;

  function appendValue(normName, val, forceArray) {
    if (val === undefined) return;
    if (forceArray) {
      if (!Array.isArray(data[normName])) {
        data[normName] = [];
      }
      data[normName].push(val);
    } else if (normName in data) {
      if (!Array.isArray(data[normName])) {
        data[normName] = [data[normName]];
      }
      data[normName].push(val);
    } else {
      data[normName] = val;
    }
  }

  // Initialize multi-checkbox groups to [] and radio groups to null if none checked
  for (const [normName, count] of checkboxCounts.entries()) {
    if (count > 1) {
      data[normName] = [];
    }
  }
  for (const normName of radioNames) {
    if (!(normName in data)) {
      data[normName] = null;
    }
  }

  for (const el of controls) {
    const rawName = el.getAttribute('name').trim();
    const normName = normalizeFieldName(rawName);
    const isExplicitArray = rawName.endsWith('[]');
    const tag = el.tagName;
    const type = (el.type || '').toLowerCase();

    if (tag === 'SELECT' && el.multiple) {
      const selectedValues = [];
      const options = Array.from(el.options || []);
      for (const opt of options) {
        if (opt.selected && !opt.disabled) {
          selectedValues.push(coerceScalarControlValue(el, opt.value));
        }
      }
      data[normName] = selectedValues;
      continue;
    }

    if (type === 'checkbox') {
      const totalCheckboxes = checkboxCounts.get(normName) || 1;
      if (totalCheckboxes > 1 || isExplicitArray) {
        if (el.checked) {
          const valAttr = el.getAttribute('value');
          const rawVal = valAttr !== null ? valAttr : 'on';
          data[normName].push(coerceScalarControlValue(el, rawVal));
        }
      } else {
        const valAttr = el.getAttribute('value');
        const dataType = (el.getAttribute('data-w-type') || '').toLowerCase();
        const isBooleanCheckbox =
          dataType === 'boolean' ||
          valAttr === null ||
          valAttr === '' ||
          valAttr === 'on' ||
          valAttr === 'true';

        if (isBooleanCheckbox) {
          data[normName] = Boolean(el.checked);
        } else if (el.checked) {
          data[normName] = coerceScalarControlValue(el, valAttr);
        } else {
          const uncheckedAttr = el.getAttribute('data-w-unchecked');
          data[normName] = uncheckedAttr !== null ? uncheckedAttr : null;
        }
      }
      continue;
    }

    if (type === 'radio') {
      if (el.checked) {
        data[normName] = coerceScalarControlValue(el, el.value);
      }
      continue;
    }

    if (type === 'file') {
      const files = el.files ? Array.from(el.files).filter((f) => f && (f.size > 0 || f.name)) : [];
      if (files.length > 0) {
        hasBinaryFile = true;
        if (el.multiple || isExplicitArray || (nameCounts.get(normName) || 0) > 1) {
          appendValue(normName, files.length === 1 && !el.multiple ? files[0] : files, !el.multiple);
          if (el.multiple) {
            data[normName] = files;
          }
        } else {
          data[normName] = files[0];
        }
      }
      continue;
    }

    const totalForName = nameCounts.get(normName) || 1;
    const coerced = coerceScalarControlValue(el, el.value !== undefined ? String(el.value) : '');
    appendValue(normName, coerced, totalForName > 1 || isExplicitArray);
  }

  // Include submitter name/value if provided and enabled
  if (submitter && !isControlDisabled(submitter)) {
    const subName = submitter.getAttribute ? submitter.getAttribute('name') : submitter.name;
    if (subName && String(subName).trim()) {
      const normSubName = normalizeFieldName(subName);
      const subValue =
        (submitter.getAttribute && submitter.getAttribute('value')) ??
        submitter.value ??
        '';
      data[normSubName] = coerceScalarControlValue(submitter, String(subValue));
    }
  }

  const enctype = ((formEl.getAttribute && formEl.getAttribute('enctype')) || formEl.enctype || '').toLowerCase();
  const isMultipart = hasBinaryFile || enctype === 'multipart/form-data';

  let formData = null;
  if (isMultipart && typeof FormData !== 'undefined') {
    formData = new FormData();
    for (const [key, val] of Object.entries(data)) {
      if (val === undefined) continue;
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item === undefined) continue;
          if (typeof Blob !== 'undefined' && item instanceof Blob) {
            formData.append(key, item);
          } else if (item !== null) {
            formData.append(key, String(item));
          }
        }
      } else if (typeof Blob !== 'undefined' && val instanceof Blob) {
        formData.append(key, val);
      } else if (val === null) {
        formData.append(key, '');
      } else {
        formData.append(key, String(val));
      }
    }
  }

  return { data, values: data, formData, isMultipart };
}

/**
 * Snapshot initial default values on a form so `reset()` restores them accurately
 * and `dirty` can compare current values against initial state.
 */
function captureInitialFormSnapshot(formEl) {
  const snapshot = new Map();
  if (!formEl || typeof formEl.querySelectorAll !== 'function') return snapshot;
  const controls = formEl.querySelectorAll('input, select, textarea');
  for (let i = 0; i < controls.length; i++) {
    const el = controls[i];
    const type = (el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      snapshot.set(el, { checked: Boolean(el.checked) });
    } else if (el.tagName === 'SELECT') {
      const selectedIndices = [];
      const opts = el.options || [];
      for (let j = 0; j < opts.length; j++) {
        if (opts[j].selected) selectedIndices.push(j);
      }
      snapshot.set(el, { selectedIndices, value: el.value });
    } else if (type !== 'file') {
      snapshot.set(el, { value: el.value !== undefined ? String(el.value) : '' });
    }
  }
  return snapshot;
}

/**
 * Check if any control in `formEl` differs from its captured initial snapshot.
 */
function computeFormDirty(formEl, initialSnapshot) {
  if (!formEl || typeof formEl.querySelectorAll !== 'function') return false;
  const controls = formEl.querySelectorAll('input, select, textarea');
  for (let i = 0; i < controls.length; i++) {
    const el = controls[i];
    const type = (el.type || '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'hidden') continue;
    const init = initialSnapshot.get(el);
    if (type === 'checkbox' || type === 'radio') {
      const expected = init ? init.checked : Boolean(el.defaultChecked);
      if (Boolean(el.checked) !== expected) return true;
    } else if (el.tagName === 'SELECT') {
      if (init) {
        if (el.value !== init.value) return true;
      }
    } else if (type === 'file') {
      if (el.files && el.files.length > 0) return true;
    } else {
      const expected = init ? init.value : (el.defaultValue || '');
      if (String(el.value || '') !== expected) return true;
    }
  }
  return false;
}

/**
 * Create a Form Handle managing a `<form>` element's lifecycle, validation errors,
 * accessibility attributes, pending lock, and submission.
 *
 * @param {HTMLFormElement} formEl
 * @param {object} options
 * @param {object} options.api - Typed API client instance
 * @param {object} [options.datastar] - Datastar adapter for reactive signals
 * @param {(url: string) => void} [options.navigate] - Navigation handler for explicit redirects
 * @param {object} [options.debug] - Client debugger
 */
function createFormHandle(formEl, options = {}) {
  if (formEl && formEl.__wFormHandle) {
    return formEl.__wFormHandle;
  }

  const api = options.api;
  const debug = options.debug || null;
  const formName =
    (formEl && formEl.getAttribute && formEl.getAttribute('data-w-form')) ||
    (formEl && formEl.getAttribute && formEl.getAttribute('name')) ||
    'form';

  let initialSnapshot = captureInitialFormSnapshot(formEl);
  let pending = false;
  let dirty = false;
  let fieldErrors = {};
  let formError = null;
  let lastData = null;

  const successListeners = new Set();
  const errorListeners = new Set();
  const stateListeners = new Set();

  function notifyStateChange() {
    for (const fn of stateListeners) {
      try {
        fn(handle);
      } catch (_e) {
        // Ignore
      }
    }
  }

  /**
   * Render field errors and form-level error into the DOM with accessible ARIA bindings.
   * Optionally focuses the first invalid control.
   */
  function syncErrorsToDom(focusFirstInvalid = false) {
    if (!formEl || typeof formEl.querySelectorAll !== 'function') return;

    // 1. Clear previous error elements and aria-invalid states
    const errorSpans = formEl.querySelectorAll('[data-w-error]');
    for (let i = 0; i < errorSpans.length; i++) {
      const span = errorSpans[i];
      const fieldName = span.getAttribute('data-w-error');
      const msg = fieldName && fieldErrors[fieldName] ? String(fieldErrors[fieldName]) : '';
      span.textContent = msg;
      if (msg) {
        span.removeAttribute('hidden');
        if (!span.id) {
          span.id = `w-err-${formName}-${fieldName}-${++errorIdSeq}`;
        }
        if (!span.getAttribute('role')) {
          span.setAttribute('role', 'alert');
        }
      } else {
        span.setAttribute('hidden', '');
      }
    }

    // 2. Bind aria-invalid and aria-describedby on form controls, and find first invalid control
    let firstInvalidControl = null;
    const controls = formEl.querySelectorAll('input, select, textarea');
    for (let i = 0; i < controls.length; i++) {
      const ctrl = controls[i];
      const rawName = ctrl.getAttribute('name');
      if (!rawName) continue;
      const normName = rawName.endsWith('[]') ? rawName.slice(0, -2) : rawName;
      const errMsg = fieldErrors[normName] || fieldErrors[rawName];

      if (errMsg) {
        ctrl.setAttribute('aria-invalid', 'true');
        const errSpan =
          formEl.querySelector(`[data-w-error="${normName}"]`) ||
          formEl.querySelector(`[data-w-error="${rawName}"]`);
        if (errSpan && errSpan.id) {
          ctrl.setAttribute('aria-describedby', errSpan.id);
        }
        if (!firstInvalidControl && typeof ctrl.focus === 'function' && !isControlDisabled(ctrl)) {
          firstInvalidControl = ctrl;
        }
      } else {
        ctrl.removeAttribute('aria-invalid');
        const desc = ctrl.getAttribute('aria-describedby');
        if (desc && desc.startsWith('w-err-')) {
          ctrl.removeAttribute('aria-describedby');
        }
      }
    }

    // 3. Form-level error element `[data-w-form-error]`
    const formErrorEl = formEl.querySelector('[data-w-form-error]');
    if (formErrorEl) {
      if (formError) {
        formErrorEl.textContent = String(formError);
        formErrorEl.removeAttribute('hidden');
        if (!formErrorEl.getAttribute('role')) {
          formErrorEl.setAttribute('role', 'alert');
        }
      } else {
        formErrorEl.textContent = '';
        formErrorEl.setAttribute('hidden', '');
      }
    }

    if (focusFirstInvalid && firstInvalidControl) {
      try {
        firstInvalidControl.focus();
      } catch (_e) {
        // Ignore focus errors in headless environments
      }
    }
  }

  /**
   * Toggle pending state on the form and submit buttons to prevent double submissions.
   */
  function setPendingState(nextPending, activeSubmitter = null) {
    pending = Boolean(nextPending);
    if (!formEl) return;

    if (pending) {
      formEl.setAttribute('aria-busy', 'true');
      formEl.setAttribute('data-w-pending', 'true');
    } else {
      formEl.removeAttribute('aria-busy');
      formEl.removeAttribute('data-w-pending');
    }

    const submitButtons = formEl.querySelectorAll
      ? formEl.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]')
      : [];
    for (let i = 0; i < submitButtons.length; i++) {
      const btn = submitButtons[i];
      if (btn.hasAttribute('data-w-disabled')) continue; // Managed by controller binding
      if (pending) {
        btn.__wWasDisabled = Boolean(btn.disabled);
        btn.disabled = true;
      } else if (!btn.__wWasDisabled) {
        btn.disabled = false;
      }
    }
    if (activeSubmitter && !activeSubmitter.hasAttribute('data-w-disabled')) {
      activeSubmitter.disabled = pending;
    }
    notifyStateChange();
  }

  /**
   * Reset form controls back to their initial default values (NOT emptying non-empty defaults).
   */
  function reset() {
    if (!formEl) return;
    if (typeof formEl.reset === 'function') {
      formEl.reset();
    }
    // Restore exact captured initial snapshot
    for (const [el, init] of initialSnapshot.entries()) {
      const type = (el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        el.checked = init.checked;
      } else if (el.tagName === 'SELECT') {
        const opts = el.options || [];
        for (let j = 0; j < opts.length; j++) {
          opts[j].selected = init.selectedIndices.includes(j);
        }
      } else if (type !== 'file') {
        el.value = init.value;
      }
    }
    dirty = false;
    fieldErrors = {};
    formError = null;
    syncErrorsToDom(false);
    notifyStateChange();
  }

  /**
   * Completely clear all user-editable controls to empty values (distinct from `reset()`).
   */
  function clear() {
    if (!formEl || typeof formEl.querySelectorAll !== 'function') return;
    const controls = formEl.querySelectorAll('input, select, textarea');
    for (let i = 0; i < controls.length; i++) {
      const el = controls[i];
      const type = (el.type || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'hidden') continue;
      if (type === 'checkbox' || type === 'radio') {
        el.checked = false;
      } else if (el.tagName === 'SELECT') {
        const opts = el.options || [];
        for (let j = 0; j < opts.length; j++) {
          opts[j].selected = false;
        }
        if (!el.multiple && opts.length > 0) {
          el.value = '';
        }
      } else {
        el.value = '';
      }
    }
    dirty = computeFormDirty(formEl, initialSnapshot);
    fieldErrors = {};
    formError = null;
    syncErrorsToDom(false);
    notifyStateChange();
  }

  /**
   * Programmatically fill form fields.
   *
   * @param {Record<string, unknown>} values - Object containing field name -> value mappings
   * @param {object} [options]
   * @param {boolean} [options.baseline=false] - If true, treats the filled values as the new baseline
   *                                            snapshot, clears `dirty`, and clears previous validation errors.
   */
  function fill(values = {}, options = {}) {
    if (!formEl || typeof formEl.querySelectorAll !== 'function' || !values || typeof values !== 'object') {
      return handle;
    }

    const isBaseline = Boolean(options.baseline);

    for (const [key, val] of Object.entries(values)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

      const normKey = key.endsWith('[]') ? key.slice(0, -2) : key;
      const matchingControls = Array.from(
        formEl.querySelectorAll(`[name="${key}"], [name="${normKey}"], [name="${normKey}[]"]`)
      );

      for (const ctrl of matchingControls) {
        if (!ctrl || ctrl.tagName === 'BUTTON') continue;
        const type = (ctrl.type || '').toLowerCase();
        if (type === 'file') continue; // Browser security prevents setting file input value

        if (type === 'checkbox') {
          if (Array.isArray(val)) {
            ctrl.checked = val.map(String).includes(String(ctrl.value));
          } else {
            ctrl.checked = Boolean(val);
          }
        } else if (type === 'radio') {
          ctrl.checked = String(val) === String(ctrl.value);
        } else if (ctrl.tagName === 'SELECT') {
          if (ctrl.multiple) {
            const arr = Array.isArray(val) ? val.map(String) : [String(val)];
            const opts = ctrl.options || [];
            for (let j = 0; j < opts.length; j++) {
              opts[j].selected = arr.includes(String(opts[j].value));
            }
          } else {
            ctrl.value = val === null || val === undefined ? '' : String(val);
          }
        } else {
          ctrl.value = val === null || val === undefined ? '' : String(val);
        }

        // Clear error for this field
        delete fieldErrors[normKey];
        delete fieldErrors[key];
      }
    }

    if (isBaseline) {
      initialSnapshot = captureInitialFormSnapshot(formEl);
      dirty = false;
      fieldErrors = {};
      formError = null;
      syncErrorsToDom(false);
    } else {
      dirty = computeFormDirty(formEl, initialSnapshot);
      syncErrorsToDom(false);
    }

    notifyStateChange();
    return handle;
  }

  function setAction(url) {
    if (formEl && url) {
      formEl.setAttribute('action', String(url));
    }
    return handle;
  }

  function setRouteParams(params = {}) {
    if (!formEl || !params) return handle;
    let action = formEl.getAttribute('action') || '';
    for (const [k, v] of Object.entries(params)) {
      action = action.replace(new RegExp(`\\[${k}\\]`, 'g'), encodeURIComponent(String(v)));
      action = action.replace(new RegExp(`:${k}\\b`, 'g'), encodeURIComponent(String(v)));
    }
    formEl.setAttribute('action', action);
    return handle;
  }

  let _manuallyDisabled = false;
  function setDisabled(val) {
    _manuallyDisabled = Boolean(val);
    if (!formEl) return handle;
    if (_manuallyDisabled) {
      if (formEl.setAttribute) {
        formEl.setAttribute('aria-disabled', 'true');
        formEl.setAttribute('disabled', '');
      }
    } else {
      if (formEl.removeAttribute) {
        formEl.removeAttribute('aria-disabled');
        formEl.removeAttribute('disabled');
      }
    }
    const controls = formEl.querySelectorAll ? formEl.querySelectorAll('input, select, textarea, button') : [];
    for (let i = 0; i < controls.length; i++) {
      controls[i].disabled = _manuallyDisabled;
    }
    notifyStateChange();
    return handle;
  }

  /**
   * Execute form submission.
   */
  async function submit(eventOrOptions = null) {
    let event = null;
    let submitOptions = {};

    if (eventOrOptions && typeof eventOrOptions.preventDefault === 'function') {
      event = eventOrOptions;
      event.preventDefault();
    } else if (eventOrOptions && typeof eventOrOptions === 'object') {
      submitOptions = eventOrOptions;
    }

    // Prevent double submit while pending
    if (pending) {
      return { submitted: false, reason: 'pending' };
    }

    // 1. Native HTML5 constraint validation first
    if (
      submitOptions.validate !== false &&
      formEl &&
      !formEl.noValidate &&
      typeof formEl.reportValidity === 'function'
    ) {
      const isValid = formEl.reportValidity();
      if (!isValid) {
        return { submitted: false, reason: 'native-constraint-invalid' };
      }
    }

    const submitter =
      submitOptions.submitter || (event && event.submitter ? event.submitter : null);
    const actionUrl =
      submitOptions.action ||
      (submitter && submitter.getAttribute && submitter.getAttribute('formaction')) ||
      (formEl && formEl.getAttribute && formEl.getAttribute('action')) ||
      (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
    const rawMethod =
      submitOptions.method ||
      (submitter && submitter.getAttribute && submitter.getAttribute('formmethod')) ||
      (formEl && formEl.getAttribute && formEl.getAttribute('method')) ||
      'POST';
    const method = String(rawMethod).toUpperCase();

    const { data: payloadData, formData, isMultipart } = parseFormElement(formEl, submitter);

    // Clear previous errors before request starts
    fieldErrors = {};
    formError = null;
    syncErrorsToDom(false);
    setPendingState(true, submitter);

    try {
      let responseData;
      const reqKey = `form:${formName}:${method}:${actionUrl}`;
      if (method === 'GET') {
        responseData = await api.get(actionUrl, payloadData, {
          key: reqKey,
          policy: 'latest',
        });
      } else {
        const bodyToSend = isMultipart && formData ? formData : payloadData;
        responseData = await api.request(method, actionUrl, bodyToSend, {
          key: reqKey,
          policy: 'drop',
        });
      }

      lastData = responseData;
      dirty = false;
      fieldErrors = {};
      formError = null;
      syncErrorsToDom(false);

      // Explicit reset / clear behavior on success
      const resetAttr = formEl ? formEl.getAttribute('data-w-reset') : null;
      const clearAttr = formEl ? formEl.getAttribute('data-w-clear') : null;
      const shouldReset =
        submitOptions.resetOnSuccess === true ||
        options.resetOnSuccess === true ||
        resetAttr === '' ||
        resetAttr === 'true' ||
        resetAttr === '1';
      const shouldClear =
        submitOptions.clearOnSuccess === true ||
        options.clearOnSuccess === true ||
        clearAttr === '' ||
        clearAttr === 'true' ||
        clearAttr === '1';

      if (shouldClear) {
        clear();
      } else if (shouldReset) {
        reset();
      } else {
        // Current state becomes the new clean baseline after successful save
        initialSnapshot = captureInitialFormSnapshot(formEl);
      }

      // Invoke registered success hooks. Note: Any background fragment refresh failure
      // is handled by the fragment coordinator and NEVER puts this form into validation error state!
      for (const listener of successListeners) {
        await listener(responseData, { values: payloadData, form: handle });
      }

      // Explicit redirect behavior
      const redirectTarget =
        submitOptions.redirectOnSuccess ||
        (formEl && formEl.getAttribute('data-w-redirect')) ||
        null;
      if (redirectTarget) {
        if (typeof options.navigate === 'function') {
          options.navigate(redirectTarget);
        } else if (typeof window !== 'undefined' && window.location) {
          window.location.assign(redirectTarget);
        }
      }

      let refreshOk = true;
      let refreshError = null;
      if (responseData && typeof responseData === 'object' && responseData.__refreshPromise) {
        const refreshOutcome = await responseData.__refreshPromise;
        if (refreshOutcome && refreshOutcome.ok === false) {
          refreshOk = false;
          refreshError = refreshOutcome.error || null;
        }
      }

      return { ok: true, submitted: true, data: responseData, refreshOk, refreshError };
    } catch (err) {
      if (err && err.kind === 'validation') {
        fieldErrors = { ...(err.fieldErrors || {}) };
        formError = err.formError || (Object.keys(fieldErrors).length === 0 ? err.message : null);
        syncErrorsToDom(true);
      } else if (err && err.isCanceled) {
        // Canceled or dropped duplicate submit — do not overwrite form with error
      } else {
        formError = err && err.message ? err.message : 'Form submission failed.';
        syncErrorsToDom(false);
      }

      for (const listener of errorListeners) {
        try {
          await listener(err, { values: payloadData, form: handle });
        } catch (_e) {
          // Ignore
        }
      }

      if (submitOptions.throwOnError) {
        throw err;
      }
      return { ok: false, submitted: false, error: err };
    } finally {
      setPendingState(false, submitter);
    }
  }

  // Listen to native submit and input/change events on `formEl`
  const onDomInput = (evt) => {
    dirty = computeFormDirty(formEl, initialSnapshot);
    const target = evt && evt.target;
    if (target && target.getAttribute) {
      const rawName = target.getAttribute('name');
      if (rawName) {
        const norm = rawName.endsWith('[]') ? rawName.slice(0, -2) : rawName;
        if (fieldErrors[norm] || fieldErrors[rawName]) {
          delete fieldErrors[norm];
          delete fieldErrors[rawName];
          syncErrorsToDom(false);
        }
      }
    }
    notifyStateChange();
  };

  const onDomSubmit = (evt) => {
    submit(evt);
  };

  const onDomReset = () => {
    setTimeout(() => {
      dirty = false;
      fieldErrors = {};
      formError = null;
      syncErrorsToDom(false);
      notifyStateChange();
    }, 0);
  };

  if (formEl && typeof formEl.addEventListener === 'function') {
    formEl.addEventListener('input', onDomInput);
    formEl.addEventListener('change', onDomInput);
    formEl.addEventListener('submit', onDomSubmit);
    formEl.addEventListener('reset', onDomReset);
  }

  // Initialize hidden state on empty error placeholders
  syncErrorsToDom(false);

  const handle = {
    name: formName,
    el: formEl,
    get pending() {
      return pending;
    },
    get dirty() {
      dirty = computeFormDirty(formEl, initialSnapshot);
      return dirty;
    },
    get values() {
      return parseFormElement(formEl).data;
    },
    get errors() {
      return { ...fieldErrors };
    },
    get fieldErrors() {
      return { ...fieldErrors };
    },
    get formError() {
      return formError;
    },
    get lastData() {
      return lastData;
    },
    get disabled() {
      return _manuallyDisabled;
    },
    set disabled(val) {
      setDisabled(val);
    },
    read(submitter) {
      return parseFormElement(formEl, submitter).data;
    },
    getValues(submitter) {
      return parseFormElement(formEl, submitter).data;
    },
    fill,
    setAction,
    setRouteParams,
    setDisabled,
    setFieldErrors(nextFieldErrors = {}, focusFirst = true) {
      fieldErrors = { ...nextFieldErrors };
      syncErrorsToDom(focusFirst);
      notifyStateChange();
    },
    setFormError(message) {
      formError = message ? String(message) : null;
      syncErrorsToDom(false);
      notifyStateChange();
    },
    clearErrors() {
      fieldErrors = {};
      formError = null;
      syncErrorsToDom(false);
      notifyStateChange();
    },
    reset,
    clear,
    submit,
    onSuccess(fn) {
      if (typeof fn === 'function') {
        successListeners.add(fn);
        return () => successListeners.delete(fn);
      }
      return () => {};
    },
    onError(fn) {
      if (typeof fn === 'function') {
        errorListeners.add(fn);
        return () => errorListeners.delete(fn);
      }
      return () => {};
    },
    subscribe(fn) {
      if (typeof fn === 'function') {
        stateListeners.add(fn);
        return () => stateListeners.delete(fn);
      }
      return () => {};
    },
    destroy() {
      if (formEl && typeof formEl.removeEventListener === 'function') {
        formEl.removeEventListener('input', onDomInput);
        formEl.removeEventListener('change', onDomInput);
        formEl.removeEventListener('submit', onDomSubmit);
        formEl.removeEventListener('reset', onDomReset);
      }
      if (formEl) {
        delete formEl.__wFormHandle;
      }
      successListeners.clear();
      errorListeners.clear();
      stateListeners.clear();
    },
  };

  if (formEl) {
    Object.defineProperty(formEl, '__wFormHandle', {
      value: handle,
      configurable: true,
      enumerable: false,
    });
  }

  if (debug) {
    debug.recordEvent('form:bind', { name: formName });
  }

  return handle;
}

module.exports = {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
};

