/**
 * DB MakeMigrations Command (Django-inspired)
 * Auto-detect model schema changes against live database and generate migrations
 */

const path = require('path');
const { loadDbConfig, createDbInstance } = require('../utils/db');
const { makeMigrations } = require('../../core/orm/migrations/diff');

function registerCommand(program) {
  program
    .command('db:makemigrations')
    .alias('makemigrations')
    .description('Auto-detect model changes against live database and generate migration files')
    .option('-c, --config <path>', 'Path to database config file (webspresso.db.js or knexfile.js)')
    .option('-m, --models <path>', 'Models directory (overrides config.models)')
    .option('--migrations <path>', 'Migrations directory (overrides config.migrations.directory)')
    .option('-n, --name <name>', 'Custom migration name override')
    .option('--include-drops', 'Generate dropColumn operations for columns removed from models')
    .option('--dry-run', 'Preview migrations that would be created without writing files')
    .action(async (options) => {
      let knex = null;
      try {
        const { config, path: configPath } = loadDbConfig(options.config);
        console.log(`\n📦 Using config: ${configPath}\n`);

        knex = await createDbInstance(config);

        const modelsDir = options.models || config.models || './models';
        const migrationDir = path.resolve(
          process.cwd(),
          options.migrations || config.migrations?.directory || './migrations'
        );

        console.log(`🔍 Inspecting database and comparing with models in ${modelsDir}...`);

        const result = await makeMigrations({
          knex,
          modelsDir,
          migrationDir,
          dryRun: Boolean(options.dryRun),
          includeDrops: Boolean(options.includeDrops),
          name: options.name || null,
        });

        if (!result.hasChanges) {
          console.log('\n✨ No changes detected in models. Database schema is up to date.\n');
          return;
        }

        const verb = options.dryRun ? 'Would generate' : 'Generated';
        console.log(`\n✅ ${verb} ${result.created.length} migration(s):\n`);

        for (const change of result.created) {
          console.log(`   📄 ${change.file}`);
          console.log(`      Model: ${change.model} (table: ${change.table})`);
          console.log(`      Type:  ${change.type}`);
          if (change.addedColumns?.length > 0) {
            console.log(`      + Added column(s): ${change.addedColumns.join(', ')}`);
          }
          if (change.removedColumns?.length > 0) {
            console.log(`      - Dropped column(s): ${change.removedColumns.join(', ')}`);
          }
          console.log();
        }

        if (options.dryRun) {
          console.log('💡 Dry-run mode: No files were written to disk.\n');
        } else {
          console.log('📝 Next step: Run "webspresso db:migrate" to apply the changes.\n');
        }
      } catch (err) {
        console.error('\n❌ Migration generation failed:', err.message);
        process.exit(1);
      } finally {
        if (knex) {
          await knex.destroy().catch(() => {});
        }
      }
    });
}

module.exports = { registerCommand };
