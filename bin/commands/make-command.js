'use strict';

/**
 * Webspresso CLI - make:command Command
 * Scaffolds a custom management command in commands/<name>.js
 * @module bin/commands/make-command
 */

const fs = require('fs');
const path = require('path');

function generateCommandContent(commandName, description = '') {
  return `'use strict';

const { defineCommand } = require('webspresso');

/**
 * Custom Management Command: ${commandName}
 * Run via: npx webspresso run ${commandName}
 */
module.exports = defineCommand({
  name: '${commandName}',
  description: '${description || `Execute ${commandName} task`}',
  options: [
    { flags: '-d, --dry-run', description: 'Run without making persistent changes', defaultValue: false },
  ],
  handle: async ({ db, queue, services, mailer, events, logger, args, flags }) => {
    logger.log('Executing "${commandName}"...');
    if (flags.dryRun) {
      logger.log('[Dry Run] No actual changes will be committed.');
    }

    // Business logic goes here:
    // e.g. const users = await db.getRepository('User').find({ active: false });

    return { success: true };
  },
});
`;
}

function registerCommand(program) {
  program
    .command('make:command <name>')
    .alias('command:make')
    .description('Scaffold a custom management command in commands/<name>.js')
    .option('-d, --desc <description>', 'Command description', '')
    .option('--root <dir>', 'Root directory of the project', process.cwd())
    .action((nameArg, options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const commandsDir = path.join(rootDir, 'commands');

      if (!fs.existsSync(commandsDir)) {
        fs.mkdirSync(commandsDir, { recursive: true });
      }

      const commandName = String(nameArg || '').trim();
      if (!commandName) {
        console.error('❌ Command name is required.');
        process.exitCode = 1;
        return;
      }

      // Convert colons or slashes to subdirectories or file path
      // e.g. "users:prune" -> commands/users/prune.js or commands/users-prune.js
      const relPath = commandName.includes(':')
        ? commandName.replace(/:/g, '/') + '.js'
        : `${commandName}.js`;

      const targetFilePath = path.join(commandsDir, relPath);
      const targetDir = path.dirname(targetFilePath);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (fs.existsSync(targetFilePath)) {
        console.error(`❌ Command file already exists: ${path.relative(rootDir, targetFilePath)}`);
        process.exitCode = 1;
        return;
      }

      const content = generateCommandContent(commandName, options.desc);
      fs.writeFileSync(targetFilePath, content, 'utf-8');
      console.log(`\n✅ Created custom management command: ${path.relative(rootDir, targetFilePath)}`);
      console.log(`   Execute it with: npx webspresso run ${commandName}\n`);
    });
}

module.exports = {
  registerCommand,
  generateCommandContent,
};
