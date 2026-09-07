/**
 * Webspresso CLI: MCP Command
 * Runs the Webspresso Model Context Protocol (MCP) server over standard I/O for IDEs (Antigravity, Claude, Cursor)
 * @module bin/commands/mcp
 */

const path = require('path');
const fs = require('fs');


/**
 * Register MCP command in Commander CLI
 * @param {import('commander').Command} program
 */
function registerCommand(program) {
  program
    .command('mcp')
    .description('Start Model Context Protocol (MCP) server over Stdio for AI coding assistants')
    .option('-d, --dir <path>', 'Project root directory', process.cwd())
    .option('-c, --config <path>', 'Database config path (knexfile.js or webspresso.db.js)')
    .option('-E, --env <environment>', 'Environment (development, production)', 'development')
    .option('--read-only', 'Restrict tools to read-only queries (blocks mutations/inserts)', false)
    .option('--no-services', 'Disable auto-bridging of services/ directory')
    .option('--no-orm', 'Disable auto-bridging of ORM models and schema')
    .option('--print-config', 'Print sample Claude Desktop / Cursor MCP configuration JSON snippet')
    .action(async (options) => {
      // 1. If print-config flag is passed, print snippet and exit cleanly
      if (options.printConfig) {
        const configSnippet = {
          mcpServers: {
            webspresso: {
              command: 'npx',
              args: ['webspresso', 'mcp'],
            },
          },
        };
        console.log(JSON.stringify(configSnippet, null, 2));
        return;
      }

      const rootDir = path.resolve(process.cwd(), options.dir || '.');
      const isReadOnly = Boolean(options.readOnly);

      const {
        McpServer,
        createServiceTools,
        createOrmTools,
        createOrmResources,
        createSystemResources,
        createBuiltinPrompts,
        startStdioTransport,
        discoverMcpDirectory,
      } = require('../../plugins/mcp');
      const { createServiceRegistry } = require('../../src/services');
      const { resolveDbConfigIfExists, createDbInstance } = require('../utils/db');
      const { getAllModels } = require('../../core/orm/model');

      // Create Server instance
      const server = new McpServer({
        name: 'webspresso-mcp',
        version: require('../../package.json').version,
        instructions: `Webspresso MCP server running in ${rootDir} (readOnly: ${isReadOnly}). Exposes business logic services and ORM models.`,
      });

      // Register built-in prompts
      const prompts = createBuiltinPrompts();
      for (const p of prompts) {
        server.registerPrompt(p);
      }

      let db = null;
      let registry = null;

      try {
        // 2. Resolve database if not disabled
        if (options.orm !== false) {
          const dbConfigResult = resolveDbConfigIfExists(options.config);
          if (dbConfigResult) {
            try {
              db = await createDbInstance(dbConfigResult.config, options.env);
              server.context.db = db;

              const ormTools = createOrmTools({
                db,
                readOnly: isReadOnly,
              });
              server.registerTools(ormTools);

              const { resources, templates } = createOrmResources({ db });
              for (const r of resources) {
                server.registerResource(r);
              }
              for (const t of templates) {
                server.registerResourceTemplate(t);
              }
            } catch (dbErr) {
              process.stderr.write(`[webspresso-mcp] DB initialization skipped: ${dbErr.message}\n`);
            }
          }
        }

        // 3. Resolve services if not disabled
        if (options.services !== false) {
          const servicesDir = path.join(rootDir, 'services');
          if (fs.existsSync(servicesDir)) {
            registry = createServiceRegistry({
              servicesDir,
              isDev: options.env !== 'production',
            });
            server.context.serviceRegistry = registry;

            const serviceTools = createServiceTools({
              registry,
              readOnly: isReadOnly,
              role: 'admin',
            });
            server.registerTools(serviceTools);
          }
        }

        // 4. Register system resources
        const sysResources = createSystemResources({
          serviceRegistry: registry,
          db,
        });
        for (const r of sysResources) {
          server.registerResource(r);
        }

        // 5. Discover custom mcp/ components
        discoverMcpDirectory(server, rootDir);

        // 6. Start Stdio transport
        const transport = startStdioTransport(server, {
          redirectStderr: true,
        });

        process.stderr.write(
          `[webspresso-mcp] Server started (Stdio transport). Registered ${server.tools.size} tools, ${server.resources.size} resources, ${server.prompts.size} prompts.\n`
        );

        // Handle process termination
        const cleanup = async () => {
          transport.close();
          if (db && typeof db.destroy === 'function') {
            await db.destroy();
          }
          process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
      } catch (err) {
        process.stderr.write(`[webspresso-mcp] Fatal error: ${err.message}\n`);
        process.exit(1);
      }
    });
}

module.exports = {
  registerCommand,
};
