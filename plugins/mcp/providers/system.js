/**
 * Webspresso MCP System Provider
 * Exposes application routes, services index, and health info as MCP Resources
 * @module plugins/mcp/providers/system
 */

/**
 * Creates system MCP resources
 * @param {Object} options
 * @param {Object} [options.appContext]
 * @param {Object} [options.serviceRegistry]
 * @param {Object} [options.routes]
 * @param {Object} [options.db]
 * @returns {Array<Object>}
 */
function createSystemResources(options = {}) {
  const { appContext, serviceRegistry, routes, db } = options;

  return [
    {
      uri: 'webspresso://routes',
      name: 'Application Routes',
      description: 'List of all file-based SSR and API routes mounted in the Webspresso application.',
      mimeType: 'application/json',
      handler: async () => {
        const rawRoutes = routes || appContext?.routes || [];
        if (Array.isArray(rawRoutes)) {
          return rawRoutes.map((r) => ({
            path: r.path || r.route,
            method: r.method ? r.method.toUpperCase() : 'GET',
            isApi: Boolean(r.isApi || r.path?.startsWith('/api/')),
            middleware: r.middleware || [],
            sourceFile: r.filePath || r.file,
          }));
        }
        return rawRoutes;
      },
    },
    {
      uri: 'webspresso://services',
      name: 'Services Directory',
      description: 'List of all business logic services discovered and registered in the application.',
      mimeType: 'application/json',
      handler: async () => {
        if (!serviceRegistry) return [];
        const names = serviceRegistry.list();
        return names.map((name) => {
          const def = serviceRegistry.get(name);
          return {
            name,
            description: def?.description || '',
            hasSchema: Boolean(def?.schema),
            hasAuth: Boolean(def?.auth),
            timeout: def?.timeout || null,
            transaction: Boolean(def?.transaction),
          };
        });
      },
    },
    {
      uri: 'webspresso://health',
      name: 'System Health & Metrics',
      description: 'Framework runtime information, node version, memory usage, and uptime.',
      mimeType: 'application/json',
      handler: async () => {
        const memory = process.memoryUsage();
        return {
          status: 'ok',
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          platform: process.platform,
          memory: {
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
            rssMB: Math.round(memory.rss / 1024 / 1024),
          },
          databaseConnected: Boolean(db),
          timestamp: new Date().toISOString(),
        };
      },
    },
  ];
}

module.exports = {
  createSystemResources,
};
