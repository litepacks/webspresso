import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  generateCloudRunJobYaml,
  generateCloudRunJobScript,
  generateEcsMigrationTaskJson,
  generateAwsMigrationScript,
  generateK8sMigrationJobYaml,
  runAddMigrationJob,
} = require('../../../bin/commands/add-migration-job');
const {
  waitForDatabaseConnection,
  freeStaleMigrationLock,
  getMigrationStatus,
  runCloudMigration,
} = require('../../../core/orm/migrate-cloud');
const { runDeployCheck } = require('../../../bin/commands/deploy-check');

describe('Cloud Migration Jobs & Zero-Downtime DB Deploy (add:migration-job & core/orm/migrate-cloud)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-migration-job-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // ====================================================
  // 1. Template Generation & Content Validation
  // ====================================================
  describe('Generator Templates', () => {
    it('generateCloudRunJobYaml produces valid Cloud Run Job specification', () => {
      const yaml = generateCloudRunJobYaml({
        appName: 'my-store',
        region: 'europe-west1',
        memory: '1Gi',
        cpu: '2',
        cloudSql: 'my-proj:europe-west1:db-prod',
      });

      expect(yaml).toContain('apiVersion: run.googleapis.com/v1');
      expect(yaml).toContain('kind: Job');
      expect(yaml).toContain('name: my-store-migrate');
      expect(yaml).toContain('cloud.googleapis.com/location: europe-west1');
      expect(yaml).toContain('run.googleapis.com/cloudsql-instances: my-proj:europe-west1:db-prod');
      expect(yaml).toContain('memory: 1Gi');
      expect(yaml).toContain('cpu: \'2\'');
      expect(yaml).toContain('- webspresso');
      expect(yaml).toContain('- db:migrate');
      expect(yaml).toContain('- production');
    });

    it('generateCloudRunJobScript generates valid deploy & execution script', () => {
      const script = generateCloudRunJobScript({
        appName: 'my-store',
        region: 'europe-west1',
        cloudSql: 'my-proj:europe-west1:db-prod',
      });

      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('JOB_NAME="my-store-migrate"');
      expect(script).toContain('gcloud run jobs deploy "$JOB_NAME"');
      expect(script).toContain('--add-cloudsql-instances "my-proj:europe-west1:db-prod"');
      expect(script).toContain('gcloud run jobs execute "$JOB_NAME"');
    });

    it('generateEcsMigrationTaskJson creates AWS Fargate task definition', () => {
      const jsonStr = generateEcsMigrationTaskJson({
        appName: 'billing-svc',
        region: 'eu-central-1',
        cpu: '512',
        memory: '1024',
      });

      const parsed = JSON.parse(jsonStr);
      expect(parsed.family).toBe('billing-svc-migration');
      expect(parsed.requiresCompatibilities).toEqual(['FARGATE']);
      expect(parsed.cpu).toBe('512');
      expect(parsed.memory).toBe('1024');

      const container = parsed.containerDefinitions[0];
      expect(container.name).toBe('billing-svc-migrator');
      expect(container.command).toEqual(['npx', 'webspresso', 'db:migrate', '--env', 'production']);
      expect(container.logConfiguration.logDriver).toBe('awslogs');
    });

    it('generateAwsMigrationScript produces valid AWS ECS run-task script', () => {
      const script = generateAwsMigrationScript({
        appName: 'billing-svc',
        region: 'eu-central-1',
      });

      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('TASK_DEF="billing-svc-migration"');
      expect(script).toContain('aws ecs run-task');
      expect(script).toContain('--launch-type FARGATE');
      expect(script).toContain('aws ecs wait tasks-stopped');
    });

    it('generateK8sMigrationJobYaml creates Helm hook compatible batch/v1 Job', () => {
      const yaml = generateK8sMigrationJobYaml({
        appName: 'order-api',
      });

      expect(yaml).toContain('apiVersion: batch/v1');
      expect(yaml).toContain('kind: Job');
      expect(yaml).toContain('name: order-api-migration');
      expect(yaml).toContain('"helm.sh/hook": pre-install,pre-upgrade');
      expect(yaml).toContain('restartPolicy: Never');
      expect(yaml).toContain('- db:migrate');
    });
  });

  // ====================================================
  // 2. runAddMigrationJob File Creation & Overwrite Protection
  // ====================================================
  describe('runAddMigrationJob Scaffolding Engine', () => {
    it('scaffolds Cloud Run files by default', () => {
      const results = runAddMigrationJob(tmpDir, {
        platform: 'cloudrun',
        appName: 'test-app',
      });

      expect(results.length).toBe(2);
      expect(fs.existsSync(path.join(tmpDir, 'cloudrun-job.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'deploy-cloudrun-migration.sh'))).toBe(true);

      // Verify executable permission on .sh
      const stats = fs.statSync(path.join(tmpDir, 'deploy-cloudrun-migration.sh'));
      expect(stats.mode & 0o111).toBeTruthy();
    });

    it('scaffolds AWS ECS files when platform is aws', () => {
      const results = runAddMigrationJob(tmpDir, {
        platform: 'aws',
        appName: 'test-app',
      });

      expect(results.length).toBe(2);
      expect(fs.existsSync(path.join(tmpDir, 'ecs-migration-task.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'deploy-aws-migration.sh'))).toBe(true);
    });

    it('scaffolds all platforms when platform is all', () => {
      const results = runAddMigrationJob(tmpDir, {
        platform: 'all',
        appName: 'test-app',
      });

      expect(results.length).toBe(5);
      expect(fs.existsSync(path.join(tmpDir, 'cloudrun-job.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'ecs-migration-task.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'k8s/migration-job.yaml'))).toBe(true);
    });

    it('protects existing files unless force option is specified', () => {
      runAddMigrationJob(tmpDir, { platform: 'cloudrun', appName: 'first-run' });

      // Modify existing file
      const jobPath = path.join(tmpDir, 'cloudrun-job.yaml');
      fs.writeFileSync(jobPath, 'CUSTOM_CONTENT', 'utf8');

      // Second run without force
      const secondRun = runAddMigrationJob(tmpDir, { platform: 'cloudrun', appName: 'second-run', force: false });
      const skippedJob = secondRun.find((r) => r.path.endsWith('cloudrun-job.yaml'));
      expect(skippedJob.skipped).toBe(true);
      expect(fs.readFileSync(jobPath, 'utf8')).toBe('CUSTOM_CONTENT');

      // Third run with force
      const thirdRun = runAddMigrationJob(tmpDir, { platform: 'cloudrun', appName: 'third-run', force: true });
      const overwrittenJob = thirdRun.find((r) => r.path.endsWith('cloudrun-job.yaml'));
      expect(overwrittenJob.skipped).toBe(false);
      expect(fs.readFileSync(jobPath, 'utf8')).not.toBe('CUSTOM_CONTENT');
    });
  });

  // ====================================================
  // 3. Cloud Safe Migration Runner Engine (core/orm/migrate-cloud)
  // ====================================================
  describe('Safe Cloud Migration Engine', () => {
    it('waitForDatabaseConnection retries on transient connection error and resolves', async () => {
      let attempts = 0;
      const mockKnex = {
        raw: vi.fn().mockImplementation(async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Connection refused (warmup in progress)');
          }
          return { rows: [1] };
        }),
      };

      const retriesLog = [];
      const ok = await waitForDatabaseConnection(mockKnex, {
        retries: 5,
        initialDelayMs: 5,
        maxDelayMs: 20,
        onRetry: (info) => retriesLog.push(info),
      });

      expect(ok).toBe(true);
      expect(attempts).toBe(3);
      expect(retriesLog.length).toBe(2);
      expect(retriesLog[0].attempt).toBe(1);
    });

    it('waitForDatabaseConnection throws error when retry limit is exceeded', async () => {
      const mockKnex = {
        raw: vi.fn().mockRejectedValue(new Error('ETIMEDOUT: DB unreachable')),
      };

      await expect(
        waitForDatabaseConnection(mockKnex, {
          retries: 2,
          initialDelayMs: 5,
          maxDelayMs: 10,
        })
      ).rejects.toThrow('Database connection failed after 2 attempts');
    });

    it('getMigrationStatus lists completed and pending migrations', async () => {
      const mockKnex = {
        migrate: {
          list: vi.fn().mockResolvedValue([
            ['20261019_users.js', '20261020_posts.js'],
            ['20261021_comments.js'],
          ]),
        },
      };

      const status = await getMigrationStatus(mockKnex);
      expect(status.completed).toEqual(['20261019_users.js', '20261020_posts.js']);
      expect(status.pending).toEqual(['20261021_comments.js']);
    });

    it('runCloudMigration performs dry-run without executing migrations', async () => {
      const mockKnex = {
        raw: vi.fn().mockResolvedValue({}),
        migrate: {
          list: vi.fn().mockResolvedValue([
            ['01_init.js'],
            ['02_add_index.js', '03_add_roles.js'],
          ]),
          latest: vi.fn(),
        },
      };

      const result = await runCloudMigration(mockKnex, {
        dryRun: true,
        waitForDb: false,
      });

      expect(result.dryRun).toBe(true);
      expect(result.pendingBefore).toEqual(['02_add_index.js', '03_add_roles.js']);
      expect(result.applied).toEqual([]);
      expect(mockKnex.migrate.latest).not.toHaveBeenCalled();
    });

    it('runCloudMigration automatically detects and frees hanging stale migration lock', async () => {
      const forceFreeMock = vi.fn().mockResolvedValue(true);
      let queryTable = '';

      const mockKnex = Object.assign(
        (table) => {
          queryTable = table;
          return {
            first: vi.fn().mockResolvedValue({ is_locked: 1 }),
          };
        },
        {
          raw: vi.fn().mockResolvedValue({}),
          schema: {
            hasTable: vi.fn().mockResolvedValue(true),
          },
          migrate: {
            list: vi.fn().mockResolvedValue([['01_init.js'], ['02_next.js']]),
            latest: vi.fn().mockResolvedValue([2, ['02_next.js']]),
            forceFreeMigrationsLock: forceFreeMock,
          },
        }
      );

      const logs = [];
      const result = await runCloudMigration(mockKnex, {
        dryRun: false,
        waitForDb: false,
        unlockIfStale: true,
        logger: (m) => logs.push(m),
      });

      expect(forceFreeMock).toHaveBeenCalled();
      expect(mockKnex.migrate.latest).toHaveBeenCalled();
      expect(result.batch).toBe(2);
      expect(result.applied).toEqual(['02_next.js']);
      expect(logs.some((l) => l.includes('Unlocking...'))).toBe(true);
    });
  });

  // ====================================================
  // 4. deploy:check Cloud Migration Strategy Audit
  // ====================================================
  describe('deploy:check Migration Audit', () => {
    it('warns about missing migration job on Cloud Run when migrations exist', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
      fs.writeFileSync(path.join(tmpDir, 'server.js'), 'const { createApp } = require("webspresso"); createApp({ pagesDir: "./pages" });');
      fs.mkdirSync(path.join(tmpDir, 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'migrations', '20261020_init.js'), 'module.exports = {};');

      const report = await runDeployCheck({
        cwd: tmpDir,
        platform: 'cloudrun',
        env: 'production',
        skipExit: true,
      });

      const warn = report.warnings.find((w) => w.title === 'Cloud Migration Strategy');
      expect(warn).toBeDefined();
      expect(warn.message).toContain('add:migration-job --platform cloudrun');
    });

    it('passes Cloud Migration Strategy when cloudrun-job.yaml exists', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
      fs.writeFileSync(path.join(tmpDir, 'server.js'), 'const { createApp } = require("webspresso"); createApp({ pagesDir: "./pages" });');
      fs.mkdirSync(path.join(tmpDir, 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'migrations', '20261020_init.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(tmpDir, 'cloudrun-job.yaml'), 'kind: Job\n');

      const report = await runDeployCheck({
        cwd: tmpDir,
        platform: 'cloudrun',
        env: 'production',
        skipExit: true,
      });

      const pass = (report.passes || report.successes).find((p) => p.title === 'Cloud Migration Strategy');
      expect(pass).toBeDefined();
      expect(pass.message).toContain('Cloud Run migration job configuration found');
    });
  });
});
