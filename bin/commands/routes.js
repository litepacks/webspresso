'use strict';

/**
 * Webspresso CLI - routes Command
 * Inspect and display compiled application routes
 * @module bin/commands/routes
 */

const path = require('path');
const fs = require('fs');
const { scanRoutes } = require('../../src/discovery/scan-routes');
const { compileRouteTable } = require('../../src/routing/route-table');
const { formatRouteTable } = require('../../src/dev/banner');

function registerCommand(program) {
  program
    .command('routes')
    .description('List and inspect all discovered application routes')
    .option('-a, --api', 'Filter to only API endpoints')
    .option('-p, --pages', 'Filter to only SSR page routes')
    .option('-j, --json', 'Output routes as JSON')
    .option('-m, --manifest', 'Generate or update .webspresso/routes.manifest.json')
    .option('--root <dir>', 'Root directory of the project', process.cwd())
    .action((options) => {
      const rootDir = path.resolve(options.root || process.cwd());

      if (options.manifest) {
        const { generateRouteManifest } = require('../../src/discovery/route-manifest');
        const result = generateRouteManifest({ rootDir });
        console.log(`✅ AOT route manifest written to: ${path.relative(rootDir, result.manifestPath)} (${result.routeCount} routes)`);
        return;
      }

      const descriptors = scanRoutes({
        rootDir,
        pages: fs.existsSync(path.join(rootDir, 'pages')) ? { dir: 'pages' } : true,
        api: fs.existsSync(path.join(rootDir, 'pages', 'api')) ? { dir: 'pages/api' } : true,
      });

      const routeTable = compileRouteTable(descriptors, { isDev: true });
      let routes = routeTable.list();

      if (options.api) {
        routes = routes.filter((r) => r.type === 'api' || (r.path && r.path.startsWith('/api')));
      } else if (options.pages) {
        routes = routes.filter((r) => r.type === 'page' && (!r.path || !r.path.startsWith('/api')));
      }

      if (options.json) {
        console.log(JSON.stringify(routes, null, 2));
        return;
      }

      console.log('');
      console.log(formatRouteTable(routes, { limit: 200 }));
      console.log('');
    });
}

module.exports = { registerCommand };
