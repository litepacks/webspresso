/**
 * DB Scaffold Command
 * Generate migration files from all models in models/
 */

const path = require('path');
const { loadDbConfig } = require('../utils/db');
const { scaffoldMigrationsFromModels } = require('../utils/model-migrations');

function registerCommand(program) {
  program
    .command('db:scaffold')
    .description('Generate create-table migrations from models/*.js')
    .option('-c, --config <path>', 'Path to database config file (webspresso.db.js or knexfile.js)')
    .option('-m, --models <path>', 'Models directory (overrides config.models)')
    .option('--migrations <path>', 'Migrations directory (overrides config.migrations.directory)')
    .option('--only <names>', 'Comma-separated model names (e.g. User,Post)')
    .option('-f, --force', 'Create migration even if createTable for table already exists')
    .option('--dry-run', 'List files that would be created without writing')
    .action(async (options) => {
      try {
        const { config, path: configPath } = loadDbConfig(options.config);
        console.log(`\n📦 Using config: ${configPath}\n`);

        const modelsDir = options.models || config.models || './models';
        const migrationDir = path.resolve(
          process.cwd(),
          options.migrations || config.migrations?.directory || './migrations'
        );
        const only = options.only
          ? options.only.split(',').map((s) => s.trim()).filter(Boolean)
          : null;

        const result = scaffoldMigrationsFromModels({
          modelsDir,
          migrationDir,
          force: Boolean(options.force),
          dryRun: Boolean(options.dryRun),
          only,
        });

        if (result.created.length > 0) {
          const verb = options.dryRun ? 'Would create' : 'Created';
          console.log(`✅ ${verb} ${result.created.length} migration(s):\n`);
          for (const row of result.created) {
            console.log(`   - ${row.model} → ${row.file}`);
          }
          console.log();
        }

        if (result.skipped.length > 0) {
          console.log(`⏭️  Skipped ${result.skipped.length} (migration already exists, use --force):\n`);
          for (const row of result.skipped) {
            console.log(`   - ${row.model} (${row.table}) — ${row.file}`);
          }
          console.log();
        }

        if (result.errors.length > 0) {
          console.error(`❌ Failed for ${result.errors.length} model(s):\n`);
          for (const row of result.errors) {
            console.error(`   - ${row.model}: ${row.message}`);
          }
          process.exit(1);
        }

        if (result.created.length === 0 && result.skipped.length > 0 && !options.force) {
          console.log('ℹ️  No new migrations written. Use --force to regenerate.\n');
        } else if (result.created.length === 0) {
          console.log('ℹ️  Nothing to scaffold.\n');
        } else if (!options.dryRun) {
          console.log('📝 Next step: webspresso db:migrate\n');
        }
      } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
      }
    });
}

module.exports = { registerCommand };
