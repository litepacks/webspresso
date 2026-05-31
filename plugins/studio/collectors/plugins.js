/**
 * Plugin manifest for Studio inspector.
 */

/**
 * @param {import('../../../src/plugin-manager').PluginManager} pluginManager
 */
function collectPlugins(pluginManager) {
  if (!pluginManager) {
    return { total: 0, plugins: [] };
  }

  const health = pluginManager.pluginHealth || new Map();
  const customRoutes = pluginManager.customRoutes || [];
  const plugins = [];

  for (const [key, plugin] of pluginManager.plugins) {
    const h = health.get(plugin.name || key) || { status: 'loaded' };
    const routesForPlugin = customRoutes
      .filter((r) => r.path && !r.path.includes('/_webspresso'))
      .map((r) => ({ method: r.method, path: r.path }));

    plugins.push({
      name: plugin.name || key,
      version: plugin.version || '0.0.0',
      description: plugin.description || '',
      enabled: h.status === 'loaded',
      status: h.status,
      error: h.error || null,
      dependencies: plugin.dependencies || [],
      dependencyIssues: h.dependencyIssues || [],
      hooks: {
        register: typeof plugin.register === 'function',
        onRoutesReady: typeof plugin.onRoutesReady === 'function',
        onReady: typeof plugin.onReady === 'function',
      },
      routes: routesForPlugin,
      adminModules: plugin.studioAdminModules || [],
      configKeys: plugin.studioConfigKeys || [],
    });
  }

  return { total: plugins.length, plugins };
}

module.exports = { collectPlugins };
