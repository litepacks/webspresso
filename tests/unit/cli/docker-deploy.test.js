import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Command } = require('commander');
const {
  registerCommand: registerAddDocker,
  generateDockerfile,
  generateDockerignore,
  generateDockerCompose,
  detectDatabase,
  normalizeNodeVersion,
} = require('../../../bin/commands/add-docker');
const {
  registerCommand: registerDeployCheck,
  runDeployCheck,
  parseEnvFile,
  WEAK_SECRET_PATTERNS,
} = require('../../../bin/commands/deploy-check');

class ProcessExitError extends Error {
  constructor(code) {
    super(`Process exited with code ${code}`);
    this.exitCode = code;
  }
}

async function runCli(registerFn, args, options = {}) {
  const argParts = Array.isArray(args) ? [...args] : args.split(' ').filter(Boolean);
  const origCwd = process.cwd();
  let stdout = '';
  let stderr = '';

  const mockLog = (...msgs) => {
    stdout += msgs.join(' ') + '\n';
  };
  const mockError = (...msgs) => {
    stderr += msgs.join(' ') + '\n';
  };
  const mockExit = (code) => {
    throw new ProcessExitError(code);
  };

  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;

  console.log = mockLog;
  console.error = mockError;
  process.exit = mockExit;

  const program = new Command();
  program.exitOverride((err) => {
    throw new ProcessExitError(err.exitCode || 1);
  });

  registerFn(program);

  let exitCode = 0;
  try {
    if (options.cwd) {
      process.chdir(options.cwd);
    }
    await program.parseAsync(['node', 'webspresso', ...argParts]);
  } catch (err) {
    if (err instanceof ProcessExitError) {
      exitCode = err.exitCode;
    } else {
      exitCode = 1;
      stderr += (err?.message || String(err)) + '\n';
    }
  } finally {
    process.chdir(origCwd);
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }

  return {
    stdout: `${stdout}${stderr}`,
    stderr,
    exitCode,
  };
}

