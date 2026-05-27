/**
 * webspresso add deploy — scaffold deploy provider files
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES_ROOT = path.join(__dirname, '../../templates/deploy');

const PROVIDERS = {
  docker: ['Dockerfile', '.dockerignore', 'docker-compose.yml'],
  pm2: ['ecosystem.config.js'],
  cloudflare: ['wrangler.toml', 'src/worker.js', 'webspresso.build.js.example', 'webspresso.db.js.example'],
};

function copyTemplate(provider, filename, cwd) {
  const src = path.join(TEMPLATES_ROOT, provider, filename);
  if (!fs.existsSync(src)) return false;

  let destName = filename;
    if (filename === 'webspresso.build.js.example') {
      destName = 'webspresso.build.js';
      if (fs.existsSync(path.join(cwd, destName))) {
        console.log(`   ⏭  ${destName} already exists — skipped`);
        return false;
      }
    }
    if (filename === 'webspresso.db.js.example') {
      destName = 'webspresso.db.js';
      if (fs.existsSync(path.join(cwd, destName))) {
        console.log(`   ⏭  ${destName} already exists — skipped`);
        return false;
      }
    }

  const dest = path.join(cwd, destName);
  if (fs.existsSync(dest) && destName !== 'webspresso.build.js') {
    console.log(`   ⏭  ${destName} already exists — skipped`);
    return false;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`   ✓ ${destName}`);
  return true;
}

function registerCommand(addProgram) {
  addProgram
    .command('deploy')
    .description('Add deployment provider files (docker, pm2, cloudflare)')
    .requiredOption('-p, --provider <name>', 'Provider: docker, pm2, cloudflare (comma-separated)')
    .action((options) => {
      const cwd = process.cwd();
      const names = String(options.provider)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      if (!names.length) {
        console.error('❌ Provide at least one provider: --provider docker|pm2|cloudflare');
        process.exit(1);
      }

      console.log('\n📦 Adding deploy provider files...\n');

      for (const name of names) {
        const files = PROVIDERS[name];
        if (!files) {
          console.error(`❌ Unknown provider "${name}". Use: docker, pm2, cloudflare`);
          process.exit(1);
        }
        console.log(`Provider: ${name}`);
        for (const file of files) {
          copyTemplate(name, file, cwd);
        }
        console.log('');
      }

      console.log('Done. Run `webspresso build --adapter <name>` then deploy.\n');
    });
}

module.exports = { registerCommand };
