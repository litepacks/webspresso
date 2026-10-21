'use strict';

/**
 * Webspresso CLI - console Command
 * Launches interactive REPL console with preloaded framework context
 * @module bin/commands/console
 */

const { startConsole, evaluateInConsole } = require('../../core/console');

function registerCommand(program) {
  program
    .command('console')
    .alias('c')
    .description('Start interactive Webspresso REPL console with preloaded db, models, and services')
    .option('-e, --eval <code-string>', 'Evaluate JavaScript code and print result, then exit')
    .option('-E, --env <environment>', 'Environment name (default: development)')
    .option('-c, --config <path>', 'Path to database config file (optional)')
    .option('--no-history', 'Disable command history persistence')
    .option('--no-banner', 'Do not display startup banner')
    .action(async (options) => {
      try {
        if (options.eval) {
          const { output, error } = await evaluateInConsole(options.eval, {
            configPath: options.config,
            env: options.env,
          });
          if (error) {
            console.error(error.stack || error.message);
            process.exit(1);
          }
          if (output !== undefined && output !== 'undefined') {
            console.log(output);
          }
          process.exit(0);
        } else {
          await startConsole({
            configPath: options.config,
            env: options.env,
            history: options.history,
            banner: options.banner,
          });
        }
      } catch (err) {
        console.error('❌ Failed to start Webspresso console:', err.message);
        process.exit(1);
      }
    });
}

module.exports = {
  registerCommand,
};