describe('DevOps & Docker CLI (add:docker & deploy:check)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-docker-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // ==========================================
  // 1. add:docker Template & Helper Functions
  // ==========================================
  describe('add:docker Generators & Utilities', () => {
    it('normalizeNodeVersion standardizes node image tags', () => {
      expect(normalizeNodeVersion('22')).toBe('22-alpine');
      expect(normalizeNodeVersion('node:20')).toBe('20-alpine');
      expect(normalizeNodeVersion('20-alpine')).toBe('20-alpine');
      expect(normalizeNodeVersion('22-slim')).toBe('22-slim');
    });

    it('detectDatabase detects database from dependencies and knexfile', () => {
      expect(detectDatabase(tmpDir, { dependencies: { pg: '^8.0.0' } })).toBe('postgres');
      expect(detectDatabase(tmpDir, { dependencies: { mysql2: '^3.0.0' } })).toBe('mysql');
      expect(detectDatabase(tmpDir, { dependencies: { 'better-sqlite3': '^11.0.0' } })).toBe('sqlite');

      // Fallback to knexfile.js
      fs.writeFileSync(path.join(tmpDir, 'knexfile.js'), "module.exports = { client: 'postgresql' };");
      expect(detectDatabase(tmpDir, {})).toBe('postgres');
    });

    it('generateDockerfile produces hardened multi-stage container instructions', () => {
      const dockerfile = generateDockerfile({
        node: '22-alpine',
        port: 4000,
        hasBuildScript: true,
      });

      expect(dockerfile).toContain('FROM node:22-alpine AS deps');
      expect(dockerfile).toContain('FROM node:22-alpine AS builder');
      expect(dockerfile).toContain('FROM node:22-alpine AS runner');
      expect(dockerfile).toContain('USER webspresso');
      expect(dockerfile).toContain('EXPOSE 4000');
      expect(dockerfile).toContain('ENV PORT=4000');
      expect(dockerfile).toContain('HEALTHCHECK');
      expect(dockerfile).toContain('CMD ["node", "server.js"]');
      expect(dockerfile).toContain('npm run build');
    });

    it('generateDockerignore includes all standard exclusions', () => {
      const ignore = generateDockerignore();
      expect(ignore).toContain('node_modules');
      expect(ignore).toContain('.env');
      expect(ignore).toContain('.git');
      expect(ignore).toContain('*.sqlite');
      expect(ignore).toContain('coverage');
      expect(ignore).toContain('tests');
      expect(ignore).toContain('!storage/uploads/.gitkeep');
    });

    it('generateDockerCompose builds postgres configuration with healthcheck', () => {
      const compose = generateDockerCompose({
        appName: 'my-saas',
        db: 'postgres',
        redis: true,
        port: 3000,
      });

      expect(compose).toContain('container_name: my-saas');
      expect(compose).toContain('image: postgres:16-alpine');
      expect(compose).toContain('image: redis:7-alpine');
      expect(compose).toContain('pg_isready -U webspresso -d webspresso');
      expect(compose).toContain('redis-cli');
      expect(compose).toContain('postgres_data:');
      expect(compose).toContain('redis_data:');
      expect(compose).toContain('condition: service_healthy');
    });

    it('generateDockerCompose builds mysql configuration', () => {
      const compose = generateDockerCompose({
        appName: 'my-mysql-app',
        db: 'mysql',
        redis: false,
        port: 8080,
      });

      expect(compose).toContain('image: mysql:8.0');
      expect(compose).toContain('mysqladmin');
      expect(compose).toContain('mysql_data:');
      expect(compose).toContain('"8080:8080"');
    });

    it('generateDockerCompose builds sqlite configuration with persistent data volume', () => {
      const compose = generateDockerCompose({
        appName: 'sqlite-app',
        db: 'sqlite',
        redis: false,
        port: 3000,
      });

      expect(compose).toContain('./data:/app/data');
      expect(compose).toContain('DATABASE_FILENAME=/app/data/app.sqlite');
      expect(compose).not.toContain('image: postgres');
    });

    it('generateDockerCompose defaults to port 7331 when omitted', () => {
      const compose = generateDockerCompose({
        appName: 'default-port-app',
      });

      expect(compose).toContain('- PORT=7331');
      expect(compose).toContain('"7331:7331"');
    });
  });

  // ==========================================
  // 2. add:docker CLI Execution
  // ==========================================
  describe('add:docker CLI Command Execution', () => {
    it('fails when run outside a project directory (no package.json)', async () => {
      const res = await runCli(registerAddDocker, 'add:docker', { cwd: tmpDir });
      expect(res.exitCode).toBe(1);
      expect(res.stdout).toContain('Not a Webspresso project');
    });

    it('generates Dockerfile, .dockerignore, docker-compose.yml and updates package.json', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'demo-app', version: '1.0.0', dependencies: { 'better-sqlite3': '^11.0.0' } }, null, 2)
      );

      const res = await runCli(registerAddDocker, 'add:docker --port 3500', { cwd: tmpDir });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Created Dockerfile');
      expect(res.stdout).toContain('Created .dockerignore');
      expect(res.stdout).toContain('Created docker-compose.yml');

      expect(fs.existsSync(path.join(tmpDir, 'Dockerfile'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.dockerignore'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'docker-compose.yml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'data'))).toBe(true);

      const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
      expect(updatedPkg.scripts['docker:build']).toBe('docker build -t demo-app .');
      expect(updatedPkg.scripts['docker:run']).toContain('-p 3500:3500');
      expect(updatedPkg.scripts['docker:up']).toBe('docker compose up -d');
      expect(updatedPkg.scripts['docker:down']).toBe('docker compose down');
    });

    it('preserves existing files unless --force is specified', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app' }));
      fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), '# Custom Dockerfile');

      const res = await runCli(registerAddDocker, 'add:docker', { cwd: tmpDir });
      expect(res.stdout).toContain('Dockerfile already exists');
      expect(fs.readFileSync(path.join(tmpDir, 'Dockerfile'), 'utf8')).toBe('# Custom Dockerfile');

      // Now with --force
      const resForce = await runCli(registerAddDocker, 'add:docker --force', { cwd: tmpDir });
      expect(resForce.stdout).toContain('Created Dockerfile');
      expect(fs.readFileSync(path.join(tmpDir, 'Dockerfile'), 'utf8')).not.toBe('# Custom Dockerfile');
    });
  });

  // ==========================================
  // 3. deploy:check Preflight Verification
  // ==========================================
  describe('deploy:check Preflight Validator', () => {
    it('parseEnvFile parses key-value pairs ignoring comments and quotes', () => {
      const envPath = path.join(tmpDir, '.env');
      fs.writeFileSync(
        envPath,
        `
# This is a comment
PORT=3000
APP_KEY="super_long_secret_key_at_least_32_characters"
DATABASE_URL='postgres://user:pass@localhost:5432/db'
EMPTY=
        `
      );

      const parsed = parseEnvFile(envPath);
      expect(parsed.PORT).toBe('3000');
      expect(parsed.APP_KEY).toBe('super_long_secret_key_at_least_32_characters');
      expect(parsed.DATABASE_URL).toBe('postgres://user:pass@localhost:5432/db');
      expect(parsed.EMPTY).toBe('');
    });

    it('fails when SESSION_SECRET is missing or too short or weak', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
      fs.writeFileSync(path.join(tmpDir, 'server.js'), "const { createApp } = require('webspresso');");

      // Test 1: Missing secret
      let result = await runDeployCheck({ cwd: tmpDir });
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.check === 'SESSION_SECRET')).toBe(true);

      // Test 2: Secret too short (< 32 chars)
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=short_secret\n');
      result = await runDeployCheck({ cwd: tmpDir });
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.message.includes('must be >= 32 chars'))).toBe(true);

      // Test 3: Weak secret placeholder
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=change-me-to-a-random-32-char-string-in-production\n');
      result = await runDeployCheck({ cwd: tmpDir });
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.message.includes('default or easily guessable placeholder'))).toBe(true);

      // Test 4: Strong valid secret
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=a8f9c0e2b1d4f7a3c5e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4\n');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\n*.sqlite\n');
      result = await runDeployCheck({ cwd: tmpDir });
      expect(result.errors.filter((e) => e.check === 'SESSION_SECRET').length).toBe(0);
    });

    it('flags .env missing from .gitignore as an error', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'git-app' }));
      fs.writeFileSync(path.join(tmpDir, 'server.js'), '// server');
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=a8f9c0e2b1d4f7a3c5e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4\n');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\n'); // Missing .env

      const result = await runDeployCheck({ cwd: tmpDir });
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.check === '.gitignore')).toBe(true);
    });

    it('checks Dockerfile hardening and healthcheck', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'docker-app' }));
      fs.writeFileSync(path.join(tmpDir, 'server.js'), '// server');
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=a8f9c0e2b1d4f7a3c5e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4\n');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\n');

      // Dockerfile with root user and no healthcheck
      fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM node:22\nCOPY . .\nCMD ["node", "server.js"]\n');

      let result = await runDeployCheck({ cwd: tmpDir });
      expect(result.warnings.some((w) => w.check === 'Dockerfile User')).toBe(true);
      expect(result.warnings.some((w) => w.check === 'Dockerfile Healthcheck')).toBe(true);

      // Hardened Dockerfile
      const hardened = generateDockerfile({ port: 3000 });
      fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), hardened);
      result = await runDeployCheck({ cwd: tmpDir });
      expect(result.successes.some((s) => s.check === 'Dockerfile User')).toBe(true);
      expect(result.successes.some((s) => s.check === 'Dockerfile Healthcheck')).toBe(true);
    });

    it('deploy:check CLI outputs formatted results and JSON when requested', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'cli-test' }));
      fs.writeFileSync(path.join(tmpDir, 'server.js'), "const { createApp } = require('webspresso');\nconst app = createApp({ server: { compression: true } });");
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=a8f9c0e2b1d4f7a3c5e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4\n');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\n');

      // Human-readable output
      const res = await runCli(registerDeployCheck, 'deploy:check', { cwd: tmpDir });
      expect(res.stdout).toContain('Webspresso Production Deployment Preflight');
      expect(res.stdout).toContain('PASSED');
      expect(res.exitCode).toBe(0);

      // JSON output
      const resJson = await runCli(registerDeployCheck, 'deploy:check --json', { cwd: tmpDir });
      expect(resJson.exitCode).toBe(0);
      const jsonParsed = JSON.parse(resJson.stdout);
      expect(jsonParsed.passed).toBe(true);
      expect(Array.isArray(jsonParsed.successes)).toBe(true);
    });

    it('deploy:check exits with 1 when errors exist or --strict with warnings', async () => {
      // Empty directory -> will have errors
      const res = await runCli(registerDeployCheck, 'deploy:check', { cwd: tmpDir });
      expect(res.exitCode).toBe(1);
      expect(res.stdout).toContain('FAILED');
    });

    it('auto-detects cloudrun, aws, and cloudflare platforms from project files', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'platform-detect-app' }));
      fs.writeFileSync(path.join(tmpDir, 'server.js'), '// server');
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=a8f9c0e2b1d4f7a3c5e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4\n');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\n');

      // Test 1: Cloud Run detection via cloudbuild.yaml
      fs.writeFileSync(path.join(tmpDir, 'cloudbuild.yaml'), 'steps: []\n');
      fs.writeFileSync(path.join(tmpDir, '.gcloudignore'), '.git\n.env\n');
      let result = await runDeployCheck({ cwd: tmpDir });
      expect(result.platform).toBe('cloudrun');
      expect(result.isPlatformAuto).toBe(true);
      expect(result.successes.some((s) => s.check === 'Cloud Build Pipeline')).toBe(true);
      expect(result.successes.some((s) => s.check === 'Google Cloud Ignore')).toBe(true);

      // Clean up Cloud Run files
      fs.unlinkSync(path.join(tmpDir, 'cloudbuild.yaml'));
      fs.unlinkSync(path.join(tmpDir, '.gcloudignore'));

      // Test 2: AWS detection via apprunner.yaml
      fs.writeFileSync(path.join(tmpDir, 'apprunner.yaml'), 'version: 1.0\n');
      result = await runDeployCheck({ cwd: tmpDir });
      expect(result.platform).toBe('aws');
      expect(result.successes.some((s) => s.check === 'AWS App Runner Config')).toBe(true);

      // Clean up AWS files
      fs.unlinkSync(path.join(tmpDir, 'apprunner.yaml'));

      // Test 3: Cloudflare detection via wrangler.toml
      fs.writeFileSync(path.join(tmpDir, 'wrangler.toml'), 'name = "cf-app"\ncompatibility_flags = ["nodejs_compat"]\n');
      result = await runDeployCheck({ cwd: tmpDir });
      expect(result.platform).toBe('cloudflare');
      expect(result.successes.some((s) => s.check === 'Cloudflare Worker Config')).toBe(true);
    });

    it('warns on ephemeral SQLite and local file upload storage on stateless containers', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'ephemeral-test-app' }));
      // Default sqlite and local uploads
      fs.writeFileSync(path.join(tmpDir, 'server.js'), "const { createApp } = require('webspresso');\nconst { uploadPlugin } = require('webspresso/plugins/upload');\ncreateApp({ plugins: [uploadPlugin({ storage: 'local' })] });");
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=a8f9c0e2b1d4f7a3c5e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4\n');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\n');

      const result = await runDeployCheck({ cwd: tmpDir, platform: 'cloudrun' });
      expect(result.platform).toBe('cloudrun');
      expect(result.warnings.some((w) => w.check === 'Ephemeral Storage (Database)')).toBe(true);
      expect(result.warnings.some((w) => w.check === 'Ephemeral Storage (Uploads)')).toBe(true);
      expect(result.remediations.some((r) => r.includes('Google Cloud SQL'))).toBe(true);
      expect(result.remediations.some((r) => r.includes('Google Cloud Storage'))).toBe(true);
    });

    it('audits shutdown timeout alignment and .gcloudignore leaks on Cloud Run', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'cloudrun-timeout-app' }));
      // Timeout > 10000ms
      fs.writeFileSync(path.join(tmpDir, 'server.js'), "const { createApp } = require('webspresso');\ncreateApp({ server: { shutdown: { timeout: 15000 } } });");
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=a8f9c0e2b1d4f7a3c5e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4\n');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\n');
      // .gcloudignore without .env
      fs.writeFileSync(path.join(tmpDir, '.gcloudignore'), '.git\nnode_modules\n');

      const result = await runDeployCheck({ cwd: tmpDir, platform: 'cloudrun' });
      expect(result.passed).toBe(false); // .env in .gcloudignore is an error
      expect(result.errors.some((e) => e.check === 'Google Cloud Ignore')).toBe(true);
      expect(result.warnings.some((w) => w.check === 'Shutdown Timeout Alignment')).toBe(true);
      expect(result.remediations.some((r) => r.includes('.gcloudignore'))).toBe(true);
    });

    it('validates AWS ECS task definition and CloudWatch logging', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'aws-app' }));
      fs.writeFileSync(path.join(tmpDir, 'server.js'), '// aws server');
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=a8f9c0e2b1d4f7a3c5e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4\n');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\n');
      fs.writeFileSync(path.join(tmpDir, 'ecs-task-definition.json'), JSON.stringify({
        containerDefinitions: [{
          name: 'webspresso',
          logConfiguration: {
            logDriver: 'awslogs',
            options: { 'awslogs-group': '/ecs/webspresso' },
          },
        }],
      }));

      const result = await runDeployCheck({ cwd: tmpDir, platform: 'aws' });
      expect(result.successes.some((s) => s.check === 'AWS ECS Task Definition')).toBe(true);
      expect(result.successes.some((s) => s.check === 'AWS CloudWatch Logs')).toBe(true);
      expect(result.successes.some((s) => s.check === 'Shutdown Timeout Alignment')).toBe(true);
    });

    it('deploy:check CLI accepts --platform option and outputs remediations', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'cli-platform-test' }));
      fs.writeFileSync(path.join(tmpDir, 'server.js'), "const { createApp } = require('webspresso');\nconst app = createApp({ server: { compression: true } });");
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SESSION_SECRET=a8f9c0e2b1d4f7a3c5e8b0d2f4a6c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4\n');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\n');

      const res = await runCli(registerDeployCheck, 'deploy:check --platform cloudrun', { cwd: tmpDir });
      expect(res.stdout).toContain('Target Platform : CLOUDRUN');
      expect(res.stdout).toContain('Recommended Actions:');

      const resJson = await runCli(registerDeployCheck, 'deploy:check -p aws --json', { cwd: tmpDir });
      const parsed = JSON.parse(resJson.stdout);
      expect(parsed.platform).toBe('aws');
      expect(parsed.isPlatformAuto).toBe(false);
      expect(Array.isArray(parsed.remediations)).toBe(true);
    });
  });
});
