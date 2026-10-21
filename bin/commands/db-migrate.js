/**
 * DB Migrate Command
 * Run pending database migrations
 */

const { loadDbConfig, createDbInstance } = require('../utils/db');
const { runCloudMigration, freeStaleMigrationLock, getMigrationStatus } = require('../../core/orm/migrate-cloud');

function registerCommand(program) {
  program
    .command('db:migrate')
    .description('Run pending database migrations')
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('-c, --config <path>', 'Path to database config file')
    .option('--safe', 'Run in cloud-safe mode with connectivity retries and stale lock auto-healing')
    .option('--dry-run', 'Preview pending migrations without applying them')
    .option('--unlock-if-stale', 'Automatically release stale migration locks from aborted jobs')
    .option('--force-unlock', 'Force release migration table lock immediately')
    .option('--retries <n>', 'Database connection retry attempts', (v) => parseInt(v, 10), 5)
    .action(async (options) => {
      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}`);
      console.log(`   Environment: ${options.env}\n`);
      
      const knex = await createDbInstance(config, options.env);
      const migrationConfig = config.migrations || {};

      try {
        if (options.forceUnlock) {
          console.log('🔓 Releasing migration lock table...');
          await freeStaleMigrationLock(knex, migrationConfig);
          console.log('✅ Migration lock freed.\n');
          return;
        }

        if (options.safe || options.dryRun || options.unlockIfStale) {
          const result = await runCloudMigration(knex, {
            migrationConfig,
            dryRun: Boolean(options.dryRun),
            unlockIfStale: Boolean(options.unlockIfStale || options.safe),
            waitForDb: Boolean(options.safe),
            retries: options.retries || 5,
            logger: (msg) => console.log(`  → ${msg}`),
          });

          if (result.dryRun) {
            if (result.pendingBefore.length === 0) {
              console.log('✅ Dry-run: Database is up to date. No pending migrations.\n');
            } else {
              console.log(`\n🔍 Dry-run: ${result.pendingBefore.length} migration(s) pending:`);
              for (const m of result.pendingBefore) {
                console.log(`  ○ ${m}`);
              }
              console.log('');
            }
            return;
          }

          if (result.applied.length === 0) {
            console.log('✅ Already up to date.\n');
          } else {
            console.log(`\n✅ Done. ${result.applied.length} migration(s) completed in ${result.durationMs}ms.\n`);
          }
          return;
        }

        // Standard knex migration run
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
