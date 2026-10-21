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
  const remediations = [];

  const addPass = (check, message) => successes.push({ check, message });
  const addWarn = (check, message) => warnings.push({ check, message });
  const addError = (check, message) => errors.push({ check, message });
  const addRemediation = (action) => {
    if (!remediations.includes(action)) remediations.push(action);
  };

  // Load environment variables from process.env and local .env files
  const localEnv = {
    ...parseEnvFile(path.join(cwd, '.env')),
    ...parseEnvFile(path.join(cwd, `.env.${targetEnv}`)),
    ...process.env,
  };

  // ----------------------------------------------------
  // Target Platform Detection
  // ----------------------------------------------------
  let targetPlatform = (options.platform || 'auto').toLowerCase();
  const isPlatformAuto = targetPlatform === 'auto';
  if (isPlatformAuto) {
    if (localEnv.K_SERVICE || fs.existsSync(path.join(cwd, 'cloudbuild.yaml')) || fs.existsSync(path.join(cwd, '.gcloudignore'))) {
      targetPlatform = 'cloudrun';
    } else if (localEnv.AWS_EXECUTION_ENV || localEnv.AWS_LAMBDA_FUNCTION_NAME || fs.existsSync(path.join(cwd, 'apprunner.yaml')) || fs.existsSync(path.join(cwd, 'ecs-task-definition.json'))) {
      targetPlatform = 'aws';
    } else if (fs.existsSync(path.join(cwd, 'wrangler.toml'))) {
      targetPlatform = 'cloudflare';
    } else if (fs.existsSync(path.join(cwd, 'Dockerfile'))) {
      targetPlatform = 'docker';
    } else {
      targetPlatform = 'generic';
    }
  }

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

    // Try verifying migration status and connection pool if db config exists
    const dbConfig = resolveDbConfigIfExists(cwd, targetEnv);
    if (dbConfig) {
      // Check connection pool for serverless/container scale-out
      const isSqlite = dbConfig.client === 'better-sqlite3' || dbConfig.client === 'sqlite3';
      if (!isSqlite && (dbConfig.client === 'pg' || dbConfig.client === 'mysql2' || dbConfig.client === 'mysql')) {
        const pool = dbConfig.pool || {};
        if (pool.max > 10) {
          addWarn('DB Connection Pool', `DB pool max is ${pool.max}. Large pools per container can exhaust database connections when autoscaling. Consider max <= 5 or an external pooler.`);
        } else if (pool.serverless || (pool.min === 0 && (pool.max || 5) <= 5)) {
          addPass('DB Connection Pool', `Database connection pool configured for serverless scaling (min: ${pool.min ?? 0}, max: ${pool.max ?? 5})`);
        }

        if ((localEnv.K_SERVICE || localEnv.AWS_EXECUTION_ENV || pool.serverless) && pool.min > 0) {
          addWarn('DB Connection Pool', `DB pool min is ${pool.min}. For serverless scale-to-zero, min: 0 is recommended so idle containers release connections.`);
        }
      }

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

    // Check cloud migration job setup for Cloud Run or AWS
    if (targetPlatform === 'cloudrun') {
      const hasJob = fs.existsSync(path.join(cwd, 'cloudrun-job.yaml')) ||
                     fs.existsSync(path.join(cwd, 'deploy-cloudrun-migration.sh')) ||
                     (fs.existsSync(path.join(cwd, 'cloudbuild.yaml')) && fs.readFileSync(path.join(cwd, 'cloudbuild.yaml'), 'utf8').includes('run jobs'));
      if (hasJob) {
        addPass('Cloud Migration Strategy', 'Cloud Run migration job configuration found');
      } else {
        addWarn('Cloud Migration Strategy', 'Running migrations inside scaled web containers can cause race conditions. Scaffold an isolated Cloud Run Job: npx webspresso add:migration-job --platform cloudrun');
      }
    } else if (targetPlatform === 'aws') {
      const hasEcsTask = fs.existsSync(path.join(cwd, 'ecs-migration-task.json')) ||
                         fs.existsSync(path.join(cwd, 'deploy-aws-migration.sh')) ||
                         (fs.existsSync(path.join(cwd, 'apprunner.yaml')) && fs.readFileSync(path.join(cwd, 'apprunner.yaml'), 'utf8').includes('db:migrate'));
      if (hasEcsTask) {
        addPass('Cloud Migration Strategy', 'AWS ECS Task or App Runner pre-deploy migration configuration found');
      } else {
        addWarn('Cloud Migration Strategy', 'Recommend running migrations as an isolated ECS Task or App Runner pre-run: npx webspresso add:migration-job --platform aws');
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

  // ----------------------------------------------------
  // 8. Stateless Scale-Out & Session Store
  // ----------------------------------------------------
  const hasRedis = Boolean(localEnv.REDIS_URL || localEnv.SESSION_STORE === 'redis');
  if (hasRedis) {
    addPass('Distributed Session Store', `Distributed session store configured for scale-out (${localEnv.SESSION_STORE || 'Redis'})`);
  } else if (targetEnv === 'production' && serverCode && (serverCode.includes('auth') || serverCode.includes('session'))) {
    addWarn('Distributed Session Store', 'In-memory session store detected in production. For stateless scale-out (Cloud Run, AWS ECS/Fargate, Kubernetes), configure a distributed store via REDIS_URL=redis://... or SESSION_STORE=redis.');
  }

  // ----------------------------------------------------
  // 9. Platform-Specific Cloud Preflight
  // ----------------------------------------------------
  const dbConfig = resolveDbConfigIfExists(cwd, targetEnv);
  const isSqlite = !dbConfig || dbConfig.client === 'better-sqlite3' || dbConfig.client === 'sqlite3';

  // 9.1 Ephemeral Storage (Database & Uploads)
  if (isSqlite && (targetPlatform === 'cloudrun' || targetPlatform === 'aws')) {
    const pName = targetPlatform === 'cloudrun' ? 'Google Cloud Run' : 'AWS (App Runner / ECS)';
    const dbRec = targetPlatform === 'cloudrun' ? 'Google Cloud SQL (PostgreSQL/MySQL)' : 'AWS RDS / Aurora';
    addWarn(
      'Ephemeral Storage (Database)',
      `${pName} uses an ephemeral container filesystem. Local SQLite databases will be lost on scale-down or redeploy. Migrate to ${dbRec}.`
    );
    addRemediation(`Configure managed database: Use ${dbRec} via webspresso.db.js or DATABASE_URL`);
  }

  if (serverCode && (serverCode.includes("storage: 'local'") || serverCode.includes('uploadPlugin({') || serverCode.includes('uploadPlugin()'))) {
    const hasCloudStorage = serverCode.includes("storage: 'gcs'") || serverCode.includes("storage: 's3'") || serverCode.includes("storage: 'cloudflare'");
    if (!hasCloudStorage && (targetPlatform === 'cloudrun' || targetPlatform === 'aws')) {
      const pStorage = targetPlatform === 'cloudrun' ? 'Google Cloud Storage (GCS)' : 'AWS S3';
      addWarn(
        'Ephemeral Storage (Uploads)',
        `Local disk file upload storage detected. Container restarts on ${targetPlatform === 'cloudrun' ? 'Cloud Run' : 'AWS'} will cause uploaded files to be lost. Configure ${pStorage}.`
      );
      addRemediation(`Configure ${pStorage}: uploadPlugin({ storage: '${targetPlatform === 'cloudrun' ? 'gcs' : 's3'}' })`);
    }
  }

  // 9.2 Shutdown Timeout Alignment
  if (targetPlatform === 'cloudrun') {
    if (serverCode) {
      const match = serverCode.match(/timeout:\s*(\d+)/);
      if (match) {
        const timeoutMs = parseInt(match[1], 10);
        if (timeoutMs > 10000) {
          addWarn('Shutdown Timeout Alignment', `Webspresso shutdown timeout (${timeoutMs}ms) exceeds Cloud Run default SIGTERM deadline (10000ms). Container may be forcibly SIGKILLed before draining.`);
          addRemediation('Set shutdown timeout <= 10000ms in createApp({ server: { shutdown: { timeout: 9000 } } })');
        } else {
          addPass('Shutdown Timeout Alignment', `Shutdown timeout (${timeoutMs}ms) matches Cloud Run 10s SIGTERM deadline`);
        }
      } else {
        addPass('Shutdown Timeout Alignment', 'Default shutdown timeout (10s) compatible with Cloud Run SIGTERM deadline');
      }
    }
  } else if (targetPlatform === 'aws') {
    addPass('Shutdown Timeout Alignment', 'Default shutdown timeout (10s) well within AWS ECS 30s stopTimeout');
  }

  // 9.3 Platform Artifacts & Secrets Inspection
  if (targetPlatform === 'cloudrun') {
    const gcloudignorePath = path.join(cwd, '.gcloudignore');
    if (fs.existsSync(gcloudignorePath)) {
      const gignore = fs.readFileSync(gcloudignorePath, 'utf8');
      if (!gignore.includes('.env')) {
        addError('Google Cloud Ignore', '.env is NOT excluded in .gcloudignore! Secrets may leak into Google Cloud Build.');
        addRemediation('Add .env to .gcloudignore');
      } else {
        addPass('Google Cloud Ignore', '.gcloudignore present and properly excludes .env');
      }
    } else {
      addWarn('Google Cloud Ignore', '.gcloudignore not found (recommend running: npx webspresso add:cloudrun)');
      addRemediation('Generate Cloud Run configuration: npx webspresso add:cloudrun');
    }

    const cloudbuildPath = path.join(cwd, 'cloudbuild.yaml');
    if (fs.existsSync(cloudbuildPath)) {
      addPass('Cloud Build Pipeline', 'cloudbuild.yaml CI/CD pipeline found');
    } else {
      addWarn('Cloud Build Pipeline', 'cloudbuild.yaml not found (run: npx webspresso add:cloudrun)');
    }

    if (serverCode) {
      if (serverCode.includes('process.env.PORT') || serverCode.includes('PORT')) {
        addPass('Cloud Run PORT Binding', 'Binds to dynamic process.env.PORT (required for Cloud Run 8080)');
      } else {
        addWarn('Cloud Run PORT Binding', 'Ensure server listens on process.env.PORT (Cloud Run assigns port 8080)');
        addRemediation('Listen on process.env.PORT: app.listen(process.env.PORT || 3000)');
      }
    }
  } else if (targetPlatform === 'aws') {
    const apprunnerPath = path.join(cwd, 'apprunner.yaml');
    const ecsTaskPath = path.join(cwd, 'ecs-task-definition.json');

    if (fs.existsSync(apprunnerPath)) {
      addPass('AWS App Runner Config', 'apprunner.yaml found');
    }
    if (fs.existsSync(ecsTaskPath)) {
      try {
        const ecsTask = JSON.parse(fs.readFileSync(ecsTaskPath, 'utf8'));
        if (ecsTask.containerDefinitions?.[0]?.logConfiguration?.logDriver === 'awslogs') {
          addPass('AWS CloudWatch Logs', 'CloudWatch logDriver (awslogs) configured in ECS task definition');
        }
        addPass('AWS ECS Task Definition', 'ecs-task-definition.json found and valid JSON');
      } catch (err) {
        addError('AWS ECS Task Definition', `ecs-task-definition.json is invalid JSON: ${err.message}`);
      }
    }

    if (!fs.existsSync(apprunnerPath) && !fs.existsSync(ecsTaskPath)) {
      addWarn('AWS Configuration', 'Neither apprunner.yaml nor ecs-task-definition.json found');
      addRemediation('Generate AWS configuration: npx webspresso add:aws');
    }
  } else if (targetPlatform === 'cloudflare') {
    const wranglerPath = path.join(cwd, 'wrangler.toml');
    if (fs.existsSync(wranglerPath)) {
      const wrangler = fs.readFileSync(wranglerPath, 'utf8');
      if (wrangler.includes('nodejs_compat')) {
        addPass('Cloudflare Worker Config', 'wrangler.toml found with nodejs_compat flag');
      } else {
        addWarn('Cloudflare Worker Config', 'wrangler.toml missing compatibility_flags = ["nodejs_compat"]');
        addRemediation('Add compatibility_flags = ["nodejs_compat"] to wrangler.toml');
      }
    } else {
      addWarn('Cloudflare Worker Config', 'wrangler.toml not found (run: npx webspresso add:cloudflare)');
      addRemediation('Generate Cloudflare Worker files: npx webspresso add:cloudflare');
    }
  }

  const passed = errors.length === 0;

  return {
    passed,
    platform: targetPlatform,
    isPlatformAuto,
    successes,
    warnings,
    errors,
    remediations,
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
    .option('-p, --platform <platform>', 'Target cloud platform (cloudrun, aws, cloudflare, docker, or auto)', 'auto')
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
        platform: options.platform || 'auto',
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.passed || (options.strict && result.warnings.length > 0)) {
          process.exit(1);
        }
        return;
      }

      console.log('\n🚀 Webspresso Production Deployment Preflight');
      console.log('=============================================');
      console.log(`Target Platform : ${result.platform.toUpperCase()} ${result.isPlatformAuto ? '(auto-detected)' : ''}`);
      console.log(`Environment     : ${options.env || 'production'}\n`);

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

      if (result.remediations && result.remediations.length > 0) {
        console.log('Recommended Actions:');
        for (const rem of result.remediations) {
          console.log(`  👉 ${rem}`);
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
