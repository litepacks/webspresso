/**
 * Deploy Check Command (Production Preflight Verification)
 * Validates environment, secrets, container hardening, database migrations, and health checks
 * @module bin/commands/deploy-check
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveDbConfigIfExists, createDbInstance } = require('../utils/db');

/**
 * Known weak secret patterns that should never be used in production
 */
const WEAK_SECRET_PATTERNS = [
  /change-me/i,
  /your-secret/i,
  /super-secret/i,
  /secret-key/i,
  /webspresso-secret/i,
  /123456/,
  /password/i,
  /^secret$/i,
  /^default$/i,
  /^test$/i,
];

/**
 * Load .env file into key-value map without modifying process.env
 * @param {string} envPath
 * @returns {Record<string, string>}
 */
function parseEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

/**
 * Run production preflight checks
 * @param {Object} options
 * @param {string} [options.cwd=process.cwd()]
 * @param {string} [options.env='production']
 * @returns {Promise<{ passed: boolean, errors: Array<{ check: string, message: string }>, warnings: Array<{ check: string, message: string }>, successes: Array<{ check: string, message: string }> }>}
 */
async function runDeployCheck(options = {}) {
  const cwd = options.cwd || process.cwd();
  const targetEnv = options.env || 'production';

  const successes = [];
  const warnings = [];
  const errors = [];

  const addPass = (check, message) => successes.push({ check, message });
  const addWarn = (check, message) => warnings.push({ check, message });
  const addError = (check, message) => errors.push({ check, message });

  // Load environment variables from process.env and local .env files
  const localEnv = {
    ...parseEnvFile(path.join(cwd, '.env')),
    ...parseEnvFile(path.join(cwd, `.env.${targetEnv}`)),
    ...process.env,
  };

  // ----------------------------------------------------
  // 1. Project & Server Basics
  // ----------------------------------------------------
  const pkgPath = path.join(cwd, 'package.json');
  let pkg = {};
  if (!fs.existsSync(pkgPath)) {
    addError('package.json', 'package.json not found in current directory');
  } else {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      addPass('package.json', `Readable (${pkg.name || 'unnamed'})`);
    } catch (e) {
      addError('package.json', `Invalid JSON: ${e.message}`);
    }
  }

  const serverPath = path.join(cwd, 'server.js');
  let serverCode = '';
  if (fs.existsSync(serverPath)) {
    serverCode = fs.readFileSync(serverPath, 'utf8');
    addPass('server.js', 'server.js entrypoint found');
  } else {
    addError('server.js', 'server.js not found (required for production runtime)');
  }

  // ----------------------------------------------------
  // 2. Production Secrets & Cryptography
  // ----------------------------------------------------
  const sessionSecret = localEnv.SESSION_SECRET || localEnv.AUTH_SESSION_SECRET || localEnv.APP_KEY || '';
  if (!sessionSecret) {
    addError('SESSION_SECRET', 'SESSION_SECRET or APP_KEY environment variable is not set');
  } else if (sessionSecret.length < 32) {
    addError('SESSION_SECRET', `SESSION_SECRET is only ${sessionSecret.length} chars (must be >= 32 chars in production)`);
  } else if (WEAK_SECRET_PATTERNS.some((p) => p.test(sessionSecret))) {
    addError('SESSION_SECRET', 'SESSION_SECRET appears to use a default or easily guessable placeholder');
  } else {
    addPass('SESSION_SECRET', 'Sufficiently strong cryptographic secret configured (>= 32 chars)');
  }

  const jwtSecret = localEnv.JWT_SECRET || '';
  if (jwtSecret) {
    if (jwtSecret.length < 32) {
      addWarn('JWT_SECRET', `JWT_SECRET is only ${jwtSecret.length} chars (recommend >= 32 chars)`);
    } else if (WEAK_SECRET_PATTERNS.some((p) => p.test(jwtSecret))) {
      addError('JWT_SECRET', 'JWT_SECRET uses an insecure default placeholder');
    } else {
      addPass('JWT_SECRET', 'Strong JWT secret configured (>= 32 chars)');
    }
  }

  // ----------------------------------------------------
  // 3. Git & File Security (.gitignore / .dockerignore)
  // ----------------------------------------------------
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (!gitignore.includes('.env')) {
      addError('.gitignore', '.env is not ignored in .gitignore (risk of leaking secrets to git)');
    } else {
      addPass('.gitignore', '.env files properly excluded from version control');
    }

    if (gitignore.includes('.sqlite') || gitignore.includes('*.db')) {
      addPass('.gitignore', 'Local database files (*.sqlite, *.db) excluded from git');
    }
  } else {
    addWarn('.gitignore', '.gitignore file not found');
  }

  const dockerignorePath = path.join(cwd, '.dockerignore');
  if (fs.existsSync(dockerignorePath)) {
    const dignore = fs.readFileSync(dockerignorePath, 'utf8');
    if (!dignore.includes('node_modules') || !dignore.includes('.env')) {
      addWarn('.dockerignore', '.dockerignore should explicitly exclude node_modules and .env');
    } else {
      addPass('.dockerignore', 'node_modules and .env excluded from Docker build context');
    }
  } else {
    addWarn('.dockerignore', '.dockerignore not found (recommend running: npx webspresso add:docker)');
  }

  // ----------------------------------------------------
  // 4. Docker & Container Hardening
  // ----------------------------------------------------
  const dockerfilePath = path.join(cwd, 'Dockerfile');
  if (fs.existsSync(dockerfilePath)) {
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

    if (/USER\s+(?!root\b)\w+/i.test(dockerfile)) {
      addPass('Dockerfile User', 'Container executes as non-root unprivileged user');
    } else {
      addWarn('Dockerfile User', 'Container does not appear to switch to a non-root USER (security risk)');
    }

    if (/HEALTHCHECK/i.test(dockerfile)) {
      addPass('Dockerfile Healthcheck', 'Container HEALTHCHECK instruction configured');
    } else {
      addWarn('Dockerfile Healthcheck', 'No HEALTHCHECK instruction found in Dockerfile');
    }

    if (/FROM.*AS\s+\w+/i.test(dockerfile)) {
      addPass('Dockerfile Multi-Stage', 'Multi-stage Docker build configured');
    } else {
      addWarn('Dockerfile Multi-Stage', 'Single-stage Dockerfile detected (multi-stage recommended for smaller image size)');
    }
  } else {
    addWarn('Dockerfile', 'Dockerfile not found (run `npx webspresso add:docker` to generate)');
  }

  // ----------------------------------------------------
  // 5. Database & Migrations
  // ----------------------------------------------------
  const migrationsDir = path.join(cwd, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js') || f.endsWith('.ts'));
    addPass('Migrations', `Found ${files.length} migration file(s) in migrations/`);

    // Try verifying migration status if db config exists
    const dbConfig = resolveDbConfigIfExists(cwd, targetEnv);
    if (dbConfig) {
      try {
        const db = createDbInstance(dbConfig);
        const status = await db.knex.migrate.status();
        if (status > 0) {
          addWarn('Pending Migrations', `There are ${status} pending database migration(s) to run (run: npx webspresso db:migrate)`);
        } else if (status === 0) {
          addPass('Pending Migrations', 'All database migrations are applied up to date');
        }
        await db.knex.destroy();
      } catch (err) {
        addWarn('Database Connectivity', `Could not check migration status: ${err.message}`);
      }
    }
  } else {
    addPass('Migrations', 'No migrations directory (skipping migration status check)');
  }

  // ----------------------------------------------------
  // 6. Server Optimizations (Compression & Graceful Shutdown)
  // ----------------------------------------------------
  if (serverCode) {
    if (serverCode.includes('compression: true') || serverCode.includes('compression:')) {
      addPass('HTTP Compression', 'Response compression (Brotli/Gzip) enabled');
    } else {
      addWarn('HTTP Compression', 'Response compression not explicitly enabled in createApp({ server: { compression: true } })');
    }

    if (serverCode.includes('shutdown:') || serverCode.includes('ShutdownManager')) {
      addPass('Graceful Shutdown', 'Graceful shutdown handling configured');
    } else {
      addPass('Graceful Shutdown', 'Default SIGTERM graceful shutdown active');
    }

    if (serverCode.includes('healthCheckPlugin') || serverCode.includes('/health') || serverCode.includes('/healthz')) {
      addPass('Health Check Endpoint', 'Health check route configured');
    } else {
      addWarn('Health Check Endpoint', 'No /health or /healthz route found (recommend healthCheckPlugin or health endpoint for orchestrators)');
    }
  }

  // ----------------------------------------------------
  // 7. Client Assets & Build Scripts
  // ----------------------------------------------------
  if (pkg.scripts && (pkg.scripts['build:css'] || pkg.scripts['build:js'] || pkg.scripts['build'])) {
    const publicDir = path.join(cwd, 'public');
    if (fs.existsSync(publicDir)) {
      addPass('Asset Build', 'Build scripts and public/ directory found');
    } else {
      addWarn('Asset Build', 'Build script defined in package.json but public/ directory is missing');
    }
  }

  const passed = errors.length === 0;

  return {
    passed,
    successes,
    warnings,
    errors,
  };
}

