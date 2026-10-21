'use strict';

/**
 * Webspresso - Interactive Console Custom REPL Commands
 * Provides dot-commands (.models, .services, .routes, .flags, .reload)
 * @module core/console/commands
 */

const { discoverAppRoutes } = require('../../src/discovery/scan-routes');

/**
 * Register Webspresso specific dot commands on the REPL server
 * @param {import('repl').REPLServer} replServer
 * @param {Object} options
 * @param {Object} options.context - Console context
 * @param {Object} options.meta - Metadata summary
 * @param {string} options.rootDir - Application root directory
 */
function registerConsoleCommands(replServer, { context, meta, rootDir }) {
  // 1. .models
  replServer.defineCommand('models', {
    help: 'List all loaded ORM models and repositories',
    action() {
      const modelNames = Object.keys(context.models || {});
      if (modelNames.length === 0) {
        console.log('\n⚠️  No models loaded. Ensure models/ directory has defineModel() files.\n');
      } else {
        console.log(`\n📦 Loaded Models (${modelNames.length}):`);
        for (const name of modelNames) {
          const repo = context.models[name];
          const tableName = repo?.model?.table || 'unknown';
          console.log(`  • \x1b[36m${name}\x1b[0m (table: \x1b[33m${tableName}\x1b[0m) -> available as \x1b[1m${name}\x1b[0m in console`);
        }
        console.log('\n  Tip: You can query directly: await ' + modelNames[0] + '.find()\n');
      }
      this.displayPrompt();
    },
  });

  // 2. .services
  replServer.defineCommand('services', {
    help: 'List all registered business services in services/',
    action() {
      if (!context.services || typeof context.services.list !== 'function') {
        console.log('\n⚠️  No services loaded.\n');
      } else {
        const services = context.services.list();
        if (services.length === 0) {
          console.log('\n⚠️  No services found in services/ directory.\n');
        } else {
          console.log(`\n⚙️  Registered Services (${services.length}):`);
          for (const s of services) {
            console.log(`  • \x1b[32m${s.name}\x1b[0m ${s.description ? `(${s.description})` : ''}`);
          }
          console.log('\n  Tip: Call a service with: await service(\'' + services[0].name + '\', payload)\n');
        }
      }
      this.displayPrompt();
    },
  });

  // 3. .routes
  replServer.defineCommand('routes', {
    help: 'Scan and list all application API endpoints and SSR pages',
    action() {
      try {
        const result = discoverAppRoutes({ rootDir });
        const descriptors = result.descriptors || [];

        if (descriptors.length === 0) {
          console.log('\n⚠️  No routes discovered in pages/ directory.\n');
        } else {
          console.log(`\n🌐 Discovered Routes (${descriptors.length}):\n`);
          const apiRoutes = descriptors.filter((d) => d.type === 'api');
          const pageRoutes = descriptors.filter((d) => d.type === 'page' || d.type === 'ssr');

          if (apiRoutes.length > 0) {
            console.log('  \x1b[1mAPI Endpoints:\x1b[0m');
            for (const r of apiRoutes) {
              const method = (r.method || 'ALL').toUpperCase().padEnd(6);
              console.log(`    \x1b[34m${method}\x1b[0m ${r.path}`);
            }
          }

          if (pageRoutes.length > 0) {
            console.log('\n  \x1b[1mPages (SSR):\x1b[0m');
            for (const r of pageRoutes) {
              console.log(`    \x1b[35mPAGE  \x1b[0m ${r.path}`);
            }
          }
          console.log('');
        }
      } catch (err) {
        console.error('\n❌ Could not scan routes:', err.message, '\n');
      }
      this.displayPrompt();
    },
  });

  // 4. .flags
  replServer.defineCommand('flags', {
    help: 'List all active feature flags and targeting rules',
    action() {
      if (!context.flags || typeof context.flags.list !== 'function') {
        console.log('\n⚠️  No feature flags configured.\n');
      } else {
        const flags = context.flags.list();
        const entries = Object.entries(flags);
        if (entries.length === 0) {
          console.log('\n⚠️  No feature flags registered.\n');
        } else {
          console.log(`\n🚩 Feature Flags (${entries.length}):`);
          for (const [key, rule] of entries) {
            const enabled = rule.enabled !== false ? '\x1b[32menabled\x1b[0m' : '\x1b[31mdisabled\x1b[0m';
            const rollout = rule.rollout !== undefined ? ` (rollout: ${rule.rollout}%)` : '';
            console.log(`  • \x1b[1m${key}\x1b[0m: ${enabled}${rollout}`);
          }
          console.log('\n  Tip: Evaluate with: flags.isEnabled(\'flag_name\', { user })\n');
        }
      }
      this.displayPrompt();
    },
  });

  // 5. .reload
  replServer.defineCommand('reload', {
    help: 'Hot-reload models and services from filesystem without exiting',
    async action() {
      try {
        console.log('\n🔄 Reloading models and services...');
        const result = await context.reload();
        // Update REPL server context with new model shortcuts
        for (const [name, repo] of Object.entries(context.models || {})) {
          replServer.context[name] = repo;
        }
        replServer.context.services = context.services;
        console.log(`✨ Reloaded ${result.models.length} models and ${result.services.length} services.\n`);
      } catch (err) {
        console.error('\n❌ Failed to reload:', err.message, '\n');
      }
      this.displayPrompt();
    },
  });
}

module.exports = {
  registerConsoleCommands,
};
