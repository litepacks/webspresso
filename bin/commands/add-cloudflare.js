/**
 * Add Cloudflare Command
 * Generate production-ready wrangler.toml and worker.js for Cloudflare Workers / Pages
 * @module bin/commands/add-cloudflare
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Generate wrangler.toml content
 * @param {Object} options
 * @param {string} options.appName
 * @param {boolean} [options.d1=true]
 * @param {boolean} [options.kv=false]
 * @param {boolean} [options.queue=false]
 * @param {boolean} [options.assets=true]
 * @returns {string}
 */
function generateWranglerToml({ appName, d1 = true, kv = false, queue = false, assets = true }) {
  const lines = [
    `# Cloudflare Workers configuration for Webspresso`,
    `name = "${appName}"`,
    `main = "worker.js"`,
    `compatibility_date = "2024-09-23"`,
    `compatibility_flags = ["nodejs_compat"]`,
    ``,
  ];

  if (assets) {
    lines.push(
      `# Static asset serving via Workers Assets / Pages`,
      `[assets]`,
      `directory = "./public"`,
      `binding = "ASSETS"`,
      ``
    );
  }

  if (d1) {
    lines.push(
      `# Cloudflare D1 Serverless SQL Database`,
      `[[d1_databases]]`,
      `binding = "DB"`,
      `database_name = "${appName}-db"`,
      `database_id = "YOUR_D1_DATABASE_ID_HERE"`,
      `migrations_dir = "./migrations"`,
      ``
    );
  }

  if (kv) {
    lines.push(
      `# Cloudflare KV for fast distributed session storage`,
      `[[kv_namespaces]]`,
      `binding = "SESSIONS"`,
      `id = "YOUR_KV_NAMESPACE_ID_HERE"`,
      ``
    );
  }

  if (queue) {
    lines.push(
      `# Cloudflare Queues for guaranteed background jobs`,
      `[[queues.producers]]`,
      `binding = "QUEUE"`,
      `queue = "${appName}-queue"`,
      ``,
      `[[queues.consumers]]`,
      `queue = "${appName}-queue"`,
      `max_batch_size = 10`,
      `max_batch_timeout = 5`,
      ``
    );
  }

  lines.push(
    `[observability]`,
    `enabled = true`,
    ``
  );

  return lines.join('\n');
}

/**
 * Generate worker.js edge bridge entry point
 * @param {Object} options
 * @param {boolean} [options.d1=true]
 * @param {boolean} [options.queue=false]
 * @returns {string}
 */
function generateWorkerJs({ d1 = true, queue = false }) {
  const d1Snippet = d1
    ? `    // Connect Cloudflare D1 to Webspresso ORM if binding is available
    let db;
    if (env.DB) {
      db = createDatabase({ client: 'd1', d1: env.DB });
    }
`
    : '';

  const queueConsumer = queue
    ? `
  /**
   * Process background jobs from Cloudflare Queues
   */
  async queue(batch, env, ctx) {
    if (app.queue && typeof app.queue.processBatch === 'function') {
      await app.queue.processBatch(batch);
    }
  },`
    : '';

  return `/**
 * Cloudflare Workers Edge Entry Point for Webspresso
 * Generated via \`npx webspresso add:cloudflare\`
 */

import { createApp${d1 ? ', createDatabase' : ''} } from 'webspresso';

// Initialize Webspresso app with high-performance Hono Edge adapter
const app = createApp({
  adapter: 'hono',
});

export default {
  /**
   * Handle incoming HTTP requests
   */
  async fetch(request, env, ctx) {
${d1Snippet}    return app.handle(request, {
      env,
      ctx,${d1 ? '\n      db,' : ''}
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },${queueConsumer}
};
`;
}

/**
 * Register command with Commander
 * @param {import('commander').Command} program
 */
function registerCommand(program) {
  program
    .command('add:cloudflare')
    .alias('cloudflare')
    .alias('add-cloudflare')
    .description('Generate production-ready wrangler.toml and worker.js for Cloudflare Workers')
    .option('--no-d1', 'Do not configure Cloudflare D1 database binding')
    .option('--kv', 'Configure Cloudflare KV for session storage', false)
    .option('--queue', 'Configure Cloudflare Queues for background tasks', false)
    .option('-f, --force', 'Overwrite existing files without prompting', false)
    .action(async (...actionArgs) => {
      const cmd = actionArgs[actionArgs.length - 1];
      const options = (cmd && typeof cmd.opts === 'function')
        ? cmd.opts()
        : (actionArgs.find((a) => a && typeof a === 'object') || {});

      const cwd = process.cwd();
      const pkgPath = path.join(cwd, 'package.json');

      if (!fs.existsSync(pkgPath)) {
        console.error('❌ Not a Webspresso project! package.json was not found in current directory.');
        process.exit(1);
      }

      let pkg = {};
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch (err) {
        console.error(`❌ Failed to parse package.json: ${err.message}`);
        process.exit(1);
      }

      const appName = pkg.name ? pkg.name.replace(/[^a-zA-Z0-9_-]/g, '-') : 'webspresso-app';
      const force = Boolean(options.force);
      const d1 = options.d1 !== false;
      const kv = Boolean(options.kv);
      const queue = Boolean(options.queue);

      const wranglerPath = path.join(cwd, 'wrangler.toml');
      const workerPath = path.join(cwd, 'worker.js');

      console.log(`\n☁️  Scaffolding Cloudflare Workers configuration for "${appName}"...`);

      // 1. wrangler.toml
      if (fs.existsSync(wranglerPath) && !force) {
        console.log(`⚠️  ${path.basename(wranglerPath)} already exists. Skipping (use --force to overwrite).`);
      } else {
        const tomlContent = generateWranglerToml({ appName, d1, kv, queue, assets: true });
        fs.writeFileSync(wranglerPath, tomlContent, 'utf8');
        console.log(`✅ Created ${path.basename(wranglerPath)}`);
      }

      // 2. worker.js
      if (fs.existsSync(workerPath) && !force) {
        console.log(`⚠️  ${path.basename(workerPath)} already exists. Skipping (use --force to overwrite).`);
      } else {
        const workerContent = generateWorkerJs({ d1, queue });
        fs.writeFileSync(workerPath, workerContent, 'utf8');
        console.log(`✅ Created ${path.basename(workerPath)}`);
      }

      // 3. Update package.json scripts
      let modifiedPkg = false;
      if (!pkg.scripts) pkg.scripts = {};
      if (!pkg.scripts['cf:dev']) {
        pkg.scripts['cf:dev'] = 'wrangler dev';
        modifiedPkg = true;
      }
      if (!pkg.scripts['cf:deploy']) {
        pkg.scripts['cf:deploy'] = 'wrangler deploy';
        modifiedPkg = true;
      }

      if (modifiedPkg) {
        try {
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
          console.log(`✅ Added "cf:dev" and "cf:deploy" scripts to package.json`);
        } catch (_) {}
      }

      console.log('\n🎉 Cloudflare Workers setup complete!');
      console.log('\nNext steps:');
      console.log('  1. Run `npx wrangler dev` to test locally on Cloudflare Workerd isolate');
      console.log('  2. Create your D1 database: `npx wrangler d1 create ' + appName + '-db`');
      console.log('  3. Deploy to the edge: `npx wrangler deploy`\n');
    });
}

module.exports = {
  registerCommand,
  generateWranglerToml,
  generateWorkerJs,
};