/**
 * Register command with Commander
 * @param {import('commander').Command} program
 */
function registerCommand(program) {
  program
    .command('deploy:check')
    .alias('check:deploy')
    .description('Run production preflight check (secrets, container hardening, database, and optimizations)')
    .option('-e, --env <environment>', 'Target environment to evaluate (default: production)', 'production')
    .option('--strict', 'Fail with exit code 1 if any warnings are detected', false)
    .option('--json', 'Output preflight results as JSON', false)
    .action(async (...actionArgs) => {
      const cmd = actionArgs[actionArgs.length - 1];
      const options = (cmd && typeof cmd.opts === 'function')
        ? cmd.opts()
        : (actionArgs.find((a) => a && typeof a === 'object') || {});

      const result = await runDeployCheck({
        cwd: process.cwd(),
        env: options.env || 'production',
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.passed || (options.strict && result.warnings.length > 0)) {
          process.exit(1);
        }
        return;
      }

      console.log('\n🚀 Webspresso Production Deployment Preflight');
      console.log('=============================================\n');

      if (result.successes.length > 0) {
        console.log('Passed Checks:');
        for (const item of result.successes) {
          console.log(`  ✅ [${item.check}] ${item.message}`);
        }
        console.log('');
      }

      if (result.warnings.length > 0) {
        console.log('Warnings:');
        for (const item of result.warnings) {
          console.log(`  ⚠️  [${item.check}] ${item.message}`);
        }
        console.log('');
      }

      if (result.errors.length > 0) {
        console.log('Errors (Must be resolved before production deployment):');
        for (const item of result.errors) {
          console.log(`  ❌ [${item.check}] ${item.message}`);
        }
        console.log('');
      }

      console.log('---------------------------------------------');
      console.log(`Summary: ${result.successes.length} passed, ${result.warnings.length} warning(s), ${result.errors.length} error(s).\n`);

      const hasFailed = !result.passed || (options.strict && result.warnings.length > 0);

      if (hasFailed) {
        console.error('❌ Deployment preflight checks FAILED.');
        process.exit(1);
      } else {
        console.log('✅ Deployment preflight checks PASSED! Your application is ready for production.\n');
      }
    });
}

module.exports = {
  registerCommand,
  runDeployCheck,
  parseEnvFile,
  WEAK_SECRET_PATTERNS,
};
