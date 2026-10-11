'use strict';

/**
 * Webspresso CLI - typegen / types Command
 * Generate TypeScript type definitions and IDE auto-complete for models, services, and routes
 * @module bin/commands/typegen
 */

const fs = require('fs');
const path = require('path');
const { generateTypes } = require('../../src/dev/typegen');

function registerCommand(program) {
  program
    .command('typegen')
    .alias('types')
    .alias('generate:types')
    .description('Generate TypeScript type definitions and IDE auto-complete for models, services, and routes')
    .option('-o, --out <file>', 'Output declaration file path (default: .webspresso/types.d.ts)')
    .option('-r, --root <dir>', 'Root directory of the project', process.cwd())
    .option('--models <dir>', 'Models directory relative to root')
    .option('--services <dir>', 'Services directory relative to root')
    .option('--pages <dir>', 'Pages directory relative to root', 'pages')
    .option('--no-env-file', 'Skip generating webspresso-env.d.ts at project root')
    .option('-w, --watch', 'Watch models, services, and pages directories for changes')
    .option('-s, --silent', 'Suppress console output', false)
    .action((options) => {
      const rootDir = path.resolve(options.root || process.cwd());

      const runOnce = () => {
        const startTime = Date.now();
        const result = generateTypes({
          rootDir,
          modelsDir: options.models,
          servicesDir: options.services,
          pagesDir: options.pages,
          outFile: options.out,
          createEnvFile: options.envFile !== false,
          silent: true,
        });

        const elapsed = Date.now() - startTime;
        if (!options.silent) {
          const relOut = path.relative(rootDir, result.outFile);
          console.log(`\n⚡ [Webspresso TypeGen] Completed in ${elapsed}ms`);
          console.log(`   ✓ Models:   ${result.modelsCount}`);
          console.log(`   ✓ Services: ${result.servicesCount}`);
          console.log(`   ✓ Routes:   ${result.routesCount}`);
          console.log(`   → Output:   ${relOut}`);
          if (result.envFile) {
            console.log(`   → Env Ref:  ${path.relative(rootDir, result.envFile)}`);
          }
          console.log('');
        }
        return result;
      };

      runOnce();

      // Watch mode
      if (options.watch) {
        if (!options.silent) {
          console.log('👀 Watching models, services, and pages for changes... (Press Ctrl+C to stop)\n');
        }

        const watchDirs = [
          options.models || 'models',
          options.models || 'src/models',
          options.services || 'services',
          options.services || 'src/services',
          options.pages || 'pages',
          options.pages || 'src/pages',
        ]
          .map((d) => path.resolve(rootDir, d))
          .filter((d) => fs.existsSync(d));

        const uniqueDirs = Array.from(new Set(watchDirs));
        let debounceTimer = null;

        for (const dir of uniqueDirs) {
          try {
            fs.watch(dir, { recursive: true }, (eventType, filename) => {
              if (
                filename &&
                (filename.endsWith('.js') || filename.endsWith('.ts') || filename.endsWith('.njk'))
              ) {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                  if (!options.silent) {
                    console.log(`🔄 Detected change in ${filename}, regenerating types...`);
                  }
                  runOnce();
                }, 150);
              }
            });
          } catch {
            // Watch unsupported on platform or directory
          }
        }
      }
    });
}

module.exports = {
  registerCommand,
};
