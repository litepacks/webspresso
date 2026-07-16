/**
 * Email template registry — inline, config map, optional Node.js directory scan
 * @module plugins/email/template-registry
 */

const path = require('path');
const fsEnv = require('./fs-env');

/**
 * @typedef {Object} TemplateEntry
 * @property {string} id
 * @property {'inline'|'path'} kind
 * @property {string|Object} source
 */

class TemplateRegistry {
  constructor() {
    /** @type {Map<string, TemplateEntry>} */
    this._templates = new Map();
  }

  /**
   * Load *.mjml files from directory (Node.js only; no-op on edge)
   * @param {string} dir
   * @returns {number} Number of templates registered
   */
  loadFromDir(dir) {
    const files = fsEnv.listMjmlBasenamesInDir(dir);
    if (files == null) {
      console.warn(
        '[email] templatesDir skipped — filesystem unavailable (edge/worker runtime). ' +
        'Use templates: { id: { mjml: "..." } } or registerTemplate with inline sources.'
      );
      return 0;
    }

    const resolved = path.resolve(dir);
    let count = 0;
    for (const file of files) {
      const id = path.basename(file, '.mjml');
      const filePath = path.join(resolved, file);
      const content = fsEnv.readFileUtf8(filePath);
      if (content != null) {
        this.register(id, { mjml: content }, 'inline');
        count += 1;
      }
    }
    return count;
  }

  /**
   * Register templates from config map (paths are inlined when fs is available)
   * @param {Record<string, string|Object>} templates
   */
  loadFromMap(templates = {}) {
    for (const [id, source] of Object.entries(templates)) {
      if (typeof source === 'string' && fsEnv.looksLikeFilePath(source) && !fsEnv.isInlineMarkup(source)) {
        const content = fsEnv.readFileUtf8(source);
        if (content != null) {
          this.register(
            id,
            source.endsWith('.mjml') ? { mjml: content } : { html: content },
            'inline'
          );
          continue;
        }
        this.register(id, source, 'path');
        continue;
      }

      this.register(id, source, 'inline');
    }
  }

  /**
   * @param {string} id
   * @param {string|Object} source
   * @param {'inline'|'path'} [kind='inline']
   */
  register(id, source, kind = 'inline') {
    if (!id) throw new Error('Template id is required');
    this._templates.set(id, { id, kind, source });
  }

  /**
   * @param {string} id
   * @returns {TemplateEntry|null}
   */
  get(id) {
    return this._templates.get(id) || null;
  }

  /**
   * @returns {Array<{ id: string, kind: string }>}
   */
  list() {
    return Array.from(this._templates.values()).map((t) => ({
      id: t.id,
      kind: t.kind,
    }));
  }

  /**
   * Load templates embedded in build manifest (edge/worker safe)
   * @param {Record<string, { mjml?: string, html?: string }>} emailTemplates
   * @returns {number}
   */
  loadFromManifest(emailTemplates = {}) {
    let count = 0;
    for (const [id, chunk] of Object.entries(emailTemplates)) {
      if (!chunk) continue;
      if (chunk.mjml) {
        this.register(id, { mjml: chunk.mjml }, 'inline');
        count += 1;
      } else if (chunk.html) {
        this.register(id, { html: chunk.html }, 'inline');
        count += 1;
      }
    }
    return count;
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this._templates.has(id);
  }
}

module.exports = {
  TemplateRegistry,
};
