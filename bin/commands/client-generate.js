'use strict';

/**
 * Webspresso CLI - client:generate Command
 * Generates an end-to-end type-safe frontend client for Next.js, Vite, React, Vue, or Mobile
 * @module bin/commands/client-generate
 */

const path = require('path');
const { generateClient } = require('../../src/dev/client-gen');

function registerCommand(program) {
  program
    .command('client:generate')
    .alias('client:gen')
    .alias('generate:client')
    .description('Generate type-safe frontend API client for browser, React, Next.js, Vite, or mobile')
    .option('-o, --out <file>', 'Output TypeScript client file path (default: src/client.ts or .webspresso/client.ts)')
    .option('-r, --root <dir>', 'Root directory of the project', process.cwd())
    .option('--pages <dir>', 'Pages directory relative to root', 'pages')
    .option('--base-url <url>', 'Default API base URL (e.g. https://api.example.com)')
    .option('-s, --silent', 'Suppress console output', false)
    .action((options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const startTime = Date.now();

      const result = generateClient({
        rootDir,
        pagesDir: options.pages,
        outFile: options.out,
        baseUrl: options.baseUrl,
        silent: true,
      });

      const elapsed = Date.now() - startTime;
      if (!options.silent) {
        const relOut = path.relative(rootDir, result.outFile);
        console.log(`\n⚡ [Webspresso Client Generator] Completed in ${elapsed}ms`);
        console.log(`   ✓ Scanned Routes: ${result.routesCount}`);
        console.log(`   → Output File:    ${relOut}`);
        console.log(`\nUsage example in your frontend app:`);
        console.log(`   import { createWebspressoClient } from './${relOut.replace(/\\.[^/.]+$/, '')}';`);
        console.log(`   const client = createWebspressoClient({ baseUrl: 'http://localhost:3000' });`);
        console.log(`   const notes = await client.api.notes.get();\n`);
      }
      return result;
    });
}

module.exports = {
  registerCommand,
};
