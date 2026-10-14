'use strict';

/**
 * Webspresso CLI - list Command
 * Lists all built-in and custom project commands with descriptions
 * @module bin/commands/list
 */

const path = require('path');
const { createCommandRegistry } = require('../../core/commands');

function registerCommand(program) {
  program
    .command('list')
    .alias('commands')
    .description('List all available Webspresso and custom project management commands')
    .option('-d, --dir <path>', 'Custom commands directory (default: ./commands)')
    .action((options) => {
      const rootDir = process.cwd();
      const commandsDir = options.dir
        ? path.resolve(rootDir, options.dir)
        : path.resolve(rootDir, 'commands');

      const customRegistry = createCommandRegistry({ commandsDir });
      const customCommands = customRegistry.list();

      console.log('');
      console.log('☕ Webspresso CLI - Command Palette');
      console.log('===================================');

      const sections = [
        {
          title: '🚀 Scaffolding & Code Generation',
          commands: [
            ['make:model <name>', 'Scaffold a new ORM model definition in models/'],
            ['make:job <name>', 'Scaffold a background queue job worker in jobs/'],
            ['make:policy <name>', 'Scaffold an authorization policy in policies/'],
            ['make:factory <name>', 'Scaffold a test/seeder model factory in factories/'],
            ['make:event <name>', 'Scaffold an event listener in listeners/'],
            ['make:mail <name>', 'Scaffold a declarative Mailable class in emails/'],
            ['make:command <name>', 'Scaffold a custom management command in commands/'],
            ['page <path>', 'Scaffold a new file-based SSR page'],
            ['api <path>', 'Scaffold a new file-based API route'],
          ],
        },
        {
          title: '💾 Database & Migrations',
          commands: [
            ['db:migrate', 'Run all pending Knex migrations'],
            ['db:makemigrations', 'Auto-diff model schemas against database and generate migration'],
            ['db:rollback', 'Rollback the last batch of migrations'],
            ['db:status', 'Show database connection and migration status'],
            ['db:scaffold', 'Generate initial create table migrations from models/'],
            ['db:make <name>', 'Create an empty Knex migration file'],
            ['seed', 'Run database seeders'],
          ],
        },
        {
          title: '🛠️ Server & Developer Experience',
          commands: [
            ['dev', 'Start local development server with hot-reload'],
            ['start', 'Start production HTTP server'],
            ['build', 'Build client assets and precompile templates'],
            ['routes', 'Inspect all discovered SSR page and API routes'],
            ['doctor', 'Diagnose project configuration, dependencies, and health'],
            ['service [name]', 'Run and test services interactively without HTTP server'],
            ['run <command>', 'Execute a custom management command with full DI context'],
            ['list', 'Display this command index'],
          ],
        },
      ];

      for (const section of sections) {
        console.log(`\n${section.title}:`);
        for (const [cmd, desc] of section.commands) {
          console.log(`  ${cmd.padEnd(28)} ${desc}`);
        }
      }

      if (customCommands.length > 0) {
        console.log(`\n⚡ Custom Project Commands (${path.relative(rootDir, commandsDir) || 'commands/'}):`);
        for (const cmd of customCommands) {
          console.log(`  ${('run ' + cmd.name).padEnd(28)} ${cmd.description || 'Custom management command'}`);
        }
      } else {
        console.log('\n⚡ Custom Project Commands:');
        console.log('  (None discovered. Create with: npx webspresso make:command <name>)');
      }

      console.log('\nUse "webspresso <command> --help" for more information about any command.\n');
    });
}

module.exports = {
  registerCommand,
};
