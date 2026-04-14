/**
 * Prune old audit log rows (CLI)
 */

const { loadDbConfig, createDbInstance } = require('../utils/db');
const { purgeAuditLogs } = require('../../plugins/audit-log/purge');

function registerCommand(program) {
  program
    .command('audit:prune')
    .description('Delete audit log rows older than the given retention window')
    .option('--days <n>', 'Delete rows older than this many days', '90')
    .option('--table <name>', 'Table name', 'audit_logs')
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('-c, --config <path>', 'Path to database config file')
    .action(async (options) => {
      const days = parseInt(options.days, 10);
      if (Number.isNaN(days) || days < 1) {
        console.error('❌ --days must be a positive integer');
        process.exit(1);
      }

      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}`);
      console.log(`   Environment: ${options.env}\n`);

      const knex = await createDbInstance(config, options.env);
      const olderThan = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      try {
        const deleted = await purgeAuditLogs(knex, {
          tableName: options.table,
          olderThan,
        });
        console.log(`✅ Deleted ${deleted} row(s) with created_at before ${olderThan.toISOString()}.\n`);
      } catch (err) {
        console.error('❌ audit:prune failed:', err.message);
        process.exit(1);
      } finally {
        await knex.destroy();
      }
    });
}

module.exports = { registerCommand };
