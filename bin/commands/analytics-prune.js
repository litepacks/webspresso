/**
 * Prune old site analytics records (CLI)
 */

const { loadDbConfig, createDbInstance } = require('../utils/db');

function registerCommand(program) {
  program
    .command('analytics:prune')
    .description('Delete analytics page views and client errors older than the given retention window')
    .option('--days <n>', 'Delete page views older than this many days', '90')
    .option('--error-days <n>', 'Delete client errors older than this many days', '30')
    .option('--table <name>', 'Page views table name', 'analytics_page_views')
    .option('--errors-table <name>', 'Client errors table name', 'analytics_client_errors')
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('-c, --config <path>', 'Path to database config file')
    .action(async (options) => {
      const days = parseInt(options.days, 10);
      if (Number.isNaN(days) || days < 1) {
        console.error('❌ --days must be a positive integer');
        process.exit(1);
      }

      const errorDays = parseInt(options.errorDays, 10);
      if (Number.isNaN(errorDays) || errorDays < 1) {
        console.error('❌ --error-days must be a positive integer');
        process.exit(1);
      }

      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}`);
      console.log(`   Environment: ${options.env}\n`);

      const knex = await createDbInstance(config, options.env);

      try {
        const { purgeAnalyticsData } = require('../../plugins/site-analytics/purge');
        const result = await purgeAnalyticsData(knex, {
          days,
          errorDays,
          tableName: options.table,
          errorsTableName: options.errorsTable,
        });

        console.log(`✅ Analytics purge completed:`);
        console.log(`   - Page views deleted: ${result.viewsDeleted} (cutoff: ${result.viewsCutoff})`);
        console.log(`   - Client errors deleted: ${result.errorsDeleted} (cutoff: ${result.errorsCutoff})\n`);
      } catch (err) {
        console.error('❌ analytics:prune failed:', err.message);
        process.exit(1);
      } finally {
        await knex.destroy();
      }
    });
}

module.exports = { registerCommand };
