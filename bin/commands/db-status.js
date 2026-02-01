/**
 * DB Status Command
 * Show migration status
 */

const { loadDbConfig, createDbInstance } = require('../utils/db');

function registerCommand(program) {
  program
    .command('db:status')
    .description('Show migration status')
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('-c, --config <path>', 'Path to database config file')
    .action(async (options) => {
      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}`);
      console.log(`   Environment: ${options.env}\n`);
      
      const knex = await createDbInstance(config, options.env);
      
      try {
        const migrationConfig = config.migrations || {};
        const [completed, pending] = await knex.migrate.list(migrationConfig);
        
        console.log('Migration Status');
        console.log('================\n');
        
        // Sort all migrations by name
        const all = [
          ...completed.map(m => ({ name: m.name || m, completed: true })),
          ...pending.map(m => ({ name: m.name || m, completed: false })),
        ].sort((a, b) => a.name.localeCompare(b.name));
        
        if (all.length === 0) {
          console.log('  No migrations found.\n');
        } else {
          for (const m of all) {
            const status = m.completed ? '✓' : '○';
            const suffix = m.completed ? '' : ' (pending)';
            console.log(`  ${status} ${m.name}${suffix}`);
          }
          console.log(`\n  Total: ${all.length} (${completed.length} completed, ${pending.length} pending)\n`);
        }
      } catch (err) {
        console.error('❌ Failed to get status:', err.message);
        process.exit(1);
      } finally {
        await knex.destroy();
      }
    });
}

module.exports = { registerCommand };
