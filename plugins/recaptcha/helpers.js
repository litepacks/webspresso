/**
 * Nunjucks-safe HTML snippets for reCAPTCHA widgets
 * @module plugins/recaptcha/helpers
 */

/**
 * Load api.js (required for v2 checkbox and v3)
 * @param {string} [render] - v3: site key; omit for v2 implicit
 * @returns {string}
 */
function recaptchaScriptTag(render) {
  let src = 'https://www.google.com/recaptcha/api.js';
  if (render) {
    src += `?render=${encodeURIComponent(render)}`;
  }
  return `<script async defer src="${src}"></script>`;
}

/**
 * v2 checkbox container
 * @param {Object} opts
 * @param {string} opts.siteKey
 * @param {string} [opts.theme] - light | dark
 * @param {string} [opts.size] - normal | compact
 * @param {string|number} [opts.tabindex]
 * @returns {string}
 */
function recaptchaV2WidgetHtml(opts = {}) {
  const { siteKey, theme = 'light', size = 'normal', tabindex } = opts;
  if (!siteKey) {
    return '<!-- recaptcha: missing siteKey -->';
  }
  let attrs = `class="g-recaptcha" data-sitekey="${escapeHtml(siteKey)}" data-theme="${escapeHtml(theme)}" data-size="${escapeHtml(size)}"`;
  if (tabindex != null) {
    attrs += ` data-tabindex="${escapeHtml(String(tabindex))}"`;
  }
  return `<div ${attrs}></div>`;
}

/**
 * Hidden input + inline script to obtain v3 token (call after recaptchaScriptTag(siteKey))
 * @param {Object} opts
 * @param {string} opts.siteKey
 * @param {string} opts.action
 * @param {string} [opts.inputId=recaptcha-token]
 * @param {string} [opts.inputName=g-recaptcha-response]
 * @returns {string}
 */
function recaptchaV3ExecuteScript(opts = {}) {
  const { siteKey, action, inputId = 'recaptcha-token', inputName = 'g-recaptcha-response' } = opts;
  if (!siteKey || !action) {
    return '<!-- recaptcha v3: siteKey and action required -->';
  }
  const id = escapeHtml(inputId);
  const name = escapeHtml(inputName);
  const hidden = `<input type="hidden" name="${name}" id="${id}" value="">`;
  const script = [
    '<script>',
    '(function(){',
    "function setToken(t){var el=document.getElementById('" + id + "');if(el)el.value=t;}",
    'function run(){',
    "if(!window.grecaptcha||!grecaptcha.execute){setTimeout(run,100);return;}",
    'grecaptcha.ready(function(){',
    "grecaptcha.execute('" + escapeJsInline(siteKey) + "',{action:'" + escapeJsInline(action) + "'})",
    '.then(setToken).catch(function(){});',
    '});',
    '}',
    'run();',
    '})();',
    '</script>',
  ].join('');
  return hidden + script;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeJsInline(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

module.exports = {
  recaptchaScriptTag,
  recaptchaV2WidgetHtml,
  recaptchaV3ExecuteScript,
};
