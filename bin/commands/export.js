'use strict';

/**
 * Webspresso CLI Export Command
 * Prerender pages into static HTML files for static hosting
 * @module bin/commands/export
 */

const fs = require('fs');
const path = require('path');
const { exportStaticSite } = require('../../core/export');

function registerCommand(program) {
  program
    .command('export')
    .description('Export and prerender application pages into static HTML files for Cloudflare Pages, S3, or Vercel')
    .option('-o, --out <dir>', 'Output directory for exported files', 'dist')
    .option('-b, --base-url <url>', 'Base URL for canonical links and sitemap.xml')
    .option('-c, --clean', 'Clean output directory before export', true)
    .option('--no-clean', 'Do not clean output directory before export')
    .option('--no-assets', 'Skip copying public static assets')
    .option('--no-clean-urls', 'Generate "path.html" instead of "path/index.html"')
    .option('--sitemap', 'Generate sitemap.xml for prerendered routes', false)
    .option('--concurrency <n>', 'Number of concurrent render requests', '5')
    .option('--silent', 'Suppress log output', false)
    .action(async (options = {}) => {
      const cwd = process.cwd();
      const pkgPath = path.join(cwd, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        console.error('❌ Not a Webspresso project! Run this command in your project directory.');
        process.exit(1);
      }

      const outDir = options.out || 'dist';
      const clean = options.clean !== false;
      const cleanUrls = options.cleanUrls !== false;
      const copyAssets = options.assets !== false;
      const sitemap = options.sitemap || Boolean(options.baseUrl);
      const baseUrl = options.baseUrl;
      const concurrency = parseInt(options.concurrency, 10) || 5;
      const silent = options.silent === true;

      // Check if project has a custom server.js
      let serverConfig = {};
      const serverJsPath = path.join(cwd, 'server.js');
      if (fs.existsSync(serverJsPath)) {
        try {
          // If server.js exports a function or config object
          const srv = require(serverJsPath);
          if (srv && typeof srv === 'object') {
            serverConfig = srv;
          }
        } catch (_) {}
      }

      try {
        const result = await exportStaticSite({
          cwd,
          outDir,
          clean,
          cleanUrls,
          copyAssets,
          sitemap,
          baseUrl,
          concurrency,
          silent,
          serverConfig,
        });

        if (result.errors && result.errors.length > 0) {
          console.error(`⚠️  Static export completed with ${result.errors.length} error(s).`);
          process.exitCode = 1;
        } else {
          if (!silent) {
            console.log(`✅ Static export succeeded: ${result.rendered} page(s) ready in "${outDir}".`);
          }
        }
      } catch (err) {
        console.error('❌ Static export failed:', err.message);
        process.exit(1);
      }
    });
}

module.exports = {
  registerCommand,
};
