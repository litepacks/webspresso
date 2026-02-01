/**
 * DB Migrate Command
 * Run pending database migrations
 */

const { loadDbConfig, createDbInstance } = require('../utils/db');

function registerCommand(program) {
  program
    .command('db:migrate')
    .description('Run pending database migrations')
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('-c, --config <path>', 'Path to database config file')
    .action(async (options) => {
      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}`);
      console.log(`   Environment: ${options.env}\n`);
      
      const knex = await createDbInstance(config, options.env);
      
      try {
        const migrationConfig = config.migrations || {};
        const [batch, migrations] = await knex.migrate.latest(migrationConfig);
        
        if (migrations.length === 0) {
          console.log('✅ Already up to date.\n');
        } else {
          console.log(`Running migrations (batch ${batch}):`);
          for (const m of migrations) {
            console.log(`  → ${m}`);
          }
          console.log(`\n✅ Done. ${migrations.length} migration(s) completed.\n`);
        }
      } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
      } finally {
        await knex.destroy();
      }
    });
}

module.exports = { registerCommand };
