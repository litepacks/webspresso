'use strict';

/**
 * polar:migrate — write Polar billing migration to migrations/
 */

const fs = require('fs');
const path = require('path');
const { loadDbConfig } = require('../utils/db');

function registerCommand(program) {
  program
    .command('polar:migrate')
    .description('Generate idempotent Polar billing migration for users table')
    .option('-c, --config <path>', 'Path to database config file')
    .option('-t, --table <name>', 'User table name', 'users')
    .option('-o, --output <path>', 'Output migration file path (default: migrations/<timestamp>_polar_billing.js)')
    .action(async (options) => {
      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}\n`);

      const migrationDir = config.migrations?.directory || './migrations';
      if (!fs.existsSync(migrationDir)) {
        fs.mkdirSync(migrationDir, { recursive: true });
        console.log(`Created directory: ${migrationDir}`);
      }

      let filepath = options.output;
      if (!filepath) {
        const now = new Date();
        const timestamp = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0'),
          String(now.getHours()).padStart(2, '0'),
          String(now.getMinutes()).padStart(2, '0'),
          String(now.getSeconds()).padStart(2, '0'),
        ].join('');
        filepath = path.join(migrationDir, `${timestamp}_polar_billing.js`);
      }

      const { generatePolarMigration } = require('../../plugins/polar/src/migration');
      const content = generatePolarMigration({ tableName: options.table });
      fs.writeFileSync(filepath, content, 'utf8');
      console.log(`✅ Polar migration written: ${filepath}`);
      console.log('\nNext: webspresso db:migrate\n');
    });
}

module.exports = { registerCommand };
