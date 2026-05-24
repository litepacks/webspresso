/**
 * webspresso build — compile manifest + bundle for adapter
 */

const path = require('path');
const fs = require('fs');
const { runBuild, formatBuildError, BuildError } = require('../../core/build');

function registerCommand(program) {
  program
    .command('build')
    .description('Build production bundle and route manifest for deployment adapter')
    .option('-a, --adapter <name>', 'Target adapter: node, cloudflare, bun')
    .option('--fail-on-warnings', 'Treat validation warnings as errors')
    .option('--skip-bundle', 'Generate manifest only (no esbuild bundle)')
    .action(async (options) => {
      try {
        const result = await runBuild({
          adapter: options.adapter,
          failOnWarnings: options.failOnWarnings,
          skipBundle: options.skipBundle,
        });

        console.log('\n✅ Webspresso build complete');
        console.log(`   Adapter:   ${result.adapter}`);
        console.log(`   Build ID:  ${result.manifest.buildId}`);
        console.log(`   Routes:    ${result.diagnostics.routes}`);
        console.log(`   Templates: ${result.diagnostics.templates}`);

        if (result.bundle) {
          console.log(`   Output:    ${result.bundle.outputDir}`);
          if (result.bundle.bundleError) {
            console.log(`\n⚠️  Bundle note: ${result.bundle.bundleError}`);
          }
        }

        if (result.diagnostics.validation.warnings.length) {
          console.log('\n⚠️  Warnings:');
          for (const w of result.diagnostics.validation.warnings) {
            console.log(`   ${w.code}: ${w.message}`);
          }
        }

        console.log('');
      } catch (err) {
        console.error('\n' + formatBuildError(err));
        if (err instanceof BuildError && err.details.errors) {
          for (const e of err.details.errors) {
            console.error(`   ${e.code}: ${e.message}`);
          }
        }
        process.exit(1);
      }
    });
}

module.exports = { registerCommand };
