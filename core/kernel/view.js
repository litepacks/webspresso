/**
 * Namespaced view resolution and minimal {{ var }} rendering.
 * @module core/kernel/view
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} template
 * @param {Record<string, any>} data
 */
function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, keyPath) => {
    const parts = keyPath.split('.');
    let v = data;
    for (const p of parts) {
      v = v == null ? undefined : v[p];
    }
    if (v == null || v === false) return '';
    return String(v);
  });
}

/**
 * Parse "namespace::name" → { namespace, name }
 * @param {string} qualified
 */
function parseQualified(qualified) {
  const sep = '::';
  const i = qualified.indexOf(sep);
  if (i === -1) {
    throw new Error(`View name must be namespaced ("ns::page"), got: ${qualified}`);
  }
  return {
    namespace: qualified.slice(0, i),
    name: qualified.slice(i + sep.length),
  };
}

/**
 * @param {{
 *   appViews?: string,
 *   themeViews?: string,
 * }} paths
 */
function createViewEngine(paths = {}) {
  const appPluginsRoot = paths.appViews || '';
  const themeRoot = paths.themeViews || '';

  /** @type {Map<string, { pluginName: string, layouts: Record<string,string>, pages: Record<string,string>, partials: Record<string,string> }>} */
  const registry = new Map();

  /**
   * @param {string} pluginName
   * @param {{ namespace: string, layouts?: Record<string,string>, pages?: Record<string,string>, partials?: Record<string,string> }} bundle
   */
  function registerPluginViews(pluginName, bundle) {
    const { namespace } = bundle;
    registry.set(namespace, {
      pluginName,
      layouts: bundle.layouts || {},
      pages: bundle.pages || {},
      partials: bundle.partials || {},
    });
  }

  /**
   * Resolve template body: app override → theme → plugin in-memory bundle.
   * @param {'page'|'layout'|'partial'} kind
   * @param {string} namespace
   * @param {string} id
   * @returns {string|null}
   */
  function resolveTemplate(kind, namespace, id) {
    const entry = registry.get(namespace);
    const pluginSlug = entry ? entry.pluginName : namespace;

    const sub =
      kind === 'layout'
        ? 'layouts'
        : kind === 'partial'
          ? 'partials'
          : 'pages';
    const file = `${id}.html`;

    if (appPluginsRoot) {
      const appPath = path.join(appPluginsRoot, 'plugins', pluginSlug, sub, file);
      if (fs.existsSync(appPath)) {
        return fs.readFileSync(appPath, 'utf8');
      }
    }

    if (themeRoot) {
      const themePath = path.join(themeRoot, pluginSlug, sub, file);
      if (fs.existsSync(themePath)) {
        return fs.readFileSync(themePath, 'utf8');
      }
    }

    if (entry) {
      const dict =
        kind === 'layout'
          ? entry.layouts
          : kind === 'partial'
            ? entry.partials
            : entry.pages;
      const inline = dict[id];
      if (inline != null) return inline;
    }

    return null;
  }

  /**
   * @param {string} qualified
   * @param {Record<string, any>} data
   * @param {{ layout?: string }} [options]
   */
  function renderView(qualified, data, options = {}) {
    const { namespace, name } = parseQualified(qualified);
    let body = resolveTemplate('page', namespace, name);
    if (body == null) {
      throw new Error(`View not found: ${qualified}`);
    }
    body = renderTemplate(body, data);

    if (options.layout) {
      const lq = parseQualified(options.layout);
      const layoutBody = resolveTemplate('layout', lq.namespace, lq.name);
      if (layoutBody == null) {
        throw new Error(`Layout not found: ${options.layout}`);
      }
      const merged = { ...data, content: body };
      return renderTemplate(layoutBody, merged);
    }

    return body;
  }

  /**
   * @param {string} qualified
   * @param {Record<string, any>} data
   */
  function renderPartial(qualified, data) {
    const { namespace, name } = parseQualified(qualified);
    const raw = resolveTemplate('partial', namespace, name);
    if (raw == null) {
      throw new Error(`Partial not found: ${qualified}`);
    }
    return renderTemplate(raw, data);
  }

  return {
    registerPluginViews,
    renderView,
    renderPartial,
    renderTemplate,
    parseQualified,
  };
}

module.exports = {
  createViewEngine,
  renderTemplate,
  parseQualified,
};
