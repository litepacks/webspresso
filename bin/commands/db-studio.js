'use strict';

/**
 * Webspresso CLI DB Studio Command
 * Launches visual database browser and SQL console
 * @module bin/commands/db-studio
 */

const fs = require('fs');
const path = require('path');
const { loadDbConfig, createDbInstance } = require('../utils/db');
const { startStudio } = require('../../core/studio');

function registerCommand(program) {
  program
    .command('db:studio')
    .alias('studio')
    .description('Open interactive visual database browser and SQL runner in your browser')
    .option('-p, --port <port>', 'Port to listen on', '4567')
    .option('-H, --host <host>', 'Host to bind to', '127.0.0.1')
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('-c, --config <path>', 'Path to database config file')
    .option('--open', 'Automatically open browser', true)
    .option('--no-open', 'Do not open browser')
    .action(async (options = {}) => {
      const cwd = process.cwd();
      const pkgPath = path.join(cwd, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        console.error('❌ Not a Webspresso project! Run this command in your project directory.');
        process.exit(1);
      }

      let dbConfig;
      let configPath;

      try {
        const loaded = loadDbConfig(options.config);
        dbConfig = loaded.config;
        configPath = loaded.path;
      } catch (err) {
        console.error('❌ Database configuration could not be loaded:', err.message);
        process.exit(1);
      }

      console.log(`\n📦 Using config: ${path.relative(cwd, configPath)} (${options.env})`);
      const knex = await createDbInstance(dbConfig, options.env);

      try {
        const port = parseInt(options.port, 10) || 4567;
        const host = options.host || '127.0.0.1';
        const open = options.open !== false;

        await startStudio({
          knex,
          port,
          host,
          open,
          silent: false,
        });

        // Keep process open until interrupted
        const cleanup = async () => {
          console.log('\n🛑 Stopping DB Studio...');
          try {
            await knex.destroy();
          } catch (_) {}
          process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
      } catch (err) {
        console.error('❌ Failed to start DB Studio:', err.message);
        try {
          await knex.destroy();
        } catch (_) {}
        process.exit(1);
      }
    });
}

module.exports = {
  registerCommand,
};
