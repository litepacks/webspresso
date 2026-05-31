/**
 * Doctor Command — environment and project sanity checks
 */

const fs = require('fs');
const path = require('path');
const { resolveDbConfigIfExists, createDbInstance } = require('../utils/db');
const {
  discoverPluginsFromAppConfig,
  isEdgeCompatible,
} = require('../../core/build/phases/03-compile/plugins');

/** @param {string} envPath */
function parseEnvFile(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    let val = t.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function hasLockfile(cwd) {
  return ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'].some((f) =>
    fs.existsSync(path.join(cwd, f))
  );
}

/**
 * @param {string} enginesNode - e.g. ">=18.0.0", "^20.1.0"
 * @returns {boolean|null} null if could not interpret
 */
function nodeEngineOk(enginesNode) {
  const v = process.version;
  const major = parseInt(v.replace(/^v/, '').split('.')[0], 10);
  if (Number.isNaN(major)) return null;

  const s = String(enginesNode).trim();
  const ge = s.match(/^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (ge) {
    const reqMajor = parseInt(ge[1], 10);
    return major >= reqMajor;
  }
  const gt = s.match(/^>\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (gt) {
    const reqMajor = parseInt(gt[1], 10);
    return major > reqMajor;
  }
  const caret = s.match(/^\^\s*(\d+)/);
  if (caret) {
    const reqMajor = parseInt(caret[1], 10);
    return major === reqMajor;
  }
  const exact = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (exact) {
    const reqMajor = parseInt(exact[1], 10);
    return major === reqMajor;
  }
  return null;
}

function registerCommand(program) {
  program
    .command('doctor')
    .description('Check Node version, project layout, and optional database connectivity')
    .option('--db', 'Run a database connection test when webspresso.db.js or knexfile.js exists')
    .option('--migrations', 'Report pending migrations when database config exists')
    .option('--strict', 'Exit with code 1 if any warning is reported')
    .option('-e, --env <environment>', 'Environment for DB config (with --db)', 'development')
    .action(async (options) => {
      const cwd = process.cwd();
      let errors = 0;
      let warnings = 0;

      const line = (icon, msg) => console.log(`  ${icon} ${msg}`);

      console.log('\nWebspresso Doctor');
      console.log('=================\n');

      console.log('Environment');
      console.log('-----------');
      line('✓', `Node.js ${process.version} (${process.platform}, ${process.arch})`);

      const pkgPath = path.join(cwd, 'package.json');
      let pkg = null;
      if (!fs.existsSync(pkgPath)) {
        line('✗', 'package.json not found (run this from a project directory)');
        errors += 1;
      } else {
        try {
          pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          line('✓', `package.json readable (${pkg.name || 'unnamed'})`);
        } catch (e) {
          line('✗', `package.json invalid JSON: ${e.message}`);
          errors += 1;
        }
      }

      if (pkg && pkg.engines && pkg.engines.node) {
        const ok = nodeEngineOk(pkg.engines.node);
        if (ok === null) {
          line('⚠', `engines.node "${pkg.engines.node}" — could not verify; check manually`);
          warnings += 1;
        } else if (ok) {
          line('✓', `engines.node "${pkg.engines.node}" satisfied`);
        } else {
          line('⚠', `engines.node "${pkg.engines.node}" may not match current Node (adjust nvm / install)`);
          warnings += 1;
        }
      }

      if (pkg) {
        console.log('\nDependencies');
        console.log('--------------');
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.webspresso) {
          line('✓', `webspresso dependency (${deps.webspresso})`);
        } else {
          line('⚠', 'webspresso not listed in package.json dependencies');
          warnings += 1;
        }
        if (hasLockfile(cwd)) {
          line('✓', 'Package manager lockfile present');
        } else {
          line('⚠', 'No lockfile — run npm install (or pnpm/yarn) and commit the lockfile');
          warnings += 1;
        }
      }

      console.log('\nProject layout');
      console.log('--------------');

      const serverPath = path.join(cwd, 'server.js');
      if (fs.existsSync(serverPath)) {
        line('✓', 'server.js present');
      } else {
        line('⚠', 'server.js not found (expected for standard Webspresso apps)');
        warnings += 1;
      }

      const pagesPath = path.join(cwd, 'pages');
      if (fs.existsSync(pagesPath) && fs.statSync(pagesPath).isDirectory()) {
        line('✓', 'pages/ directory present');
      } else {
        line('⚠', 'pages/ not found (file-based routes may be missing)');
        warnings += 1;
      }

      console.log('\nEnvironment files');
      console.log('-----------------');

      const envExamplePath = path.join(cwd, '.env.example');
      const envPath = path.join(cwd, '.env');
      if (fs.existsSync(envExamplePath)) {
        line('✓', '.env.example present');
      } else {
        line('○', 'No .env.example (optional; new scaffolds include one)');
      }
      if (fs.existsSync(envPath)) {
        line('✓', '.env present');
      } else if (fs.existsSync(envExamplePath)) {
        line('⚠', 'No .env — copy .env.example to .env if the app expects env vars');
        warnings += 1;
      } else {
        line('○', 'No .env (fine if you do not use dotenv in this project)');
      }
      const loadEnvPath = path.join(cwd, 'config', 'load-env.js');
      if (fs.existsSync(loadEnvPath)) {
        line('✓', 'config/load-env.js present (dotenv chain scaffold)');
      }

      console.log('\nSecrets & auth');
      console.log('----------------');
      const envVars = parseEnvFile(envPath);
      const sessionSecret = envVars.SESSION_SECRET || envVars.AUTH_SESSION_SECRET;
      if (sessionSecret && sessionSecret.length >= 32) {
        line('✓', 'SESSION_SECRET / AUTH_SESSION_SECRET length OK (32+)');
      } else if (sessionSecret) {
        line('⚠', 'Session secret is shorter than 32 characters — use a longer random value');
        warnings += 1;
      } else if (fs.existsSync(envPath)) {
        const appSrc = fs.existsSync(path.join(cwd, 'config', 'app.js'))
          ? fs.readFileSync(path.join(cwd, 'config', 'app.js'), 'utf8')
          : '';
        const needsAuth =
          /quickAuth|createAuth|adminPanelPlugin|authTokens/.test(appSrc) ||
          discoverPluginsFromAppConfig(cwd).some((p) => /admin|auth/i.test(p));
        if (needsAuth) {
          line('⚠', 'SESSION_SECRET or AUTH_SESSION_SECRET not set in .env (required for auth/admin)');
          warnings += 1;
        } else {
          line('○', 'No session secret in .env (OK if auth/admin not used)');
        }
      }

      const plugins = discoverPluginsFromAppConfig(cwd);
      const usesEmail = plugins.some((p) => /email/i.test(p));
      if (usesEmail) {
        const smtpOk =
          envVars.SMTP_HOST && envVars.SMTP_USER && (envVars.SMTP_PASS || envVars.SMTP_PASSWORD);
        if (smtpOk && envVars.MAIL_FROM) {
          line('✓', 'SMTP_* and MAIL_FROM set for email plugin');
        } else {
          line('⚠', 'Email plugin detected but SMTP_* / MAIL_FROM incomplete in .env');
          warnings += 1;
        }
      }

      console.log('\nPlugins (static scan)');
      console.log('---------------------');
      const wranglerPath = path.join(cwd, 'wrangler.toml');
      const hasCf =
        fs.existsSync(wranglerPath) || fs.existsSync(path.join(cwd, 'webspresso.build.js'));

      if (plugins.length === 0) {
        line('○', 'No *Plugin references found in config/app.js');
      } else {
        for (const name of plugins) {
          const edge = isEdgeCompatible(name);
          if (!edge && hasCf) {
            line('⚠', `${name} — Node-only (incompatible with Cloudflare Workers)`);
            warnings += 1;
          } else if (!edge) {
            line('○', `${name} — Node-only`);
          } else {
            line('✓', name);
          }
        }
      }

      if (hasCf && plugins.some((p) => !isEdgeCompatible(p))) {
        line('⚠', 'Cloudflare deploy config with Node-only plugins — remove them or deploy on Node');
        warnings += 1;
      }

      console.log('\nDatabase config');
      console.log('---------------');

      let resolved = null;
      let configLoadError = false;
      try {
        resolved = resolveDbConfigIfExists();
      } catch (e) {
        configLoadError = true;
        line('✗', `Database config could not be loaded: ${e.message}`);
        errors += 1;
      }

      if (resolved) {
        line('✓', `Found ${path.relative(cwd, resolved.path)}`);
      } else if (!configLoadError) {
        line('○', 'No webspresso.db.js or knexfile.js (ORM/CLI DB commands need one)');
      }

      if (options.db) {
        console.log('\nDatabase connection (--db)');
        console.log('--------------------------');
        if (!resolved) {
          line('○', 'Skipped — no database config file');
        } else {
          let knexMod;
          try {
            knexMod = require('knex');
          } catch {
            line('✗', 'knex is not installed. Run: npm install knex');
            errors += 1;
          }
          if (knexMod) {
            let knex;
            try {
              knex = await createDbInstance(resolved.config, options.env);
              await knex.raw('select 1');
              line('✓', `Connection OK (env: ${options.env})`);
            } catch (e) {
              line('✗', `Connection failed: ${e.message}`);
              errors += 1;
            } finally {
              if (knex && typeof knex.destroy === 'function') {
                try {
                  await knex.destroy();
                } catch {
                  /* ignore */
                }
              }
            }
          }
        }
      }

      if (options.migrations) {
        console.log('\nMigrations (--migrations)');
        console.log('-------------------------');
        if (!resolved) {
          line('○', 'Skipped — no database config file');
        } else {
          let knexMod;
          try {
            knexMod = require('knex');
          } catch {
            line('✗', 'knex is not installed. Run: npm install knex');
            errors += 1;
          }
          if (knexMod) {
            let knex;
            try {
              knex = await createDbInstance(resolved.config, options.env);
              const migrationConfig = resolved.config.migrations || {};
              const [, pending] = await knex.migrate.list(migrationConfig);
              if (pending.length === 0) {
                line('✓', 'No pending migrations');
              } else {
                line('⚠', `${pending.length} pending migration(s) — run: webspresso db:migrate`);
                warnings += 1;
              }
            } catch (e) {
              line('✗', `Migration check failed: ${e.message}`);
              errors += 1;
            } finally {
              if (knex && typeof knex.destroy === 'function') {
                try {
                  await knex.destroy();
                } catch {
                  /* ignore */
                }
              }
            }
          }
        }
      }

      console.log('');

      const strict = options.strict === true;
      const failWarnings = strict && warnings > 0;
      const exitCode = errors > 0 || failWarnings ? 1 : 0;

      if (errors > 0) {
        console.log(`Summary: ${errors} error(s)${warnings ? `, ${warnings} warning(s)` : ''}\n`);
      } else if (warnings > 0) {
        console.log(`Summary: ${warnings} warning(s)${strict ? ' (strict: treating as failure)' : ''}\n`);
      } else {
        console.log('Summary: all checks passed.\n');
      }

      process.exit(exitCode);
    });
}

module.exports = { registerCommand };
