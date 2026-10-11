/**
 * Prune old background queue jobs (CLI)
 */

'use strict';

const { loadDbConfig, createDbInstance } = require('../utils/db');

function registerCommand(program) {
  program
    .command('queue:prune')
    .description('Delete completed or failed queue jobs older than the given retention window')
    .option('--days <n>', 'Delete jobs older than this many days', '7')
    .option('--status <statuses>', 'Comma-separated statuses to delete (e.g. completed, failed)', 'completed')
    .option('--table <name>', 'Queue table name', 'webspresso_jobs')
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('-c, --config <path>', 'Path to database config file')
    .action(async (options) => {
      const days = parseInt(options.days, 10);
      if (Number.isNaN(days) || days < 0) {
        console.error('❌ --days must be a non-negative integer');
        process.exit(1);
      }

      const statuses = (options.status || 'completed')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}`);
      console.log(`   Environment: ${options.env}\n`);

      const knex = await createDbInstance(config, options.env);
      const olderThan = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      try {
        const { DatabaseQueueAdapter } = require('../../core/queue/adapters/database');
        const adapter = new DatabaseQueueAdapter({
          knex,
          tableName: options.table,
        });

        const deleted = await adapter.clean({
          status: statuses,
          olderThan,
        });

        console.log(`✅ Deleted ${deleted} job(s) [status: ${statuses.join(', ')}] with timestamp before ${olderThan.toISOString()}.\n`);
      } catch (err) {
        console.error('❌ queue:prune failed:', err.message);
        process.exit(1);
      } finally {
        await knex.destroy();
      }
    });
}

module.exports = { registerCommand };
