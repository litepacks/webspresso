/**
 * Prune unreferenced / orphaned uploaded files (CLI)
 */

'use strict';

const path = require('path');
const { loadDbConfig, createDbInstance } = require('../utils/db');
const { pruneOrphanedUploads } = require('../../plugins/upload/orphan-pruner');

function registerCommand(program) {
  program
    .command('upload:prune')
    .description('Scan and delete orphaned files in the uploads directory not referenced by any database model')
    .option('--dir <path>', 'Custom uploads directory path (default: public/uploads)')
    .option('--url-base <path>', 'Public URL base path (default: /uploads)', '/uploads')
    .option('--dry-run', 'Scan and list orphaned files without deleting them', false)
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('-c, --config <path>', 'Path to database config file')
    .action(async (options) => {
      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}`);
      console.log(`   Environment: ${options.env}\n`);

      const knex = await createDbInstance(config, options.env);
      const db = { knex };

      try {
        const destDir = options.dir
          ? path.resolve(process.cwd(), options.dir)
          : path.resolve(process.cwd(), 'public', 'uploads');

        console.log(`🔍 Scanning directory: ${destDir}`);
        console.log(`   Public URL base: ${options.urlBase}`);
        if (options.dryRun) {
          console.log(`   Mode: DRY RUN (no files will be deleted)\n`);
        } else {
          console.log(`   Mode: PRUNE & DELETE\n`);
        }

        const result = await pruneOrphanedUploads({
          db,
          destDir,
          publicBasePath: options.urlBase,
          dryRun: options.dryRun,
        });

        console.log(`📊 Scan Summary:`);
        console.log(`   Total files on disk: ${result.totalFiles} (${result.totalBytesFormatted})`);
        console.log(`   Referenced by DB:   ${result.referencedCount}`);
        console.log(`   Orphaned files:     ${result.orphanedCount} (${result.orphanedBytesFormatted})\n`);

        if (result.orphanedCount === 0) {
          console.log(`✅ No orphaned files found. Storage is clean!\n`);
          return;
        }

        if (options.dryRun) {
          console.log(`ℹ️ [DRY RUN] The following ${result.orphanedCount} file(s) would be deleted:`);
          for (const file of result.orphanedFiles.slice(0, 20)) {
            console.log(`   - ${file.relativePath} (${file.publicUrl})`);
          }
          if (result.orphanedFiles.length > 20) {
            console.log(`   ... and ${result.orphanedFiles.length - 20} more file(s)`);
          }
          console.log(`\n💡 To permanently delete these files, run without --dry-run.\n`);
        } else {
          console.log(`🗑️ Successfully deleted ${result.deletedCount} orphaned file(s) (${result.deletedBytesFormatted} reclaimed).\n`);
        }
      } catch (err) {
        console.error('❌ upload:prune failed:', err.message);
        process.exit(1);
      } finally {
        await knex.destroy();
      }
    });
}

module.exports = { registerCommand };
