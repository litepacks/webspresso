'use strict';

/**
 * Webspresso CLI - openapi / api:docs Command
 * Generate and export OpenAPI 3 specification from application routes
 * @module bin/commands/openapi
 */

const fs = require('fs');
const path = require('path');
const { scanRoutes } = require('../../src/discovery/scan-routes');
const { compileRouteTable } = require('../../src/routing/route-table');
const { buildOpenApiDocument } = require('../../core/openapi/build-from-api-routes');

function registerCommand(program) {
  program
    .command('openapi')
    .alias('api:docs')
    .description('Generate and export OpenAPI 3 specification from application routes')
    .option('-o, --out <file>', 'Output JSON file path (e.g. openapi.json or public/openapi.json)')
    .option('-r, --root <dir>', 'Root directory of the project', process.cwd())
    .option('--pages <dir>', 'Pages directory relative to root', 'pages')
    .option('--title <title>', 'OpenAPI specification title override')
    .option('--api-version <version>', 'OpenAPI specification version override')
    .option('--description <desc>', 'OpenAPI specification description override')
    .option('--server <url>', 'Default server URL in spec', 'http://localhost:3000')
    .option('--include-orm', 'Include ORM model schemas in components', false)
    .option('--indent <spaces>', 'JSON indentation spaces', '2')
    .option('-p, --print', 'Print specification JSON to stdout', false)
    .action((options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const pagesRelDir = options.pages || 'pages';
      const pagesDir = path.resolve(rootDir, pagesRelDir);
      const apiDir = path.resolve(pagesDir, 'api');

      if (!fs.existsSync(pagesDir) && !fs.existsSync(apiDir)) {
        console.warn(`[webspresso] Warning: Pages directory not found at: ${pagesDir}`);
      }

      // Discover routes
      const descriptors = scanRoutes({
        rootDir,
        pages: fs.existsSync(pagesDir) ? { dir: pagesRelDir } : true,
        api: fs.existsSync(apiDir) ? { dir: path.join(pagesRelDir, 'api') } : true,
      });

      const routeTable = compileRouteTable(descriptors, { isDev: true });
      const routes = routeTable.list();

      // Read package.json metadata if available
      let pkg = {};
      const pkgPath = path.join(rootDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        } catch {
          // ignore invalid json
        }
      }

      const docTitle = options.title || pkg.name || 'Webspresso API';
      const docVersion = options.apiVersion || pkg.version || '1.0.0';
      const docDescription =
        options.description ||
        pkg.description ||
        'OpenAPI 3.0 specification generated from Webspresso file-based API routes.';

      const doc = buildOpenApiDocument({
        routes,
        pagesDir,
        includeOrmSchemas: Boolean(options.includeOrm),
        info: {
          title: docTitle,
          version: docVersion,
          description: docDescription,
        },
        servers: [{ url: String(options.server).replace(/\/$/, '') }],
      });

      const indent = parseInt(options.indent, 10) || 2;
      const formattedJson = JSON.stringify(doc, null, indent);

      if (options.out) {
        const targetPath = path.resolve(rootDir, options.out);
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(targetPath, formattedJson, 'utf8');

        const relPath = path.relative(rootDir, targetPath);
        const pathCount = Object.keys(doc.paths || {}).length;
        console.log(`\x1b[32m✔\x1b[0m Generated OpenAPI 3 specification with ${pathCount} path(s) -> \x1b[1m${relPath}\x1b[0m`);
      }

      if (!options.out || options.print) {
        console.log(formattedJson);
      }
    });
}

module.exports = { registerCommand };
