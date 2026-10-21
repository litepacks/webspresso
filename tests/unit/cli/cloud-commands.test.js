import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Command } = require('commander');

const {
  registerCommand: registerAddCloudrun,
  generateCloudBuildYaml,
  generateGCloudIgnore,
  generateDeployScript: generateCloudrunDeployScript,
} = require('../../../bin/commands/add-cloudrun');

const {
  registerCommand: registerAddAws,
  generateAppRunnerYaml,
  generateEcsTaskDefinition,
  generateAwsDeployScript,
  normalizeEcsCpu,
  normalizeEcsMemory,
} = require('../../../bin/commands/add-aws');

const {
  registerCommand: registerAddCi,
  generateBaseCiWorkflow,
  generateCloudRunWorkflow,
  generateAwsWorkflow,
  generateCloudflareWorkflow,
  generateGitLabCi,
  detectTargetPlatform,
} = require('../../../bin/commands/add-ci');

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

describe('Cloud Deployment CLI Commands', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-cloud-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // ==========================================
  // 1. Google Cloud Run (add:cloudrun)
  // ==========================================
  describe('Google Cloud Run Generator (add:cloudrun)', () => {
    it('generates cloudbuild.yaml with default options', () => {
      const yaml = generateCloudBuildYaml({ appName: 'test-app' });

      expect(yaml).toContain('steps:');
      expect(yaml).toContain('gcr.io/cloud-builders/docker');
      expect(yaml).toContain('gcr.io/google.com/cloudsdktool/cloud-sdk');
      expect(yaml).toContain('--platform');
      expect(yaml).toContain('managed');
      expect(yaml).toContain('--execution-environment');
      expect(yaml).toContain('gen2');
      expect(yaml).toContain('_SERVICE_NAME: \'test-app\'');
      expect(yaml).toContain('_REGION: \'us-central1\'');
      expect(yaml).toContain('_PORT: \'8080\'');
      expect(yaml).toContain('_MEMORY: \'512Mi\'');
      expect(yaml).toContain('_CPU: \'1\'');
      expect(yaml).toContain('_MIN_INSTANCES: \'0\'');
      expect(yaml).toContain('_MAX_INSTANCES: \'10\'');
    });

    it('generates cloudbuild.yaml with custom region, specs and Cloud SQL', () => {
      const yaml = generateCloudBuildYaml({
        appName: 'enterprise-app',
        region: 'europe-west1',
        memory: '2Gi',
        cpu: '2',
        port: 3000,
        minInstances: 1,
        maxInstances: 50,
        cloudSql: 'my-project:europe-west1:prod-db',
      });

      expect(yaml).toContain('_SERVICE_NAME: \'enterprise-app\'');
      expect(yaml).toContain('_REGION: \'europe-west1\'');
      expect(yaml).toContain('_PORT: \'3000\'');
      expect(yaml).toContain('_MEMORY: \'2Gi\'');
      expect(yaml).toContain('_CPU: \'2\'');
      expect(yaml).toContain('_MIN_INSTANCES: \'1\'');
      expect(yaml).toContain('_MAX_INSTANCES: \'50\'');
      expect(yaml).toContain('--add-cloudsql-instances');
      expect(yaml).toContain('my-project:europe-west1:prod-db');
    });

    it('generates .gcloudignore with standard exclusions', () => {
      const ignore = generateGCloudIgnore();

      expect(ignore).toContain('.git');
      expect(ignore).toContain('node_modules');
      expect(ignore).toContain('.env');
      expect(ignore).toContain('*.sqlite');
      expect(ignore).toContain('tests');
    });

    it('generates deploy-cloudrun.sh with executable bash syntax', () => {
      const script = generateCloudrunDeployScript({
        appName: 'test-api',
        region: 'us-east1',
        port: 8080,
      });

      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('set -euo pipefail');
      expect(script).toContain('gcloud run deploy "$SERVICE_NAME"');
      expect(script).toContain('--execution-environment gen2');
    });

    it('executes add:cloudrun in a Webspresso project and updates package.json', async () => {
      const pkg = {
        name: 'cloudrun-demo',
        version: '1.0.0',
        scripts: { test: 'vitest' },
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

      const res = await runCli(registerAddCloudrun, 'add:cloudrun --region europe-west1', { cwd: tmpDir });

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Scaffolding Google Cloud Run configuration');
      expect(res.stdout).toContain('Created cloudbuild.yaml');
      expect(res.stdout).toContain('Created .gcloudignore');
      expect(res.stdout).toContain('Created deploy-cloudrun.sh');
      expect(res.stdout).toContain('Created Dockerfile');
      expect(res.stdout).toContain('Created .dockerignore');

      // Verify files created
      expect(fs.existsSync(path.join(tmpDir, 'cloudbuild.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.gcloudignore'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'deploy-cloudrun.sh'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'Dockerfile'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.dockerignore'))).toBe(true);

      // Verify package.json updated with scripts
      const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
      expect(updatedPkg.scripts['gcp:deploy']).toBe('./deploy-cloudrun.sh');
      expect(updatedPkg.scripts['gcp:build']).toContain('cloudbuild.yaml');
    });

    it('respects existing files unless --force is used', async () => {
      const pkg = { name: 'cloudrun-demo' };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'cloudbuild.yaml'), '# CUSTOM_CLOUDBUILD', 'utf8');

      const res = await runCli(registerAddCloudrun, 'add:cloudrun', { cwd: tmpDir });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('cloudbuild.yaml already exists. Skipping');
      expect(fs.readFileSync(path.join(tmpDir, 'cloudbuild.yaml'), 'utf8')).toBe('# CUSTOM_CLOUDBUILD');

      // Now run with --force
      const forceRes = await runCli(registerAddCloudrun, 'add:cloudrun --force', { cwd: tmpDir });
      expect(forceRes.exitCode).toBe(0);
      expect(forceRes.stdout).toContain('Created cloudbuild.yaml');
      expect(fs.readFileSync(path.join(tmpDir, 'cloudbuild.yaml'), 'utf8')).not.toBe('# CUSTOM_CLOUDBUILD');
    });

    it('fails gracefully when run outside of a project root', async () => {
      const res = await runCli(registerAddCloudrun, 'add:cloudrun', { cwd: tmpDir });
      expect(res.exitCode).toBe(1);
      expect(res.stdout).toContain('Not a Webspresso project');
    });
  });

  // ==========================================
  // 2. AWS App Runner & ECS Fargate (add:aws)
  // ==========================================
  describe('AWS Deployment Generator (add:aws)', () => {
    it('normalizes ECS CPU and Memory formats accurately', () => {
      expect(normalizeEcsCpu('0.25 vCPU')).toBe('256');
      expect(normalizeEcsCpu('0.5 vCPU')).toBe('512');
      expect(normalizeEcsCpu('1 vCPU')).toBe('1024');
      expect(normalizeEcsCpu('2 vcpu')).toBe('2048');
      expect(normalizeEcsCpu('4 vCPU')).toBe('4096');
      expect(normalizeEcsCpu('1024')).toBe('1024');

      expect(normalizeEcsMemory('1 GB')).toBe('1024');
      expect(normalizeEcsMemory('2GB')).toBe('2048');
      expect(normalizeEcsMemory('512MiB')).toBe('512');
      expect(normalizeEcsMemory('2048')).toBe('2048');
    });

    it('generates apprunner.yaml for AWS App Runner', () => {
      const yaml = generateAppRunnerYaml({
        appName: 'aws-app',
        port: 7331,
      });

      expect(yaml).toContain('version: 1.0');
      expect(yaml).toContain('runtime: nodejs20');
      expect(yaml).toContain('npm ci --omit=dev');
      expect(yaml).toContain('npm run build --if-present');
      expect(yaml).toContain('command: npm start');
      expect(yaml).toContain('port: "7331"');
      expect(yaml).toContain('NODE_ENV');
      expect(yaml).toContain('production');
    });

    it('generates valid ecs-task-definition.json for AWS ECS Fargate', () => {
      const jsonStr = generateEcsTaskDefinition({
        appName: 'enterprise-aws',
        region: 'eu-central-1',
        cpu: '1 vCPU',
        memory: '2 GB',
        port: 7331,
      });

      const parsed = JSON.parse(jsonStr);
      expect(parsed.family).toBe('enterprise-aws');
      expect(parsed.networkMode).toBe('awsvpc');
      expect(parsed.requiresCompatibilities).toEqual(['FARGATE']);
      expect(parsed.cpu).toBe('1024');
      expect(parsed.memory).toBe('2048');
      expect(parsed.containerDefinitions).toHaveLength(1);

      const container = parsed.containerDefinitions[0];
      expect(container.name).toBe('enterprise-aws');
      expect(container.portMappings[0].containerPort).toBe(7331);
      expect(container.healthCheck.command[1]).toContain('/healthz');
      expect(container.logConfiguration.logDriver).toBe('awslogs');
      expect(container.logConfiguration.options['awslogs-region']).toBe('eu-central-1');
    });

    it('generates deploy-aws.sh with ECR authentication and Docker build steps', () => {
      const script = generateAwsDeployScript({
        appName: 'aws-service',
        region: 'us-west-2',
        port: 7331,
      });

      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('set -euo pipefail');
      expect(script).toContain('aws sts get-caller-identity');
      expect(script).toContain('aws ecr get-login-password');
      expect(script).toContain('docker build');
      expect(script).toContain('docker push');
      expect(script).toContain('aws apprunner create-service');
      expect(script).toContain('aws ecs update-service');
    });

    it('executes add:aws in a Webspresso project and updates package.json', async () => {
      const pkg = {
        name: 'aws-demo',
        version: '1.0.0',
        scripts: { test: 'vitest' },
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

      const res = await runCli(registerAddAws, 'add:aws --region us-west-2 --cpu 1024 --memory 2048', { cwd: tmpDir });

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Scaffolding AWS deployment configuration');
      expect(res.stdout).toContain('Created apprunner.yaml');
      expect(res.stdout).toContain('Created ecs-task-definition.json');
      expect(res.stdout).toContain('Created deploy-aws.sh');
      expect(res.stdout).toContain('Created Dockerfile');
      expect(res.stdout).toContain('Created .dockerignore');

      // Verify files exist
      expect(fs.existsSync(path.join(tmpDir, 'apprunner.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'ecs-task-definition.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'deploy-aws.sh'))).toBe(true);

      // Verify task definition JSON content
      const taskDef = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ecs-task-definition.json'), 'utf8'));
      expect(taskDef.family).toBe('aws-demo');
      expect(taskDef.cpu).toBe('1024');
      expect(taskDef.memory).toBe('2048');

      // Verify package.json updated
      const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
      expect(updatedPkg.scripts['aws:deploy']).toBe('./deploy-aws.sh');
    });

    it('respects existing AWS files unless --force is used', async () => {
      const pkg = { name: 'aws-demo' };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'apprunner.yaml'), '# CUSTOM_APPRUNNER', 'utf8');

      const res = await runCli(registerAddAws, 'add:aws', { cwd: tmpDir });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('apprunner.yaml already exists. Skipping');
      expect(fs.readFileSync(path.join(tmpDir, 'apprunner.yaml'), 'utf8')).toBe('# CUSTOM_APPRUNNER');

      // Run with --force
      const forceRes = await runCli(registerAddAws, 'add:aws --force', { cwd: tmpDir });
      expect(forceRes.exitCode).toBe(0);
      expect(forceRes.stdout).toContain('Created apprunner.yaml');
      expect(fs.readFileSync(path.join(tmpDir, 'apprunner.yaml'), 'utf8')).not.toBe('# CUSTOM_APPRUNNER');
    });

    it('fails gracefully when add:aws run outside of a project root', async () => {
      const res = await runCli(registerAddAws, 'add:aws', { cwd: tmpDir });
      expect(res.exitCode).toBe(1);
      expect(res.stdout).toContain('Not a Webspresso project');
    });
  });

  // ==========================================
  // add:ci (GitHub Actions & GitLab CI)
  // ==========================================
  describe('add:ci Generators & CLI Execution', () => {
    it('generateBaseCiWorkflow produces standard GitHub Actions test & preflight pipeline', () => {
      const yaml = generateBaseCiWorkflow({ branch: 'production' });
      expect(yaml).toContain('name: Webspresso CI & Preflight');
      expect(yaml).toContain('branches: [ production ]');
      expect(yaml).toContain('node-version: [20.x, 22.x]');
      expect(yaml).toContain('run: npm test');
      expect(yaml).toContain('run: npx webspresso deploy:check --strict');
    });

    it('generateCloudRunWorkflow produces keyless Workload Identity Federation workflow', () => {
      const yaml = generateCloudRunWorkflow({ appName: 'my-cr-app', region: 'europe-west1' });
      expect(yaml).toContain('name: Deploy to Google Cloud Run');
      expect(yaml).toContain('id-token: write');
      expect(yaml).toContain('google-github-actions/auth@v2');
      expect(yaml).toContain('GCP_WIF_PROVIDER');
      expect(yaml).toContain('deploy:check --platform cloudrun --strict');
      expect(yaml).toContain('REGION: europe-west1');
    });

    it('generateAwsWorkflow produces keyless AWS IAM OIDC workflow', () => {
      const yaml = generateAwsWorkflow({ appName: 'my-aws-app', region: 'us-west-2' });
      expect(yaml).toContain('name: Deploy to AWS (App Runner / ECS)');
      expect(yaml).toContain('id-token: write');
      expect(yaml).toContain('aws-actions/configure-aws-credentials@v4');
      expect(yaml).toContain('AWS_DEPLOY_ROLE_ARN');
      expect(yaml).toContain('amazon-ecr-login@v2');
      expect(yaml).toContain('deploy:check --platform aws --strict');
    });

    it('generateCloudflareWorkflow produces Cloudflare Workers edge deployment workflow', () => {
      const yaml = generateCloudflareWorkflow({ branch: 'main' });
      expect(yaml).toContain('name: Deploy to Cloudflare Workers');
      expect(yaml).toContain('cloudflare/wrangler-action@v3');
      expect(yaml).toContain('CLOUDFLARE_API_TOKEN');
      expect(yaml).toContain('deploy:check --platform cloudflare --strict');
    });

    it('generateGitLabCi produces valid GitLab CI configuration', () => {
      const gitlab = generateGitLabCi({ platform: 'cloudrun' });
      expect(gitlab).toContain('stages:');
      expect(gitlab).toContain('- test');
      expect(gitlab).toContain('- verify');
      expect(gitlab).toContain('- deploy');
      expect(gitlab).toContain('deploy:check --platform cloudrun --strict');
    });

    it('detectTargetPlatform identifies platform from project markers', () => {
      expect(detectTargetPlatform(tmpDir)).toBe('generic');

      fs.writeFileSync(path.join(tmpDir, 'cloudbuild.yaml'), '');
      expect(detectTargetPlatform(tmpDir)).toBe('cloudrun');
      fs.unlinkSync(path.join(tmpDir, 'cloudbuild.yaml'));

      fs.writeFileSync(path.join(tmpDir, 'apprunner.yaml'), '');
      expect(detectTargetPlatform(tmpDir)).toBe('aws');
      fs.unlinkSync(path.join(tmpDir, 'apprunner.yaml'));

      fs.writeFileSync(path.join(tmpDir, 'wrangler.toml'), '');
      expect(detectTargetPlatform(tmpDir)).toBe('cloudflare');
    });

    it('executes add:ci CLI, creates workflows and updates package.json', async () => {
      const pkg = { name: 'ci-demo', version: '1.0.0', scripts: { test: 'vitest' } };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

      // Auto-detect cloudrun when cloudbuild.yaml exists
      fs.writeFileSync(path.join(tmpDir, 'cloudbuild.yaml'), '# gcp');

      const res = await runCli(registerAddCi, 'add:ci --gitlab', { cwd: tmpDir });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Scaffolding CI/CD Pipelines for "ci-demo"');
      expect(res.stdout).toContain('Created .github/workflows/ci.yml');
      expect(res.stdout).toContain('Created .github/workflows/deploy-cloudrun.yml');
      expect(res.stdout).toContain('Created .gitlab-ci.yml');
      expect(res.stdout).toContain('Added "ci:verify" script to package.json');

      expect(fs.existsSync(path.join(tmpDir, '.github', 'workflows', 'ci.yml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.github', 'workflows', 'deploy-cloudrun.yml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.gitlab-ci.yml'))).toBe(true);

      const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
      expect(updatedPkg.scripts['ci:verify']).toContain('webspresso deploy:check --strict');
    });

    it('scaffolds AWS and Cloudflare workflows when explicit platform is specified', async () => {
      const pkg = { name: 'multi-ci-demo' };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf8');

      const resAws = await runCli(registerAddCi, 'add:ci --platform aws', { cwd: tmpDir });
      expect(resAws.exitCode).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, '.github', 'workflows', 'deploy-aws.yml'))).toBe(true);

      const resCf = await runCli(registerAddCi, 'add:ci --platform cloudflare', { cwd: tmpDir });
      expect(resCf.exitCode).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, '.github', 'workflows', 'deploy-cloudflare.yml'))).toBe(true);
    });

    it('fails gracefully when add:ci run outside of a project root', async () => {
      const res = await runCli(registerAddCi, 'add:ci', { cwd: tmpDir });
      expect(res.exitCode).toBe(1);
      expect(res.stdout).toContain('package.json not found');
    });
  });
});
