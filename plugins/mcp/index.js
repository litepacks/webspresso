/**
 * Webspresso Model Context Protocol (MCP) Plugin
 * Connects Webspresso applications to AI agents, IDEs, and LLM tools.
 * @module plugins/mcp
 */

const { McpServer } = require('./server');
const { createServiceTools } = require('./providers/services');
const { createOrmTools, createOrmResources } = require('./providers/orm');
const { createSystemResources } = require('./providers/system');
const { createBuiltinPrompts } = require('./prompts');
const { createMcpAuthMiddleware } = require('./auth');
const { mountSseTransport } = require('./transports/sse');
const { startStdioTransport, redirectConsoleToStderr, restoreConsole } = require('./transports/stdio');
const { discoverMcpDirectory } = require('./discovery');

const { getServiceRegistry, hasServiceRegistry } = require('../../src/app-context');

/**
 * MCP Plugin Factory
 * @param {Object} [options={}]
 * @param {string} [options.path='/_mcp'] - Route path for HTTP & SSE endpoints
 * @param {boolean} [options.enabled=true] - Whether the plugin is active
 * @param {Object} [options.auth] - Authentication options { token, localhostOnly, verify }
 * @param {Object|boolean} [options.services] - Services auto-bridge config
 * @param {Object|boolean} [options.orm] - ORM auto-bridge config
 * @param {Object|boolean} [options.system] - System resources config
 * @param {Array<Object>} [options.tools] - Additional custom tools
 * @param {Array<Object>} [options.resources] - Additional custom resources
 * @param {Array<Object>} [options.prompts] - Additional custom prompts
 * @param {boolean} [options.discovery=true] - Auto-discover mcp/ folder
 * @param {string} [options.name='webspresso-mcp'] - Server name
 * @param {string} [options.version='1.0.0'] - Server version
 * @param {string} [options.instructions] - Instructions for the LLM
 * @returns {Object} Webspresso plugin definition
 */
function mcpPlugin(options = {}) {
  const {
    path = '/_mcp',
    enabled = true,
    auth = {},
    services: servicesOption = true,
    orm: ormOption = true,
    system: systemOption = true,
    tools: extraTools = [],
    resources: extraResources = [],
    prompts: extraPrompts = [],
    discovery = true,
    name = 'webspresso-mcp',
    version = '1.0.0',
    instructions,
  } = options;

  let serverInstance = null;

  return {
    name: 'mcp',
    version: '1.0.0',
    dependencies: [],

    api: {
      getServer: () => serverInstance,
      registerTool: (tool) => serverInstance && serverInstance.registerTool(tool),
      registerResource: (res) => serverInstance && serverInstance.registerResource(res),
      registerPrompt: (prompt) => serverInstance && serverInstance.registerPrompt(prompt),
    },

    register(ctx) {
      if (!enabled) return;

      serverInstance = new McpServer({
        name,
        version,
        instructions,
        context: {
          app: ctx.app,
        },
      });

      // Register initial custom tools, resources, prompts
      if (Array.isArray(extraTools)) {
        serverInstance.registerTools(extraTools);
      }
      if (Array.isArray(extraResources)) {
        for (const res of extraResources) {
          if (res.uriTemplate) {
            serverInstance.registerResourceTemplate(res);
          } else {
            serverInstance.registerResource(res);
          }
        }
      }
      if (Array.isArray(extraPrompts)) {
        for (const prompt of extraPrompts) {
          serverInstance.registerPrompt(prompt);
        }
      }

      // Register built-in prompts
      const builtinPrompts = createBuiltinPrompts();
      for (const p of builtinPrompts) {
        serverInstance.registerPrompt(p);
      }

      // Expose to ctx
      ctx.mcp = {
        server: serverInstance,
        registerTool: (t) => serverInstance.registerTool(t),
        registerResource: (r) => serverInstance.registerResource(r),
        registerPrompt: (p) => serverInstance.registerPrompt(p),
      };
    },

    onRoutesReady(ctx) {
      if (!enabled || !serverInstance) return;

      const { app, db, routes } = ctx;
      serverInstance.context.db = db;

      // 1. Resolve ServiceRegistry
      let registry = null;
      if (ctx.options?.serviceRegistry) {
        registry = ctx.options.serviceRegistry;
      } else if (hasServiceRegistry()) {
        registry = getServiceRegistry();
      }
      serverInstance.context.serviceRegistry = registry;

      // 2. Auto-bridge Services to MCP Tools
      if (servicesOption && registry) {
        const sOpts = typeof servicesOption === 'object' ? servicesOption : {};
        const serviceTools = createServiceTools({
          registry,
          include: sOpts.include,
          exclude: sOpts.exclude,
          readOnly: Boolean(sOpts.readOnly),
          role: sOpts.role || 'admin',
        });
        serverInstance.registerTools(serviceTools);
      }

      // 3. Auto-bridge ORM Models to MCP Tools and Resources
      if (ormOption && db) {
        const oOpts = typeof ormOption === 'object' ? ormOption : {};
        const ormTools = createOrmTools({
          db,
          readOnly: Boolean(oOpts.readOnly),
          models: oOpts.models,
        });
        serverInstance.registerTools(ormTools);

        const { resources, templates } = createOrmResources({ db });
        for (const r of resources) {
          serverInstance.registerResource(r);
        }
        for (const t of templates) {
          serverInstance.registerResourceTemplate(t);
        }
      }

      // 4. Auto-bridge System Resources
      if (systemOption) {
        const sysResources = createSystemResources({
          appContext: ctx,
          serviceRegistry: registry,
          routes,
          db,
        });
        for (const r of sysResources) {
          serverInstance.registerResource(r);
        }
      }

      // 5. Auto-discover custom items from mcp/ directory
      if (discovery) {
        discoverMcpDirectory(serverInstance, process.cwd());
      }

      // 6. Mount HTTP & SSE Transport on Express
      const authMiddleware =
        auth.token || auth.localhostOnly || auth.verify ? createMcpAuthMiddleware(auth) : null;

      mountSseTransport({
        app,
        server: serverInstance,
        path,
        authMiddleware,
      });
    },
  };
}

module.exports = {
  mcpPlugin,
  McpServer,
  createMcpServer: (opts) => new McpServer(opts),
  startStdioTransport,
  mountSseTransport,
  createMcpAuthMiddleware,
  createServiceTools,
  createOrmTools,
  createOrmResources,
  createSystemResources,
  createBuiltinPrompts,
  discoverMcpDirectory,
  redirectConsoleToStderr,
  restoreConsole,
};
