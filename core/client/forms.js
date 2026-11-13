'use strict';

const { defaultStorage } = require('./storage');
const { isArray, setElementBusyState } = require('./utils');

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

/**
 * Validate that a redirect URL uses a safe protocol (http/https) or relative path
 * to prevent DOM-based XSS (e.g. javascript: URIs) and protocol injection.
 *
 * @param {string} target
 * @returns {boolean}
 */
function resolveSafeRedirectUrl(target) {
  if (!target || typeof target !== 'string') return null;
  const trimmed = target.trim();
  if (!trimmed) return null;

  // Block control characters
  if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) return null;

  // Block protocol-relative URLs (//example.com) and backslash traversal (/\ or \\)
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.startsWith('\\')) {
    return null;
  }

  // Relative path starting with single slash (e.g. /dashboard)
  if (trimmed.startsWith('/')) {
    try {
      const parsed = new URL(trimmed, 'http://localhost');
      if (parsed.origin !== 'http://localhost' || !parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) {
        return null;
      }
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }

  // Absolute URL: MUST explicitly parse as http: or https:
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function isSafeRedirectUrl(target) {
  return resolveSafeRedirectUrl(target) !== null;
}

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
      if (!isArray(data[normName])) {
        data[normName] = [];
      }
      data[normName].push(val);
    } else if (normName in data) {
      if (!isArray(data[normName])) {
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
      if (isArray(val)) {
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
    if (options.services && typeof formEl.__wFormHandle.__setServices === 'function') {
      formEl.__wFormHandle.__setServices(options.services);
    }
    return formEl.__wFormHandle;
  }

  const api = options.api;
  const debug = options.debug || null;
  let services = options.services || null;
  const formName =
    (formEl && formEl.getAttribute && formEl.getAttribute('data-w-form')) ||
    (formEl && formEl.getAttribute && formEl.getAttribute('name')) ||
    'form';

  let initialSnapshot = captureInitialFormSnapshot(formEl);
  let baselineValues = parseFormElement(formEl).data;
  let pending = false;
  let dirty = false;
  let submitted = false;
  let inputRevision = 0;
  let fieldErrors = {};
  let formError = null;
  let lastError = null;
  let lastData = null;
  let draftDebounceTimer = null;
  let resetTimer = null;

  const touchedFields = new Set();
  const errorDisplayMode =
    options.errorDisplay === 'touched' ||
    (formEl && formEl.getAttribute && formEl.getAttribute('data-w-error-mode') === 'touched')
      ? 'touched'
      : 'always';

  const validationSeqByField = new Map();
  const validationTimersByField = new Map();
  const validationAbortByField = new Map();

  let activeSubmitAbort = null;
  let uploadEntries = [];
  const previewUrlsByField = new Map();

  function cancelFieldValidation(fieldName) {
    if (fieldName) {
      const t = validationTimersByField.get(fieldName);
      if (t) {
        clearTimeout(t);
        validationTimersByField.delete(fieldName);
      }
      const ac = validationAbortByField.get(fieldName);
      if (ac) {
        try {
          ac.abort();
        } catch (_e) {}
        validationAbortByField.delete(fieldName);
      }
      return;
    }
    for (const t of validationTimersByField.values()) clearTimeout(t);
    validationTimersByField.clear();
    for (const ac of validationAbortByField.values()) {
      try {
        ac.abort();
      } catch (_e) {}
    }
    validationAbortByField.clear();
  }

  function revokePreviewUrls(fieldName) {
    const revokeUrl = (u) => {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(u);
        } catch (_e) {}
      }
    };
    if (fieldName) {
      const set = previewUrlsByField.get(fieldName);
      if (set) {
        for (const u of set) revokeUrl(u);
        set.clear();
        previewUrlsByField.delete(fieldName);
      }
      return;
    }
    for (const set of previewUrlsByField.values()) {
      for (const u of set) revokeUrl(u);
      set.clear();
    }
    previewUrlsByField.clear();
  }

  function createPreviewUrl(file, fieldName = '_default') {
    if (!file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    const url = URL.createObjectURL(file);
    let set = previewUrlsByField.get(fieldName);
    if (!set) {
      set = new Set();
      previewUrlsByField.set(fieldName, set);
    }
    set.add(url);
    return url;
  }

  const beforeSubmitListeners = new Set();
  const successListeners = new Set();
  const errorListeners = new Set();
  const stateListeners = new Set();

  function cancelDraftDebounce() {
    if (draftDebounceTimer) {
      clearTimeout(draftDebounceTimer);
      draftDebounceTimer = null;
    }
  }

  // Form draft persistence setup (sessionStorage by default, or localStorage)
  const rawDraftAttr = formEl
    ? formEl.getAttribute('data-w-persist-draft') || formEl.getAttribute('data-w-draft')
    : null;
  const isDraftEnabled =
    options.persistDraft !== undefined
      ? Boolean(options.persistDraft)
      : rawDraftAttr !== null && rawDraftAttr !== 'false';

  let draftStorageType = 'session';
  if (typeof options.persistDraft === 'string') {
    draftStorageType = options.persistDraft.toLowerCase() === 'local' ? 'local' : 'session';
  } else if (rawDraftAttr && rawDraftAttr.toLowerCase() === 'local') {
    draftStorageType = 'local';
  }

  const draftScope =
    options.draftScope ||
    (formEl && formEl.getAttribute && formEl.getAttribute('data-w-draft-scope')) ||
    '';

  const baseDraftKey =
    options.draftKey ||
    (formEl && (formEl.getAttribute('data-w-draft-key') || formEl.getAttribute('data-w-persist-key'))) ||
    `form_draft:${formName || 'anon'}`;

  let draftKey = draftScope ? `${baseDraftKey}:${draftScope}` : baseDraftKey;

  const draftStorage =
    (options.storage && options.storage[draftStorageType]) ||
    (draftStorageType === 'local' ? defaultStorage.local : defaultStorage.session);

  function extractDraftValues(el) {
    if (!el || typeof el.querySelectorAll !== 'function') return {};
    const { data } = parseFormElement(el);
    const safeData = {};
    for (const [key, val] of Object.entries(data)) {
      const ctrl = el.querySelector(`[name="${key}"], [name="${key}[]"]`);
      if (!ctrl) {
        safeData[key] = val;
        continue;
      }
      const type = (ctrl.type || '').toLowerCase();
      if (type === 'password' || type === 'file') continue;
      if (ctrl.hasAttribute('data-w-no-draft') || ctrl.getAttribute('data-w-persist') === 'false') continue;
      safeData[key] = val;
    }
    return safeData;
  }

  function sanitizeDraftObject(raw) {
    if (!raw || typeof raw !== 'object' || isArray(raw)) return null;
    const clean = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        clean[k] = v;
      } else if (isArray(v) && v.every((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
        clean[k] = v;
      }
    }
    return Object.keys(clean).length > 0 ? clean : null;
  }

  function saveDraft() {
    cancelDraftDebounce();
    if (!formEl || !isDraftEnabled) return false;
    const draftPayload = extractDraftValues(formEl);
    return draftStorage.set(draftKey, draftPayload);
  }

  function restoreDraft() {
    if (!formEl || !isDraftEnabled) return false;
    let saved = null;
    try {
      saved = draftStorage.get(draftKey, null);
    } catch (_e) {
      saved = null;
    }
    const cleanDraft = sanitizeDraftObject(saved);
    if (cleanDraft) {
      fill(cleanDraft, { baseline: false });
      if (typeof formEl.dispatchEvent === 'function') {
        const CustomEventCtor =
          (formEl.ownerDocument && formEl.ownerDocument.defaultView && formEl.ownerDocument.defaultView.CustomEvent) ||
          (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
        if (CustomEventCtor) {
          formEl.dispatchEvent(
            new CustomEventCtor('w-form:draft-restored', {
              bubbles: true,
              cancelable: true,
              detail: { form: handle, draft: cleanDraft, key: draftKey },
            })
          );
        }
      }
      return true;
    }
    return false;
  }

  function clearDraft() {
    cancelDraftDebounce();
    if (!isDraftEnabled) return false;
    return draftStorage.remove(draftKey);
  }

  function hasDraft() {
    if (!isDraftEnabled) return false;
    return draftStorage.has(draftKey);
  }

  function setDraftKey(nextKey, keyOpts = {}) {
    cancelDraftDebounce();
    if (typeof nextKey === 'string' && nextKey.trim()) {
      draftKey = nextKey.trim();
      if (formEl && typeof formEl.setAttribute === 'function') {
        formEl.setAttribute('data-w-draft-key', draftKey);
      }
      if (keyOpts && keyOpts.restore === true && isDraftEnabled) {
        restoreDraft();
      }
    }
    return handle;
  }

  function notifyStateChange() {
    for (const fn of stateListeners) {
      try {
        fn(handle);
      } catch (_e) {
        // Ignore
      }
    }
  }

  function isFieldErrorVisible(fieldName) {
    if (errorDisplayMode !== 'touched') return true;
    if (submitted) return true;
    return touchedFields.has(fieldName);
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
      const normName = fieldName && fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;
      const rawMsg = fieldName && (fieldErrors[fieldName] || (normName && fieldErrors[normName]))
        ? String(fieldErrors[fieldName] || fieldErrors[normName])
        : '';
      const msg = rawMsg && (isFieldErrorVisible(fieldName) || (normName && isFieldErrorVisible(normName))) ? rawMsg : '';
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
      const rawErrMsg = fieldErrors[normName] || fieldErrors[rawName];
      const errMsg = rawErrMsg && (isFieldErrorVisible(normName) || isFieldErrorVisible(rawName)) ? rawErrMsg : '';

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
    const next = Boolean(nextPending);
    if (pending === next) return;
    pending = next;
    if (!formEl) return;

    if (pending) {
      formEl.setAttribute('aria-busy', 'true');
      formEl.setAttribute('data-w-pending', 'true');
      formEl.setAttribute('data-w-busy', 'true');
    } else {
      formEl.removeAttribute('aria-busy');
      formEl.removeAttribute('data-w-pending');
      formEl.removeAttribute('data-w-busy');
    }

    const submitButtons = formEl.querySelectorAll
      ? formEl.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]')
      : [];
    let submitterHandled = false;
    for (let i = 0; i < submitButtons.length; i++) {
      const btn = submitButtons[i];
      if (btn === activeSubmitter) submitterHandled = true;
      setElementBusyState(btn, pending);
    }
    if (activeSubmitter && !submitterHandled) {
      setElementBusyState(activeSubmitter, pending);
    }
    notifyStateChange();
  }

  /**
   * Reset form controls back to their initial default values (NOT emptying non-empty defaults).
   */
  function reset() {
    cancelDraftDebounce();
    cancelFieldValidation();
    revokePreviewUrls();
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
    submitted = false;
    touchedFields.clear();
    fieldErrors = {};
    formError = null;
    syncErrorsToDom(false);
    notifyStateChange();
  }

  /**
   * Completely clear all user-editable controls to empty values (distinct from `reset()`).
   */
  function clear() {
    cancelDraftDebounce();
    cancelFieldValidation();
    revokePreviewUrls();
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
    submitted = false;
    touchedFields.clear();
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
    if (!formEl || typeof formEl.querySelectorAll !== 'function' || !values || typeof values !== 'object' || isArray(values)) {
      return handle;
    }

    const isBaseline = Boolean(options.baseline);
    if (isBaseline) {
      cancelDraftDebounce();
    }

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
          if (isArray(val)) {
            ctrl.checked = val.map(String).includes(String(ctrl.value));
          } else {
            ctrl.checked = Boolean(val);
          }
        } else if (type === 'radio') {
          ctrl.checked = String(val) === String(ctrl.value);
        } else if (ctrl.tagName === 'SELECT') {
          if (ctrl.multiple) {
            const arr = isArray(val) ? val.map(String) : [String(val)];
            const opts = ctrl.options || [];
            for (let j = 0; j < opts.length; j++) {
              opts[j].selected = arr.includes(String(opts[j].value));
            }
          } else {
            ctrl.value = val === null || val === undefined ? '' : String(val);
          }
        } else {
          if (val !== null && typeof val === 'object') continue;
          ctrl.value = val === null || val === undefined ? '' : String(val);
        }

        // Clear error for this field
        delete fieldErrors[normKey];
        delete fieldErrors[key];
      }
    }

    if (isBaseline) {
      cancelFieldValidation();
      initialSnapshot = captureInitialFormSnapshot(formEl);
      baselineValues = parseFormElement(formEl).data;
      dirty = false;
      submitted = false;
      touchedFields.clear();
      fieldErrors = {};
      formError = null;
      lastError = null;
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
      const nextAction = String(url);
      formEl.setAttribute('action', nextAction);
      formEl.__wCustomAction = nextAction;
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
    formEl.__wCustomAction = action;
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

    // Execute beforeSubmit hooks before initiating network request
    for (const guardFn of beforeSubmitListeners) {
      let allowed = true;
      try {
        allowed = await guardFn(payloadData, { form: handle, submitter, action: actionUrl, method });
      } catch (guardErr) {
        return { ok: false, submitted: false, canceled: true, reason: 'before-submit-error', error: guardErr };
      }
      if (allowed === false) {
        return { ok: false, submitted: false, canceled: true, reason: 'before-submit' };
      }
    }

    // Clear previous errors before request starts, mark submitted = true
    cancelFieldValidation();
    submitted = true;
    fieldErrors = {};
    formError = null;
    lastError = null;
    syncErrorsToDom(false);
    const submitRevision = inputRevision;
    const submittedSnapshot = captureInitialFormSnapshot(formEl);
    setPendingState(true, submitter);

    // Track per-file upload state if multipart
    const submitAbortController = new AbortController();
    activeSubmitAbort = submitAbortController;
    if (isMultipart && formEl && typeof formEl.querySelectorAll === 'function') {
      const nextUploads = [];
      const fileInputs = formEl.querySelectorAll('input[type="file"]');
      for (let i = 0; i < fileInputs.length; i++) {
        const fi = fileInputs[i];
        const fName = fi.getAttribute('name') || 'file';
        const files = fi.files || [];
        for (let j = 0; j < files.length; j++) {
          const f = files[j];
          nextUploads.push({
            field: fName,
            name: f.name || 'file',
            size: typeof f.size === 'number' ? f.size : 0,
            status: 'uploading',
            loaded: 0,
            total: typeof f.size === 'number' ? f.size : 0,
            percent: null,
            error: null,
          });
        }
      }
      uploadEntries = nextUploads;
      if (uploadEntries.length > 0) notifyStateChange();
    } else {
      uploadEntries = [];
    }

    try {
      let responseData;
      const reqKey = `form:${formName}:${method}:${actionUrl}`;
      if (method === 'GET') {
        responseData = await api.get(actionUrl, payloadData, {
          key: reqKey,
          policy: 'latest',
          signal: submitAbortController.signal,
        });
      } else {
        const bodyToSend = isMultipart && formData ? formData : payloadData;
        const reqOpts = {
          key: reqKey,
          policy: 'drop',
          signal: submitAbortController.signal,
        };
        if (isMultipart && uploadEntries.length > 0) {
          reqOpts.onUploadProgress = (prog) => {
            for (let i = 0; i < uploadEntries.length; i++) {
              uploadEntries[i].loaded = prog.loaded;
              uploadEntries[i].total = prog.total || uploadEntries[i].total;
              uploadEntries[i].percent = prog.percent;
            }
            if (typeof submitOptions.onUploadProgress === 'function') {
              submitOptions.onUploadProgress(prog, uploadEntries);
            }
            notifyStateChange();
          };
        }
        responseData = await api.request(method, actionUrl, bodyToSend, reqOpts);
      }

      if (uploadEntries.length > 0) {
        for (let i = 0; i < uploadEntries.length; i++) {
          uploadEntries[i].status = 'done';
          if (uploadEntries[i].percent !== null) uploadEntries[i].percent = 100;
        }
      }

      lastData = responseData;
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

      const editedDuringSubmit = inputRevision !== submitRevision;

      if (!editedDuringSubmit) {
        dirty = false;
        if (shouldClear) {
          clear();
        } else if (shouldReset) {
          reset();
        } else {
          // Current state becomes the new clean baseline after successful save
          initialSnapshot = captureInitialFormSnapshot(formEl);
          baselineValues = parseFormElement(formEl).data;
        }

        if (isDraftEnabled) {
          clearDraft();
        }
      } else {
        // User edited form controls while submit was in flight:
        // Never wipe out the new unsubmitted edits via reset() or clear().
        // Update baseline to what was actually committed on the server (or empty baseline if clearOnSuccess).
        if (shouldClear) {
          const clearedSnapshot = new Map();
          for (const [ctrl, snap] of submittedSnapshot.entries()) {
            clearedSnapshot.set(ctrl, {
              ...snap,
              checked: false,
              value: '',
              selectedValues: [],
            });
          }
          initialSnapshot = clearedSnapshot;
          baselineValues = {};
        } else if (!shouldReset) {
          initialSnapshot = submittedSnapshot;
          baselineValues = payloadData && typeof payloadData === 'object' ? { ...payloadData } : {};
        }
        dirty = computeFormDirty(formEl, initialSnapshot);
        if (isDraftEnabled) {
          if (dirty) {
            saveDraft();
          } else {
            clearDraft();
          }
        }
      }

      // Invoke registered success hooks. Note: Any background fragment refresh failure
      // or side-effect service error in onSuccess NEVER puts a succeeded form into validation error
      // state or makes the completed mutation appear rolled back!
      let hookError = null;
      for (const listener of successListeners) {
        try {
          await listener(responseData, { values: payloadData, form: handle, services });
        } catch (listenerErr) {
          if (!hookError) hookError = listenerErr;
          if (debug && typeof debug.trackCleanupError === 'function') {
            debug.trackCleanupError(`form_${formName}`, formName, 'form:onSuccess', listenerErr);
          }
        }
      }

      // Explicit redirect behavior
      const rawRedirectTarget =
        submitOptions.redirectOnSuccess ||
        (formEl && formEl.getAttribute('data-w-redirect')) ||
        null;
      const redirectTarget = resolveSafeRedirectUrl(rawRedirectTarget);
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

      return { ok: true, submitted: true, data: responseData, refreshOk, refreshError, hookError };
    } catch (err) {
      lastError = err || null;
      if (uploadEntries.length > 0) {
        const isCanceled = Boolean(err && err.isCanceled);
        for (let i = 0; i < uploadEntries.length; i++) {
          if (uploadEntries[i].status === 'uploading') {
            uploadEntries[i].status = isCanceled ? 'canceled' : 'error';
            uploadEntries[i].error = isCanceled ? null : (err && err.message ? err.message : 'Upload failed');
          }
        }
      }
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
          await listener(err, { values: payloadData, form: handle, services });
        } catch (_e) {
          // Ignore
        }
      }

      if (submitOptions.throwOnError) {
        throw err;
      }
      return {
        ok: false,
        submitted: false,
        outcomeUnknown: Boolean(err && err.outcomeUnknown),
        outcome: (err && err.outcome) || 'failed',
        error: err,
      };
    } finally {
      if (activeSubmitAbort === submitAbortController) {
        activeSubmitAbort = null;
      }
      setPendingState(false, submitter);
    }
  }

  function parseFieldValidateConfig(ctrl) {
    const ctrlAttr = ctrl && ctrl.getAttribute ? ctrl.getAttribute('data-w-validate') : null;
    const formAttr = formEl && formEl.getAttribute ? formEl.getAttribute('data-w-validate') : null;
    const raw = ctrlAttr !== null ? ctrlAttr : formAttr;
    if (!raw || raw === 'false') return null;
    const parts = String(raw).split(/[\s,|]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const onBlur = parts.includes('blur') || parts.includes('true') || raw === '';
    let debounceMs = null;
    for (const p of parts) {
      if (p.startsWith('debounce:')) {
        const ms = Number(p.slice('debounce:'.length).replace(/ms$/i, ''));
        debounceMs = Number.isFinite(ms) && ms >= 0 ? ms : 300;
      } else if (p === 'debounce') {
        debounceMs = 300;
      }
    }
    return { onBlur, debounceMs };
  }

  async function validateField(fieldName, vOpts = {}) {
    if (!formEl || !api || !fieldName) return { ok: true, valid: true, errors: {} };
    const norm = fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;

    const seq = (validationSeqByField.get(norm) || 0) + 1;
    validationSeqByField.set(norm, seq);

    const prevAbort = validationAbortByField.get(norm);
    if (prevAbort) {
      try {
        prevAbort.abort();
      } catch (_e) {}
    }
    const ac = new AbortController();
    validationAbortByField.set(norm, ac);

    const validateUrl =
      vOpts.url ||
      (formEl.getAttribute && (formEl.getAttribute('data-w-validate-url') || formEl.getAttribute('action'))) ||
      (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
    const method = String(vOpts.method || (formEl.getAttribute && formEl.getAttribute('method')) || 'POST').toUpperCase();

    const { data: allValues } = parseFormElement(formEl);
    const ctrl = formEl.querySelector ? (formEl.querySelector(`[name="${norm}"]`) || formEl.querySelector(`[name="${fieldName}"]`)) : null;
    const contextAttr = ctrl && ctrl.getAttribute ? ctrl.getAttribute('data-w-validate-context') : null;

    let payload = { [norm]: allValues[norm] };
    if (vOpts.contextFields === '*' || contextAttr === '*') {
      payload = { ...allValues };
    } else {
      const ctxList = isArray(vOpts.contextFields)
        ? vOpts.contextFields
        : typeof contextAttr === 'string' && contextAttr.trim()
          ? contextAttr.split(',').map((s) => s.trim()).filter(Boolean)
          : [];
      for (const cf of ctxList) {
        if (Object.prototype.hasOwnProperty.call(allValues, cf)) {
          payload[cf] = allValues[cf];
        }
      }
    }

    try {
      const resp = await api.request(method, validateUrl, payload, {
        headers: { 'X-Webspresso-Validate-Fields': norm },
        signal: ac.signal,
      });

      if (seq !== validationSeqByField.get(norm)) {
        return { ok: true, stale: true, valid: true, errors: {} };
      }

      const respErrors = resp && resp.errors && typeof resp.errors === 'object' ? resp.errors : {};
      if (respErrors[norm]) {
        fieldErrors[norm] = String(respErrors[norm]);
      } else {
        delete fieldErrors[norm];
      }
      syncErrorsToDom(false);
      notifyStateChange();
      return {
        ok: true,
        valid: !fieldErrors[norm],
        errors: fieldErrors[norm] ? { [norm]: fieldErrors[norm] } : {},
      };
    } catch (err) {
      if (seq !== validationSeqByField.get(norm) || (err && err.isCanceled)) {
        return { ok: true, stale: true, canceled: Boolean(err && err.isCanceled), errors: {} };
      }
      // If server returned a 400/422 validation envelope, extract only this field's error
      if (err && err.kind === 'validation' && err.fieldErrors) {
        if (err.fieldErrors[norm]) {
          fieldErrors[norm] = String(err.fieldErrors[norm]);
        } else {
          delete fieldErrors[norm];
        }
        syncErrorsToDom(false);
        notifyStateChange();
        return { ok: true, valid: !fieldErrors[norm], errors: fieldErrors[norm] ? { [norm]: fieldErrors[norm] } : {} };
      }
      // Network or 5xx error: NEVER mark the field as invalid!
      if (typeof formEl.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
        formEl.dispatchEvent(
          new CustomEvent('w-form:validation-error', {
            bubbles: true,
            detail: { field: norm, error: err },
          })
        );
      }
      return { ok: false, networkError: true, error: err };
    } finally {
      if (validationAbortByField.get(norm) === ac) {
        validationAbortByField.delete(norm);
      }
    }
  }

  function cancelUpload() {
    if (activeSubmitAbort) {
      try {
        activeSubmitAbort.abort();
      } catch (_e) {}
      activeSubmitAbort = null;
      return true;
    }
    return false;
  }

  // Listen to native submit, focusout, and input/change events on `formEl`
  const onDomInput = (evt) => {
    inputRevision += 1;
    dirty = computeFormDirty(formEl, initialSnapshot);
    const target = evt && evt.target;
    if (target && target.getAttribute) {
      const type = (target.type || '').toLowerCase();
      const rawName = target.getAttribute('name');
      if (type === 'file' && evt.type === 'change' && rawName) {
        revokePreviewUrls(rawName);
      }
      if (rawName) {
        const norm = rawName.endsWith('[]') ? rawName.slice(0, -2) : rawName;
        if (evt.type === 'change' && (type === 'checkbox' || type === 'radio' || target.tagName === 'SELECT')) {
          touchedFields.add(norm);
        }
        if (fieldErrors[norm] || fieldErrors[rawName]) {
          delete fieldErrors[norm];
          delete fieldErrors[rawName];
          syncErrorsToDom(false);
        }
        if (evt.type === 'input') {
          const vCfg = parseFieldValidateConfig(target);
          if (vCfg && vCfg.debounceMs !== null) {
            const prevTimer = validationTimersByField.get(norm);
            if (prevTimer) clearTimeout(prevTimer);
            const t = setTimeout(() => {
              validationTimersByField.delete(norm);
              validateField(norm).catch(() => {});
            }, vCfg.debounceMs);
            validationTimersByField.set(norm, t);
          }
        }
      }
    }
    if (isDraftEnabled) {
      cancelDraftDebounce();
      draftDebounceTimer = setTimeout(() => {
        draftDebounceTimer = null;
        saveDraft();
      }, 150);
    }
    notifyStateChange();
  };

  const onDomFocusOut = (evt) => {
    const target = evt && evt.target;
    if (!target || !target.getAttribute) return;
    const rawName = target.getAttribute('name');
    if (!rawName) return;
    const type = (target.type || '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'hidden') return;
    const norm = rawName.endsWith('[]') ? rawName.slice(0, -2) : rawName;
    const wasTouched = touchedFields.has(norm);
    touchedFields.add(norm);
    if (!wasTouched) {
      syncErrorsToDom(false);
      notifyStateChange();
    }
    const vCfg = parseFieldValidateConfig(target);
    if (vCfg && vCfg.onBlur) {
      validateField(norm).catch(() => {});
    }
  };

  const onDomSubmit = (evt) => {
    submit(evt);
  };

  const onDomReset = () => {
    cancelDraftDebounce();
    cancelFieldValidation();
    revokePreviewUrls();
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      resetTimer = null;
      dirty = false;
      submitted = false;
      touchedFields.clear();
      fieldErrors = {};
      formError = null;
      syncErrorsToDom(false);
      notifyStateChange();
    }, 0);
  };

  if (formEl && typeof formEl.addEventListener === 'function') {
    formEl.addEventListener('input', onDomInput);
    formEl.addEventListener('change', onDomInput);
    formEl.addEventListener('focusout', onDomFocusOut);
    formEl.addEventListener('submit', onDomSubmit);
    formEl.addEventListener('reset', onDomReset);
  }

  // Initialize hidden state on empty error placeholders
  syncErrorsToDom(false);

  let handle = null;

  handle = {
    name: formName,
    el: formEl,
    get services() {
      return services;
    },
    __setServices(nextServices) {
      if (nextServices) services = nextServices;
    },
    get pending() {
      return pending;
    },
    get dirty() {
      dirty = computeFormDirty(formEl, initialSnapshot);
      return dirty;
    },
    get touched() {
      return touchedFields.size > 0;
    },
    get touchedFields() {
      return Array.from(touchedFields);
    },
    get submitted() {
      return submitted;
    },
    isTouched(fieldName) {
      if (!fieldName) return touchedFields.size > 0;
      const norm = fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;
      return touchedFields.has(norm) || touchedFields.has(fieldName);
    },
    touch(fieldName) {
      if (fieldName) {
        const norm = fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;
        touchedFields.add(norm);
      } else if (formEl && typeof formEl.querySelectorAll === 'function') {
        const controls = formEl.querySelectorAll('input, select, textarea');
        for (let i = 0; i < controls.length; i++) {
          const n = controls[i].getAttribute && controls[i].getAttribute('name');
          if (n) touchedFields.add(n.endsWith('[]') ? n.slice(0, -2) : n);
        }
      }
      syncErrorsToDom(false);
      notifyStateChange();
      return handle;
    },
    untouch(fieldName) {
      if (fieldName) {
        const norm = fieldName.endsWith('[]') ? fieldName.slice(0, -2) : fieldName;
        touchedFields.delete(norm);
        touchedFields.delete(fieldName);
      } else {
        touchedFields.clear();
      }
      syncErrorsToDom(false);
      notifyStateChange();
      return handle;
    },
    validateField,
    get uploads() {
      return uploadEntries.map((u) => ({ ...u }));
    },
    cancelUpload,
    createPreviewUrl,
    revokePreviewUrls,
    get inputRevision() {
      return inputRevision;
    },
    get draftKey() {
      return draftKey;
    },
    get values() {
      return parseFormElement(formEl).data;
    },
    get baseline() {
      return { ...(baselineValues || {}) };
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
    get lastError() {
      return lastError;
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
    saveDraft,
    restoreDraft,
    clearDraft,
    setDraftKey,
    get hasDraft() {
      return hasDraft();
    },
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
      lastError = null;
      syncErrorsToDom(false);
      notifyStateChange();
    },
    reset,
    clear,
    submit,
    beforeSubmit(fn) {
      if (typeof fn === 'function') {
        beforeSubmitListeners.add(fn);
        return () => beforeSubmitListeners.delete(fn);
      }
      return () => {};
    },
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
      cancelDraftDebounce();
      cancelFieldValidation();
      cancelUpload();
      revokePreviewUrls();
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      if (formEl && typeof formEl.removeEventListener === 'function') {
        formEl.removeEventListener('input', onDomInput);
        formEl.removeEventListener('change', onDomInput);
        formEl.removeEventListener('focusout', onDomFocusOut);
        formEl.removeEventListener('submit', onDomSubmit);
        formEl.removeEventListener('reset', onDomReset);
      }
      if (formEl) {
        delete formEl.__wFormHandle;
      }
      beforeSubmitListeners.clear();
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

  if (isDraftEnabled) {
    restoreDraft();
  }

  return handle;
}

module.exports = {
  parseFormElement,
  isControlDisabled,
  coerceScalarControlValue,
  createFormHandle,
  isSafeRedirectUrl,
};

