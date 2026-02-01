/**
 * DB Rollback Command
 * Rollback the last batch of migrations
 */

const { loadDbConfig, createDbInstance } = require('../utils/db');

function registerCommand(program) {
  program
    .command('db:rollback')
    .description('Rollback the last batch of migrations')
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('-c, --config <path>', 'Path to database config file')
    .option('-a, --all', 'Rollback all migrations')
    .action(async (options) => {
      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}`);
      console.log(`   Environment: ${options.env}\n`);
      
      const knex = await createDbInstance(config, options.env);
      
      try {
        const migrationConfig = {
          ...(config.migrations || {}),
          ...(options.all ? { all: true } : {}),
        };
        
        const [batch, migrations] = await knex.migrate.rollback(migrationConfig);
        
        if (migrations.length === 0) {
          console.log('✅ Nothing to rollback.\n');
        } else {
          console.log(`Rolling back${options.all ? ' all' : ''} migrations:`);
          for (const m of migrations) {
            console.log(`  ← ${m}`);
          }
          console.log(`\n✅ Done. ${migrations.length} migration(s) rolled back.\n`);
        }
      } catch (err) {
        console.error('❌ Rollback failed:', err.message);
        process.exit(1);
      } finally {
        await knex.destroy();
      }
    });
}

module.exports = { registerCommand };
