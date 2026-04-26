/**
 * Upgrade Command — bump the webspresso dependency in the current project
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PKG_NAME = 'webspresso';

/**
 * @param {string} cwd
 * @returns {'npm'|'pnpm'|'yarn'}
 */
function detectPackageManager(cwd) {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * @param {object} pkg
 * @returns {{ specifier: string, saveDev: boolean } | null}
 */
function findWebspressoDep(pkg) {
  if (!pkg || typeof pkg !== 'object') return null;
  const prod = pkg.dependencies && pkg.dependencies[PKG_NAME];
  const dev = pkg.devDependencies && pkg.devDependencies[PKG_NAME];
  if (prod) return { specifier: String(prod), saveDev: false };
  if (dev) return { specifier: String(dev), saveDev: true };
  return null;
}

function isNonRegistrySpecifier(spec) {
  return /^(file:|link:|workspace:|git\+|github:|http:|https:)/i.test(spec.trim());
}

/**
 * @param {'npm'|'pnpm'|'yarn'} pm
 * @param {string} tag
 * @param {boolean} saveDev
 * @returns {string[]}
 */
function buildInstallArgs(pm, tag, saveDev) {
  const spec = `${PKG_NAME}@${tag}`;
  if (pm === 'npm') {
    return saveDev
      ? ['install', spec, '--save-dev']
      : ['install', spec, '--save'];
  }
  if (pm === 'pnpm') {
    return saveDev ? ['add', '-D', spec] : ['add', spec];
  }
  /* yarn */
  return saveDev ? ['add', '-D', spec] : ['add', spec];
}

function registerCommand(program) {
  program
    .command('upgrade')
    .description(
      'Upgrade the webspresso package in the current project (npm/pnpm/yarn)'
    )
    .option(
      '-t, --tag <dist-tag>',
      'npm dist-tag (e.g. latest, next)',
      'latest'
    )
    .option('--pm <manager>', 'Force package manager: npm, pnpm, or yarn')
    .option('--dry-run', 'Print the install command without running it')
    .action((options) => {
      const cwd = process.cwd();
      const pkgPath = path.join(cwd, 'package.json');

      if (!fs.existsSync(pkgPath)) {
        console.error('❌ package.json not found. Run this from your project root.');
        process.exit(1);
      }

      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch (e) {
        console.error(`❌ Could not read package.json: ${e.message}`);
        process.exit(1);
      }

      const found = findWebspressoDep(pkg);
      if (!found) {
        console.error(
          `❌ No "${PKG_NAME}" entry in dependencies or devDependencies.`
        );
        console.error('   Add it first, e.g. npm install webspresso');
        process.exit(1);
      }

      if (isNonRegistrySpecifier(found.specifier)) {
        console.error(
          `❌ "${PKG_NAME}" is not a registry semver range (current: ${found.specifier}).`
        );
        console.error(
          '   For file:/link:/workspace: installs, change package.json manually or point to a published version.'
        );
        process.exit(1);
      }

      let pm = options.pm;
      if (pm) {
        pm = String(pm).toLowerCase();
        if (!['npm', 'pnpm', 'yarn'].includes(pm)) {
          console.error('❌ --pm must be npm, pnpm, or yarn');
          process.exit(1);
        }
      } else {
        pm = detectPackageManager(cwd);
      }

      const args = buildInstallArgs(pm, options.tag, found.saveDev);
      const cmd = `${pm} ${args.join(' ')}`;

      console.log('\nWebspresso upgrade');
      console.log('==================\n');
      console.log(`  Package manager: ${pm}`);
      console.log(`  Target:          ${PKG_NAME}@${options.tag}`);
      console.log(`  Save as:         ${found.saveDev ? 'devDependency' : 'dependency'}`);
      console.log(`  Current range:   ${found.specifier}\n`);

      if (options.dryRun) {
        console.log(`Dry run — would run:\n  ${cmd}\n`);
        return;
      }

      try {
        execSync(cmd, { stdio: 'inherit', cwd, shell: true });
        console.log(
          '\n✅ Upgrade finished. If you use native addons (better-sqlite3, bcrypt, sharp), run:\n' +
            '   npm run rebuild:native\n' +
            '   (or: npm rebuild better-sqlite3 bcrypt sharp)\n'
        );
      } catch {
        process.exit(1);
      }
    });
}

module.exports = { registerCommand, detectPackageManager, findWebspressoDep };
