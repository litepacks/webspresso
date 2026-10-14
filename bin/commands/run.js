'use strict';

/**
 * Webspresso CLI - run Command
 * Executes custom management commands with injected framework context
 * @module bin/commands/run
 */

const path = require('path');
const fs = require('fs');
const { createCommandRegistry, executeCommand } = require('../../core/commands');
const { createEventDispatcher } = require('../../core/events');
const { createMailer } = require('../../core/mail');
const { resolveDbConfigIfExists, createDbInstance } = require('../utils/db');

/**
 * Helper to parse unknown CLI options into a flags object
 * e.g. ['--dry-run', '--limit', '50', 'arg1'] -> flags: { dryRun: true, limit: 50 }, args: ['arg1']
 * @param {string[]} rawArgs
 * @returns {{ flags: Object, args: string[] }}
 */
function parseRawArgs(rawArgs = []) {
  const flags = {};
  const args = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const item = rawArgs[i];
    if (item.startsWith('--')) {
      const withoutDashes = item.slice(2);
      if (withoutDashes.includes('=')) {
        const [k, v] = withoutDashes.split('=');
        flags[camelCase(k)] = parseVal(v);
      } else {
        const next = rawArgs[i + 1];
        if (next && !next.startsWith('-')) {
          flags[camelCase(withoutDashes)] = parseVal(next);
          i++;
        } else {
          flags[camelCase(withoutDashes)] = true;
        }
      }
    } else if (item.startsWith('-') && item.length === 2) {
      const flagChar = item.slice(1);
      const next = rawArgs[i + 1];
      if (next && !next.startsWith('-')) {
        flags[flagChar] = parseVal(next);
        i++;
      } else {
        flags[flagChar] = true;
      }
    } else {
      args.push(item);
    }
  }

  return { flags, args };
}

function camelCase(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseVal(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null') return null;
  if (!Number.isNaN(Number(val)) && val.trim() !== '') return Number(val);
  return val;
}

function registerCommand(program) {
  program
    .command('run [commandName] [args...]')
    .alias('command:run')
    .description('Run a custom management command from commands/ with injected framework context')
    .option('-d, --dir <path>', 'Custom commands directory (default: ./commands)')
    .option('-c, --config <path>', 'Path to database config file (optional)')
    .option('-E, --env <environment>', 'Environment name (default: development)')
    .allowUnknownOption(true)
    .action(async (commandName, rawArgs = [], options = {}) => {
      const rootDir = process.cwd();
      const commandsDir = options.dir
        ? path.resolve(rootDir, options.dir)
        : path.resolve(rootDir, 'commands');

      const registry = createCommandRegistry({ commandsDir });
      const available = registry.list();

      if (!commandName) {
        if (available.length === 0) {
          console.log(`\n⚠️  No custom commands found in "${path.relative(rootDir, commandsDir) || 'commands/'}".`);
          console.log('   Create your first custom command with:');
          console.log('   npx webspresso make:command <name>\n');
          return;
        }

        console.log(`\n⚡ Available Custom Management Commands (${available.length}):\n`);
        const maxLen = Math.max(...available.map((c) => c.name.length), 10);
        for (const cmd of available) {
          console.log(`  webspresso run ${cmd.name.padEnd(maxLen + 2)} ${cmd.description ? `# ${cmd.description}` : ''}`);
        }
        console.log('');
        return;
      }

      if (!registry.has(commandName)) {
        console.error(`\n❌ Error: Command "${commandName}" not found in ${path.relative(rootDir, commandsDir) || 'commands/'}.`);
        if (available.length > 0) {
          console.log(`   Available commands: ${registry.names().join(', ')}\n`);
        } else {
          console.log('   Use `npx webspresso make:command <name>` to create it.\n');
        }
        process.exitCode = 1;
        return;
      }

      const cmdDef = registry.get(commandName);
      const { flags, args } = parseRawArgs(rawArgs);

      // Boot Context
      let knexInstance = null;
      let db = null;
      let services = null;
      const events = createEventDispatcher();
      const mailer = createMailer({ backend: 'console' });

      // 1. Database
      try {
        const dbInfo = resolveDbConfigIfExists(options.config);
        if (dbInfo) {
          knexInstance = await createDbInstance(dbInfo.config, options.env);
          const { createDatabase } = require('../../core/orm');
          db = createDatabase({ knex: knexInstance });
        }
      } catch (err) {
        console.warn('⚠️  Could not initialize database for command:', err.message);
      }

      // 2. Services
      try {
        const servicesDir = path.resolve(rootDir, 'services');
        if (fs.existsSync(servicesDir)) {
          const { createServiceRegistry } = require('../../src/services');
          services = createServiceRegistry({ servicesDir, isDev: true });
        }
      } catch (err) {
        console.warn('⚠️  Could not initialize service registry for command:', err.message);
      }

      // 3. Queue
      let queue = null;
      try {
        const { createQueueDispatcher } = require('../../core/queue');
        queue = createQueueDispatcher({ db: knexInstance });
      } catch (_) {
        queue = {
          dispatch: async () => {},
        };
      }

      console.log(`\n🚀 [webspresso run] Executing "${commandName}"...`);
      const executionResult = await executeCommand(cmdDef, {
        args,
        flags,
        db,
        queue,
        services,
        mailer,
        events,
        logger: console,
      });

      // Cleanup
      if (knexInstance && typeof knexInstance.destroy === 'function') {
        try {
          await knexInstance.destroy();
        } catch (_) {}
      }

      if (executionResult.success) {
        console.log(`\n✨ Command "${commandName}" completed successfully in ${executionResult.durationMs}ms.\n`);
      } else {
        console.error(`\n❌ Command "${commandName}" failed after ${executionResult.durationMs}ms:`);
        if (executionResult.error) {
          console.error(executionResult.error.stack || executionResult.error.message);
        }
        process.exitCode = 1;
      }
    });
}

module.exports = {
  registerCommand,
  parseRawArgs,
};
