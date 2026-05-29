/**
 * Build manifest helpers for email plugin
 * @module plugins/email/manifest
 */

/**
 * @param {object} manifest
 * @returns {{ templates: Record<string, { mjml?: string, html?: string }>, emailTemplates: Record<string, object> }}
 */
function emailPluginOptionsFromManifest(manifest) {
  const chunks = manifest?.emailTemplates || {};
  /** @type {Record<string, { mjml?: string, html?: string }>} */
  const templates = {};

  for (const [id, chunk] of Object.entries(chunks)) {
    if (chunk?.mjml) templates[id] = { mjml: chunk.mjml };
    else if (chunk?.html) templates[id] = { html: chunk.html };
  }

  return { templates, emailTemplates: chunks };
}

module.exports = {
  emailPluginOptionsFromManifest,
};
