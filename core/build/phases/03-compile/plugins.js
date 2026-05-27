/**
 * Plugin build analysis + capability matrix
 * @module core/build/phases/03-compile/plugins
 */

const NODE_ONLY_PLUGINS = new Set([
  'admin-panel',
  'adminPanelPlugin',
  'upload',
  'uploadPlugin',
  'data-exchange',
  'dataExchangePlugin',
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
function isEdgeCompatible(name) {
  const key = String(name).toLowerCase().replace(/plugin$/, '');
  if (NODE_ONLY_PLUGINS.has(name) || NODE_ONLY_PLUGINS.has(key)) return false;
  if (name.includes('admin')) return false;
  if (name.includes('upload')) return false;
  return true;
}

/**
 * Extract plugin names from config/app.js plugins array (best-effort static)
 * @param {string} cwd
 */
function discoverPluginsFromAppConfig(cwd) {
  const fs = require('fs');
  const path = require('path');
  const appPath = path.join(cwd, 'config', 'app.js');
  if (!fs.existsSync(appPath)) return [];

  try {
    const src = fs.readFileSync(appPath, 'utf8');
    const names = [];
    const re = /(\w+Plugin)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!names.includes(m[1])) names.push(m[1]);
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * @param {import('../../index').BuildContextInternal} ctx
 * @param {object[]} pluginRefs from config
 */
async function compilePlugins(ctx, pluginRefs = []) {
  const fromConfig = discoverPluginsFromAppConfig(ctx.cwd);
  const combined = [...new Set([...pluginRefs.map(String), ...fromConfig])];

  /** @type {object[]} */
  const plugins = combined.map((name) => ({
    name,
    edgeCompatible: isEdgeCompatible(name),
    nodeOnly: !isEdgeCompatible(name),
  }));

  if (ctx.config.hooks && typeof ctx.config.hooks['build:manifest'] === 'function') {
    // user hook runs later in manifest phase
  }

  return { plugins };
}

/**
 * Run plugin build:analyze hooks if plugins export them
 * @param {import('../../index').BuildContextInternal} ctx
 */
async function runPluginBuildHooks(ctx, hookName) {
  // v1: no dynamic plugin load at build time unless listed in config
  const hooks = ctx.config.hooks || {};
  if (typeof hooks[hookName] === 'function') {
    await hooks[hookName](ctx);
  }
}

module.exports = {
  compilePlugins,
  isEdgeCompatible,
  discoverPluginsFromAppConfig,
  runPluginBuildHooks,
};
