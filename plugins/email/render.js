/**
 * MJML / HTML rendering with {{var}} interpolation
 * @module plugins/email/render
 */

const fsEnv = require('./fs-env');

let mjml2html;
try {
  mjml2html = require('mjml');
} catch {
  mjml2html = null;
}

/**
 * Resolve dot-path on data object
 * @param {Object} data
 * @param {string} keyPath
 * @returns {*}
 */
function getNestedValue(data, keyPath) {
  if (!data || !keyPath) return '';
  const parts = keyPath.split('.');
  let cur = data;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return '';
    cur = cur[p];
  }
  if (cur == null) return '';
  return String(cur);
}

/**
 * Replace {{key}} and {{a.b}} placeholders
 * @param {string} source
 * @param {Object} [data={}]
 * @returns {string}
 */
function interpolate(source, data = {}) {
  if (!source) return '';
  return String(source).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => getNestedValue(data, key));
}

/**
 * Read file if path exists (Node.js only)
 * @param {string} filePath
 * @returns {string|null}
 */
function readFileIfExists(filePath) {
  return fsEnv.readFileUtf8(filePath);
}

/**
 * Normalize template source to { mjml?, html?, text? }
 * @param {string|Object} source
 * @returns {{ mjml?: string, html?: string, text?: string }}
 */
function normalizeSource(source) {
  if (typeof source === 'string') {
    if (fsEnv.isInlineMarkup(source)) {
      const trimmed = source.trim();
      if (trimmed.startsWith('<mjml')) {
        return { mjml: source };
      }
      return { html: source };
    }

    if (fsEnv.looksLikeFilePath(source)) {
      const content = fsEnv.readFileUtf8(source);
      if (content == null) {
        if (!fsEnv.isFilesystemAvailable()) {
          throw new Error(
            `Template path "${source}" requires Node.js filesystem (unavailable on edge runtimes). ` +
            'Use inline { mjml: "..." }, registerTemplate(id, { mjml }), or pass MJML/HTML strings directly.'
          );
        }
        throw new Error(`Template file not found: ${source}`);
      }
      if (source.endsWith('.mjml')) {
        return { mjml: content };
      }
      return { html: content };
    }

    return { html: source };
  }

  if (source && typeof source === 'object') {
    if (source.path) {
      return normalizeSource(source.path);
    }
    if (source.mjml) {
      return { mjml: source.mjml };
    }
    if (source.html) {
      return { html: source.html };
    }
    if (source.text) {
      return { text: source.text };
    }
  }

  throw new Error('Invalid template source');
}

/**
 * Compile MJML to HTML
 * @param {string} mjmlSource
 * @returns {Promise<{ html: string, errors: Array }>}
 */
async function compileMjml(mjmlSource) {
  if (!mjml2html) {
    throw new Error('mjml is required for MJML templates. Install it with: npm install mjml');
  }
  const result = await mjml2html(mjmlSource, { validationLevel: 'soft' });
  return {
    html: result.html,
    errors: result.errors || [],
  };
}

/**
 * Render template source with data
 * @param {string|Object} source
 * @param {Object} [data={}]
 * @returns {Promise<{ html?: string, text?: string, errors?: Array }>}
 */
async function renderSource(source, data = {}) {
  const normalized = normalizeSource(source);

  if (normalized.mjml) {
    const interpolated = interpolate(normalized.mjml, data);
    const { html, errors } = await compileMjml(interpolated);
    return { html, errors };
  }

  if (normalized.html) {
    return { html: interpolate(normalized.html, data) };
  }

  if (normalized.text) {
    return { text: interpolate(normalized.text, data) };
  }

  return {};
}

module.exports = {
  interpolate,
  normalizeSource,
  compileMjml,
  renderSource,
  readFileIfExists,
};
